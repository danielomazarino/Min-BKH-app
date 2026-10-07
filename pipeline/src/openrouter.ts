/**
 * OpenRouter news synthesis — the provider now under evaluation.
 *
 * This is a DELIBERATE MEASUREMENT PATH, not the production path. It sends the
 * same articles Gemini would have seen and asks the same question with the same
 * system instruction, but its answer is NEVER written into app.json. The app
 * keeps the deterministic events either way. The point is to record what the
 * provider actually does on real nightly news — quality, latency and cost — so
 * switching it on later is an informed decision rather than a leap of faith.
 *
 * WHY IT IS SAFE TO RUN UNATTENDED
 * - Exactly ONE upstream request per run, hard-capped in code (MAX_TOTAL_CALLS).
 * - No retry storm. Free-tier `:free` models live in a shared upstream pool that
 *   frequently 429s; retrying would burn quota for no new information (measured:
 *   2 of 3 attempts were upstream 429s while only 4/1000 of OUR budget was used).
 * - The result feeds metrics and the log only. Even a perfect answer changes
 *   nothing the supporter sees.
 * - The key is read only to make the single authenticated fetch. safeUrl and the
 *   metrics recorder keep it out of the log.
 */

import { trackedFetch, noteCost, noteErrorDetail, noteLlmCall } from "./apiMetrics";
import { resolveFreeModel } from "./openrouterModel";
import {
  parseGeminiResponse,
  truncateSummary,
  SYSTEM_INSTRUCTION,
  RawSchemaJson,
  type GeminiArticleInput,
  type GeminiResult,
} from "./gemini";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Legacy default, kept only as a documented constant for tests and reference.
 * It was DELISTED from OpenRouter's catalog by 2026-10-06 (every call 404'd
 * while the key was healthy). Do NOT use it as a fallback — the live model is
 * resolved dynamically via resolveFreeModel() from the current catalog.
 */
export const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3.8-27b:free";

const TIMEOUT_MS = 60_000;

/**
 * HARD CAP on upstream requests for one run. One, deliberately.
 *
 * This is the whole safety story for an unattended nightly: the worst case is a
 * NUMBER, not a product of models x attempts. Measured history: 3 attempts
 * total, 1 success (21s) + 2 upstream 429s. A single request cannot become a
 * quota event, and cannot become an incident.
 */
const MAX_TOTAL_CALLS = 1;

class OpenRouterHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`OpenRouter HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Turn an OpenRouter error body into a short, diagnosable Swedish string.
 *
 * The body is JSON with an `error.metadata` block that names the REAL limit:
 *   limit_source: "upstream_provider_shared_pool" → the shared free pool, not us
 *   provider_name: "Google AI Studio"             → whose capacity was busy
 *   remedy_hint / raw                              → what OpenRouter suggests
 *
 * Status codes get fixed meanings so the panel can explain them without the
 * body: 402 billing, 401/403 auth, 404 model gone, 429 rate limit, 5xx provider.
 */
export function describeOpenRouterError(status: number, body: string): string {
  interface ErrorMeta {
    raw?: string;
    provider_name?: string;
    limit_source?: string;
    remedy_hint?: string;
  }
  let meta: ErrorMeta | null = null;
  try {
    const parsed = JSON.parse(body) as { error?: { metadata?: ErrorMeta } };
    meta = parsed.error?.metadata ?? null;
  } catch {
    /* non-JSON body — fall through to the status-based text */
  }

  const parts: string[] = [];
  if (meta?.limit_source === "upstream_provider_shared_pool") {
    parts.push(
      `Delad gratis-pool hos ${meta.provider_name ?? "leverantören"} är upptagen — inte vår kvot`,
    );
  } else if (meta?.raw) {
    parts.push(meta.raw.slice(0, 160));
  }

  switch (status) {
    case 401:
    case 403:
      parts.push("401/403 = nyckeln avvisad (fel eller spärrad nyckel)");
      break;
    case 402:
      parts.push("402 = fakturering — kontot saknar täckning även för gratismodeller");
      break;
    case 404:
      parts.push("404 = modellen finns inte längre (avlistad från katalogen)");
      break;
    case 429:
      if (parts.length === 0)
        parts.push("429 = taktnivå nådd — kan vara vår kvot ELLER den delade poolen");
      break;
    default:
      if (status >= 500)
        parts.push(`${status} = leverantörens fel, ingen provider klarade routingen`);
      else parts.push(`HTTP ${status}`);
  }
  if (meta?.remedy_hint) parts.push(`Åtgärd: ${meta.remedy_hint.slice(0, 120)}`);
  return parts.join(" · ");
}

/**
 * Build the OpenRouter chat-completions request.
 *
 * Uses OpenRouter's `response_format: { type: "json_schema" }` so the model is
 * held to the SAME schema Gemini is held to. That is what makes two providers
 * comparable: identical articles, identical instruction, identical output
 * contract, so any difference in the result is the provider's, not the harness's.
 */
export function buildOpenRouterRequestPayload(articles: GeminiArticleInput[], model?: string) {
  const articleBlocks = articles.map((a) =>
    [
      `<article id="${a.id}">`,
      `publisher: ${a.publisher}`,
      `url: ${a.url}`,
      `published: ${a.publishedAt}`,
      a.sourceTags?.length ? `sourceTags: ${a.sourceTags.join(", ")}` : "",
      `title: ${a.title}`,
      a.text ? `text: ${a.text}` : `text: (SA INTE GÅ att hämta — använd bara titel och url)`,
      `</article>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return {
    model: model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      {
        role: "user",
        content: `Analysera dessa ${articles.length} artiklar och returnera JSON enligt schemat.

${articleBlocks.join("\n\n")}

Svara för VARJE artikel med en verdict (scope/confidence/reason).
Svara med ett event per underliggande händelse, och lista de articleId som hör till den.
Endast artiklar med scope "men" ska ingå i events.`,
      },
    ],
    temperature: 0.1,
    response_format: {
      type: "json_schema",
      // RawSchemaJson, NOT RawSchema. Gemini's uppercase dialect
      // ("OBJECT"/"ARRAY"/"STRING") is rejected by xgrammar, the
      // constrained-decoding engine behind json_schema. Sending it produced,
      // on the first real nightly run (37251529017):
      //   HTTP 400  grammar does not compile: xgrammar StructuralTag
      //             compilation failed
      // The request never reached the model — it failed while compiling the
      // grammar, so this was a request-construction bug, not a provider
      // outage. The contract is identical; only the spelling differs.
      json_schema: { name: "news_events", strict: true, schema: RawSchemaJson },
    },
  };
}

export interface OpenRouterSynthesis {
  /** Always null in this measurement build — deliberately not used for app.json. */
  result: null;
  status: { ok: boolean; error?: string; calls: number; model?: string };
  /** Populated only on success: what the provider actually produced. */
  observation?: {
    events: number;
    menScoped: boolean;
    unknownIds: string[];
    rejected: number;
    model: string;
    responseChars: number;
  };
}

export interface OpenRouterOutcome {
  ok: boolean;
  error?: string;
  calls: number;
  model?: string;
  /** Parsed + validated answer, or null. Measured, never shipped. */
  answer: GeminiResult | null;
  /** Ids the model referenced that we never supplied — a fabrication signal. */
  unknownIds: string[];
  /** Articles the model refused to place in an event. */
  rejectedCount: number;
}

/**
 * ONE request. No retry, no fallback model, no second attempt.
 *
 * A 429 from the shared free pool is a legitimate and informative outcome for a
 * measurement run — it says the provider is not reliably available at 03:30,
 * which is exactly what must be known before switching it on. Retrying would
 * convert a clear "unavailable" into a quota spend and still tell us nothing new.
 */
