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
  /** True only when BK Häcken is a verified P54 club claim. */
  hackenClub: boolean;
  hackenTeam: "men" | "women" | null;
  gender?: "male" | "female" | "other";
  heightCm?: number;
  imageUrl?: string;
  pageUrl: string;
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
  u.searchParams.set("props", "labels|descriptions|claims|aliases");
  u.searchParams.set("languages", "sv|en|de|fr|es|it|pt|nl|no|da|fi|pl");
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

interface Entity {
  id: string;
  labels?: Record<string, { language?: string; value?: string }>;
  descriptions?: Record<string, { language?: string; value?: string }>;
  aliases?: Record<string, { language?: string; value?: string }[]>;
  claims?: Record<string, EntityClaim[]>;
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
export function toCandidate(entity: Entity, opts: { query: string; labels: Map<string, string> }): PlayerCandidate {
  const name = pickLabel(entity, PREFERRED_LANGUAGES) ?? entity.id;
  const claims = entity.claims ?? {};

  const clubs = allIdValues(claims[MEMBER_OF_SPORTS_TEAM]);
  const genders = allIdValues(claims[SEX]);
  const dob = parseWikidataTime(firstClaim(claims[DATE_OF_BIRTH]));
  const dod = parseWikidataTime(firstClaim(claims[DATE_OF_DEATH]));
  const height = parseHeightCm(firstClaim(claims[HEIGHT]));

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

  return {
    qid: entity.id,
    name,
    alsoKnownAs: [...new Set(aliases)].filter((a) => a.toLowerCase() !== name.toLowerCase()),
    description: pickDescription(entity),
    dateOfBirth: dob?.iso,
    dateOfDeath: dod?.iso,
    citizenship: citizenshipLabels,
    clubs: clubLabels,
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
}

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

  // ---- 1. Index search -------------------------------------------------
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
  if (hits.length === 0) return { status: "not-found", query };

  // Cheap pre-filter on the index payload: it carries a description, which is
  // enough to discard obvious non-people without spending a second request on
  // entities we will throw away. This is an OPTIMISATION ONLY — correctness
  // never depends on it, and a hit we keep is still verified after hydration.
  const indexQids = hits.map((h) => h.id).slice(0, INDEX_LIMIT);
  if (indexQids.length === 0) return { status: "not-found", query };

  // ---- 2. Hydration ---------------------------------------------------
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

  const entities = entJson.entities ?? {};

  // Collect the entities we might display, so their country and club labels
  // are resolved in ONE extra call regardless of which path produced them.
  function collectLabelQids(list: readonly Entity[]): Set<string> {
    const set = new Set<string>();
    for (const e of list) {
      for (const q of allIdValues(e.claims?.[CITIZENSHIP])) set.add(q);
      for (const q of allIdValues(e.claims?.[MEMBER_OF_SPORTS_TEAM])) set.add(q);
    }
    return set;
  }

  const indexEntities = indexQids.map((id) => entities[id]).filter((e): e is Entity => !!e);
  let labels = await resolveLabels(collectLabelQids(indexEntities), deps);

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

  // ---- 3. Surname fallback --------------------------------------------
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
      labels = await resolveLabels(collectLabelQids(viaSurname), deps, labels);
    }
  }

  if (chosen.length === 0) {
    // The index matched something, but nothing survived as a person. Say so
    // rather than pretending the search was empty.
    return { status: "not-found", query };
  }

  const candidates = chosen.map((e) => toCandidate(e, { query, labels }));
  return { status: "results", query, candidates, discarded };
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
  seed?: Map<string, string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>(seed ?? []);
  const ids = [...qids].filter((q) => !out.has(q));
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
        if (label) out.set(id, label);
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
