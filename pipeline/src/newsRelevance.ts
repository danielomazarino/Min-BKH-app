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
  formerPlayers: string[];
  staff?: string[];
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
  // normalized form (also covers "BK Häcken" spacing variants).
  const text = norm(`${title} ${summary}`);
  return /\bhacken\b/.test(text) || /\bbk ?hacken\b/.test(text);
}

/** Does the article mention a known Häcken person by name? */
export function mentionsKnownPerson(title: string, summary: string, persons: string[]): string | null {
  const text = norm(`${title} ${summary}`);
  for (const p of persons) {
    const key = norm(p);
    if (key.length < 4) continue;
    if (text.includes(key)) return p;
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
  const womenContext = /damallsvenskan|damlaget|damerna|\bdam\b|kvinnor|obs dam/.test(text);
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
    const person = mentionsKnownPerson(title, summary, [...known.currentPlayers, ...known.formerPlayers]);
    if (person) {
      return {
        relevance: "CURRENT_HACKEN",
        category: "men",
        reason: `Häcken mention + known person: ${person}`,
        matchedPerson: person,
      };
    }
    return { relevance: "CURRENT_HACKEN", category: "men", reason: "explicit Häcken mention" };
  }

  // 3) Known Häcken person without explicit club mention (e.g. transfer story).
  const person = mentionsKnownPerson(title, summary, [...known.currentPlayers, ...known.formerPlayers]);
  if (person) {
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