/**
 * Wikipedia as the narrative layer over Wikidata's structured claims.
 *
 * WHY THIS EXISTS
 * ---------------
 * The first enrichment pass (2026-10-05) read only Wikidata's structured
 * claims. The result was honest but thin: P54 qualifiers exist for maybe half
 * of all stints, P1350/P1351 (apps/goals) are curated by almost nobody, and
 * nothing in Wikidata says what a player is DOING now. The supporter-visible
 * verdict was "lousy data" — and it was right.
 *
 * Wikipedia is the fix, and it costs nothing:
 *   - Every Wikidata entity carries `sitelinks` — the Wikipedia articles that
 *     are ABOUT that exact entity. No name matching, no guessing.
 *   - The articles are written by humans who care about footballers' careers,
 *     so they carry the narrative Wikidata never will: "Efter en succésäsong
 *     med Qviding i division 1 med hela 14 mål och 6 assist på 21 matcher
 *     skrev han på för BK Häcken".
 *   - The REST summary endpoint is CORS-open (`access-control-allow-origin: *`,
 *     verified 2026-10-06), needs no key, and returns a lead paragraph plus a
 *     properly-cropped thumbnail.
 *
 * THE IDENTITY TRAP (verified live 2026-10-06)
 * --------------------------------------------
 * A title match is NOT an identity match. "Mats Hedén" on sv.wikipedia is a
 * MUSICIAN (Q5795456); our footballer Mats Hedén is Q103846058. The REST
 * response carries `wikibase_item` — the Q-ID the article is actually about —
 * so every response is checked against the Q-ID we searched for. A mismatch
 * is discarded: showing a musician's biography beside a footballer's stats is
 * exactly the confident-wrong-answer this app refuses to ship.
 *
 * COST: one request per language tried, at most two (sv then en), only when a
 * sheet is opened. Cached per Q-ID for the session.
 */

/** REST summary endpoint per language. `origin=*` is not needed here; the
 *  REST endpoint sends `access-control-allow-origin: *` unconditionally. */
const REST = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/** Languages tried in order. Swedish first — the app's audience reads it. */
const LANGS = ["sv", "en"] as const;

export interface WikipediaSummary {
  /** The article language actually used. */
  lang: string;
  /** Lead paragraph, plain text. */
  extract: string;
  /** Properly-cropped lead image, or undefined. */
  imageUrl?: string;
  /** Canonical article URL, for provenance. */
  pageUrl: string;
  /** The Q-ID the article is about — the identity proof. */
  wikibaseItem: string;
}

/**
 * Fetch the Wikipedia summary for a Wikidata entity.
 *
 * Returns null when: no sitelink exists, every language 404s, or — the
 * important case — the article found is about a DIFFERENT person. Null is the
 * honest answer ("Wikipedia has nothing verified to add"), never an error.
 */
export async function fetchWikipediaSummary(
  qid: string,
  sitelinks: Record<string, { title: string }>,
  deps: { fetch: FetchLike },
): Promise<WikipediaSummary | null> {
  for (const lang of LANGS) {
    const key = `${lang}wiki`;
    const title = sitelinks[key]?.title;
    if (!title) continue;

    try {
      const res = await deps.fetch(REST(lang, title), { headers: { Accept: "application/json" } });
      if (res.status === 404) continue; // article gone; try the next language
      if (!res.ok) continue;

      const json = (await res.json()) as {
        extract?: string;
        thumbnail?: { source?: string };
        originalimage?: { source?: string };
        content_urls?: { desktop?: { page?: string } };
        wikibase_item?: string;
      };

      // THE IDENTITY GUARD. A title match is not an identity match — measured:
      // "Mats Hedén" on sv.wikipedia is a musician (Q5795456), not our
      // footballer (Q103846058). If the article is about someone else, it is
      // not enrichment, it is a wrong biography.
      if (json.wikibase_item && json.wikibase_item !== qid) continue;

      const extract = json.extract?.trim();
      if (!extract) continue;

      return {
        lang,
        extract,
        imageUrl: json.thumbnail?.source ?? json.originalimage?.source,
        pageUrl: json.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        wikibaseItem: json.wikibase_item ?? qid,
      };
    } catch {
      // A transport failure is not evidence of absence. Try the next language;
      // if none answers, the caller renders the Wikidata-only card.
      continue;
    }
  }
  return null;
}

type FetchLike = typeof fetch;

/* ------------------------------------------------------------------ *
 * Session cache — one entry per Q-ID
 * ------------------------------------------------------------------ *
 *
 * Opening the same player twice must not spend the request twice. Unlike the
 * search cache, a null result IS cached: "Wikipedia has nothing verified on
 * this person" is a fact about the source, and re-asking every open would
 * spend the request for the same answer.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 60;

interface CacheEntry {
  at: number;
  value: WikipediaSummary | null;
}

const cache = new Map<string, CacheEntry>();

export function readWikiCache(qid: string, now: number): WikipediaSummary | null | undefined {
  const hit = cache.get(qid);
  if (!hit) return undefined;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(qid);
    return undefined;
  }
  return hit.value;
}

export function writeWikiCache(qid: string, value: WikipediaSummary | null, now: number): void {
  cache.set(qid, { at: now, value });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export function clearWikiCache(): void {
  cache.clear();
}
