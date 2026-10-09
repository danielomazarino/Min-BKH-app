/**
 * Gemini-assisted news SYNTHESIS.
 *
 * Gemini's only job is semantic interpretation of articles the deterministic
 * pipeline has already collected:
 *   - is this BK Häcken MEN's first team, women's, youth, or club/general?
 *   - which supplied articles describe the SAME underlying event?
 *   - what is the logical headline and a short factual Swedish summary?
 *
 * Gemini is NOT a discovery mechanism and NOT the source. It never receives
 * URLs it did not get from us, and any URL it returns that we did not supply is
 * discarded during validation.
 *
 * Cost model: ONE request per pipeline run, containing the whole candidate
 * batch (section 20 of the task). No per-article calls.
 *
 * No SDK is used: the REST endpoint with responseMimeType/responseSchema
 * returns validated JSON, which keeps the dependency surface at zero.
 */
import { z } from "zod";
import type { NewsCategory, NewsEvent, NewsItem } from "./types";
import { buildNewsEvents, publisherRole } from "./newsEvents";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 120000;

/**
 * Ordered model candidates.
 *
 * Verified 2026-09-25 against a real key:
 *   gemini-2.5-flash   -> HTTP 404 "no longer available to new users"
 *   gemini-3.8-flash   -> HTTP 503 UNAVAILABLE "high demand" (capacity, not auth)
 *
 * So the model is a runtime concern, not a build-time constant. We try the
 * candidates in order and use the first that answers. GEMINI_MODEL pins a
 * single model (useful for debugging).
 */
const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
];
/** Read per call, not at import time, so the env override is always honoured. */
function candidateModels(): string[] {
  const pinned = process.env.GEMINI_MODEL;
  return pinned ? [pinned] : DEFAULT_MODELS;
}

/** HTTP statuses worth retrying on a different model / after a pause. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export const MAX_SUMMARY_CHARS = 200;

/** One article as presented to Gemini. */
export interface GeminiArticleInput {
  id: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string;
  /** Article body text, or undefined when extraction failed. */
  text?: string;
  /** Deterministic hint from our own keyword classifier (advisory only). */
  categoryHint: NewsCategory;
  /** Official source tag evidence, e.g. "Herr" / "Dam", when present. */
  sourceTags?: string[];
}

export interface GeminiEvent {
  title: string;
  summary: string;
  /** Article ids (as supplied) that belong to this event. */
  articleIds: string[];
}

export interface GeminiVerdict {
  articleId: string;
  scope: "men" | "women" | "youth" | "club" | "unknown";
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface GeminiResult {
  verdicts: GeminiVerdict[];
  events: GeminiEvent[];
}

/**
 * Exported so the OpenRouter path can hold its model to the IDENTICAL output
 * contract. Two providers are only comparable if the instruction, the schema
 * and the parser are the same objects — otherwise a difference in the result
 * could be the harness's doing rather than the provider's.
 */
export const RawSchema = {
  type: "OBJECT",
  properties: {
    verdicts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          articleId: { type: "STRING" },
          scope: { type: "STRING", enum: ["men", "women", "youth", "club", "unknown"] },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          reason: { type: "STRING" },
        },
        required: ["articleId", "scope", "confidence", "reason"],
      },
    },
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          summary: { type: "STRING" },
          articleIds: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["title", "summary", "articleIds"],
      },
    },
  },
  required: ["verdicts", "events"],
} as const;

/**
 * THE SAME SCHEMA IN PLAIN JSON SCHEMA — lowercase type names.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT REDUNDANT
 * `RawSchema` above uses Gemini's UPPERCASE dialect ("OBJECT", "ARRAY",
 * "STRING"). That is correct for Gemini's `responseSchema` and is what the
 * working semantic evaluation used.
 *
 * Passing `RawSchema` straight to OpenRouter produced:
 *   HTTP 400  grammar does not compile: xgrammar StructuralTag
 *             compilation failed
 * because xgrammar — the constrained-decoding engine behind
 * `response_format: json_schema` — does not accept the uppercase dialect.
 * The request never reached the model; it was rejected while compiling the
 * grammar.
 *
 * So the two providers need the same CONTRACT in different DIALECTS. The
 * contract is defined once, here, and each provider gets the spelling it can
 * actually compile. Before this, the contract was duplicated by hand in
 * `openrouterSemanticEval.ts` and drifted — and a silent drift between
 * providers is exactly how a comparison becomes meaningless.
 */
