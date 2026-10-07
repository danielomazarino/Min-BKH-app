/**
 * The Wikipedia infobox layer — the structured data Wikidata does not have.
 *
 * WHY THIS EXISTS (all measured 2026-10-06, on the user's own examples)
 * --------------------------------------------------------------------
 * Wikidata's structured claims are thin for exactly the fields a supporter
 * checks first. Measured on real players the user named:
 *
 *   Mats Hedén (Q103846058):  P2048 (height) ABSENT, P413 (position) ABSENT,
 *                             P54 (career) ABSENT — the card showed three
 *                             honest "–" gaps. His ENGLISH Wikipedia infobox
 *                             has all of it: 1.82 m, Defender, Västra
 *                             Frölunda 1998–2000, BK Häcken 2005–2006.
 *   Bénie Traoré (Q106464198): P54 has ONE stint with NO year qualifiers —
 *                             the card showed "????–???? BK Häcken". The
 *                             infobox has the whole career: Häcken 2021–23
 *                             (41/15), Sheffield United, Nantes (loan),
 *                             Basel, NYCFC.
 *   Martin Ericsson (Q602051): Wikidata's P582 says 2012 for Häcken — the
 *                             "career cut off at 2012" the user reported.
 *                             The infobox says 2012–2016.
 *   Jeremy Agbonifo:           Wikidata has height but no position and one
 *                             unqualified stint. The infobox has Ytter
 *                             (winger), vänsterfotad, and every loan.
 *
 * The infobox is maintained by football fans who care about exactly these
 * fields, and it is the SAME source the narrative layer already trusts.
 *
 * HOW: action=parse with prop=wikitext&section=0 returns the lead section —
 * the infobox plus the first paragraph — as raw wikitext. CORS-open
 * (access-control-allow-origin: *, verified 2026-10-06), no key, ~0.8s.
 * One request per language tried, at most two (sv then en), only when a
 * sheet is opened, cached for the session.
 *
 * THE IDENTITY TRAP, AGAIN
 * ------------------------
 * The same trap as the summary layer: "Mats Hedén" on sv.wikipedia is a
 * MUSICIAN. The parse response does not carry wikibase_item, so identity is
 * enforced by the CALLER: this module is only invoked with the title from
 * the entity's own sitelinks, and the summary layer's wikibase_item check
 * has already proven the article is about this exact entity before the
 * infobox is asked for. Parsing the infobox of a sitelink that the summary
 * guard rejected would be a bug — the caller must chain them.
 *
 * PARSING IS TEMPLATE-AWARE, NOT REGEX-ONLY
 * -----------------------------------------
 * Infobox values contain nested templates: {{ålder|2002|11|30}},
 * {{flaggbild|Sverige}} [[BK Häcken]], {{0|0000}}–2021. A naive regex
 * cannot find the value's end (a pipe inside {{...}} is not a field
 * separator). The parser below walks the text and tracks brace depth.
 */

/**
 * The MediaWiki parse endpoint for a page's lead section wikitext.
 */
const PARSE = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&section=0&format=json&origin=*`;

/**
 * Expand a batch of templates to wikitext, one per line.
 *
 * Used ONLY for the national-team flag template `{{hff|CIV|u=23}}`, which
 * sv infoboxes use for every landslag row and which expands to
 * `[[Elfenbenskustens herrlandslag i fotboll|Elfenbenskusten U23]]` — the
 * team link we want to display. Raw wikitext leaves it opaque, and
 * expanding the WHOLE infobox turns it into an HTML table (measured), so
 * the templates are extracted, expanded in ONE batched request, and
 * substituted back. Skipped entirely when no hff template is present, so
 * the common case stays one request.
 */
const EXPAND = (lang: string, text: string) =>
  `https://${lang}.wikipedia.org/w/api.php?action=expandtemplates&text=${encodeURIComponent(text)}&prop=wikitext&format=json&origin=*`;

/** The sv national-team template. en infoboxes use plain links. */
const HFF_RE = /\{\{hff\|[^{}]+\}\}/g;

