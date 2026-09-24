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
 * - Same normalized title within ±3 days → duplicates.
 */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles: Array<{ norm: string; date: number; keep: NewsItem }> = [];
  const out: NewsItem[] = [];

  for (const item of items) {
    const cUrl = canonicalUrl(item.url);
    if (seenUrls.has(cUrl)) continue;
    const norm = normalizeTitle(item.title);
    const t = Date.parse(item.publishedAt);
    const dup = seenTitles.find((s) => {
      if (s.norm !== norm) return false;
      if (Number.isNaN(t) || Number.isNaN(s.date)) return false;
      return Math.abs(t - s.date) <= 3 * 24 * 3600 * 1000;
    });
    if (dup) continue;
    seenUrls.add(cUrl);
    seenTitles.push({ norm, date: t, keep: item });
    out.push(item);
  }
  return out;
}
