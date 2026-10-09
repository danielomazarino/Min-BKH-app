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
 *   - Archived items are RE-VALIDATED against the current rules before being
 *     re-served (see `opts.isStillValid`). Without this an article kept by an
 *     earlier, looser build stayed on the site for 21 days after the rule that
 *     let it in was fixed — measured 2026-10-09: four false positives
 *     ("VM 94-hjälten Roger Ljung skiljer sig", "Britt-Marie Mattsson: Trump
 *     bjuder in Putin…", plus two ice-hockey stories) were re-published every
 *     night, tagged "Tidigare spelare", even though the CURRENT classifier
 *     returns UNRELATED for all four. A filter fix must be able to withdraw a
 *     wrong item, not only stop new ones.
 *   - This is a DATA-MERGING step only: it never INVENTS a verdict, and the
 *     per-run audit still reports what THAT run fetched (accumulation must not
 *     make the audit lie about tonight's fetch).
 */
import type { NewsItem } from "./types";
import { canonicalUrl, normalizeTitle } from "./dedupe";

/** How long an accumulated article stays in the app once seen. */
export const RETENTION_DAYS = 21;

/** Hard cap on the accumulated list, newest first. */
export const MAX_ACCUMULATED = 60;

export interface AccumulateOptions {
  /**
   * Re-validate a PREVIOUSLY-ARCHIVED item before re-serving it.
   *
   * Applied to `previous` ONLY, never to `fresh`: this run's survivors have
   * already passed the current gates, and re-running the classifier on them
   * here would both be redundant and risk disagreeing with the run's own audit.
   * Optional so existing callers/tests keep their exact behaviour.
   */
  isStillValid?: (item: NewsItem) => boolean;
}

/**
 * Merge previously-served news with this run's news.
 *
 * `now` is injected so the retention cut-off is testable without the clock.
 */
export function accumulateNews(
  previous: readonly NewsItem[],
  fresh: readonly NewsItem[],
  now: Date = new Date(),
  opts: AccumulateOptions = {},
): NewsItem[] {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000;

  // Re-validation applies to `previous` ONLY. Fresh items already passed the
  // current gates this run, and re-classifying them here could contradict the
  // run's own per-run audit.
  const previous_ = opts.isStillValid
    ? previous.filter((i) => opts.isStillValid!(i))
    : previous;

  // New items first so they win the dedupe, then the previous list.
  const ordered = [...fresh, ...previous_];
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