export async function synthesizeWithOpenRouter(
  articles: GeminiArticleInput[],
): Promise<OpenRouterOutcome> {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    return { ok: false, error: "OPENROUTER_API_KEY is not set", calls: 0, answer: null, unknownIds: [], rejectedCount: 0 };
  }
  if (articles.length === 0) {
    return { ok: false, error: "no articles to analyse", calls: 0, answer: null, unknownIds: [], rejectedCount: 0 };
  }
  if (MAX_TOTAL_CALLS < 1) {
    return { ok: false, error: "call cap is zero", calls: 0, answer: null, unknownIds: [], rejectedCount: 0 };
  }

  // Resolve the model BEFORE the request. The catalog lookup is a public
  // metadata call: no key, no quota, no generation request. A pinned model
  // that has been delisted fails HERE, loudly, instead of as a silent 404
  // that still counted against the daily allowance.
  let model: string;
  try {
    model = (await resolveFreeModel(process.env.OPENROUTER_MODEL)).model;
  } catch (e) {
    return {
      ok: false,
      error: `model resolution failed: ${e instanceof Error ? e.message : String(e)}`,
      calls: 0,
      answer: null,
      unknownIds: [],
      rejectedCount: 0,
    };
  }

  const payload = buildOpenRouterRequestPayload(articles, model);
  const started = Date.now();

  try {
    const res = await trackedFetch(
      "openrouter",
      ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://danielomazarino.github.io/Min-BKH-app/",
          "X-Title": "Min BKH-app",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      // metered:true so the request is charged against the daily quota.
      // Without it a real, billable call would be recorded but never counted.
      { metered: true },
    );

    if (!res.ok) {
      const body = await res.text();
      // The status alone ("HTTP 429") cannot be diagnosed: OUR quota and the
      // SHARED upstream pool both answer 429 with opposite remedies. The body
      // names which one it was (limit_source, provider_name, remedy_hint), so
      // patch the readable parts onto the trackedFetch record for the panel.
      noteErrorDetail("openrouter", describeOpenRouterError(res.status, body));
      throw new OpenRouterHttpError(res.status, body);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { total_cost?: number; cost?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const usedModel = json.model ?? model;

    // ONE record per request. `trackedFetch` above already recorded the call,
    // with real status, duration and byte counts. Calling `noteLlmCall` as
    // well produced a SECOND record for the same HTTP request, which is why
    // the first live run reported "2 calls" for a stage hard-capped at one
    // request, and charged two quota for one send.
    //
    // Cost is attached to that existing record via `noteCost` rather than by
    // pushing another entry. 0 means the provider REPORTED it free; null means
    // nobody told us. They are never conflated.
    const reportedCost = typeof json.usage?.total_cost === "number" ? json.usage.total_cost : null;
    noteCost("openrouter", reportedCost);

    if (!text.trim()) {
      return {
        ok: false,
        error: "OpenRouter returned an empty response",
        calls: 1,
        model: usedModel,
        answer: null,
        unknownIds: [],
        rejectedCount: 0,
      };
    }

    // Parse and validate against the SAME contract Gemini must satisfy. This is
    // what makes the verdict comparable rather than a matter of opinion.
    let answer: GeminiResult | null = null;
    let unknownIds: string[] = [];
    let parseError: string | undefined;
    try {
      const parsed = parseGeminiResponse(text, articles.map((a) => a.id));
      answer = {
        ...parsed.result,
        events: parsed.result.events.map((e) => ({
          ...e,
          summary: truncateSummary(e.summary),
        })),
      };
      unknownIds = parsed.unknownIds;
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }

    // Cost semantics matter here: 0 means the provider REPORTED the call as
    // free; null means it did not report a figure. They must never be conflated,
    // because "we spent nothing" and "we do not know what this cost" lead to
    // opposite decisions about whether to keep running it. It is attached to
    // this request's trackedFetch record via noteCost, above.
    if (parseError || !answer) {
      return {
        ok: false,
        error: `response failed our own validation: ${parseError ?? "unknown"}`,
        calls: 1,
        model: usedModel,
        answer: null,
        unknownIds,
        rejectedCount: 0,
      };
    }

    return { ok: true, calls: 1, model: usedModel, answer, unknownIds, rejectedCount: 0 };
  } catch (e) {
    // A failed request has already left its own trackedFetch record carrying
    // the real status (429/5xx) and the network-level timing. Pushing a second
    // entry here is exactly what made the first live run report two calls for a
    // stage hard-capped at one, and charge two quota for one send.
    const status = e instanceof OpenRouterHttpError ? e.status : 0;
    const msg = e instanceof Error ? e.message : String(e);
    if (status === 0) {
      // The request never produced an HTTP response (DNS, TLS, abort). Only in
      // that case is there no trackedFetch record to carry the failure, so this
      // is the one situation that genuinely needs to be recorded by hand.
      noteLlmCall("openrouter", {
        model,
        status: 0,
        ok: false,
        durationMs: Date.now() - started,
        responseBytes: null,
        cost: null,
      });
    }
    return { ok: false, error: msg, calls: 1, answer: null, unknownIds: [], rejectedCount: 0 };
  }
}