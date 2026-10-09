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

/**
 * Cap for the body stored in `app.json` for in-app reading.
 *
 * Deliberately smaller than MAX_CHARS: this text is SERVED to every device, so
 * it is a payload cost, not just a synthesis input. 2000 characters is roughly
 * a full short news story and keeps the added payload to tens of kilobytes.
 */
export const MAX_BODY_CHARS = 2000;

export interface ArticleText {
  url: string;
  ok: boolean;
  text?: string;
  /** HTTP status or extraction failure reason. */
  error?: string;
  /**
   * Editorial image declared by the page (`og:image`).
   *
   * WHY: the RSS `<enclosure>` only exists on bkhacken.se, so only 4 of 21
   * events had a thumbnail. `og:image` is present on both readable sources and
   * is the same image the publisher shows in social cards.
   */
  imageUrl?: string;
  /**
   * Authoritative category labels rendered by the source on the article page
   * (BK Häcken: "Herr" / "Dam" / "Hållbarhet" / "Föreningen", ...).
   * Absent for sources that expose no such labels.
   */
  sourceTags?: string[];
}

import { trackedFetch } from "./apiMetrics";

const UA = "MinBKH/0.1 (supporter PWA; news synthesis; contact: repo issues)";

/**
 * Extract the source's own category badge labels from an article page.
 *
 * BK Häcken renders one Livewire `category-badge` per article for each
 * category it is filed under, e.g. ["Herr"], ["Dam"] or
 * ["Hållbarhet","Föreningen"]. These are the club's authoritative team
 * classification and are strictly better evidence than any keyword guess.
 *
 * Deliberately narrow: it reads only the badge component and never infers a
 * team from the title, body text or URL, so a place name such as
 * "Slätta Damm" can never be mistaken for a women's-team label.
 */