export const RawSchemaJson = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          articleId: { type: "string" },
          scope: { type: "string", enum: ["men", "women", "youth", "club", "unknown"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string" },
        },
        required: ["articleId", "scope", "confidence", "reason"],
        additionalProperties: false,
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          articleIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "summary", "articleIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts", "events"],
  additionalProperties: false,
} as const;

/** Exported for the same reason as RawSchema — see the note there. */
export const SYSTEM_INSTRUCTION = `Du redigerar nyhetsflödet för en PWA om BK HÄCKENS HERRLAG.

För varje artikel bestämmer du:
1. Om den gäller herrlaget, damlaget, ungdom/academi eller klubb generellt.
2. Vilka andra av de levererade artiklarna som beskriver Samma underliggande händelse.

REGLER
- En artikel räknas som herrlag endast om det finns stöd i texten: herrlagsspelare, herrlagsmatch, Allsvenskan/herr, eller ett officiellt källtagg som "Herr".
- Ett omnämnande av "Häcken", ett bkhacken.se-länk eller ett kvinnligt spelarnamn är INTE i sig herrlag.
- Oklart underlag => scope "unknown". Gissa inte.
- Artiklar om samma match, samma resultat, samma transfer eller samma skada hör till samma händelse, ÄVEN om rubrikerna skiljer sig helt.
- Matchens två sidor är däremot separata händelser: material från FÖRE matchen (matchtrupp, förhandsprogram, besöksinformation, matchtröpehelg, truppen inför) hör inte ihop med material från EFTER matchen (matchrapport, referat, resultat), även om de gäller samma motståndare, samma match och samma vecka.
- Artiklar om samma AVSLUTADE utfall hör däremot ihop, även om några beskriver det olika: flera rapporter om samma resultat är en händelse.
- Artiklar om olika saker (t.ex. matchresultat och kontraktsförlängning) är separata händelser, även samma dag.
- Rubrik: en logisk svensk rubrik för hela händelsen.
- Sammanfattning: Svensk, faktisk, högst 200 tecken, inga åsikter, ingen clickbait, ingen uppfinngad information. Endast utifrån det material du fått.
- Hitta på inga fakta, inga urls, inga datum som inte framgår av materialet.`;

export interface GeminiStatus {
  ok: boolean;
  error?: string;
  calls: number;
  /** Which model actually produced the answer. */
  model?: string;
}

/** Build the single batched request payload. Exported for tests. */
export function buildGeminiRequestPayload(articles: GeminiArticleInput[]) {
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
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Analysera dessa ${articles.length} artiklar och returnera JSON enligt schemat.

${articleBlocks.join("\n\n")}

Svara för VARJE artikel med en verdict (scope/confidence/reason).
Svara med ett event per underliggande händelse, och lista de articleId som hör till den.
Endast artiklar med scope "men" ska ingå i events.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: RawSchema,
    },
  };
}

interface GeminiCallResult {
  text: string;
  calls: number;
  model: string;
}

class GeminiHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Gemini HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** Maximum retries per model, AFTER the initial request. Bounded on purpose. */
const MAX_RETRIES_PER_MODEL = 2;
/**
 * HARD CAP on total calls for one pipeline run.
 *
 * The quota problem is multiplicative, not additive. With 4 candidate models
 * x 3 attempts each, one run costs up to 12 calls. The Free Tier budget is
 * assumed to be 20 requests/day, so a single bad night (every model 503ing)
 * spends 60% of the day's quota, and several such runs exhaust it outright.
 * Observed 12 calls in run 36189893618.
 *
 * This cap makes the worst case a NUMBER rather than a product, so an
 * unattended nightly run cannot quietly eat the quota. It is deliberately
 * generous enough that one healthy run (1 call) plus a full retry storm on the
 * first model still gets a fair attempt, while leaving the remaining budget
 * for a manual retry.
 */
