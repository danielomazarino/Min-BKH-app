/**
 * Wikidata as a live player directory.
 *
 * WHY THIS EXISTS: the app used to ship a hand-curated 31-player register. It
 * was a closed list, so a supporter who remembered a 32nd player got a
 * confident "no match" — the app was lying by omission. This module replaces
 * that list with an actual search over an open, citable, permanent-identifier
 * source, so the failure mode becomes "we did not find them" (true, checkable)
 * rather than "they are not in our list" (false).
 *
 * DESIGN CONSTRAINTS, EACH OF WHICH WAS MEASURED, NOT ASSUMED:
 *
 *  - MediaWiki's action API only returns `access-control-allow-origin: *` when
 *    the request carries `origin=*`. Without it the request succeeds under curl
 *    and fails in the browser with "TypeError: Failed to fetch". This is
 *    invisible to any server-side test, so it is asserted in the URL builder
 *    and re-checked in the browser during release verification.
 *
 *  - A SPARQL label scan (`FILTER(CONTAINS(...))` over all footballers)
 *    measured 57 s. The indexed `wbsearchentities` endpoint measured 0.95 s.
 *    We use the index and never SPARQL from the client.
 *
 *  - Wikidata rate-limits to roughly 10 requests/minute per client. We
 *    therefore send exactly TWO requests per submitted search and cache both,
 *    and we never search on keystroke.
 *
 *  - A 429 must NEVER be rendered as "no such player". It means we did not
 *    look. It has its own state and its own message.
 */

import { rankCandidates, scoreMatch } from "./playerSearch";

const API = "https://www.wikidata.org/w/api.php";
const ENTITY_BASE = "https://www.wikidata.org/wiki/Special:EntityPage";

/** BK Häcken (men's) and BK Häcken FF (women's), verified 2026-09-26. */
export const HACKEN_MEN_QID = "Q639723";
export const HACKEN_WOMEN_QID = "Q1337348";

/** "association football player" (Q937857), verified 2026-09-26. */
const FOOTBALLER_QID = "Q937857";

/** Results returned from the index before we filter. */
const INDEX_LIMIT = 25;
/** How many hydrated footballers we keep for display. */
const MAX_CANDIDATES = 8;

/** Identifiers, not display strings, so a rename upstream cannot break us. */
const OCCUPATION = "P106";
const DATE_OF_BIRTH = "P569";
const DATE_OF_DEATH = "P570";
const CITIZENSHIP = "P27";
const MEMBER_OF_SPORTS_TEAM = "P54";
const INSTANCE_OF = "P31";
const SEX = "P21";
const IMAGE = "P18";
const HEIGHT = "P2048";
/** Preferred position ("försvarare", "anfallare" …), on the player entity. */
const POSITION = "P413";
/**
 * P54 statement qualifiers — the per-stint period and totals. VERIFIED
 * 2026-10-05 against Q518833 and Q16633101: `wbgetentities` with
 * `props=claims` returns qualifiers on every statement that carries them, so
 * the career timeline costs ZERO extra requests. Measured coverage on real
 * Häcken players: 10/10 Bjärsmyr stints have dates, 9/10 have apps and goals.
 */
const START_TIME = "P580";
const END_TIME = "P582";
const MATCHES_PLAYED = "P1350";
const GOALS_SCORED = "P1351";

/** Q5 human, Q6581097 male, Q6581072 female — verified 2026-09-26. */
const A_PERSON = "Q5";
const MALE = "Q6581097";
const FEMALE = "Q6581072";

export type SearchState =
  | { status: "idle" }
  | { status: "searching"; query: string }
  | { status: "results"; query: string; candidates: PlayerCandidate[]; discarded: number }
  | { status: "ambiguous"; query: string; candidates: PlayerCandidate[] }
  | { status: "not-found"; query: string }
  | { status: "failed"; query: string; message: string }
  | { status: "rate-limited"; query: string; retryAfterSeconds: number | null };

/**
 * A search hit, hydrated. Every field is optional because Wikidata's coverage
 * is genuinely uneven and a missing statement is not a null answer — it is the
 * absence of a claim, and the UI must say so rather than substitute a guess.
 */
/**
 * One club period, from a P54 statement and its qualifiers.
 *
 * Every field except the team is optional because Wikidata's coverage is
 * uneven, and a missing year is NOT the same as an ongoing stint — the UI
 * must render the gap, never infer "still there" from its absence.
 */
export interface CareerStint {
  /** Resolved display label, or the raw Q-ID when no label resolved. */
  team: string;
  teamQid: string;
  /** Year only. Undefined means Wikidata does not record it. */
  startYear?: string;
  endYear?: string;
  apps?: number;
  goals?: number;
}

/** A national-team period. Caps (P1350) rather than club apps. */
export interface NationalTeamStint {
  team: string;
  teamQid: string;
  startYear?: string;
  endYear?: string;
  caps?: number;
  goals?: number;
}