export function extractSourceTags(html: string): string[] {
  const out: string[] = [];
  const badge = /data-livewire-v2-component="category-badge"[^>]*>([\s\S]{0,200}?)<\/span>/g;
  for (const m of html.matchAll(badge)) {
    const label = m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

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

/**
 * PER-SOURCE BODY EXTRACTORS (measured 2026-10-09).
 *
 * The generic `extractTextFromHtml` strips every tag, so it returns the page's
 * navigation and footer as well as the story. On fotbolltransfers that meant a
 * body beginning "Logga in Kontakt Annonsera Nyheter Övergångar Podd Ligor …"
 * — unusable as reading text and noisy for synthesis. Each site keeps its
 * article prose in a stable container, so we read that container directly and
 * fall back to the generic strip only when the container is absent.
 *
 * Measured on live pages: bkhacken.se 1,027–2,476 chars of clean prose;
 * fotbolltransfers 2,935–8,735 chars of clean prose.
 */
function extractContainer(html: string, className: string, minLen: number): string {
  const re = new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`, "gi");
  const parts: string[] = [];
  for (const m of html.matchAll(re)) {
    const t = decodeEntities(m[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (t.length >= minLen) parts.push(t);
  }
  return parts.join("\n\n");
}

/** bkhacken.se keeps the story in `div.html-text` (lead + remainder). */
export function extractBkhBody(html: string): string {
  return extractContainer(html, "html-text", 40);
}

/** fotbolltransfers keeps the story in `div.article-text`. */
export function extractFtBody(html: string): string {
  return extractContainer(html, "article-text", 20);
}

/**
 * Sources whose article body we may read, and how.
 *
 * SCOPE IS DELIBERATE AND VERIFIED (2026-10-09). Both hosts publish
 * `User-agent: *` / `Disallow:` (empty = everything allowed) and neither is
 * paywalled. Expressen is EXCLUDED on two independent grounds: it is paywalled
 * ("Prenumerera / Logga in") and Bonnier News' robots.txt states that scraping
 * "for text and data aggregation … is strictly prohibited". A source not listed
 * here still contributes its headline, summary and link — only the body is
 * withheld.
 */
const BODY_EXTRACTORS: Array<{ host: RegExp; extract: (html: string) => string }> = [
  { host: /(^|\.)bkhacken\.se$/i, extract: extractBkhBody },
  { host: /(^|\.)fotbolltransfers\.com$/i, extract: extractFtBody },
];

/** True when this URL's host is one we are permitted to read in full. */
export function isReadableSource(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return BODY_EXTRACTORS.some((e) => e.host.test(host));
  } catch {
    return false;
  }
}

/**
 * Boilerplate lines that are not part of the story.
 *
 * Measured 2026-10-09: "FT:s nya satsning - lyssna på Transferpodden:" appears
 * in 16 of 20 fotbolltransfers bodies. It is a house promotion, not reporting,
 * and reading it mid-story is worse than reading nothing.
 */
const BOILERPLATE_LINES: RegExp[] = [
  /^FT:s nya satsning\b.*$/i,
  /^Lyssna på Transferpodden\b.*$/i,
  /^Följ oss\b.*$/i,
  /^Tipsa oss\b.*$/i,
];

/**
 * Tidy extracted prose for reading.
 *
 * WHY (measured 2026-10-09): the container extractor replaces every tag with a
 * space, so an inline link leaves a gap before its punctuation —
 * "BK Häcken</a>." became "BK Häcken ." and "Hestnes</a>, 30" became
 * "Hestnes , 30". Both were present in live bodies. Collapsing the space before
 * punctuation is a pure formatting fix: no word is added, removed or reordered.
 */
function cleanBody(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !BOILERPLATE_LINES.some((re) => re.test(p)))
    .map((p) =>
      p
        // "word ," -> "word,"  /  "word ." -> "word."
        .replace(/\s+([,.;:!?])/g, "$1")
        // "word )" -> "word)"  /  "( word" -> "(word"
        .replace(/\s+\)/g, ")")
        .replace(/\(\s+/g, "(")
        // collapse any run of spaces left behind
        .replace(/[ \t]{2,}/g, " "),
    )
    .join("\n\n");
}

/**
 * Extract the article body, preferring the source's own container.
 * Falls back to the generic strip so an unlisted host still yields text.
 */
export function extractArticleBody(html: string, url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* fall through to generic */
  }
  const found = BODY_EXTRACTORS.find((e) => e.host.test(host));
  if (found) {
    const body = found.extract(html);
    // Use the container result whenever it found ANYTHING, even a short
    // paragraph. Falling back to the generic strip on a short-but-real body
    // would reintroduce exactly the problem this exists to fix: the generic
    // strip returns the page's navigation, so a brief story would be replaced
    // by "Logga in Kontakt Annonsera Nyheter …". The generic path is only for
    // hosts with no known container.
    if (body.trim().length > 0) return cleanBody(body).slice(0, MAX_CHARS);
  }
  return extractTextFromHtml(html);
}

/**
 * The page's declared social/editorial image.
 *
 * Reads `og:image` in either attribute order, then `twitter:image` as a
 * fallback. Returns an absolute URL only — a relative value is discarded rather
 * than guessed, because a wrong image is worse than no image.
 */
export function extractOgImage(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const v = m?.[1]?.trim();
    if (v && /^https?:\/\//i.test(v)) return v;
  }
  return undefined;
}

/** Fetch one article page and extract plain text. Never throws. */
export async function fetchArticleText(url: string): Promise<ArticleText> {
  if (!/^https?:\/\//i.test(url)) return { url, ok: false, error: "not an http(s) url" };
  try {
    const res = await trackedFetch("article-text", url, {
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
    const text = extractArticleBody(body, url);
    // Category badges are metadata, not prose: collect them whenever the page
    // is readable, even if the body itself is too short to be useful.
    const sourceTags = extractSourceTags(body);
    const imageUrl = extractOgImage(body);
    if (text.length < 80) {
      return {
        url,
        ok: false,
        error: "no readable text extracted",
        ...(sourceTags.length ? { sourceTags } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      };
    }
    return {
      url,
      ok: true,
      text,
      ...(sourceTags.length ? { sourceTags } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    };
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
