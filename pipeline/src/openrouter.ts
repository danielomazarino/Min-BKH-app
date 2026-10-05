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

import { trackedFetch, noteLlmCall } from "./apiMetrics";
import {
  parseGeminiResponse,
  truncateSummary,
  SYSTEM_INSTRUCTION,
  RawSchemaJson,
  type GeminiArticleInput,
  type GeminiResult,
} from "./gemini";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Default provider model. `:free` = no credit cost, shared upstream pool. */
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
 * Build the OpenRouter chat-completions request.
 *
 * Uses OpenRouter's `response_format: { type: "json_schema" }` so the model is
 * held to the SAME schema Gemini is held to. That is what makes two providers
 * comparable: identical articles, identical instruction, identical output
 * contract, so any difference in the result is the provider's, not the harness's.
 */
export function buildOpenRouterRequestPayload(articles: GeminiArticleInput[]) {
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
    model: process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
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
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
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

  const payload = buildOpenRouterRequestPayload(articles);
  const started = Date.now();

  try {
    const res = await trackedFetch("openrouter", ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://danielomazarino.github.io/Min-BKH-app/",
        "X-Title": "Min BKH-app",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new OpenRouterHttpError(res.status, body);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { total_cost?: number; cost?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    const durationMs = Date.now() - started;
    const usedModel = json.model ?? model;

    if (!text.trim()) {
      noteLlmCall("openrouter", {
        model: usedModel,
        status: 200,
        ok: false,
        durationMs,
        responseBytes: 0,
        cost: json.usage?.total_cost ?? null,
      });
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
    // opposite decisions about whether to keep running it.
    const cost = typeof json.usage?.total_cost === "number" ? json.usage.total_cost : null;

    noteLlmCall("openrouter", {
      model: usedModel,
      status: 200,
      ok: parseError === undefined,
      durationMs,
      responseBytes: text.length,
      cost,
    });

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
    const status = e instanceof OpenRouterHttpError ? e.status : 0;
    const msg = e instanceof Error ? e.message : String(e);
    noteLlmCall("openrouter", {
      model,
      status,
      ok: false,
      durationMs: Date.now() - started,
      responseBytes: 0,
      // A failed call reported no cost figure. null, never 0: claiming a failed
      // call was free would hide that we simply do not know.
      cost: null,
    });
    return { ok: false, error: msg, calls: 1, answer: null, unknownIds: [], rejectedCount: 0 };
  }
}