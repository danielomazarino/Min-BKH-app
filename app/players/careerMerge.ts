/**
 * Merge the two career sources into ONE list — the union, not a choice.
 *
 * WHY THIS EXISTS (measured 2026-10-07, on the user's own examples)
 * ----------------------------------------------------------------
 * The card used to PICK a source: whichever of Wikidata or the Wikipedia
 * infobox had more rows won outright. That silently dropped real clubs,
 * because the two sources are complementary, not competing:
 *
 *   Etrit Berisha (Q1523030): Wikidata has 10 P54 stints but the BK Häcken
 *     one carries NO year qualifiers, so it renders "????–???? BK Häcken".
 *     The sv infobox has 9 stints and DOES have "2025– BK Häcken". 9 >= 10
 *     is false, so Wikidata won and the Häcken row was the unqualified one —
 *     the user reported "no Häcken records".
 *   Adam Lundqvist (Q18196418): Wikidata has 5 stints, three of them
 *     unqualified ("????–???? BK Häcken", "????–???? Austin FC",
 *     "????–???? Houston Dynamo"); the infobox has the same 5 WITH years.
 *
 * The union keeps every club either source knows about, and prefers the
 * infobox's row when both describe the same club — the infobox is maintained
 * by fans who care about exactly these fields, and Wikidata's P582 end-years
 * are measurably stale (Martin Ericsson: Wikidata says 2012, infobox 2016).
 *
 * MATCHING IS BY CLUB, NOT BY STRING
 * ----------------------------------
 * The two sources spell the same club differently: "BK Häcken" vs "Häcken",
 * "IF Elfsborg" vs "Elfsborg", "Kvik Halden FK" vs "Kvik Halden". A raw
 * string compare would treat each as a different club and duplicate the row.
 * `clubKey` strips the club-type prefixes (BK, IF, FC, FK, …) and all
 * punctuation, so the two spellings collapse to one key.
 */

import type { CareerStint, NationalTeamStint } from "./wikidata";
import type { InfoboxStint } from "./infobox";

/** One row as the card renders it. */
export interface DisplayStint {
  years: string;
  team: string;
  loan: boolean;
  apps?: number;
  goals?: number;
}

/**
 * Club-type prefixes that carry no identity: "BK Häcken" and "Häcken" are the
 * same club. Stripped as whole words only, so "IFK" is not mangled into "K".
 * "bc" is included because Wikidata writes "Atalanta BC" where the infobox
 * writes "Atalanta" — measured 2026-10-07, that produced a duplicate row.
 */
const CLUB_PREFIX_WORDS = new Set([
  "ifk", "gif", "öis", "aik", "bk", "if", "ff", "fc", "sk", "ik", "fk", "sc",
  "cf", "ac", "ss", "ssc", "as", "us", "cd", "sv", "vfl", "tsv", "bsc", "il",
  "sf", "gik", "bois", "bc", "fotboll", "fotball",
]);

/**
 * Descriptive words in a national-team name. Wikidata writes "Albaniens
 * herrlandslag i fotboll" where the infobox writes "Albanien"; without
 * stripping these the two never match and the row is duplicated (measured
 * 2026-10-07 on Berisha and Adam Lundqvist).
 */
const TEAM_NOISE_WORDS = new Set(["herrlandslag", "damlandslag", "landslag", "i", "fotboll", "fotball"]);

/**
 * A comparable key for a team name — club OR national side.
 *
 * Lowercased, punctuation removed, then:
 *  - a possessive first token is de-possessed ("Albaniens" → "albanien",
 *    "Sveriges" → "sverige"), which is how the two sources spell the same
 *    country differently;
 *  - club-type prefixes and national-team noise words are dropped;
 *  - the rest is joined, so "Sverige U21" and "Sveriges U21-herrlandslag i
 *    fotboll" both become "sverigeu21".
 *
 * Falls back to the plain normalized name when stripping would leave nothing
 * (a club literally named "IF").
 */
export function clubKey(team: string): string {
  const normalized = team
    .toLowerCase()
    .replace(/[^a-z0-9åäöæø]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  // Possessive country form, on the FIRST token only — club names rarely lead
  // with a possessive, and stripping every token's trailing "s" would merge
  // genuinely different names.
  if (tokens.length > 0 && tokens[0].length > 4 && tokens[0].endsWith("s")) {
    tokens[0] = tokens[0].slice(0, -1);
  }
  const stripped = tokens
    .filter((t) => !TEAM_NOISE_WORDS.has(t) && !CLUB_PREFIX_WORDS.has(t))
    .join("");
  return stripped.length > 0 ? stripped : normalized.replace(/\s+/g, "");
}

/**
 * The start year of a rendered years string ("2025–", "2014–2016",
 * "????–????"). -1 when no year is present, so unqualified stints sort LAST
 * rather than first — the same rule the Wikidata layer uses.
 */
export function startYearOf(years: string): number {
  const m = /(\d{4})/.exec(years);
  return m ? Number(m[1]) : -1;
}

function fromWikidata(s: CareerStint | NationalTeamStint): DisplayStint {
  return {
    years: `${s.startYear ?? "????"}–${s.endYear ?? "????"}`,
    team: s.team,
    loan: false,
    apps: (s as CareerStint).apps ?? (s as NationalTeamStint).caps,
    goals: s.goals,
  };
}

function fromInfobox(s: InfoboxStint): DisplayStint {
  return {
    years: s.years || "????",
    team: s.team,
    loan: s.loan,
    apps: s.apps,
    goals: s.goals,
  };
}

/**
 * The union of the two sources, newest first.
 *
 * Infobox rows lead (they carry years and apps); a Wikidata stint whose club
 * the infobox does not mention is appended. `usedInfobox` is true when the
 * infobox contributed anything, so the card can label the provenance honestly.
 */
export function mergeCareerStints(
  wd: readonly (CareerStint | NationalTeamStint)[],
  ib: readonly InfoboxStint[],
): { stints: DisplayStint[]; usedInfobox: boolean } {
  const ibKeys = new Set(ib.map((s) => clubKey(s.team)));
  const extra = wd.filter((s) => !ibKeys.has(clubKey(s.team)));
  const merged = [...ib.map(fromInfobox), ...extra.map(fromWikidata)];

  // Dedupe by (team key, years). Two genuinely different spells at the same
  // club have different years and both survive; the same club with the same
  // years is one row. This catches duplicates WITHIN a single source too,
  // which the cross-source filter above cannot.
  const seen = new Set<string>();
  const stints = merged.filter((s) => {
    const k = `${clubKey(s.team)}|${s.years}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  stints.sort((a, b) => startYearOf(b.years) - startYearOf(a.years));
  return { stints, usedInfobox: ib.length > 0 };
}
