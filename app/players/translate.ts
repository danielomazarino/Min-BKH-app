/**
 * Machine translation for the home-country Wikipedia layer.
 *
 * WHY THIS EXISTS (user, 2026-10-07): "translate complementary text
 * information to Swedish". A player's own-country Wikipedia is often the
 * richest source — Brice Wembangomo's Norwegian article carries his whole
 * career while sv.wikipedia has no infobox — but the app's audience reads
 * Swedish. Showing a Norwegian paragraph untranslated is not enrichment.
 *
 * THE SOURCE: MyMemory (https://mymemory.translated.net). Chosen because it
 * is the one free endpoint that is CORS-open — verified 2026-10-07:
 * `access-control-allow-origin: *` on a real request, and a real translation
 * returned ("Han har tidligere spilt for Kvik Halden" → "Han har tidigare
 * spelat för Kvik Halden"). No key, no signup.
 *
 * HONESTY RULES
 * -------------
 *  - A translation is MACHINE output and is labelled as such in the UI. It is
 *    never presented as the source's own words.
 *  - A failed translation returns null; the caller then shows the ORIGINAL
 *    text with a note, never a fabricated Swedish sentence.
 *  - Only the narrative extract is translated. Structured facts (years, apps,
 *    goals, club names) are NOT translated — a club name is a proper noun and
 *    translating it would invent a name that does not exist.
 */

const ENDPOINT = "https://api.mymemory.translated.net/get";

/** MyMemory caps a single query; longer text is truncated by the API. */
const MAX_CHARS = 480;

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 80;

interface CacheEntry {
  at: number;
  value: string | null;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(text: string, from: string, to: string): string {
  return `${from}>${to}:${text}`;
}

export function readTranslationCache(text: string, from: string, to: string, now: number): string | null | undefined {
  const hit = cache.get(cacheKey(text, from, to));
  if (!hit) return undefined;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(cacheKey(text, from, to));
    return undefined;
  }
  return hit.value;
}

export function writeTranslationCache(text: string, from: string, to: string, value: string | null, now: number): void {
  cache.set(cacheKey(text, from, to), { at: now, value });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export function clearTranslationCache(): void {
  cache.clear();
}

/**
 * Translate `text` from `from` to `to`. Returns null on any failure — a
 * missing translation is honest, a wrong one is not.
 *
 * `from`/`to` are Wikipedia language codes; MyMemory uses ISO-639-1, which
 * matches for every language we try except Norwegian, where Wikipedia's `nb`
 * maps to MyMemory's `no`.
 */
export async function translateText(
  text: string,
  from: string,
  to: string,
  deps: { fetch: FetchLike },
): Promise<string | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (from === to) return trimmed;

  const src = from === "nb" || from === "nn" ? "no" : from;
  const url = `${ENDPOINT}?q=${encodeURIComponent(trimmed.slice(0, MAX_CHARS))}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(to)}`;

  try {
    const res = await deps.fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number | string;
    };
    // MyMemory signals quota/errors with a non-200 responseStatus inside a
    // 200 HTTP body. Treat anything but 200 as "no translation".
    if (json.responseStatus !== undefined && String(json.responseStatus) !== "200") return null;
    const out = json.responseData?.translatedText?.trim();
    if (!out) return null;
    // MyMemory echoes the input on some failures; that is not a translation.
    if (out.toLowerCase() === trimmed.toLowerCase()) return null;
    return out;
  } catch {
    return null;
  }
}

type FetchLike = typeof fetch;