const MAX_TOTAL_CALLS = 6;
/** Backoff before retry N (1-based). Short — this is a nightly batch job. */
const RETRY_DELAY_MS = [5_000, 20_000];
/** Test seam: GEMINI_RETRY_DELAY_MS=0 makes retry-backoff tests instant. */
function retryDelay(attempt: number): number {
  const override = Number(process.env.GEMINI_RETRY_DELAY_MS);
  return Number.isFinite(override) && override >= 0 ? override : RETRY_DELAY_MS[attempt];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** One HTTP call against a specific model. */
async function callModel(
  model: string,
  articles: GeminiArticleInput[],
  apiKey: string,
): Promise<GeminiCallResult> {
  const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(buildGeminiRequestPayload(articles)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new GeminiHttpError(res.status, await res.text());
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini returned an empty response");
  return { text, calls: 1, model };
}

/**
 * Try each candidate model in order, with a BOUNDED retry for transient
 * failures only.
 *
 * Retried (capacity / rate limits): 429, 500, 502, 503, 504 — at most
 * MAX_RETRIES_PER_MODEL times, then we move on to the next model.
 *
 * NOT retried, because retrying cannot help:
 *   400 malformed request, 401/403 bad key, 404 retired model — we break out.
 */
export class GeminiCallError extends Error {
  constructor(message: string, readonly calls: number) {
    super(message);
    this.name = "GeminiCallError";
  }
}

async function callGemini(articles: GeminiArticleInput[]): Promise<GeminiCallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const errors: string[] = [];
  let calls = 0;
  for (const model of candidateModels()) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      // The hard cap. Checked BEFORE the call, so the worst case is exactly
      // MAX_TOTAL_CALLS requests and never one more.
      if (calls >= MAX_TOTAL_CALLS) {
        console.warn(
          `gemini: stopping after ${calls} calls (cap ${MAX_TOTAL_CALLS}) — ` +
            `keeping deterministic events to protect the daily quota`,
        );
        errors.push(`call cap ${MAX_TOTAL_CALLS} reached`);
        throw new GeminiCallError(errors.join(" | "), calls);
      }
      try {
        const r = await callModel(model, articles, key);
        return { ...r, calls: calls + 1 };
      } catch (e) {
        calls++;
        const status = e instanceof GeminiHttpError ? e.status : 0;
        const msg = e instanceof Error ? e.message : String(e);
        const canRetry = status !== 0 && RETRYABLE.has(status) && attempt < MAX_RETRIES_PER_MODEL;
        console.warn(
          `gemini: model ${model} attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1} failed — ${msg}` +
            (canRetry ? ` (retrying in ${retryDelay(attempt) / 1000}s)` : ""),
        );
        if (!canRetry) {
          errors.push(`${model}: ${msg}`);
          break;
        }
        await sleep(retryDelay(attempt));
      }
    }
  }
  // The call count MUST survive the throw. Previously it was a plain local,
  // so a 3-attempt failure reported `calls=0` in the summary line and made
  // an expensive failure look free. Observed in workflow run 36319955524.
  throw new GeminiCallError(errors.join(" | "), calls);
}

const Parsed = z.object({
  verdicts: z.array(
    z.object({
      articleId: z.string(),
      scope: z.enum(["men", "women", "youth", "club", "unknown"]),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      articleIds: z.array(z.string()),
    }),
  ),
});

export interface ParsedGemini {
  result: GeminiResult;
  /** Article ids Gemini referenced that we never supplied. */
  unknownIds: string[];
}

