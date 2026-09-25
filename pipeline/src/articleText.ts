/**
 * Minimal server-side article text extraction for Gemini synthesis.
 *
 * This runs ONLY inside the GitHub Actions data pipeline. The browser never
 * fetches article bodies. RSS descriptions are often truncated or absent, so
 * for the candidate set we fetch the original page and extract readable text.
 *
 * Design rule: smallest reliable approach, no scraping framework. If a page
 * cannot be fetched or yields no text, the caller keeps the article metadata
 * and records that text was unavailable — nothing is ever invented.
 */

const MAX_CHARS = 4000;

export interface ArticleText {
  url: string;
  ok: boolean;
  text?: string;
  /** HTTP status or extraction failure reason. */
  error?: string;
}

const UA = "MinBKH/0.1 (supporter PWA; news synthesis; contact: repo issues)";

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Strip markup and collapse whitespace. */
export function extractTextFromHtml(html: string): string {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ");
  const text = decodeEntities(noScripts.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_CHARS);
}

/** Fetch one article page and extract plain text. Never throws. */
export async function fetchArticleText(url: string): Promise<ArticleText> {
  if (!/^https?:\/\//i.test(url)) return { url, ok: false, error: "not an http(s) url" };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (!/html|plain|text/i.test(contentType) && !/<\w+/.test(body)) {
      return { url, ok: false, error: `unsupported content-type ${contentType || "unknown"}` };
    }
    const text = extractTextFromHtml(body);
    if (text.length < 80) return { url, ok: false, error: "no readable text extracted" };
    return { url, ok: true, text };
  } catch (e) {
    return { url, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Extract text for a batch, sequentially, with a small concurrency window. */
export async function fetchArticleTexts(
  urls: string[],
  concurrency = 4,
): Promise<Map<string, ArticleText>> {
  const out = new Map<string, ArticleText>();
  const queue = [...urls];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      out.set(url, await fetchArticleText(url));
    }
  });
  await Promise.all(workers);
  return out;
}
