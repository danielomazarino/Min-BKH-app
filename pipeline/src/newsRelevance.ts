/**
 * Entity/relation-aware news relevance engine.
 *
 * Replaces the old generic-keyword classifier where words like "klubb" or
 * "förening" were treated as BK Häcken relevance. Now an article must have an
 * actual relationship to BK Häcken:
 * - source is the official club feed (source-level relevance), OR
 * - explicit Häcken mention in title/summary, OR
 * - mention of a known Häcken person (current squad or verified former player)
 *   in a Häcken context.
 *
 * Relevance classes: CURRENT_HACKEN | FORMER_PLAYER | GENERAL_ALLSVENSKAN |
 * UNRELATED | UNKNOWN.
 */
import type { NewsCategory, NewsItem } from "./types";

export type Relevance = "CURRENT_HACKEN" | "FORMER_PLAYER" | "GENERAL_ALLSVENSKAN" | "UNRELATED" | "UNKNOWN";

/** Words that are NEVER sufficient evidence of a Häcken relationship. */
const GENERIC_WORDS = ["klubb", "förening", "medlem", "fotboll", "fotbollsklubben", "spelare", "lag"];
void GENERIC_WORDS;

/** Official club source — its metadata establishes relevance by itself. */
const OFFICIAL_SOURCES = ["BK Häcken"];
void OFFICIAL_SOURCES;

/** Competition channel — official but covers the whole league. */
const COMPETITION_SOURCES = ["Allsvenskan"];
void COMPETITION_SOURCES;

/** Secondary media sources — require an explicit Häcken relation. */
const SECONDARY_SOURCES = ["Sportbladet", "Expressen", "SVT Sport", "Bollsvenskan"];
void SECONDARY_SOURCES;