/** Parse + structurally validate the model response. Exported for tests. */
export function parseGeminiResponse(text: string, knownIds: string[]): ParsedGemini {
  const parsed = Parsed.parse(JSON.parse(text));
  const known = new Set(knownIds);
  const unknownIds = new Set<string>();
  const seenVerdict = new Set<string>();
  const verdicts: GeminiVerdict[] = [];
  for (const v of parsed.verdicts) {
    if (!known.has(v.articleId)) {
      unknownIds.add(v.articleId);
      continue;
    }
    if (seenVerdict.has(v.articleId)) continue;
    seenVerdict.add(v.articleId);
    verdicts.push(v);
  }
  const assigned = new Set<string>();
  const events: GeminiEvent[] = [];
  for (const e of parsed.events) {
    const ids = e.articleIds.filter((id) => known.has(id));
    for (const id of e.articleIds) if (!known.has(id)) unknownIds.add(id);
    // Drop cross-event reuse so every article appears in at most one event.
    const unique = ids.filter((id) => !assigned.has(id));
    if (unique.length === 0) continue;
    unique.forEach((id) => assigned.add(id));
    events.push({ title: e.title.trim(), summary: e.summary.trim(), articleIds: unique });
  }
  return { result: { verdicts, events }, unknownIds: [...unknownIds] };
}

