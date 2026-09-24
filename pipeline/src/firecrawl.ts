/**
 * Firecrawl Keyless client — supplementary discovery ONLY.
 *
 * Verified 2026-09-24 against https://docs.firecrawl.dev/features/search:
 * POST https://api.firecrawl.dev/v2/search works WITHOUT an API key
 * (Keyless). Cost: 2 credits per 10 results. No account/payment for public
 * users. Keyless gives ~1000 free credits/month.
 *
 * Firecrawl is a DISCOVERY mechanism, never the source of truth. Every result
 * keeps discoveredVia="firecrawl" and must be attributed to the underlying
 * source article.
 */

const ENDPOINT = "https://api.firecrawl.dev/v2/search";

export interface FirecrawlResult {
  url: string;
  title: string;
  description?: string;
}

export interface FirecrawlSearchStatus {
  ok: boolean;
  error?: string;
  creditsUsed?: number;
}

export async function firecrawlSearch(
  query: string,
  limit = 5,
): Promise<{ results: FirecrawlResult[]; status: FirecrawlSearchStatus }> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, sources: ["web"] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return { results: [], status: { ok: false, error: `HTTP ${res.status}` } };
    }
    const json = (await res.json()) as {
      success: boolean;
      data?: { web?: FirecrawlResult[] };
      creditsUsed?: number;
      error?: string;
    };
    if (!json.success) {
      return { results: [], status: { ok: false, error: json.error ?? "search failed", creditsUsed: json.creditsUsed } };
    }
    const web = json.data?.web ?? [];
    return { results: web, status: { ok: true, creditsUsed: json.creditsUsed } };
  } catch (e) {
    return { results: [], status: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Search career news for a former player. Conservative query design:
 * name + Swedish football transfer/contract vocabulary, to limit credits.
 */
export function playerQuery(playerName: string): string {
  return `${playerName} fotboll kontrakt eller övergång`;
}