async function resolveNationalTemplates(
  lang: string,
  wikitext: string,
  deps: { fetch: FetchLike },
): Promise<string> {
  const templates = wikitext.match(HFF_RE);
  if (!templates || templates.length === 0) return wikitext;
  try {
    const res = await deps.fetch(EXPAND(lang, templates.join("\n")), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return wikitext;
    const json = (await res.json()) as { expandtemplates?: { wikitext?: string } };
    const expanded = json.expandtemplates?.wikitext;
    if (!expanded) return wikitext;
    const lines = expanded.split("\n").filter((l) => l.trim().length > 0);
    let out = wikitext;
    templates.forEach((orig, i) => {
      const exp = lines[i];
      if (!exp) return;
      // The expansion carries TWO links: the flag image (namespace "Fil:")
      // and the team. The team is the one that is not a file.
      const links = [...exp.matchAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g)].map((m) => [m[1], m[2]] as const);
      const team = links.find(([target]) => !target.startsWith("Fil:"));
      if (team) out = out.replace(orig, `[[${team[0]}|${team[1].replace(/&nbsp;/g, " ")}]]`);
    });
    return out;
  } catch {
    // Expansion is a bonus: raw wikitext still parses, the national rows
    // just come out empty for hff-only pages.
    return wikitext;
  }
}

export interface InfoboxData {
  /** The language the infobox came from. */
  lang: string;
  /** Height in cm, when the infobox records it. */
  heightCm?: number;
  /** Position as written ("Mittfältare", "Forward, winger"), links stripped. */
  position?: string;
  /** Preferred foot ("Vänsterfotad"), when recorded. */
  foot?: string;
  /** Current club, links stripped ("Lens", "FC Basel"). */
  currentClub?: string;
  /** Senior career, newest first as the infobox lists it. */
  career: InfoboxStint[];
  /** Youth career, when the infobox records it. */
  youth: InfoboxStint[];
  /** National-team periods, when recorded. */
  national: InfoboxStint[];
  /** The article the data came from, for provenance. */
  pageUrl: string;
}

/** One club period from the infobox's parallel year/club/apps lists. */
export interface InfoboxStint {
  years: string;
  /** Club name, flag templates and link syntax stripped. */
  team: string;
  /** True when the infobox marks the stint as a loan ("→ ... (lån)"). */
  loan: boolean;
  apps?: number;
  goals?: number;
}

/* ------------------------------------------------------------------ *
 * Wikitext value cleaning
 * ------------------------------------------------------------------ */

/**
 * Strip link syntax: [[BK Häcken|Häcken]] → Häcken, [[FC Basel|Basel]] →
 * Basel, [[Defender (association football)|Defender]] → Defender. The
 * DISPLAY target (after the pipe) is what a reader sees, so it is what we
 * keep; when there is no pipe the target itself is the display.
 */
function stripLinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1");
}

/** Remove the reference markup (<ref>...</ref> and <ref name=x/>) that
 *  infobox values routinely carry. */
function stripRefs(text: string): string {
  return text.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
}

/**
 * Remove decorative templates: {{flaggbild|Sverige}} (country flags),
 * {{0|0000}} (zero-padding), {{hff|CIV|u=23}} (national-team shorthand).
 * They carry display decoration, not data — a club row is the club, not the
 * flag beside it. Templates with a meaningful payload are handled by their
 * own readers ({{ålder}} for dates is never read; the birth date comes from
 * Wikidata).
 */
function stripTemplates(text: string): string {
  return text.replace(/\{\{[^{}]*\}\}/g, "");
}

/** Remove HTML tags like <br />, <br/> and their whitespace variants. */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ");
}

/** Collapse whitespace runs and trim. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Expand the club/team templates that carry a NAME, before the generic
 * template stripper removes them.
 *
 * WHY (measured 2026-10-07): the Norwegian `Infoboks lagspiller` writes every
 * club as `{{Fk|Sarpsborg 08}}` and every national team as `{{F|Norge}}`.
 * `stripTemplates` deletes `{{...}}` wholesale, so those rows cleaned to an
 * EMPTY string and Brice Wembangomo's seven-club career vanished. The payload
 * is the data; only the braces are decoration.
 *
 * Innermost-first, because `{{Lån|{{Fk|Kvik Halden}}}}` nests. `{{Lån|X}}`
 * becomes `→ X` so `readStint` still sees the loan arrow.
 */
