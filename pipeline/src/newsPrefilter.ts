/**
 * Deterministic PRE-filter for the Gemini synthesis stage.
 *
 * This is deliberately LOOSER than the previous production filter. Its only
 * jobs are cheap, unambiguous rejections that do not require semantics:
 *
 *   - drop items outside the date window;
 *   - drop items that mention BK Häcken nowhere and are not from the official
 *     club feed (pure league/other-club noise);
 *   - drop explicit season-ticket / ticket / shop / job advertisements.
 *
 * It deliberately does NOT decide men's vs women's. That is Gemini's job now,
 * so a hard-coded women's-player list is no longer the gate.
 */
import type { NewsItem } from "./types";
import { mentionsHäcken, isGeneralAllsvenskan, classifyRelevance, type KnownPersons } from "./newsRelevance";

/** Default window: 45 days back from `now`. Configurable via NEWS_WINDOW_DAYS. */
export const DEFAULT_WINDOW_DAYS = 45;

const HARD_EXCLUDES: RegExp[] = [
  /årskort/i,
  /\bbiljett(er)?\b/i,
  /\buppköpning av biljetter\b/i,
  /jobbannons/i,
  /\bannons\b/i,
  /butik|shopp?\b/i,
  /öppettider/i,
];

export interface PrefilterOptions {
  windowDays?: number;
  now?: Date;
  maxItems?: number;
  /**
   * Known Häcken persons, used only to rescue articles that name a current
   * player without ever saying "Häcken".
   *
   * OPTIONAL ON PURPOSE. When omitted the prefilter behaves exactly as it did
   * before this field existed (title/summary Häcken mention or official
   * source), so existing callers and tests are unaffected. The rescue is an
   * addition, never a loosening of the women's / ambiguous-surname stances
   * that `classifyRelevance` already enforces.
   */
  known?: KnownPersons;
}

export interface PrefilterResult {
  candidates: NewsItem[];
  dropped: Array<{ url: string; reason: string }>;
}

/** Reject items that cannot be relevant on a hard, textual rule alone. */
export function isHardExcluded(item: NewsItem): boolean {
  const text = `${item.title} ${item.summary ?? ""}`;
  return HARD_EXCLUDES.some((re) => re.test(text));
}

export function prefilterNews(items: NewsItem[], opts: PrefilterOptions = {}): PrefilterResult {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  const maxItems = opts.maxItems ?? 40;
  const cutoff = now.getTime() - windowDays * 24 * 3600 * 1000;
  const dropped: Array<{ url: string; reason: string }> = [];
  const candidates: NewsItem[] = [];

  for (const item of items) {
    const t = Date.parse(item.publishedAt);
    if (!Number.isNaN(t) && t < cutoff) {
      dropped.push({ url: item.url, reason: "outside date window" });
      continue;
    }
    if (isHardExcluded(item)) {
      dropped.push({ url: item.url, reason: "advertisement" });
      continue;
    }
    const official = item.publisher === "BK Häcken";
    const extra = { url: item.url, bodyText: item.bodyText };
    const mentions = mentionsHäcken(item.title, item.summary ?? "", extra);

    // A secondary-source article that never says "Häcken" in its title but
    // names a current Häcken man is still Häcken news — "Gustav Lindgren gör
    // hattrick mot Kalmar" is the single most newsworthy item in its set, and
    // dropping it on a literal string match was a real false negative.
    //
    // A FORMER Häcken man counts too (2026-10-09): "Officiellt: Zeidane
    // Inoussa lånas ut av Swansea" never says "Häcken" and was dropped. The
    // user's requirement is that the app shares news about current AND former
    // men's-team players.
    //
    // This REUSES classifyRelevance rather than introducing a second person
    // matcher, so the conservative stances stay exactly as they are: a
    // women's player still wins, a Häcken mention with no men's evidence is
    // still UNKNOWN, and ambiguous surnames are still excluded.
    //
    // The whole men's/former VERDICT is accepted, not just `matchedPerson`
    // (2026-10-09). Two real classes of Häcken news carry no person at all and
    // were dropped here purely because no person was matched:
    //   - a club-scoped feed item whose Häcken relation appears in the body
    //     ("Krävs för att BK Häcken ska fortsätta vara konkurrenskraftiga" —
    //     club finances, no competition keyword);
    //   - the club's own contract/transfer list ("LISTA: Kontraktsläget i BK
    //     Häcken").
    // classifyRelevance has already applied every conservative veto to reach
    // CURRENT_HACKEN/FORMER_PLAYER, so re-checking `matchedPerson` here would
    // only re-drop what those vetos deliberately allowed.
    const rel = opts.known ? classifyRelevance(item, opts.known) : null;
    const namesKnownMan = rel?.relevance === "CURRENT_HACKEN" || rel?.relevance === "FORMER_PLAYER";

    // General Allsvenskan coverage without a Häcken mention is league noise.
    if (!official && !mentions && !namesKnownMan) {
      const reason = isGeneralAllsvenskan(item.title, item.summary ?? "", extra)
        ? "general allsvenskan, no Häcken relation"
        : "no Häcken relation";
      dropped.push({ url: item.url, reason });
      continue;
    }
    candidates.push(item);
  }

  // Newest first, capped — this bounds the single Gemini request size.
  candidates.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const kept = candidates.slice(0, maxItems);
  for (const extra of candidates.slice(maxItems)) {
    dropped.push({ url: extra.url, reason: "over candidate cap" });
  }
  return { candidates: kept, dropped };
}