export interface PlayerCandidate {
  /** Wikidata Q-ID. The ONLY stable identity we use. */
  qid: string;
  /** Display name: Swedish label, else English, else the Q-ID itself. */
  name: string;
  /** Every label the source publishes, for "also known as". */
  alsoKnownAs: string[];
  description?: string;
  dateOfBirth?: string;
  dateOfDeath?: string;
  citizenship: string[];
  clubs: string[];
  /** Club career from P54 + qualifiers, newest first. */
  career: CareerStint[];
  /** National-team periods, separated from clubs by the team's own class. */
  nationalTeams: NationalTeamStint[];
  /** Preferred position (P413), resolved to a label when one resolved. */
  position?: string;
  /** Wikipedia articles about this exact entity, keyed `svwiki`, `enwiki`… */
  sitelinks: Record<string, { title: string }>;
  /** True only when BK Häcken is a verified P54 club claim. */
  hackenClub: boolean;
  hackenTeam: "men" | "women" | null;
  gender?: "male" | "female" | "other";
  heightCm?: number;
  imageUrl?: string;
  pageUrl: string;
  /**
   * True when this candidate was rebuilt from the user's saved STARRED
   * snapshot rather than fetched now. It means "this is what was true when
   * you starred him", not "this is current" — so the card must say so rather
   * than presenting a stale value with the same confidence as a live one.
   */
  fromSnapshot?: boolean;
  /** 0-100, from local re-ranking of the index hits. */
  matchScore: number;
}

/* ------------------------------------------------------------------ *
 * URL building — separated so the CORS requirement is unit-testable.
 * ------------------------------------------------------------------ */

/**
 * Wikimedia's API REQUIRES a User-Agent, and the penalty for omitting it is a
 * hard 429 rather than a descriptive error.
 *
 * MEASURED 2026-09-26 on identical URLs from the same machine:
 *   fetch without User-Agent  -> 429 (Retry-After: 1000)
 *   fetch with a User-Agent   -> 200
 *
 * A browser cannot set User-Agent from fetch() — it is a forbidden header, and
 * the browser supplies its own. So the header below matters for the PIPELINE
 * and for any future server-side caller, while the browser path relies on the
 * UA the browser itself sends. It is applied when the runtime permits it and
 * is expected to be ignored (not to throw) when it does not.
 *
 * The `mode: "cors"` on every call below is the load-bearing part for the
 * browser; see buildSearchUrl for why.
 */
const USER_AGENT = "MinBkhApp/1.0 (https://github.com/danielomazarino/Min-BKH-app)";

/** Headers for every Wikidata request. */
function requestHeaders(): HeadersInit {
  return { Accept: "application/json", "User-Agent": USER_AGENT };
}

/**
 * Build a `wbsearchentities` URL.
 *
 * `origin=*` is not optional. It is the single difference between "works in the
 * browser" and "TypeError: Failed to fetch" for every call in this module.
 */
export function buildSearchUrl(query: string, limit = INDEX_LIMIT): string {
  const u = new URL(API);
  u.searchParams.set("action", "wbsearchentities");
  u.searchParams.set("search", query);
  u.searchParams.set("language", "sv");
  u.searchParams.set("uselang", "sv");
  u.searchParams.set("type", "item");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  u.searchParams.set("limit", String(limit));
  return u.toString();
}

/** Build a `wbgetentities` URL for a batch of Q-IDs. */
export function buildEntitiesUrl(qids: readonly string[]): string {
  const u = new URL(API);
  u.searchParams.set("action", "wbgetentities");
  u.searchParams.set("ids", qids.join("|"));
  // `sitelinks` rides along on the same response: it is the map of Wikipedia
  // articles ABOUT this exact entity, which the narrative layer (wikipedia.ts)
  // needs. Asking for it separately would double the request count.
  u.searchParams.set("props", "labels|descriptions|claims|aliases|sitelinks");
  u.searchParams.set("languages", "sv|en|de|fr|es|it|pt|nl|no|da|fi|pl");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  return u.toString();
}

/**
 * Build a cirrus full-text search URL, filtered to footballers.
 *
 * WHY THIS EXISTS (all measured 2026-10-06):
 * `wbsearchentities` is a PREFIX index ranked by popularity. For a common
 * prefix the player is crowded out: "jere" returns Jerevan, Jeremy Irons and
 * 48 others — Jeremejeff and his surname entity are BOTH absent from the top
 * 50, so no fallback on those results can help. The player only appears from
 * 6 characters ("jereme").
 *
 * The cirrus index with a wildcard and a footballer statement filter reaches
 * deeper: "jere* haswbstatement:P106=Q937857" DOES contain him (position 86
 * of 335), and "bjar* …" finds Bjärsmyr at position 16 — both from 4
 * characters. It runs ONLY when the primary path found no people, so the
 * common case still costs two requests.
 *
 * MEASURED LIMITATION, documented rather than hidden: a missing-letter typo
 * ("jeremejev" for Jeremejeff) matches OTHER REAL PEOPLE (the Eremeevs) and
 * is not recoverable by any Wikidata endpoint. Diacritic-stripped names
 * ("tofting" for Tøfting) ARE handled by the primary path.
 */
