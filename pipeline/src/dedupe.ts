import type { NewsItem } from "./types";

/** Normalize a title for dedup comparison. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9åäö ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

/**
 * Deterministic news deduplication.
 * - Same canonical URL → duplicates.
 * - Same normalized title within ±3 days → same EVENT.
 *
 * Event-level dedup: instead of discarding secondary coverage, all items
 * describing the same underlying story get the SAME dedupeKey so
 * buildNewsEvents can merge them into one event card with multiple source
 * pills (original publisher + original URL preserved for every source).
 * Exact URL duplicates (same canonical URL) are still removed outright.
 */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles: Array<{ norm: string; date: number; key: string }> = [];
  const out: NewsItem[] = [];

  for (const item of items) {
    const cUrl = canonicalUrl(item.url);
    if (seenUrls.has(cUrl)) continue; // same article, drop outright
    const norm = normalizeTitle(item.title);
    const t = Date.parse(item.publishedAt);
    const dup = seenTitles.find((s) => {
      if (s.norm !== norm) return false;
      if (Number.isNaN(t) || Number.isNaN(s.date)) return false;
      return Math.abs(t - s.date) <= 3 * 24 * 3600 * 1000;
    });
    if (dup) {
      // Same event from another publisher: keep it, but give it the lead
      // article's event key so buildNewsEvents merges them into one card.
      item.dedupeKey = dup.key;
      out.push(item);
      continue;
    }
    const key = `event-${cUrl}`;
    item.dedupeKey = item.dedupeKey ?? key;
    seenUrls.add(cUrl);
    seenTitles.push({ norm, date: t, key: item.dedupeKey });
    out.push(item);
  }
  return out;
}