/** Call Gemini once for the whole candidate batch. Never throws. */
export async function synthesizeWithGemini(
  articles: GeminiArticleInput[],
): Promise<{ result: GeminiResult | null; status: GeminiStatus; raw: string | null }> {
  if (articles.length === 0) return { result: null, status: { ok: true, calls: 0 }, raw: null };
  if (!process.env.GEMINI_API_KEY) {
    return {
      result: null,
      status: { ok: false, error: "GEMINI_API_KEY is not set — keeping deterministic events", calls: 0 },
      raw: null,
    };
  }
  try {
    const { text, calls, model } = await callGemini(articles);
    const ids = articles.map((a) => a.id);

    // Persist the raw model output BEFORE parsing it.
    //
    // A real run (36215617435, 2026-09-26) returned HTTP 200 with a response
    // that parsed but yielded ZERO events. Without the raw text, "no usable
    // events" is indistinguishable between three very different causes:
    //   1. the model correctly scoped every article to women/club/youth
    //      (a CORRECT empty answer, and the fallback firing needlessly),
    //   2. the model invented events referencing article ids we never sent
    //      (a prompt/format bug we must fix), or
    //   3. the model returned an empty events array for some other reason.
    // We logged only the summary, so the run was undiagnosable after the fact.
    // This is the same gap that made the earlier 503 investigation blind.
    try {
      if (process.env.GEMINI_DEBUG_RAW === "1" && text) {
        const { writeFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const dir = resolve(import.meta.dirname, "../../pipeline/data");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = resolve(dir, `gemini-raw-${stamp}.json`);
        writeFileSync(file, text, "utf8");
        console.warn(`gemini: raw response written to ${file} (${text.length} chars)`);
      }
    } catch (e) {
      // Diagnostics must never break the pipeline.
      console.warn(`gemini: could not write raw response: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Parse defensively so the failure reason is reportable rather than thrown.
    let parsed: ReturnType<typeof parseGeminiResponse> | null = null;
    let parseError: string | null = null;
    try {
      parsed = parseGeminiResponse(text, ids);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
    if (parsed === null) {
      console.warn(`gemini: response did not parse — ${parseError}`);
      return {
        result: null,
        status: { ok: false, error: `Gemini response invalid: ${parseError}`, calls, model },
        raw: text,
      };
    }

    const { result, unknownIds } = parsed;
    if (result.events.length === 0) {
      // Say WHICH of the three causes above this was, so the next run is
      // actionable without re-running the model by hand.
      const detail =
        unknownIds.length > 0
          ? `all events referenced article ids we never sent (${unknownIds.slice(0, 3).join(", ")})`
          : `model returned ${result.verdicts.length} verdicts but 0 events (every article was scoped non-men, or events were empty)`;
      console.warn(`gemini: no usable events — ${detail}`);
      return { result: null, status: { ok: false, error: `Gemini returned no usable events: ${detail}`, calls, model }, raw: text };
    }
    if (unknownIds.length) {
      console.warn(`gemini: ignored unknown article ids: ${unknownIds.join(", ")}`);
    }
    return { result, status: { ok: true, calls, model }, raw: text };
  } catch (e) {
    return {
      result: null,
      // Preserve the real call count. A 3-attempt 503 run costs 3 requests,
      // and reporting 0 hid that from every summary and budget decision.
      status: {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        calls: e instanceof GeminiCallError ? e.calls : 0,
      },
      raw: null,
    };
  }
}

/** Deterministic events, used as the fallback and as the test oracle. */
function fallbackSummary(item: NewsItem): string {
  const s = (item.summary ?? "").trim();
  if (s.length > 20) return s.length > MAX_SUMMARY_CHARS ? `${s.slice(0, MAX_SUMMARY_CHARS - 1)}…` : s;
  return item.title.slice(0, MAX_SUMMARY_CHARS);
}

function eventFromItems(id: string, items: NewsItem[], summary: string, method: NewsEvent["summaryMethod"]): NewsEvent {
  const sorted = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const lead = sorted[0];
  // Preserve the "former" tag set by menRelevantNews. Everything else in this
  // path is men's news by construction, so the default stays "men".
  const category: NewsCategory = sorted.some((s) => s.category === "former") ? "former" : "men";
  return {
    id,
    title: lead.title,
    summary,
    publishedAt: lead.publishedAt,
    latestPublishedAt: lead.publishedAt,
    category,
    sources: sorted.map((s) => ({
      publisher: s.publisher,
      title: s.title,
      url: s.url,
      publishedAt: s.publishedAt,
      role: s.sourceRole ?? publisherRole(s.publisher),
      discoveredVia: s.discoveredVia,
    })),
    summaryMethod: method,
  };
}

/**
 * Turn a validated Gemini result into NewsEvents.
 *
 * Rules enforced here (we never trust the model):
 * - only articles Gemini scoped as "men" may appear in an event;
 * - URLs, publishers, titles and dates always come from OUR items;
 * - summary is truncated to MAX_SUMMARY_CHARS and falls back to source text;
 * - a men-scoped article Gemini did not place in any event still appears, via
 *   the existing deterministic title-based grouping, so nothing vanishes.
 */
export function buildEventsFromGemini(items: NewsItem[], gemini: GeminiResult | null): NewsEvent[] {
  if (!gemini || gemini.events.length === 0) return [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const menIds = new Set(gemini.verdicts.filter((v) => v.scope === "men").map((v) => v.articleId));

  const events: NewsEvent[] = [];
  const assignedIds = new Set<string>();
  // Ids the model referenced anywhere — an id it dropped from a duplicate
  // event must not reappear as a leftover.
  const referencedIds = new Set(gemini.events.flatMap((e) => e.articleIds));
  gemini.events.forEach((e, idx) => {
    // An article may belong to at most ONE event.
    const members = e.articleIds
      .map((id) => byId.get(id))
      .filter((i): i is NewsItem => !!i && menIds.has(i.id) && !assignedIds.has(i.id));
    if (members.length === 0) return;
    members.forEach((m) => assignedIds.add(m.id));
    events.push(
      eventFromItems(
        `event-gemini-${idx}-${members[0].id}`.slice(0, 120),
        members,
        truncateSummary(e.summary) || fallbackSummary(members[0]),
        "gemini-synthesis",
      ),
    );
  });

  // Men-scoped articles Gemini left unplaced still deserve to be shown. An
  // article the model deliberately moved to a rejected (e.g. women's) event
  // must NOT sneak back in here.
  const rejectedIds = new Set(
    gemini.events.flatMap((e) => e.articleIds).filter((id) => !menIds.has(id)),
  );
  const leftovers = items.filter(
    (i) => menIds.has(i.id) && !referencedIds.has(i.id) && !rejectedIds.has(i.id),
  );
  if (leftovers.length > 0) {
    for (const ev of buildNewsEvents(leftovers)) {
      events.push({ ...ev, summaryMethod: "gemini-synthesis-fallback" });
    }
  }
  return events.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function truncateSummary(summary: string): string {
  const s = summary.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_SUMMARY_CHARS) return s;
  return `${s.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`;
}