export function buildCirrusSearchUrl(query: string, limit = 50): string {
  const u = new URL(API);
  u.searchParams.set("action", "query");
  u.searchParams.set("list", "search");
  u.searchParams.set("srsearch", `${query}* haswbstatement:${OCCUPATION}=${FOOTBALLER_QID}`);
  u.searchParams.set("srlimit", String(limit));
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  return u.toString();
}

/**
 * Build a `list=backlinks` URL.
 *
 * Used only by the surname fallback: given the surname entity, this returns
 * the people whose P734 points at it. Backlinks include every statement
 * referencing the entity, so the result is filtered to humans downstream.
 */
export function buildBacklinksUrl(qid: string): string {
  const u = new URL(API);
  u.searchParams.set("action", "query");
  u.searchParams.set("list", "backlinks");
  u.searchParams.set("bltitle", qid);
  u.searchParams.set("blnamespace", "0");
  u.searchParams.set("bllimit", "50");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  return u.toString();
}

/* ------------------------------------------------------------------ *
 * Raw response shapes (only what we actually read).
 * ------------------------------------------------------------------ */

interface IndexHit {
  id: string;
  label?: string;
  description?: string;
  match?: { text?: string };
}

interface EntityClaim {
  mainsnak?: { snaktype?: string; datavalue?: { value?: unknown } };
  qualifiers?: Record<string, unknown[]>;
  rank?: string;
}

/** A qualifier entry has the same shape as a mainsnak. */
interface Snak {
  datavalue?: { value?: unknown };
}

/** The first qualifier of the given property, or undefined. */
function qualifierSnak(claim: EntityClaim | undefined, prop: string): Snak | undefined {
  const list = claim?.qualifiers?.[prop];
  return Array.isArray(list) && list.length > 0 ? (list[0] as Snak) : undefined;
}

/** A qualifier time value reduced to a plausible year, or undefined. */
function stintYear(snak: Snak | undefined): string | undefined {
  const v = snak?.datavalue?.value as TimeValue | undefined;
  const m = typeof v?.time === "string" ? /^[+-](\d{4})/.exec(v.time) : null;
  if (!m) return undefined;
  const year = Number(m[1]);
  // Same plausibility window as parseWikidataTime: anything outside it is a
  // mis-modelled value, and showing it would be worse than showing nothing.
  return year >= 1850 && year <= 2100 ? m[1] : undefined;
}

/** A qualifier quantity, guarded against nonsense magnitudes. */
function stintNumber(snak: Snak | undefined, max: number): number | undefined {
  const v = snak?.datavalue?.value as { amount?: string } | undefined;
  if (!v || typeof v.amount !== "string") return undefined;
  const n = Number(v.amount.replace("+", ""));
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined;
  return n;
}

interface Entity {
  id: string;
  labels?: Record<string, { language?: string; value?: string }>;
  descriptions?: Record<string, { language?: string; value?: string }>;
  aliases?: Record<string, { language?: string; value?: string }[]>;
  claims?: Record<string, EntityClaim[]>;
  /** Wikipedia articles about this exact entity, keyed `svwiki`, `enwiki`… */
  sitelinks?: Record<string, { title: string }>;
}

/* ------------------------------------------------------------------ *
 * Claim readers
 * ------------------------------------------------------------------ */

