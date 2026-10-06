/**
 * Dynamic free-model resolution for OpenRouter.
 *
 * WHY THIS EXISTS
 *   The original default, `qwen/qwen3.8-27b:free`, was DELISTED from
 *   OpenRouter's catalog between 2026-10-05 and 2026-10-06. Every call started
 *   returning HTTP 404 while the key itself was perfectly healthy (verified:
 *   GET /api/v1/key → 200, 0/1000 used). A pinned free model id is a liability:
 *   OpenRouter rotates the `:free` catalog without notice.
 *
 *   Fix chosen by the user (2026-10-06): resolve the model AT RUN TIME from the
 *   live catalog instead of pinning one.
 *
 * STABILITY VS FRESHNESS
 *   Pure "pick any free model" would make the nightly quality track record
 *   meaningless — a different model every night measures nothing. So resolution
 *   is DETERMINISTIC given a catalog:
 *     1. An explicit OPENROUTER_MODEL pin always wins (validated against the
 *        catalog; a pin naming a delisted model is an error, not a silent 404).
 *     2. Otherwise the first entry of PREFERRED_MODELS that still exists is used.
 *     3. Otherwise the alphabetically first free model (stable tie-break).
 *   Consecutive runs therefore use the SAME model until it is delisted, and the
 *   catalog change is visible in the log the moment it happens.
 *
 * COST
 *   GET /api/v1/models is a public metadata call. No key, no quota, no
 *   generation request. Resolution never spends anything.
 */

export const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

/**
 * Preference order over CURRENTLY LISTED free models (verified against
 * GET /api/v1/models on 2026-10-06: 466 models, 16 free). Ordered by general
 * capability for a structured Swedish news-grouping task; the first survivor
 * wins. When the whole list is delisted, update it — the resolver will say so.
 */
export const PREFERRED_MODELS = [
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-26b-a4b-it:free",
  "inclusionai/ling-3.0-flash-sante:free",
];

export interface ResolvedModel {
  model: string;
  /** How the model was chosen — goes straight into the run log. */
  reason: string;
  /** All free model ids visible in the catalog at resolution time. */
  freeCatalog: string[];
}

export async function fetchFreeModelCatalog(
  endpoint: string = MODELS_ENDPOINT,
  doFetch: typeof fetch = fetch,
): Promise<string[]> {
  const res = await doFetch(endpoint, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`model catalog lookup failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.endsWith(":free"));
  return ids.sort();
}

/**
 * Resolve which free model to use. Never spends a generation request.
 *
 * @param pinned value of OPENROUTER_MODEL, or undefined. A pin MUST end in
 *   `:free` (budget guard) and SHOULD exist in the catalog — a pin naming a
 *   delisted model throws, converting the old silent 404 into a loud, cheap,
 *   pre-request failure.
 */
export async function resolveFreeModel(
  pinned: string | undefined,
  catalog?: string[],
): Promise<ResolvedModel> {
  // Budget guard FIRST — before any network call. A non-free pin must fail
  // with zero fetches, not after a catalog lookup.
  if (pinned && !pinned.endsWith(":free")) {
    throw new Error(`OPENROUTER_MODEL "${pinned}" is not a :free variant — refusing (budget guard)`);
  }

  const free = (catalog ?? (await fetchFreeModelCatalog())).slice().sort();

  if (pinned) {
    if (!free.includes(pinned)) {
      throw new Error(
        `OPENROUTER_MODEL "${pinned}" is NOT in the current free catalog ` +
        `(${free.length} free models listed). It was likely delisted — this is ` +
        `the failure that silently 404'd on 2026-10-06. Pick another or unset the pin.`,
      );
    }
    return { model: pinned, reason: "explicit OPENROUTER_MODEL pin, verified present in catalog", freeCatalog: free };
  }

  const preferred = PREFERRED_MODELS.find((m) => free.includes(m));
  if (preferred) {
    return {
      model: preferred,
      reason: `first entry of PREFERRED_MODELS still listed (position ${PREFERRED_MODELS.indexOf(preferred) + 1})`,
      freeCatalog: free,
    };
  }

  if (free.length === 0) {
    throw new Error("no :free models in the OpenRouter catalog at all — dynamic resolution impossible");
  }
  return {
    model: free[0],
    reason: "no preferred model listed; fell back to alphabetically first free model",
    freeCatalog: free,
  };
}