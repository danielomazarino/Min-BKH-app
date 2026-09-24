import { XMLParser } from "fast-xml-parser";
import type { NewsItem } from "./types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export interface FetchedFeed {
  ok: boolean;
  items: NewsItem[];
  error?: string;
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]);
  }
  return String(v);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchRss(
  url: string,
  publisher: string,
  discoveredVia = "rss",
): Promise<FetchedFeed> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MinBKH/0.1 (supporter PWA; contact: repo issues)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const doc = parser.parse(xml);
    const channel = doc?.rss?.channel ?? doc?.feed;
    const rawItems = channel?.item ?? channel?.entry ?? [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];
    const items: NewsItem[] = list.map((it: Record<string, unknown>, i: number) => {
      const link = text(it.link);
      const title = stripHtml(text(it.title));
      const description = stripHtml(text(it.description ?? it.summary));
      const pub = text(it.pubDate ?? it.published ?? it.updated);
      const enclosure = it.enclosure && typeof it.enclosure === "object" ? String((it.enclosure as Record<string, unknown>)["@_url"]) : undefined;
      return {
        id: `${publisher}-${i}-${link || title}`,
        title,
        url: link,
        summary: description.slice(0, 300) || undefined,
        publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
        publisher,
        category: "unknown",
        imageUrl: enclosure,
        discoveredVia,
        dedupeKey: link,
      };
    });
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