/** Current squad names + well-known Häcken persons (normalized). */
export interface KnownPersons {
  currentPlayers: string[];
  /**
   * Known former players. Optional since 2026-09-26: the hand-curated
   * registry was retired, and news relevance must NOT depend on a closed list
   * of former players — an article about a former Häcken player we do not
   * happen to know is still a Häcken article, and dropping the field keeps
   * relevance working for every player rather than the 31 we remembered.
   */
  formerPlayers?: string[];
  staff?: string[];
  /** Known women's-team players — their presence marks an article as women's. */
  womenPlayers?: string[];
  /** Known women's-team opponents/competitions (Damallsvenskan clubs etc.). */
  womenContextTerms?: string[];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Explicit Häcken mention in relevant context. */
export function mentionsHäcken(title: string, summary: string): boolean {
  // norm() strips diacritics, so "häcken" becomes "hacken" — match the
  // normalized form. "hackens?" also covers the possessive form "Häckens"
  // (e.g. "Häckens CL-premiär"), which \bhacken\b alone rejected.
  const text = norm(`${title} ${summary}`);
  return /\bhackens?\b/.test(text) || /\bbk ?hackens?\b/.test(text);
}

/**
 * Surnames that are too ambiguous for surname-only matching: common Swedish
 * words ("Seger" = victory, "Sten" = stone) and the most common Nordic
 * surnames ("Viktor Andersson" must never match squad player "David
 * Andersson"). "jensen" is here because it is the single most common Danish
 * surname and would otherwise make "Mikkel Rygaard Jensen" match every
 * unrelated Jensen article.
 */
const AMBIGUOUS_SURNAMES = new Set([
  // common Swedish words
  "seger", "sten", "berg", "lund", "mark", "wall", "dahl", "holm", "borg", "gren",
  // among the most common Swedish/Danish surnames
  "andersson", "johansson", "karlsson", "gustafson", "gustafsson", "nilsson",
  "eriksson", "larsson", "olsson", "persson", "svensson", "jansson", "jensen",
]);

/**
 * The name parts usable for surname-only matching, in the order to try them.
 *
 * WHY EVERY TOKEN AFTER THE FIRST, NOT JUST THE LAST (measured 2026-10-08)
 * ------------------------------------------------------------------------
 * The squad lists "Mikkel Rygaard Jensen", but the press — and Wikidata, and
 * the player himself — use "Mikkel Rygaard". Taking the LAST token as the
 * surname yielded "Jensen", so every "Rygaard …" headline matched nothing and
 * several real articles were dropped as "no Häcken relation" (confirmed on
 * Fotbollstidningar/GP: "Rygaard om Häckens väntan", "Rygaards gläds över
 * transfern"). The same failure hit "Sabri Dahari Kondo" (Kondo), "Bamir
 * Fierza Sadiku" (Sadiku) and "Wilson Lindberg Uhrström" (Uhrström).
 *
 * MIDDLE tokens get a longer minimum (5 chars, vs 4 for the final token)
 * because a middle name is more likely to be a given name: "Christ Ivan Wawa"
 * must not make every article about a person called Ivan a Häcken article.
 */
function surnameCandidates(normalizedName: string): string[] {
  const parts = normalizedName.split(" ").filter(Boolean);
  if (parts.length < 2) return [];
  const after = parts.slice(1);
  return after.filter((t, i) => {
    const isLast = i === after.length - 1;
    return t.length >= (isLast ? 4 : 5) && !AMBIGUOUS_SURNAMES.has(t);
  });
}

/** Does the article mention a known Häcken person by name? */
export function mentionsKnownPerson(title: string, summary: string, persons: string[]): string | null {
  const text = norm(`${title} ${summary}`);
  for (const p of persons) {
    const key = norm(p);
    if (key.length < 4) continue;
    if (text.includes(key)) return p;
    // Surname-only match: headlines often use just the surname ("Falk utvisad",
    // "Rygaard om Häckens väntan"). Word-boundary match, with an optional
    // possessive "s" so "Rygaards gläds …" matches too. Substring matching is
    // deliberately NOT used: "Lindelöf" contains "linde", "Ibrahimovic"
    // contains "ibrahim".
    for (const surname of surnameCandidates(key)) {
      if (new RegExp(`\\b${surname}s?\\b`).test(text)) return p;
    }
  }
  return null;
}

/** Is the article about Allsvenskan generally (not Häcken-specific)? */
export function isGeneralAllsvenskan(title: string, summary: string): boolean {
  const text = norm(`${title} ${summary}`);
  return /allsvenskan/.test(text) && !mentionsHäcken(title, summary);
}

export interface NewsRelevanceResult {
  relevance: Relevance;
  category: NewsCategory;
  /** Why this classification was reached (for provenance/debug). */
  reason: string;
  /** Matched person, if any. */
  matchedPerson?: string;
}

/**
 * Classify one article's relationship to BK Häcken men.
 *
 * Rules:
 * - Official club source → CURRENT_HACKEN (source metadata establishes relation).
 *   But still demote to women/youth if explicit women/youth context.
 * - Secondary sources require explicit Häcken mention or a known Häcken person.
 * - Generic words (klubb, förening, medlem) are NEVER sufficient.
 * - Allsvenskan without Häcken mention → GENERAL_ALLSVENSKAN.
 */
export function classifyRelevance(
  item: Pick<NewsItem, "title" | "summary" | "publisher">,
  known: KnownPersons,
): NewsRelevanceResult {
  const title = item.title ?? "";
  const summary = item.summary ?? "";
  const publisher = item.publisher ?? "";

  // Women's/youth context always wins over men's relevance.
  const text = norm(`${title} ${summary}`);
  const womenContext =
    /damallsvenskan|damlaget|damerna|damfotboll|kvinnor|obs dam|kvinnlig|women'?s champions league|women'?s super league/i.test(text) ||
    // Known women's-team players are strong women's evidence (e.g. Jennifer Falk).
    mentionsKnownPerson(title, summary, known.womenPlayers ?? []) !== null ||
    (known.womenContextTerms ?? []).some((t) => text.includes(norm(t)));
  const youthContext = /akademi|u19|u17|pojkar|flickor|junior|p05|p07/.test(text);

  // 1) Official club source: relevance established by source metadata.
  if (publisher === "BK Häcken") {
    if (womenContext) return { relevance: "UNRELATED", category: "women", reason: "official source but women's context" };
    if (youthContext) return { relevance: "UNRELATED", category: "youth", reason: "official source but youth context" };
    return { relevance: "CURRENT_HACKEN", category: "men", reason: "official club source" };
  }

  // 2) Explicit Häcken mention in relevant context.
  if (mentionsHäcken(title, summary)) {
    if (womenContext) return { relevance: "UNRELATED", category: "women", reason: "Häcken mention but women's context" };
    const person = mentionsKnownPerson(title, summary, [
      ...known.currentPlayers,
      ...(known.formerPlayers ?? []),
    ]);
    if (person) {
      return {
        relevance: "CURRENT_HACKEN",
        category: "men",
        reason: `Häcken mention + known person: ${person}`,
        matchedPerson: person,
      };
    }
    if (publisher === "BK Häcken") {
      return { relevance: "CURRENT_HACKEN", category: "men", reason: "official club source" };
    }
    // Secondary source with Häcken mention but NO men's evidence (no known
    // men's player, no men's competition marker). The Häcken mention alone
    // cannot distinguish men's from women's team — be conservative.
    const menMarker = /allsvenskan(?!\s*dam)|herr(?:ar|lag)?\b|svenska cupen herr/i.test(text);
    if (!menMarker) {
      return {
        relevance: "UNKNOWN",
        category: "unknown",
        reason: "Häcken mention but no men's evidence — could be women's team",
      };
    }
    return { relevance: "CURRENT_HACKEN", category: "men", reason: "Häcken mention + men's competition marker" };
  }

  // 3) Known Häcken person without explicit club mention (e.g. transfer story).
  //
  // The women/youth veto is re-checked here, and it MUST be: branches 1 and 2
  // both apply it, but this branch did not, so an article naming a men's
  // player inside a women's context was returned CURRENT_HACKEN — directly
  // contradicting this function's own contract ("women's/youth context always
  // wins over men's relevance"). It was unreachable from production while the
  // prefilter ignored known-person matching; wiring the prefilter to reuse
  // this branch made it reachable, so the gap is closed here rather than
  // worked around in the caller.
  const person = mentionsKnownPerson(title, summary, [
    ...known.currentPlayers,
    ...(known.formerPlayers ?? []),
  ]);
  if (person) {
    if (womenContext) {
      return { relevance: "UNRELATED", category: "women", reason: `women's context overrides known person: ${person}`, matchedPerson: person };
    }
    if (youthContext) {
      return { relevance: "UNRELATED", category: "youth", reason: `youth context overrides known person: ${person}`, matchedPerson: person };
    }
    const isCurrent = known.currentPlayers.some((c) => norm(c) === norm(person));
    return {
      relevance: isCurrent ? "CURRENT_HACKEN" : "FORMER_PLAYER",
      category: "men",
      reason: `known Häcken person: ${person}`,
      matchedPerson: person,
    };
  }

  // 4) General Allsvenskan coverage — related to the league, not to Häcken.
  if (isGeneralAllsvenskan(title, summary)) {
    return { relevance: "GENERAL_ALLSVENSKAN", category: "men", reason: "Allsvenskan without Häcken relation" };
  }

  // 5) Everything else — including articles that only say "klubb" — UNRELATED.
  return { relevance: "UNRELATED", category: "unknown", reason: "no Häcken relationship established" };
}

/** Convenience: keep only articles relevant to current BK Häcken men. */
export function currentHackenNews<T extends { publisher: string; title: string; summary?: string }>(
  items: T[],
  known: KnownPersons,
): T[] {
  return items.filter((it) => classifyRelevance({ ...it, summary: it.summary ?? "" }, known).relevance === "CURRENT_HACKEN");
}