function expandClubTemplates(text: string): string {
  let out = text;
  for (let i = 0; i < 5; i += 1) {
    const next = out
      .replace(/\{\{\s*Fk\s*\|([^{}|]+)\}\}/gi, "$1")
      .replace(/\{\{\s*F\s*\|([^{}|]+)\}\}/gi, "$1");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{\s*Lån\s*\|([^{}]*)\}\}/gi, "→ $1");
}

/** The full cleaning pipeline for a single-line value. */
function cleanValue(text: string): string {
  return tidy(stripTags(stripRefs(stripTemplates(stripLinks(expandClubTemplates(text))))));
}

/**
 * Split a value on <br> variants into the parallel list rows the infobox
 * uses for years / clubs / apps. "2021–2023<br/>2023–2024" → two rows.
 */
function splitRows(text: string): string[] {
  return stripRefs(expandClubTemplates(text))
    .split(/<br\s*\/?>/i)
    .map((row) => tidy(stripTags(row)))
    .filter((row) => row.length > 0);
}

/* ------------------------------------------------------------------ *
 * Field extraction — brace-depth-aware
 * ------------------------------------------------------------------ */

/**
 * Parse `{{Infobox ... | field = value | field2 = value2 ... }}` into a map.
 *
 * TWO kinds of nesting must be survived:
 *   1. Templates: {{flaggbild|Sverige}} — a pipe inside {{...}} is INSIDE
 *      the value, not a field separator.
 *   2. Links: [[BK Häcken|Häcken]] — a pipe inside [[...]] separates the
 *      link target from its display text, equally NOT a field separator.
 * A naive split on "|" breaks on both; the walk below tracks brace depth
 * AND link depth, and only treats a pipe at depth 0 in BOTH as a field
 * separator. The first "=" at depth 0 inside a field is its name/value
 * boundary (the same two rules apply to it).
 */
