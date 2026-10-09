import type { NewsCategory, NewsItem } from "./types";
import { classifyRelevance, type KnownPersons } from "./newsRelevance";

/**
 * Deterministic classification of BK Häcken news into men/women/youth/club.
 *
 * Strategy (conservative, documented in docs/data-sources.md):
 * 1. Explicit category labels published BY THE SOURCE (BK Häcken renders one
 *    badge per article: "Herr", "Dam", "Hållbarhet", "Föreningen", ...).
 *    These are authoritative and take precedence over every text heuristic.
 * 2. Known women's-team player/subject keywords.
 * 3. Known men's-team keywords.
 * 4. Otherwise "unknown"/"club" — never guess men's relevance.
 *
 * A team label wins over the text. A non-team label (e.g. "Hållbarhet")
 * is general club content and must NOT be turned into "women" or "men" just
 * because it is not "Herr".
 */

/** Source labels that positively identify the men's first team. */
const MEN_TEAM_TAGS = new Set(["herr", "herrar", "herrlaget"]);
/** Source labels that positively identify the women's team. */
const WOMEN_TEAM_TAGS = new Set(["dam", "damer", "damlaget", "damerna", "obs dam"]);
/** Source labels that are general club/community content, team-neutral. */
const CLUB_TAGS = new Set([
  "hållbarhet",
  "föreningen",
  "klubben",
  "förening",
  "akademi",
  "partner",
  "sponsor",
  "verksamhet",
  "lediga jobb",
]);

/**
 * Women's-team evidence from TEXT. Deliberately word-bounded and specific:
 * the bare substring "dam" is never sufficient, because it occurs inside
 * ordinary Swedish place names ("Slätta Damm", "Åsleden" style compounds)
 * and must not be read as a women's-team signal.
 */
const WOMEN_KEYWORDS = [
  "damallsvenskan",
  "damerna",
  "damlaget",
  "damlagarna",
  "obs dam",
  "kvinnor",
  "damlag",
  // Well-known women's team players/staff (kept short and verifiable):
  "laney egbuka",
  "tilde karlsson",
  "johanna fossdalsá",
  "tuva ölvestad",
  "joy omewa",
  "haley bugeja",
  "alva selerud",
  "elisa bartoli",
  "lina magull",
  "elena sadiku",
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

/** Classify one article. `tags` are the source's own category labels. */
export function classifyNews(title: string, summary: string, tags: string[] = []): NewsCategory {
  const text = `${title} ${summary}`.toLowerCase();
  const tagSet = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);

  // 1. Authoritative source labels win outright, in both directions.
  if (tagSet.some((t) => WOMEN_TEAM_TAGS.has(t))) return "women";
  if (tagSet.some((t) => MEN_TEAM_TAGS.has(t))) {
    // "Herr" is authoritative, but a women's player name in the text means the
    // badge is being reused for mixed coverage — stay conservative.
    return WOMEN_KEYWORDS.some((k) => text.includes(k)) ? "women" : "men";
  }
  // A team-neutral club label is general content: never infer a team from it.
  const hasClubTag = tagSet.some((t) => CLUB_TAGS.has(t));
  if (hasClubTag) return "club";

  // 2. No team label from the source — fall back to text heuristics.
  if (WOMEN_KEYWORDS.some((k) => text.includes(k))) return "women";
  if (YOUTH_KEYWORDS.some((k) => text.includes(k))) return "youth";
  if (/\bherr\b/.test(text)) return "men";
  if (MEN_KEYWORDS.some((k) => text.includes(k))) return "men";
  if (/klubb|förening|medlem|träningsschema|gåfotboll|hållbarhet|partner|avtal|årsmöte/.test(text)) return "club";
  return "unknown";
}

export function isClubPromotional(title: string): boolean {
  return EXCLUDE_PATTERNS.some((re) => re.test(title));
}

/**
 * True when the SOURCE explicitly classified this article as women's.
 * Such an article may never enter the men's news set, whatever else it says.
 */
export function isExplicitlyWomenTeam(item: NewsItem): boolean {
  return (item.sourceTags ?? [])
    .map((t) => t.trim().toLowerCase())
    .some((t) => WOMEN_TEAM_TAGS.has(t));
}

/**
 * The men's-team news gate.
 *
 * This is a POSITIVE test. An article qualifies only when it is classified as
 * men's, or is club/community content that is demonstrably about the men's
 * team. Anything the source labelled "Dam", or that we classified as
 * women's, is excluded outright.
 *
 * When the source published its own labels, they are authoritative: an article
 * whose labels contain no men's-team label is NOT men's-team news, even if its
 * local category is "club". General club content (sustainability, association
 * news) must not reach the men's section on the strength of being "not women".
 *
 * Sources that publish no labels keep the previous behaviour, where locally
 * classified club content is admitted unless it is promotional.
 *
 * ENTITY-AWARE WHEN GIVEN `known` (2026-10-09)
 * --------------------------------------------
 * This gate used to run the keyword-only `classifyNews`, which knows no player
 * names. That made it UNDO the prefilter's work: an article the prefilter
 * correctly rescued by player name ("Rygaards gläds över transfern") got
 * `category: "unknown"` here and was dropped. Measured 2026-10-09 — Rygaard,
 * Harun Ibrahim and every former-player story were lost this way.
 *
 * When `known` is supplied, an article that names a current or former Häcken
 * man is admitted regardless of keywords, and a former player is tagged
 * `former`. The women's veto still wins (it is applied inside
 * `classifyRelevance`), so this widens men's evidence without weakening the
 * women's exclusion. When `known` is omitted the behaviour is unchanged, so
 * existing callers and tests are unaffected.
 */
export function menRelevantNews(items: NewsItem[], known?: KnownPersons): NewsItem[] {
  return items.filter((n) => {
    if (isExplicitlyWomenTeam(n)) return false;
    if (n.category === "women") return false;

    // Entity-aware path: a named current/former Häcken man is men's news even
    // when no keyword matches. This is what stops the gate undoing the
    // prefilter's person rescue.
    //
    // Deliberately keyed on `matchedPerson` AND a men's/former verdict, NOT on
    // the whole CURRENT_HACKEN verdict:
    //  - CURRENT_HACKEN also covers "official club source", which would bypass
    //    the authoritative source-tag check below and let tagged club content
    //    (sustainability, association news) into the men's feed.
    //  - `matchedPerson` is ALSO set when the women's/youth veto fires (the
    //    verdict is then UNRELATED), so checking the person alone would admit
    //    a women's article that merely names a men's player.
    if (known) {
      const rel = classifyRelevance(n, known);
      const isMenOrFormer = rel.relevance === "CURRENT_HACKEN" || rel.relevance === "FORMER_PLAYER";
      if (rel.matchedPerson && isMenOrFormer) {
        // Set the category explicitly. The item arrived as "unknown" from the
        // keyword classifier, and the event's category is taken from the lead
        // item — so without this a rescued article would render with no tag
        // and an "unknown" category.
        n.category = rel.relevance === "FORMER_PLAYER" ? "former" : "men";
        return true;
      }
    }

    const tags = (n.sourceTags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.length > 0) {
      // Authoritative labels present: only a men's-team label qualifies.
      return tags.some((t) => MEN_TEAM_TAGS.has(t)) && n.category === "men";
    }
    if (n.category === "men") return true;
    if (n.category === "club") return !isClubPromotional(n.title);
    return false;
  });
}
