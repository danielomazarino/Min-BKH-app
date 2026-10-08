/**
 * News accumulation across nightly runs.
 *
 * WHY THIS EXISTS (user-reported 2026-10-08)
 * ------------------------------------------
 * The feeds are SAMPLED ONCE A NIGHT, and several of them are volatile:
 *    - gp.se/rss holds only the ~10 latest front-page items;
 *    - Sportbladet/Expressen/SVT roll over within a day or two.
 *
 * Tonight's run at 03:48 UTC caught GP's feed four minutes into its refresh —
 * it saw the 02:55–03:00 batch and MISSED "Rygaard om Häckens väntan: 'En
 * risk'", which was published at 03:47:07 and only became visible minutes
 * later. That article is gone from the feed forever, and nothing in the
 * pipeline could have recovered it. The user reported exactly this: "check the
 * gp.se source that is missing the news article from yesterday or the day
 * before about the bk häcken herr team status before the coming weekend's
 * game".
 *
 * Accumulating means an article seen on ANY night is retained until it ages
 * out, so a single unlucky sampling time cannot silently drop a story.
 *
 * RULES
 *   - New items win on URL collision, so a corrected headline/summary updates.
 *   - Items older than the retention window are dropped.
 *   - The list is capped, newest first, so app.json cannot grow without bound.
 *   - This is a DATA-MERGING step only: it never changes a verdict, and the
 *     per-run audit still reports what THAT run fetched (accumulation must not
 *     make the audit lie about tonight's fetch).
 */
import type { NewsItem } from "./types";
import { canonicalUrl, normalizeTitle } from "./dedupe";

/** How long an accumulated article stays in the app once seen. */
export const RETENTION_DAYS = 21;

/** Hard cap on the accumulated list, newest first. */
export const MAX_ACCUMULATED = 60;

/**
 * Merge previously-served news with this run's news.
 *
 * `now` is injected so the retention cut-off is testable without the clock.
 */
export function accumulateNews(
  previous: readonly NewsItem[],
  fresh: readonly NewsItem[],
  now: Date = new Date(),
): NewsItem[] {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000;

  // New items first so they win the dedupe, then the previous list.
  const ordered = [...fresh, ...previous];
  const byUrl = new Map<string, NewsItem>();
  const titleKeys = new Map<string, string>();

  for (const item of ordered) {
    const t = Date.parse(item.publishedAt);
    if (!Number.isNaN(t) && t < cutoff) continue;

    const url = canonicalUrl(item.url);
    if (byUrl.has(url)) continue; // a newer item already claimed this URL

    // Same-title-same-day items are the same story; keep the first (newest).
    const titleKey = `${normalizeTitle(item.title)}|${item.publishedAt.slice(0, 10)}`;
    const existingUrl = titleKeys.get(titleKey);
    if (existingUrl !== undefined) continue;

    byUrl.set(url, item);
    titleKeys.set(titleKey, url);
  }

  const out = [...byUrl.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return out.slice(0, MAX_ACCUMULATED);
}