export function parseInfoboxFields(wikitext: string): Map<string, string> {
  const fields = new Map<string, string>();

  // Find the infobox start. sv/en use {{Infobox ...}}; Norwegian and Danish
  // use {{Infoboks ...}}. Matching only "Infobox" silently returned an empty
  // field map for every Norwegian article (measured 2026-10-07).
  const start = wikitext.search(/\{\{\s*(?:Infobox|Infoboks)\b/i);
  if (start === -1) return fields;

  // Walk from the opening braces, tracking depth, to the matching close.
  let depth = 0;
  let i = start;
  let end = -1;
  for (; i < wikitext.length; i += 1) {
    const two = wikitext.slice(i, i + 2);
    if (two === "{{") {
      depth += 1;
      i += 1;
    } else if (two === "}}") {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return fields;

  // The body between the outer braces, minus the leading "Infobox ..." name.
  const body = wikitext.slice(start + 2, end - 1);
  const nameEnd = body.indexOf("\n") === -1 ? body.length : body.indexOf("\n");
  const fieldsText = body.slice(nameEnd);

  /** Shared walker: splits `text` at depth-0 pipes, where depth counts
   *  BOTH {{templates}} and [[links]]. */
  const splitTopLevelPipes = (text: string): string[] => {
    const parts: string[] = [];
    let braces = 0;
    let links = 0;
    let partStart = 0;
    for (let c = 0; c < text.length; c += 1) {
      const two = text.slice(c, c + 2);
      if (two === "{{") {
        braces += 1;
        c += 1;
      } else if (two === "}}") {
        braces -= 1;
        c += 1;
      } else if (two === "[[") {
        links += 1;
        c += 1;
      } else if (two === "]]") {
        links -= 1;
        c += 1;
      } else if (text[c] === "|" && braces === 0 && links === 0) {
        parts.push(text.slice(partStart, c));
        partStart = c + 1;
      }
    }
    parts.push(text.slice(partStart));
    return parts;
  };

  for (const chunk of splitTopLevelPipes(fieldsText)) {
    // The name/value boundary is the FIRST depth-0 "=" — same nesting rules.
    let braces = 0;
    let links = 0;
    let eq = -1;
    for (let c = 0; c < chunk.length; c += 1) {
      const two = chunk.slice(c, c + 2);
      if (two === "{{") {
        braces += 1;
        c += 1;
      } else if (two === "}}") {
        braces -= 1;
        c += 1;
      } else if (two === "[[") {
        links += 1;
        c += 1;
      } else if (two === "]]") {
        links -= 1;
        c += 1;
      } else if (chunk[c] === "=" && braces === 0 && links === 0) {
        eq = c;
        break;
      }
    }
    if (eq === -1) continue;
    const name = tidy(chunk.slice(0, eq)).toLowerCase();
    const value = chunk.slice(eq + 1).trim();
    if (name && value) fields.set(name, value);
  }
  return fields;
}

/* ------------------------------------------------------------------ *
 * Field readers
 * ------------------------------------------------------------------ */

/**
 * The first present field among several names.
 *
 * WHY: the same infobox field is spelled differently per language. Norwegian
 * `Infoboks lagspiller` uses `år1`/`klubb1`/`kamper1`/`mål1`; Danish uses
 * `år1`/`klub1`/`kampe1`/`mål1`; English uses `years1`/`clubs1`/`caps1`/
 * `goals1`. Reading only the English names silently produced an EMPTY career
 * for Brice Wembangomo (measured 2026-10-07) even though his nowiki infobox
 * lists seven clubs with years and apps.
 */
function firstField(fields: Map<string, string>, names: readonly string[]): string | undefined {
  for (const n of names) {
    const v = fields.get(n);
    if (v !== undefined && v.trim().length > 0) return v;
  }
  return undefined;
}

/** Height: sv "178 cm", en "1.82 m" (sometimes "1.82m"). */
function readHeight(fields: Map<string, string>): number | undefined {
  const sv = firstField(fields, ["längd", "langd", "høyde", "hoyde", "højde", "hojde"]);
  if (sv) {
    const m = /(\d{3})\s*cm/.exec(cleanValue(sv));
    if (m) {
      const n = Number(m[1]);
      // Same plausibility window as the Wikidata height parser: a human
      // height, not a mis-modelled unit.
      if (n >= 100 && n <= 260) return n;
    }
  }
  const en = fields.get("height");
  if (en) {
    const m = /(\d(?:\.\d+)?)\s*m(?:\s|$)/.exec(cleanValue(en));
    if (m) {
      const cm = Math.round(Number(m[1]) * 100);
      if (cm >= 100 && cm <= 260) return cm;
    }
  }
  return undefined;
}

/** Position: sv "position", en "position". Multi-position values are kept
 *  whole ("Forward, winger") — trimming them would invent a preference. */
function readPosition(fields: Map<string, string>): string | undefined {
  const raw = firstField(fields, ["position", "posisjon"]);
  if (!raw) return undefined;
  const v = cleanValue(raw);
  return v.length > 0 ? v : undefined;
}

/** Preferred foot: sv "lateralitet" ("Vänsterfotad"). en has no field. */
function readFoot(fields: Map<string, string>): string | undefined {
  const raw = firstField(fields, ["lateralitet", "fot"]);
  if (!raw) return undefined;
  const v = cleanValue(raw);
  return v.length > 0 ? v : undefined;
}

/** Current club: sv "nuvarandeklubb", en "currentclub", nb "nvklubb". */
function readCurrentClub(fields: Map<string, string>): string | undefined {
  const raw = firstField(fields, ["nuvarandeklubb", "currentclub", "nvklubb", "nåværendeklubb"]);
  if (!raw) return undefined;
  const v = cleanValue(raw);
  return v.length > 0 ? v : undefined;
}

/**
 * One career row: "→ {{flaggbild|Frankrike}} [[RC Lens|Lens]] (lån)".
 * The arrow marks a loan; the "(lån)"/"(loan)" suffix confirms it.
 *
 * The row is expanded first: the numbered (en/nb/da) branches pass the RAW
 * field value, which writes loans as `{{Lån|{{Fk|Kvik Halden}}}}` — without
 * expansion the arrow never appears and the loan is silently lost.
 */
function readStint(row: string): InfoboxStint | null {
  const expanded = expandClubTemplates(row);
  const loan = expanded.includes("→") || /\((lån|loan)\)/i.test(expanded);
  const cleaned = cleanValue(expanded.replace(/→/g, "").replace(/\((lån|loan)\)/gi, ""));
  if (!cleaned) return null;
  return { years: "", team: cleaned, loan };
}

/**
 * The parallel career lists. sv names them seniorår/seniorklubbar/
 * antalseniormatcher(mål) (or proffsår/proffsklubbar/antalproffsmatcher(mål)
 * for pre-1999 careers); en uses yearsN/clubsN/capsN/goalsN with numbered
 * fields. Both shapes are handled.
 */
function readCareer(fields: Map<string, string>): InfoboxStint[] {
  const yearsRaw = fields.get("seniorår") ?? fields.get("proffsår");
  const clubsRaw = fields.get("seniorklubbar") ?? fields.get("proffsklubbar");
  const appsRaw =
    fields.get("antalseniormatcher(mål)") ??
    fields.get("antalproffsmatcher(mål)") ??
    fields.get("antalseniormatcher(mål)".toLowerCase());

  if (yearsRaw && clubsRaw) {
    const years = splitRows(yearsRaw);
    const clubs = splitRows(clubsRaw);
    const apps = appsRaw ? splitRows(appsRaw) : [];
    const stints: InfoboxStint[] = [];
    for (let i = 0; i < Math.max(years.length, clubs.length); i += 1) {
      const stint = readStint(clubs[i] ?? "");
      if (!stint) continue;
      stint.years = years[i] ?? "";
      const appsRow = apps[i];
      if (appsRow) {
        // "41 (15)" or "41 {{0}}(0)" — apps then goals in parentheses;
        // {{0}} is zero-padding the fans use to align the columns.
        const m = /^(\d+)\s*\((\d+)\)$/.exec(cleanValue(appsRow).replace(/\{\{0\}\}/g, "").replace(/\s+/g, " "));
        if (m) {
          stint.apps = Number(m[1]);
          stint.goals = Number(m[2]);
        }
      }
      stints.push(stint);
    }
    return stints;
  }

  // EN numbered shape: years1, clubs1, caps1, goals1, years2, ...
  // Norwegian/Danish numbered shape: år1, klubb1/klub1, kamper1/kampe1, mål1.
  const stints: InfoboxStint[] = [];
  for (let n = 1; n <= 20; n += 1) {
    const years = firstField(fields, [`years${n}`, `år${n}`, `aar${n}`]);
    const clubs = firstField(fields, [`clubs${n}`, `klubb${n}`, `klub${n}`]);
    if (!clubs) continue;
    const stint = readStint(clubs);
    if (!stint) continue;
    stint.years = cleanValue(years ?? "");
    const caps = firstField(fields, [`caps${n}`, `kamper${n}`, `kampe${n}`]);
    const goals = firstField(fields, [`goals${n}`, `mål${n}`, `maal${n}`]);
    if (caps && /^\d+$/.test(cleanValue(caps))) stint.apps = Number(cleanValue(caps));
    if (goals && /^\d+$/.test(cleanValue(goals))) stint.goals = Number(cleanValue(goals));
    stints.push(stint);
  }
  return stints;
}

/** Youth career: sv juniorår/juniorklubbar, en youthyearsN/youthclubsN. */
function readYouth(fields: Map<string, string>): InfoboxStint[] {
  const yearsRaw = fields.get("juniorår");
  const clubsRaw = fields.get("juniorklubbar");
  if (yearsRaw && clubsRaw) {
    const years = splitRows(yearsRaw);
    const clubs = splitRows(clubsRaw);
    const stints: InfoboxStint[] = [];
    for (let i = 0; i < Math.max(years.length, clubs.length); i += 1) {
      const stint = readStint(clubs[i] ?? "");
      if (!stint) continue;
      stint.years = years[i] ?? "";
      stints.push(stint);
    }
    return stints;
  }
  const stints: InfoboxStint[] = [];
  for (let n = 1; n <= 10; n += 1) {
    const years = fields.get(`youthyears${n}`);
    const clubs = fields.get(`youthclubs${n}`);
    if (!clubs) continue;
    const stint = readStint(clubs);
    if (!stint) continue;
    stint.years = cleanValue(years ?? "");
    stints.push(stint);
  }
  return stints;
}

/** National teams: sv landslagsår/landslag/antallandskamper(mål), en
 *  nationalyearsN/nationalteamN/nationalcapsN/nationalgoalsN. */
function readNational(fields: Map<string, string>): InfoboxStint[] {
  const yearsRaw = fields.get("landslagsår");
  const teamsRaw = fields.get("landslag");
  if (yearsRaw && teamsRaw) {
    const years = splitRows(yearsRaw);
    const teams = splitRows(teamsRaw);
    const capsRaw = fields.get("antallandskamper(mål)");
    const caps = capsRaw ? splitRows(capsRaw) : [];
    const stints: InfoboxStint[] = [];
    for (let i = 0; i < Math.max(years.length, teams.length); i += 1) {
      const stint = readStint(teams[i] ?? "");
      if (!stint) continue;
      stint.years = years[i] ?? "";
      const capsRow = caps[i];
      if (capsRow) {
        const m = /^(\d+)\s*\((\d+)\)$/.exec(cleanValue(capsRow).replace(/\{\{0\}\}/g, "").replace(/\s+/g, " "));
        if (m) {
          stint.apps = Number(m[1]);
          stint.goals = Number(m[2]);
        }
      }
      stints.push(stint);
    }
    return stints;
  }
  const stints: InfoboxStint[] = [];
  for (let n = 1; n <= 10; n += 1) {
    const years = firstField(fields, [`nationalyears${n}`, `landslagår${n}`, `landslagaar${n}`]);
    const team = firstField(fields, [`nationalteam${n}`, `landslag${n}`]);
    if (!team) continue;
    const stint = readStint(team);
    if (!stint) continue;
    stint.years = cleanValue(years ?? "");
    const caps = firstField(fields, [`nationalcaps${n}`, `landslagkamper${n}`]);
    const goals = firstField(fields, [`nationalgoals${n}`, `landslagmål${n}`, `landslagmaal${n}`]);
    if (caps && /^\d+$/.test(cleanValue(caps))) stint.apps = Number(cleanValue(caps));
    if (goals && /^\d+$/.test(cleanValue(goals))) stint.goals = Number(cleanValue(goals));
    stints.push(stint);
  }
  return stints;
}

/* ------------------------------------------------------------------ *
 * Fetch + cache
 * ------------------------------------------------------------------ */

/**
 * Fetch and parse the infobox for a Wikipedia article.
 *
 * The caller supplies the title from the entity's OWN sitelinks and the
 * language the summary layer already verified (wikibase_item matched).
 * Returns null when the page has no infobox or the request fails — null is
 * "nothing verified to add", never an error.
 */
export async function fetchInfobox(
  lang: string,
  title: string,
  deps: { fetch: FetchLike },
): Promise<InfoboxData | null> {
  try {
    const res = await deps.fetch(PARSE(lang, title), { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { parse?: { wikitext?: { "*": string } } };
    let wikitext = json.parse?.wikitext?.["*"];
    if (!wikitext) return null;

    // Resolve the sv national-team templates before parsing, so the
    // landslag rows carry real team names instead of opaque {{hff|...}}.
    wikitext = await resolveNationalTemplates(lang, wikitext, deps);

    const fields = parseInfoboxFields(wikitext);
    if (fields.size === 0) return null;

    const career = readCareer(fields);
    const youth = readYouth(fields);
    const national = readNational(fields);
    const heightCm = readHeight(fields);
    const position = readPosition(fields);
    const foot = readFoot(fields);
    const currentClub = readCurrentClub(fields);

    // An infobox with NOTHING we read is not worth keeping — the caller
    // would merge zero fields and the request would have bought nothing.
    if (career.length === 0 && youth.length === 0 && national.length === 0 && heightCm === undefined && position === undefined) {
      return null;
    }

    return {
      lang,
      heightCm,
      position,
      foot,
      currentClub,
      career,
      youth,
      national,
      pageUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return null;
  }
}

type FetchLike = typeof fetch;

/* ------------------------------------------------------------------ *
 * Session cache — one entry per "lang:title"
 * ------------------------------------------------------------------ *
 *
 * Same policy as the summary cache: opening the same player twice must not
 * spend the request twice, and a null result IS cached (absence is a fact).
 */

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 60;

interface CacheEntry {
  at: number;
  value: InfoboxData | null;
}

const cache = new Map<string, CacheEntry>();

export function readInfoboxCache(key: string, now: number): InfoboxData | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

export function writeInfoboxCache(key: string, value: InfoboxData | null, now: number): void {
  cache.set(key, { at: now, value });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export function clearInfoboxCache(): void {
  cache.clear();
}