import type { NewsCategory, NewsItem } from "./types";

/**
 * Deterministic classification of BK Häcken news into men/women/youth/club.
 *
 * Strategy (conservative, documented in docs/data-sources.md):
 * 1. Explicit category tags present in the BK Häcken RSS ecosystem
 *    (HERR, DAM, AKADEMI etc.) — high confidence.
 * 2. Known women's-team player/subject keywords.
 * 3. Known men's-team keywords.
 * 4. Otherwise "unknown"/"club" — never guess men's relevance.
 */

const WOMEN_KEYWORDS = [
  "damallsvenskan",
  "damerna",
  "damlaget",
  " dam",
  "obs dam",
  "kvinnor",
  // Well-known women's team players/staff (kept short and verifiable):
  "laney egbuka",
  "tilde karlsson",
  "johanna fossdalsá",
  "tuva ölvestad",
  "joy omewa",
  "eskilstuna united",
  "vittsjö",
];

const MEN_KEYWORDS = [
  "allsvenskan",
  "herrlaget",
  "herr ",
  " herrar",
  "herren",
  "matchtruppen",
  "nordic wellness arena",
];

const YOUTH_KEYWORDS = ["akademi", "u19", "u17", "pojkar", "flickor", "junior", "gothia park academy", "p05", "p07"];

const EXCLUDE_PATTERNS = [
  /årskort/i,
  /biljett/i,
  /shop/i,
  /partner/i,
  /sponsorpaket/i,
];

export function classifyNews(title: string, summary: string, tags: string[] = []): NewsCategory {
  const text = `${title} ${summary}`.toLowerCase();
  const tagText = tags.join(" ").toLowerCase();

  if (/herr/.test(tagText) || /\bherr\b/.test(text)) {
    // "Herr" tag present, but exclude obvious women-context collisions.
    if (!WOMEN_KEYWORDS.some((k) => text.includes(k))) return "men";
  }
  if (/damallsvenskan|dam\b|damer/.test(tagText) || WOMEN_KEYWORDS.some((k) => text.includes(k))) {
    return "women";
  }
  if (YOUTH_KEYWORDS.some((k) => text.includes(k))) return "youth";
  if (MEN_KEYWORDS.some((k) => text.includes(k))) return "men";
  if (/klubb|förening|medlem|träningsschema|gåfotboll|hållbarhet|partner|avtal|årsmöte/.test(text)) return "club";
  return "unknown";
}

export function isClubPromotional(title: string): boolean {
  return EXCLUDE_PATTERNS.some((re) => re.test(title));
}

export function menRelevantNews(items: NewsItem[]): NewsItem[] {
  return items.filter(
    (n) => n.category === "men" || (n.category === "club" && !isClubPromotional(n.title)),
  );
}
