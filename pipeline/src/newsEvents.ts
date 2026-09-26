import type { NewsEvent, NewsItem, SourceRole } from "./types";

/**
 * Source role registry — per-publication defaults, refined per article when
 * attribution evidence exists (see docs/SOURCES.md for the audit).
 *
 * PRIMARY     = original reporting / official announcements
 * SECONDARY   = reputable reporting on events first reported elsewhere
 * DISCOVERY   = mechanism that finds content, not a source itself
 */
export const PUBLISHER_ROLES: Record<string, SourceRole> = {
  "BK Häcken": "primary", // official club announcements
  "Allsvenskan": "primary", // official competition channel
  "SvFF": "primary", // official federation
  "Sportbladet": "secondary", // large newsroom, mostly secondary reporting
  "Expressen": "secondary",
  "SVT Sport": "secondary",
  "Göteborgs-Posten": "secondary", // local reporting on Gothenburg clubs
  "Bollsvenskan": "secondary", // Allsvenskan-focused; article-level attribution varies
  "Fotbolltransfers": "secondary", // transfer-market focused
};

export function publisherRole(publisher: string): SourceRole {
  return PUBLISHER_ROLES[publisher] ?? "unknown";
}

/**
 * Group deduplicated articles into news EVENTS.
 * Articles describing the same underlying story (same normalized title within
 * a date window, already handled by dedupeNews) are merged into one event
 * with multiple source pills.
 */
export function buildNewsEvents(items: NewsItem[]): NewsEvent[] {
  const groups = new Map<string, NewsItem[]>();
  for (const item of items) {
    const key = item.dedupeKey ?? normalizeEventKey(item.title);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const events: NewsEvent[] = [];
  for (const [, list] of groups) {
    // Sort newest first; the newest article's title leads the card.
    const sorted = [...list].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const lead = sorted[0];
    const summary = pickSummary(sorted);
    // The lead article's image represents the event; fall back to any source
    // that has one so a story never loses its thumbnail just because the
    // newest article happened to have no image.
    const imageUrl = lead.imageUrl ?? sorted.find((s) => s.imageUrl)?.imageUrl;
    events.push({
      id: `event-${lead.id}`,
      title: lead.title,
      summary,
      publishedAt: lead.publishedAt,
      latestPublishedAt: lead.publishedAt,
      category: lead.category,
      ...(imageUrl ? { imageUrl } : {}),
      // The lead article's image represents the event; fall back to any
      // source that has one so a story never loses its thumbnail because the
      // newest article happens to have no image.
      ...(lead.imageUrl ?? sorted.find((s) => s.imageUrl)?.imageUrl
        ? { imageUrl: lead.imageUrl ?? sorted.find((s) => s.imageUrl)?.imageUrl }
        : {}),
      sources: sorted.map((s) => ({
        publisher: s.publisher,
        url: s.url,
        publishedAt: s.publishedAt,
        role: s.sourceRole ?? publisherRole(s.publisher),
        discoveredVia: s.discoveredVia,
      })),
      summaryMethod: summaryMethod(sorted),
    });
  }
  return events.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function normalizeEventKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Pick the best factual summary available without inventing content. */
function pickSummary(sorted: NewsItem[]): string {
  // Prefer the longest non-empty RSS description among sources — it is
  // source-derived text, not generated.
  const withDesc = sorted.filter((s) => s.summary && s.summary.trim().length > 20);
  if (withDesc.length > 0) {
    const best = withDesc.reduce((a, b) => (b.summary!.length > a.summary!.length ? b : a));
    return best.summary!.trim();
  }
  // Fallback: concise extracted excerpt from the lead title context.
  return sorted[0].title;
}

function summaryMethod(sorted: NewsItem[]): NewsEvent["summaryMethod"] {
  const withDesc = sorted.some((s) => s.summary && s.summary.trim().length > 20);
  return withDesc ? "rss-description" : "excerpt";
}
