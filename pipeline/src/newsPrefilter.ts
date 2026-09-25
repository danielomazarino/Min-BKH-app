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
import { mentionsHäcken, isGeneralAllsvenskan } from "./newsRelevance";

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
    const mentions = mentionsHäcken(item.title, item.summary ?? "");
    // General Allsvenskan coverage without a Häcken mention is league noise.
    if (!official && !mentions) {
      const reason = isGeneralAllsvenskan(item.title, item.summary ?? "")
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