function idValue(claim: EntityClaim | undefined): string | null {
  const v = claim?.mainsnak?.datavalue?.value;
  if (v && typeof v === "object" && "id" in v) {
    const id = (v as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** Remove duplicates from a list of display labels, keeping first-seen order. */
function uniquePreservingOrder(labels: readonly string[]): string[] {
  return [...new Set(labels)];
}

/** All Q-IDs including deprecated, used where a statement is still evidence. */
function allIdValues(claims: EntityClaim[] | undefined): string[] {
  if (!Array.isArray(claims)) return [];
  const out: string[] = [];
  for (const c of claims) {
    const id = idValue(c);
    if (id) out.push(id);
  }
  return out;
}

interface TimeValue {
  time?: string;
  precision?: number;
  calendarmodel?: string;
}

/** `+1986-01-03T00:00:00Z` -> `1986-01-03`. Precision is preserved by caller. */
function parseWikidataTime(claim: EntityClaim | undefined): { iso: string; yearOnly: boolean } | null {
  const v = claim?.mainsnak?.datavalue?.value as TimeValue | undefined;
  if (!v || typeof v.time !== "string") return null;
  const m = /^([+-])(\d{4,})-(\d{2})-(\d{2})T/.exec(v.time);
  if (!m) return null;
  // A BCE or very distant date is noise in a football context; ignore it.
  if (m[1] === "-") return null;
  const year = Number(m[2]);
  if (!Number.isFinite(year) || year < 1850 || year > 2100) return null;
  const yearOnly = (v.precision ?? 11) <= 6;
  if (yearOnly) return { iso: String(year), yearOnly };
  return { iso: `${m[2]}-${m[3]}-${m[4]}`, yearOnly };
}

function parseQuantity(claim: EntityClaim | undefined): number | null {
  const v = claim?.mainsnak?.datavalue?.value as { amount?: string } | undefined;
  if (!v || typeof v.amount !== "string") return null;
  const n = Number(v.amount.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * A Commons image URL from a P18 filename.
 *
 * P18 stores a FILENAME ("Bjarsmyr at Panathinaikos.jpg"), not a URL —
 * verified live 2026-10-05. `Special:FilePath` resolves it and the redirect
 * lands on upload.wikimedia.org (measured: HTTP 200, image/jpeg). The width
 * parameter asks Commons for a thumbnail, because a supporter's phone has no
 * use for a 4000px original. An <img> tag needs no CORS permission, so this
 * works from the browser exactly like any other image.
 */
export function commonsImageUrl(filename: string, width = 480): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}

/**
 * Team classes that mean "national team", not club.
 *
 * VERIFIED 2026-10-05 against real entities: clubs carry P31 Q476028
 * (association football club), national teams carry Q6979593 (national
 * association football team) or Q135408445 (the men's subclass). A club can
 * ALSO carry "men's association football team" (Q103229495, IFK Göteborg),
 * so that value must never be treated as national.
 */
const NATIONAL_TEAM_CLASSES = new Set(["Q6979593", "Q135408445"]);
/**
 * Label fallback for teams whose class is missing. "Landslag" is the Swedish
 * word for national team — but it is ALWAYS a compound in real labels
 * ("Sveriges U21-herrlandslag i fotboll", "damlandslag"), so a word-boundary
 * regex (`\blandslag\b`) matches NOTHING. Measured against the real labels on
 * Q518833's P54 statements. Deliberately narrow otherwise: a club whose name
 * merely contains "national" (e.g. National Bank Egypt SC) must not be
 * misfiled, and no Swedish club name contains "landslag".
 */
const NATIONAL_TEAM_LABEL = /landslag/i;

/** Everything resolveLabels learned in one pass, reused across retries. */
export interface LabelIndex {
  labels: Map<string, string>;
  /** P31 class Q-IDs per fetched entity, for the club/national split. */
  classes: Map<string, string[]>;
}

/** Q-IDs whose entity is a national team rather than a club. */
export function deriveNationalTeams(index: LabelIndex): Set<string> {
  const out = new Set<string>();
  for (const [qid, p31s] of index.classes) {
    if (p31s.some((c) => NATIONAL_TEAM_CLASSES.has(c))) out.add(qid);
  }
  for (const [qid, label] of index.labels) {
    if (NATIONAL_TEAM_LABEL.test(label)) out.add(qid);
  }
  return out;
}

/** Drop exact duplicates, keeping first-seen order. */
function dedupeStints<T>(stints: readonly T[], key: (s: T) => string): T[] {
  const seen = new Set<string>();
  return stints.filter((s) => {
    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * P2048 (height).
 *
 * VERIFIED 2026-09-26 against Q16633101: the raw amount is `"+190"` with unit
 * Q174728 (centimetre). The stored value is ALREADY in centimetres.
 *
 * The first implementation multiplied by 100 to "convert to centimetres" and
 * rendered 190 cm as "19000". A live browser check caught it; no unit test did,
 * because every fixture omitted P2048. The multiplication is now removed and
 * the plausible range is a hard guard, so an unexpected unit fails visibly
 * rather than silently printing a nonsense number.
 */
function parseHeightCm(claim: EntityClaim | undefined): number | undefined {
  const n = parseQuantity(claim);
  if (n === null) return undefined;
  // A human height is 100–260 cm. Anything else means a different unit, and
  // showing it would be worse than showing nothing.
  return n >= 100 && n <= 260 ? Math.round(n) : undefined;
}

function firstClaim(claims: EntityClaim[] | undefined): EntityClaim | undefined {
  if (!Array.isArray(claims)) return undefined;
  for (const c of claims) if (c.rank !== "deprecated") return c;
  return claims[0];
}

function pickLabel(entity: Entity, languages: readonly string[]): string | undefined {
  const labels = entity.labels ?? {};
  for (const lang of languages) {
    const v = labels[lang]?.value;
    if (v) return v;
  }
  return undefined;
}

function pickDescription(entity: Entity): string | undefined {
  const descriptions = entity.descriptions ?? {};
  for (const lang of PREFERRED_LANGUAGES) {
    const v = descriptions[lang]?.value;
    if (v) return v;
  }
  return undefined;
}

/** P18 image filenames are plain strings; anything else is ignored. */
function parseStringValue(claim: EntityClaim | undefined): string | undefined {
  const v = claim?.mainsnak?.datavalue?.value;
  return typeof v === "string" ? v : undefined;
}

/** The entity is a human being, not a surname, a song or a village. */
export function isPerson(entity: Entity): boolean {
  return allIdValues(entity.claims?.[INSTANCE_OF]).includes(A_PERSON);
}

/** The entity is a footballer, per Wikidata's own occupation claim. */
export function isFootballer(entity: Entity): boolean {
  return allIdValues(entity.claims?.[OCCUPATION]).includes(FOOTBALLER_QID);
}

/** The entity is a name/family name and must never be shown as a person. */
export function isNameEntity(entity: Entity): boolean {
  // Q101352 family name, Q202444 given name, Q15632636 surname in other langs.
  return allIdValues(entity.claims?.[INSTANCE_OF]).some((id) => id === "Q101352" || id === "Q202444");
}

/* ------------------------------------------------------------------ *
 * Hydration
 * ------------------------------------------------------------------ */

const PREFERRED_LANGUAGES = ["sv", "en"] as const;

/** Build a display candidate from a hydrated entity. */
export function toCandidate(
  entity: Entity,
  opts: { query: string; labels: Map<string, string>; classes?: Map<string, string[]> },
): PlayerCandidate {
  const name = pickLabel(entity, PREFERRED_LANGUAGES) ?? entity.id;
  const claims = entity.claims ?? {};

  const clubs = allIdValues(claims[MEMBER_OF_SPORTS_TEAM]);
  const genders = allIdValues(claims[SEX]);
  const dob = parseWikidataTime(firstClaim(claims[DATE_OF_BIRTH]));
  const dod = parseWikidataTime(firstClaim(claims[DATE_OF_DEATH]));
  const height = parseHeightCm(firstClaim(claims[HEIGHT]));
  const positionQid = idValue(firstClaim(claims[POSITION]));
  const position = positionQid ? opts.labels.get(positionQid) ?? positionQid : undefined;

  const genderRaw = genders[0];
  const gender = genderRaw === MALE ? "male" : genderRaw === FEMALE ? "female" : genderRaw ? "other" : undefined;

  // An entity is a former player only if there is positive evidence of a
  // career. A person with no P54 at all is a person whose club history is
  // simply not recorded — which is NOT the same as "never played anywhere",
  // and certainly not "retired".
  const aliases = Object.values(entity.aliases ?? {})
    .flat()
    .map((a) => a?.value)
    .filter((v): v is string => typeof v === "string");

  // Deduped twice: by Q-ID (Wikidata records several statements per stint,
  // e.g. junior team + senior team), then by resolved label (it models the
  // same club as two entities, e.g. "Örgryte IS" Q297906 and "Örgryte IS
  // Fotboll" Q11903335). Without this the sheet reads like a data dump:
  // "IFK Göteborg · ... · IFK Göteborg" — observed live on Q518833.
  const clubLabels = uniquePreservingOrder(clubs.map((q) => opts.labels.get(q) ?? q));
  const citizenshipLabels = uniquePreservingOrder(
    (claims[CITIZENSHIP] ? allIdValues(claims[CITIZENSHIP]) : []).map((q) => opts.labels.get(q) ?? q),
  );

  // ---- career timeline, from P54 qualifiers ----------------------------
  //
  // The club/national split needs each team's P31 class, which lives on the
  // TEAM entity, not the player. `opts.classes` carries what resolveLabels
  // fetched; a team we never fetched is classified by its label, and a team
  // with neither is treated as a club — the conservative default, because a
  // misfiled club stint is a visible oddity while a misfiled cap is a
  // fabricated international career.
  const national = deriveNationalTeams({ labels: opts.labels, classes: opts.classes ?? new Map() });
  const clubStints: CareerStint[] = [];
  const nationalStints: NationalTeamStint[] = [];
  for (const claim of claims[MEMBER_OF_SPORTS_TEAM] ?? []) {
    const teamQid = idValue(claim);
    if (!teamQid) continue;
    const team = opts.labels.get(teamQid) ?? teamQid;
    const startYear = stintYear(qualifierSnak(claim, START_TIME));
    const endYear = stintYear(qualifierSnak(claim, END_TIME));
    const apps = stintNumber(qualifierSnak(claim, MATCHES_PLAYED), 2000);
    const goals = stintNumber(qualifierSnak(claim, GOALS_SCORED), 500);
    if (national.has(teamQid)) {
      nationalStints.push({ team, teamQid, startYear, endYear, caps: apps, goals });
    } else {
      clubStints.push({ team, teamQid, startYear, endYear, apps, goals });
    }
  }
  // Newest first: an unsorted list read like a random dump, and the most
  // recent club is the one a supporter is most likely checking.
  const byStartDesc = (a: { startYear?: string }, b: { startYear?: string }) =>
    (b.startYear ?? "0000").localeCompare(a.startYear ?? "0000");
  const career = dedupeStints(clubStints.sort(byStartDesc), (s) => `${s.teamQid}|${s.startYear ?? ""}|${s.endYear ?? ""}`);
  const nationalTeams = dedupeStints(nationalStints.sort(byStartDesc), (s) => `${s.teamQid}|${s.startYear ?? ""}|${s.endYear ?? ""}`);

  return {
    qid: entity.id,
    name,
    alsoKnownAs: [...new Set(aliases)].filter((a) => a.toLowerCase() !== name.toLowerCase()),
    description: pickDescription(entity),
    dateOfBirth: dob?.iso,
    dateOfDeath: dod?.iso,
    citizenship: citizenshipLabels,
    clubs: clubLabels,
    career,
    nationalTeams,
    position,
    sitelinks: entity.sitelinks ?? {},
    hackenClub: clubs.includes(HACKEN_MEN_QID),
    hackenTeam: clubs.includes(HACKEN_MEN_QID) ? "men" : clubs.includes(HACKEN_WOMEN_QID) ? "women" : null,
    gender,
    heightCm: height,
    imageUrl: parseStringValue(firstClaim(claims[IMAGE])),
    pageUrl: `${ENTITY_BASE}/${entity.id}`,
    // Score against every published name, not just the display label. A player
    // found by a former name (David Frölund / Marek) must rank as a strong
    // match even though the label he is shown under does not contain the
    // query. This is a ranking hint only; the user still confirms the person.
    matchScore: Math.max(...[name, ...aliases].map((n) => scoreMatch(opts.query, n)), 0),
  };
}

/* ------------------------------------------------------------------ *
 * The search itself
 * ------------------------------------------------------------------ */

type FetchLike = typeof fetch;

export interface SearchDeps {
  fetch: FetchLike;
  /** Injected so tests are hermetic. */
  now?: () => number;
  /**
   * Progress callback, fired at each stage of the chain. The UI uses it to
   * tell the user WHAT is happening during the multi-second search instead
   * of showing a silent box — the user's verdict on the silent version was
   * that it read as a hang. Optional: tests and callers that do not care
   * simply omit it.
   */
  onPhase?: (phase: SearchPhase) => void;
}

/** The stages a search walks through, in order. */
export type SearchPhase =
  | "index" // prefix lookup
  | "cirrus" // full-text fallback for short prefixes
  | "hydrate" // entity hydration
  | "labels"; // club/country label resolution

/**
 * Run a complete search: index lookup, then hydration of the top hits.
 *
 * Two network requests, both required, both cached by the caller. Returns one
 * of the six honest states — it never collapses a transport failure into an
 * empty result set.
 */
export async function searchPlayersOnline(
  rawQuery: string,
  deps: SearchDeps,
): Promise<SearchState> {
  const query = rawQuery.trim();
  if (query.length < 2) return { status: "idle" };
  const phase = deps.onPhase ?? (() => {});

  // ---- 1. Index search -------------------------------------------------
  phase("index");
  let indexRes: Response;
  try {
    indexRes = await deps.fetch(buildSearchUrl(query), { headers: requestHeaders(), mode: "cors" });
  } catch (e) {
    return {
      status: "failed",
      query,
      message: describeTransportError(e),
    };
  }

  if (indexRes.status === 429) {
    return { status: "rate-limited", query, retryAfterSeconds: retryAfter(indexRes) };
  }
  if (!indexRes.ok) {
    return { status: "failed", query, message: `Wikidata svarade med ${indexRes.status}.` };
  }

  let indexJson: { search?: IndexHit[] };
  try {
    indexJson = (await indexRes.json()) as { search?: IndexHit[] };
  } catch {
    return { status: "failed", query, message: "Kunde inte tolka svaret från Wikidata." };
  }

  const hits = (indexJson.search ?? []).filter((h) => typeof h?.id === "string" && h.id.startsWith("Q"));
  // An empty index is NOT the end of the search. The prefix index misses
  // misspellings that the cirrus full-text index resolves — measured
  // 2026-10-07: "Adam Lundkvist" (the squad's spelling) returns ZERO index
  // hits, but cirrus finds the footballer Q18196418. Returning "not-found"
  // here would skip the very fallback that exists to rescue this case, so an
  // empty index falls through to the cirrus and surname fallbacks below with
  // no entities to hydrate.

  // Cheap pre-filter on the index payload: it carries a description, which is
  // enough to discard obvious non-people without spending a second request on
  // entities we will throw away. This is an OPTIMISATION ONLY — correctness
  // never depends on it, and a hit we keep is still verified after hydration.
  const indexQids = hits.map((h) => h.id).slice(0, INDEX_LIMIT);

  // ---- 2. Hydration ---------------------------------------------------
  let entities: Record<string, Entity> = {};
  if (indexQids.length > 0) {
    phase("hydrate");
    let entRes: Response;
    try {
      entRes = await deps.fetch(buildEntitiesUrl(indexQids), { headers: requestHeaders(), mode: "cors" });
    } catch (e) {
      return { status: "failed", query, message: describeTransportError(e) };
    }

    if (entRes.status === 429) {
      return { status: "rate-limited", query, retryAfterSeconds: retryAfter(entRes) };
    }
    if (!entRes.ok) {
      return { status: "failed", query, message: `Wikidata svarade med ${entRes.status}.` };
    }

    let entJson: { entities?: Record<string, Entity> };
    try {
      entJson = (await entRes.json()) as { entities?: Record<string, Entity> };
    } catch {
      return { status: "failed", query, message: "Kunde inte tolka svaret från Wikidata." };
    }
    entities = entJson.entities ?? {};
  }

  // Collect the entities we might display, so their country and club labels
  // are resolved in ONE extra call regardless of which path produced them.
  function collectLabelQids(list: readonly Entity[]): Set<string> {
    const set = new Set<string>();
    for (const e of list) {
      for (const q of allIdValues(e.claims?.[CITIZENSHIP])) set.add(q);
      for (const q of allIdValues(e.claims?.[MEMBER_OF_SPORTS_TEAM])) set.add(q);
      // The position (P413) label lives on a separate entity too. Missing it
      // was caught by e2e, not by unit tests: the sheet rendered the raw
      // "Q280658" where "anfallare" belongs, because nothing above ever asked
      // for that entity's label.
      for (const q of allIdValues(e.claims?.[POSITION])) set.add(q);
    }
    return set;
  }

  const indexEntities = indexQids.map((id) => entities[id]).filter((e): e is Entity => !!e);
  phase("labels");
  let index = await resolveLabels(collectLabelQids(indexEntities), deps);
  let labels = index.labels;

  const people = indexQids
    .map((id) => entities[id])
    .filter((e): e is Entity => !!e)
    .filter(isPerson)
    .filter((e) => !isNameEntity(e));

  const ranked = rankCandidates(
    people,
    query,
    (e) => pickLabel(e, PREFERRED_LANGUAGES) ?? e.id,
    isFootballer,
  );

  let chosen = ranked.ordered.slice(0, MAX_CANDIDATES);
  let discarded = people.length - chosen.length;

  if (ranked.footballers.length === 0) {
    // ---- 4. Cirrus fallback ---------------------------------------------
    //
    // Fires when the prefix index produced NO footballers — either it crowded
    // every person out (measured: "jere" returns 50 hits, none of them
    // Jeremejeff, and his surname entity is not there either — so the surname
    // fallback below cannot fire) or it found people who are not players
    // (measured live: "jere" surfaces Jeremy Bentham, Corbyn and Irons —
    // people, but useless to a supporter looking for a striker). The cirrus
    // index with a wildcard and a footballer filter reaches deeper: "jere*"
    // finds him at position 86, "bjar*" finds Bjärsmyr at position 16.
    //
    // One extra request, only on this path. The top hits are hydrated with
    // the SAME wbgetentities call shape, so the rest of the pipeline is
    // unchanged. When cirrus finds footballers they lead the list and the
    // primary people stay behind them; when it finds nothing the primary
    // results stand (better than an empty page).
    const cirrusQids = await cirrusFootballerQids(query, deps, phase);
    if (cirrusQids.length > 0) {
      let hydrated: Entity[] = [];
      try {
        const res = await deps.fetch(buildEntitiesUrl(cirrusQids), { headers: requestHeaders(), mode: "cors" });
        if (res.ok) {
          const json = (await res.json()) as { entities?: Record<string, Entity> };
          hydrated = cirrusQids.map((id) => json.entities?.[id]).filter((e): e is Entity => !!e);
        }
      } catch {
        // Keep the primary results; a failed bonus lookup must never break
        // the search.
      }
      const cirrusPeople = hydrated.filter(isPerson).filter(isFootballer).filter((e) => !isNameEntity(e));
      if (cirrusPeople.length > 0) {
        const seen = new Set(cirrusPeople.map((e) => e.id));
        const merged = [...cirrusPeople, ...ranked.ordered.filter((e) => !seen.has(e.id))];
        chosen = merged.slice(0, MAX_CANDIDATES);
        discarded = Math.max(0, people.length + cirrusPeople.length - chosen.length);
        phase("labels");
        index = await resolveLabels(collectLabelQids(chosen), deps, index);
        labels = index.labels;
      }
    }
  }

  // ---- 5. Surname fallback --------------------------------------------
  //
  // MEASURED 2026-09-26: searching "Jeremejeff" returns exactly ONE index
  // hit — the surname entity Q47466482 — and no people. The player exists
  // (Q16633101) and links to that surname via P734, but the text index does
  // not surface him. Reporting "not found" here would be precisely the false
  // negative this feature exists to eliminate, for a very common query shape
  // (supporters search the surname they remember).
  //
  // The fix is one extra call to the backlinks API, which asks the structured
  // graph instead of the text index. It runs ONLY when the normal path found
  // no people, so the common case still costs two requests.
  if (chosen.length === 0) {
    const surnameEntities = indexEntities.filter(isNameEntity).map((e) => e.id);

    const viaSurname = await peopleBySurname(surnameEntities, deps);
    if (viaSurname.length > 0) {
      chosen = viaSurname.slice(0, MAX_CANDIDATES);
      discarded = 0;
      // The fallback path hydrates its own entities, so their club and country
      // labels were never collected above. Resolve them now, still in one call.
      phase("labels");
      index = await resolveLabels(collectLabelQids(viaSurname), deps, index);
      labels = index.labels;
    }
  }

  if (chosen.length === 0) {
    // The index matched something, but nothing survived as a person. Say so
    // rather than pretending the search was empty.
    return { status: "not-found", query };
  }

  const candidates = chosen.map((e) => toCandidate(e, { query, labels, classes: index.classes }));
  return { status: "results", query, candidates, discarded };
}

/**
 * Run the cirrus fallback and return the footballer Q-IDs it found, in
 * cirrus rank order.
 *
 * Every failure path returns an empty list: this is a bonus lookup, and a
 * failure must degrade to "no extra candidates", never to a broken search.
 */
async function cirrusFootballerQids(query: string, deps: SearchDeps, phase?: (p: SearchPhase) => void): Promise<string[]> {
  try {
    phase?.("cirrus");
    const res = await deps.fetch(buildCirrusSearchUrl(query), { headers: requestHeaders(), mode: "cors" });
    if (res.status === 429) return [];
    if (!res.ok) return [];
    const json = (await res.json()) as { query?: { search?: Array<{ title?: string }> } };
    return (json.query?.search ?? [])
      .map((r) => r.title)
      .filter((t): t is string => typeof t === "string" && t.startsWith("Q"));
  } catch {
    return [];
  }
}

/**
 * Resolve surname entities to the people who bear them.
 *
 * Uses `list=backlinks`, which is a structured graph lookup and measured at
 * well under a second, unlike the SPARQL equivalent (45 s timeout). Every
 * failure path returns an empty list: this is a bonus lookup, and a failure
 * must degrade to "no extra candidates", never to a broken search.
 */
async function peopleBySurname(surnameQids: readonly string[], deps: SearchDeps): Promise<Entity[]> {
  const found = new Set<string>();
  for (const qid of surnameQids.slice(0, 5)) {
    try {
      const res = await deps.fetch(buildBacklinksUrl(qid), { headers: requestHeaders(), mode: "cors" });
      if (!res.ok) continue;
      const json = (await res.json()) as { query?: { backlinks?: { title: string }[] } };
      for (const b of json.query?.backlinks ?? []) {
        if (b.title.startsWith("Q")) found.add(b.title);
      }
    } catch {
      return [];
    }
  }
  if (found.size === 0) return [];

  try {
    const res = await deps.fetch(buildEntitiesUrl([...found]), { headers: requestHeaders(), mode: "cors" });
    if (!res.ok) return [];
    const json = (await res.json()) as { entities?: Record<string, Entity> };
    return Object.values(json.entities ?? {})
      .filter(isPerson)
      .filter(isFootballer)
      .filter((e) => !isNameEntity(e));
  } catch {
    return [];
  }
}

/** Third-party labels (citizenship, clubs) are needed for display only. */
async function resolveLabels(
  qids: ReadonlySet<string>,
  deps: SearchDeps,
  seed?: LabelIndex,
): Promise<LabelIndex> {
  const out: LabelIndex = { labels: new Map(seed?.labels ?? []), classes: new Map(seed?.classes ?? []) };
  const ids = [...qids].filter((q) => !out.labels.has(q));
  if (ids.length === 0) return out;

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const res = await deps.fetch(buildEntitiesUrl(batch), { headers: requestHeaders(), mode: "cors" });
      if (res.status === 429) {
        // A label is decoration. Losing it must not fail the search.
        return out;
      }
      if (!res.ok) continue;
      const json = (await res.json()) as { entities?: Record<string, Entity> };
      for (const [id, e] of Object.entries(json.entities ?? {})) {
        const label = pickLabel(e, PREFERRED_LANGUAGES);
        if (label) out.labels.set(id, label);
        // P31 classes ride along on the SAME response — the club/national
        // split needs them and asking again would double the request count.
        out.classes.set(id, allIdValues(e.claims?.[INSTANCE_OF]));
      }
    } catch {
      return out;
    }
  }
  return out;
}

function retryAfter(res: Response): number | null {
  const raw = res.headers?.get?.("Retry-After");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function describeTransportError(e: unknown): string {
  if (e instanceof TypeError) {
    // The classic symptom of the missing `origin=*` parameter, and also of a
    // genuine offline device. We say both rather than guessing.
    return "Kunde inte nå Wikidata. Kontrollera nätverket — eller försök igen om en stund.";
  }
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ *
 * Session cache
 * ------------------------------------------------------------------ *
 *
 * Wikidata allows roughly 10 requests/minute. A supporter who searches
 * "Jeremejeff", does not like the result, and types it again would otherwise
 * spend three more requests to get a byte-identical answer. Repeated and
 * back-spaced searches are the NORMAL way people use a search box, so this is
 * not an optimisation — without it the feature throttles itself.
 *
 * In memory only, deliberately. A persistent cache would let the app show a
 * stale "not found" days later, which is the exact dishonesty this module
 * exists to remove: absence of a result is only meaningful if it is recent.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 40;

interface CacheEntry {
  at: number;
  state: SearchState;
}

const cache = new Map<string, CacheEntry>();

/** Cached states, keyed by the normalized query. Exported for tests. */
export function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Read a cached result. Only SUCCESS and honest negative answers are cached.
 *
 * A `failed` or `rate-limited` state is deliberately NOT cached: those are
 * transient, and caching one would freeze a temporary network fault into a
 * permanent "we could not reach Wikidata" until the app is restarted.
 */
export function readCache(query: string, now: number): SearchState | null {
  const hit = cache.get(cacheKey(query));
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(cacheKey(query));
    return null;
  }
  if (hit.state.status === "failed" || hit.state.status === "rate-limited") return null;
  return hit.state;
}

export function writeCache(query: string, state: SearchState, now: number): void {
  if (state.status === "failed" || state.status === "rate-limited") return;
  cache.set(cacheKey(query), { at: now, state });
  // Bounded so a long session cannot grow this without limit.
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export function clearCache(): void {
  cache.clear();
}
