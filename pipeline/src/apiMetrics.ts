/**
 * API MEASUREMENT LOG — recorder and aggregator.
 *
 * WHY THIS EXISTS
 *   This repo has repeatedly been unable to answer basic questions about its
 *   own API usage: how many calls a run makes, which source is slow, what a
 *   provider actually costs, and whether a free tier is being burned. Those
 *   questions were previously answered by grepping workflow logs, which is
 *   slow, expires (GitHub job logs are retained ~30 days), and cannot be
 *   read from inside the app.
 *
 *   The 84-request Gemini incident and the 20-request/day free-tier ceiling
 *   are both examples of a number that should have been visible before it
 *   mattered.
 *
 * WHAT IS RECORDED, PER CALL
 *   service, method, url (host+path only), http status, ok, duration,
 *   request bytes, RESPONSE bytes, attempt count, cost in credits, and
 *   whether the call counts against a metered quota.
 *
 * WHY COST IS `number | null` AND NOT A DEFAULT 0
 *   Zero is a REAL and important value: a `:free` model that reports
 *   "cost: 0 credits" has told us the request was genuinely free, and that is
 *   exactly what the free-tier accounting needs to distinguish. Collapsing
 *   "free" and "provider did not tell us" into a single 0 would destroy the
 *   distinction that matters, so `null` means "not reported" and `0` means
 *   "reported, and free". `costReported` counts how many calls actually gave
 *   a figure, so a total of 0 with costReported 0 is visibly NOT a claim that
 *   everything was free.
 *
 * PRIVACY AND SIZE — WHY THE LOG IS ITS OWN FILE
 *   This is written to `public/data/api-metrics.json`, NOT into `app.json`,
 *   for three measured reasons:
 *     1. `app.json` is fetched on FIRST PAINT by every supporter. Adding
 *        ~10 KB of diagnostics to that is a real cost paid by every visit.
 *     2. The app loads this file LAZILY, only when the cog-wheel diagnostics
 *        section is opened, so it costs nothing at all in the common case.
 *     3. A corrupt or oversized log can then never break the app itself.
 *
 *   Volume control, because the log grows every night:
 *     - `HISTORY_LIMIT` recent runs are kept as per-service aggregates only.
 *     - Per-call detail is kept for the LATEST run only, capped at
 *       `MAX_LATEST_CALLS`, because that is what debugging actually needs.
 *     - No response bodies, no headers, no article text, no query strings
 *       that could carry a key. URLs are reduced to host + path.
 *   A run makes roughly 15-20 calls (8 RSS feeds, SportoMedia, API-Football,
 *   ~6 article bodies, optionally 1 LLM call), so the bounded file lands
 *   around 8-12 KB and stops growing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/** One HTTP request/response pair. */
export interface ApiCallRecord {
  /** Stable service id, e.g. "rss:sportbladet", "sportomedia", "openrouter". */
  service: string;
  method: string;
  /**
   * Host + path ONLY. Query strings are dropped because they can carry an
   * api key (api-sports uses `?key=`), and a measurement log must never
   * become a secret-leak surface. The CI leak check would catch a key, but
   * the right fix is to never write it.
   */
  url: string;
  /** HTTP status, or null when the request never produced a response. */
  status: number | null;
  ok: boolean;
  durationMs: number;
  requestBytes: number | null;
  responseBytes: number | null;
  /** 1 means no retry. >1 makes retry storms visible instead of invisible. */
  attempts: number;
  /**
   * Credits spent. 0 means the provider REPORTED zero (a genuinely free
   * call). null means the provider did not report a figure. Never conflate
   * the two — see the file header.
   */
  costCredits: number | null;
  /** True when this call counts against a documented free-tier quota. */
  metered: boolean;
  /** Short, sanitised failure reason. No response bodies are retained. */
  error?: string;
}

/** Per-service rollup for one run. */
export interface ServiceAggregate {
  service: string;
  calls: number;
  failures: number;
  /**
   * Calls that were never attempted (e.g. a provider with no key injected).
   *
   * KEPT SEPARATE FROM `failures` ON PURPOSE. A skipped call has `ok: false`
   * because nothing came back, so counting it as a failure made a run with
   * ZERO real failures report "1 misslyckade" — the panel showed Gemini as an
   * error on a night it was deliberately never called. "Did not run" and "ran
   * and failed" are different facts and a monitoring surface must not merge
   * them. Found by looking at the live UI, not by a test.
   */
  skipped: number;
  /**
   * Why calls were skipped, taken from the recorded `error` of non-attempts.
   *
   * Carried through so the panel can say WHY a source is not switched on
   * instead of showing a bare grey pill. Previously the reason was written to
   * the log and then dropped at the aggregation boundary — the information
   * existed and was discarded one step before the person who needed it.
   */
  skipReasons?: string[];
  totalDurationMs: number;
  maxDurationMs: number;
  requestBytes: number;
  responseBytes: number;
  /** Sum of REPORTED costs. 0 with costReported 0 means "nobody told us". */
  costCredits: number;
  /** How many calls actually reported a cost figure. */
  costReported: number;
  meteredCalls: number;
}

/**
 * How many articles one publisher contributed in a single run.
 *
 * Distinct from `calls` in `ServiceAggregate`, which counts REQUESTS. A feed
 * that returned 39 articles still cost exactly one request. Both numbers matter
 * and they answer different questions: "is the source reachable" (calls) and
 * "is it producing anything" (kept).
 */
export interface SourceArticles {
  fetched: number;
  kept: number;
  dropped: number;
}

/** One pipeline run. */
export interface RunRecord {
  runAt: string;
  durationMs: number;
  calls: number;
  failures: number;
  costCredits: number;
  services: ServiceAggregate[];
  /**
   * Per-publisher article counts for this run. Present on `latestRun` and on
   * each entry in `history`, which is what makes the over-time table possible.
   *
   * OPTIONAL: absent on runs from before this was measured. That absence is
   * meaningful and must not be rendered as "0 articles" — it means the run
   * predates the measurement, not that the source was silent.
   */
  sourceArticles?: Record<string, SourceArticles>;
}

/**
 * Quota accounting for one metered provider on one UTC day.
 *
 * Quotas reset on UTC midnight, not on the app's local day, so the key is the
 * UTC date. This is the view that would have made the Gemini free-tier ceiling
 * and the 84-request incident visible at the time.
 */
export interface MeteredBudget {
  service: string;
  utcDate: string;
  requests: number;
  /** Documented ceiling, or null when it is not known. */
  quotaLimit: number | null;
  note?: string;
}

export interface ApiMetrics {
  /** Schema version, so a future reader can detect an older file. */
  version: number;
  generatedAt: string;
  latestRun: RunRecord | null;
  /** Per-call detail, LATEST run only, capped at MAX_LATEST_CALLS. */
  latestCalls: ApiCallRecord[];
  /** How many calls the run made in total, so a truncated list is honest. */
  latestCallsTotal: number;
  /** True when `latestCalls` is shorter than `latestCallsTotal`. */
  latestCallsTruncated: boolean;
  /** Per-service aggregates for older runs, oldest first. */
  history: RunRecord[];
  budget: MeteredBudget[];
  totals: {
    calls: number;
    failures: number;
    costCredits: number;
    meteredRequests: number;
  };
}

export const METRICS_VERSION = 1;

/** Keep this many past runs as aggregates. 7 nightly runs ~= 1 week. */
const HISTORY_LIMIT = 7;

/**
 * Per-call cap for the latest run.
 *
 * MEASURED, not guessed. A real run on 2026-10-04 made 63 calls, and storing
 * all of them produced a 23 KB file — of which `latestCalls` was 15 KB. Since
 * the panel renders PER-SERVICE aggregates (which are complete regardless of
 * this cap) and per-call detail is only for debugging, a full night is not
 * worth 15 KB of everyone's download.
 *
 * 25 keeps every distinct service visible on a normal night (a real run had 11
 * services) while bounding the block to roughly 6 KB. Truncation is REPORTED
 * via `latestCallsTruncated` and `latestCallsTotal`, never silent: a silently
 * short list reads as "that was all the calls", which is the exact confusion
 * this file is meant to remove.
 */
const MAX_LATEST_CALLS = 25;

/** How many past per-day metered counters to retain. */
const MAX_BUDGET_ROWS = 14;

const calls: ApiCallRecord[] = [];
const sourceArticles: Record<string, SourceArticles> = {};
let runStartedAt = Date.now();

/** Strip query string and fragment: a key must never reach this file. */
export function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`;
  } catch {
    return raw.split("?")[0] ?? raw;
  }
}

export function beginRun(): void {
  calls.length = 0;
  // Cleared per run so yesterday's publishers cannot leak into tonight's counts
  // if tonight's ingest fails before reporting anything.
  for (const k of Object.keys(sourceArticles)) delete sourceArticles[k];
  runStartedAt = Date.now();
}

/**
 * Record how many articles each publisher contributed in THIS run.
 *
 * Separate from `calls`, which counts requests. A feed that returned 39
 * articles still cost one request, so "reachable" and "producing" are
 * different questions and need different numbers.
 *
 * Called once per run, after the ingest. Absent means the run predates this
 * measurement, which the panel must show as "not measured" rather than 0.
 */
export function noteSourceArticles(counts: Record<string, SourceArticles>): void {
  for (const [publisher, v] of Object.entries(counts)) {
    // `Math.round(NaN)` is NaN, and `Math.max(0, NaN)` is also NaN — so a bad
    // number would survive as `NaN` here and serialise to `null` in the file,
    // which the app would then have to guess about. Non-finite and negative
    // values mean the ingest is wrong, not that the source was silent.
    const safe = (n: number): number =>
      Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    sourceArticles[publisher] = {
      fetched: safe(v.fetched),
      kept: safe(v.kept),
      dropped: safe(v.dropped),
    };
  }
}

/**
 * Wrap a fetch so every call is measured without each caller having to
 * remember to. Timing uses performance.now() when available.
 */
export async function trackedFetch(
  service: string,
  url: string,
  init: RequestInit = {},
  opts: { metered?: boolean; attempts?: number } = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const t0 = now();

  let requestBytes: number | null = null;
  if (typeof init.body === "string") {
    requestBytes = new TextEncoder().encode(init.body).byteLength;
  }

  try {
    const res = await fetch(url, init);
    // Read the size from a CLONE so the caller still gets an unread body.
    let responseBytes: number | null = null;
    try {
      const buf = await res.clone().arrayBuffer();
      responseBytes = buf.byteLength;
    } catch {
      responseBytes = null;
    }
    calls.push({
      service,
      method,
      url: safeUrl(url),
      status: res.status,
      ok: res.ok,
      durationMs: Math.round(now() - t0),
      requestBytes,
      responseBytes,
      attempts: opts.attempts ?? 1,
      costCredits: null,
      metered: opts.metered ?? false,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    });
    return res;
  } catch (e) {
    calls.push({
      service,
      method,
      url: safeUrl(url),
      status: null,
      ok: false,
      durationMs: Math.round(now() - t0),
      requestBytes,
      responseBytes: null,
      attempts: opts.attempts ?? 1,
      costCredits: null,
      metered: opts.metered ?? false,
      error: e instanceof Error ? e.message.slice(0, 120) : "network-error",
    });
    throw e;
  }
}

/**
 * Attach a cost figure to the most recent call for a service.
 *
 * Kept separate from `trackedFetch` because only the caller knows how its
 * provider reports cost — Gemini returns usageMetadata, OpenRouter returns
 * usage.cost, RSS returns nothing at all. Pass `null` when the provider did
 * NOT report a cost, which is different from reporting zero.
 */
export function noteCost(service: string, credits: number | null): void {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].service === service) {
      calls[i].costCredits = credits;
      return;
    }
  }
}

/** Record a failure that never reached the network (e.g. a blocked call). */
export function noteSkippedCall(service: string, reason: string, metered = false): void {
  calls.push({
    service,
    method: "-",
    url: "-",
    status: null,
    ok: false,
    durationMs: 0,
    requestBytes: null,
    responseBytes: null,
    attempts: 0,
    costCredits: null,
    metered,
    error: reason.slice(0, 120),
  });
}

/**
 * DOCUMENTED FREE-TIER CEILINGS, per UTC day.
 *
 * These are the numbers that would have made the 84-request Gemini incident
 * visible before it happened. They are recorded as DATA, not enforced here —
 * this module measures, it does not throttle. Enforcement belongs at the call
 * site, because only the caller knows whether a retry is warranted.
 *
 * Sourced from vendor docs on 2026-10-04:
 *   OpenRouter: 20 req/min. 50/day below 10 credits ever purchased,
 *                1000/day at or above it. The key in this repo reports
 *                limit=1000 via GET /api/v1/key, which is authoritative.
 *   Gemini free tier: 20 generateContent requests/UTC day, measured from a
 *                real 429 body (run 36813438657) rather than from docs.
 */
export const QUOTA_LIMITS: Record<string, number> = {
  openrouter: 1000,
  gemini: 20,
};

/**
 * Record a metered LLM call that has already returned, with its cost.
 *
 * This is the shape an OpenRouter call has: the provider returns
 * `usage.cost`, and for a `:free` model that is a REAL 0 — which is the whole
 * point. A free call and a call whose cost nobody reported must never look
 * alike, so `cost` is passed through verbatim and `null` is never substituted.
 *
 * @param cost credits actually reported by the provider; 0 means free.
 */
export function noteLlmCall(
  service: string,
  opts: {
    model: string;
    status: number;
    ok: boolean;
    durationMs: number;
    responseBytes: number | null;
    cost: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    error?: string;
  },
): void {
  calls.push({
    service,
    method: "POST",
    // Deliberately does NOT include the model in the URL: the endpoint path
    // would be the same for every model, so the model is recorded on the
    // aggregate instead of in a per-call URL that repeats 400x.
    url: `${service}:/chat/completions`,
    status: opts.status,
    ok: opts.ok,
    durationMs: Math.round(opts.durationMs),
    requestBytes: null,
    responseBytes: opts.responseBytes,
    attempts: 1,
    costCredits: opts.cost,
    metered: true,
    ...(opts.error ? { error: opts.error.slice(0, 120) } : {}),
  });
}

/** Documented daily ceiling for a metered service, or null if unknown. */
export function quotaLimitFor(service: string): number | null {
  return QUOTA_LIMITS[service] ?? null;
}

function aggregate(list: ApiCallRecord[]): ServiceAggregate[] {
  const by = new Map<string, ApiCallRecord[]>();
  for (const c of list) {
    const arr = by.get(c.service) ?? [];
    arr.push(c);
    by.set(c.service, arr);
  }
  return [...by.entries()]
    .map(([service, group]) => ({
      service,
      // A skipped call never left the machine, so it is not a call. Counting it
      // made the panel show "1 anrop" for a source that is switched off, which
      // contradicts the "Ej påslaget" pill right beside it. `calls` counts real
      // attempts; `skipped` reports the non-attempts separately.
      calls: group.filter((c) => c.attempts > 0).length,
      failures: group.filter((c) => !c.ok && c.attempts > 0).length,
      skipped: group.filter((c) => c.attempts === 0).length,
      skipReasons: group
        .filter((c) => c.attempts === 0 && !!c.error)
        .map((c) => c.error as string),
      totalDurationMs: group.reduce((n, c) => n + c.durationMs, 0),
      maxDurationMs: group.reduce((n, c) => Math.max(n, c.durationMs), 0),
      requestBytes: group.reduce((n, c) => n + (c.requestBytes ?? 0), 0),
      responseBytes: group.reduce((n, c) => n + (c.responseBytes ?? 0), 0),
      costCredits: group.reduce((n, c) => n + (c.costCredits ?? 0), 0),
      costReported: group.filter((c) => c.costCredits !== null).length,
      meteredCalls: group.filter((c) => c.metered).length,
    }))
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs);
}

function summarise(list: ApiCallRecord[], startedAt: number): RunRecord {
  return {
    runAt: new Date(startedAt).toISOString(),
    durationMs: Math.round((Date.now() - startedAt) / 1) || 0,
    // Real attempts only, so this equals the sum of the per-service `calls`
    // and does not drift from the rows shown in the panel.
    calls: list.filter((c) => c.attempts > 0).length,
    // Only real attempts can fail. A skipped call is reported separately.
    failures: list.filter((c) => !c.ok && c.attempts > 0).length,
    costCredits: list.reduce((n, c) => n + (c.costCredits ?? 0), 0),
    services: aggregate(list),
    // Only attached when ingest actually reported. An empty object would read
    // as "every source found nothing", which is a different and wrong claim.
    ...(Object.keys(sourceArticles).length > 0 ? { sourceArticles: { ...sourceArticles } } : {}),
  };
}

/** Metered quota already consumed today, summed from previous logs. */
function budgetFrom(previous: ApiMetrics | null, list: ApiCallRecord[]): MeteredBudget[] {
  const utcDate = new Date().toISOString().slice(0, 10);
  const rows = new Map<string, MeteredBudget>();

  // Carry forward today and yesterday's rows so a multi-day view survives.
  for (const b of previous?.budget ?? []) {
    if (b.utcDate === utcDate || rows.size < MAX_BUDGET_ROWS) rows.set(`${b.service}:${b.utcDate}`, b);
  }
  for (const c of list) {
    // A call that never left the machine must NOT consume quota.
    //
    // `noteSkippedCall` records attempts: 0 for a provider that was never
    // contacted (e.g. no key injected). Counting those would report 1/20 used
    // on a night when zero requests were made — precisely the false accounting
    // this log exists to eliminate. Quota is consumed only by real attempts.
    if (!c.metered || c.attempts === 0) continue;
    const key = `${c.service}:${utcDate}`;
    const row = rows.get(key) ?? {
      service: c.service,
      utcDate,
      requests: 0,
      quotaLimit: QUOTA_LIMITS[c.service] ?? null,
    };
    row.requests += 1;
    rows.set(key, row);
  }
  return [...rows.values()]
    .filter((b) => b.utcDate === utcDate)
    .sort((a, b) => b.requests - a.requests);
}

export function readMetrics(path: string): ApiMetrics | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ApiMetrics;
    // A file from a future version may have a different shape; ignore it
    // rather than trusting it.
    return parsed?.version === METRICS_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/** Build this run's metrics, merging bounded history from the previous log. */
export function buildMetrics(previous: ApiMetrics | null): ApiMetrics {
  const latest = summarise(calls, runStartedAt);
  const history = [...(previous?.history ?? []), ...(previous?.latestRun ? [previous.latestRun] : [])]
    .slice(-HISTORY_LIMIT);

  return {
    version: METRICS_VERSION,
    generatedAt: new Date().toISOString(),
    latestRun: latest,
    latestCalls: calls.slice(0, MAX_LATEST_CALLS),
    latestCallsTotal: latest.calls,
    latestCallsTruncated: latest.calls > MAX_LATEST_CALLS,
    history,
    budget: budgetFrom(previous, calls),
    totals: {
      calls: latest.calls,
      failures: latest.failures,
      costCredits: latest.costCredits,
      meteredRequests: calls.filter((c) => c.metered && c.attempts > 0).length,
    },  };
}

/**
 * Write the log. Never throws: a measurement failing must not fail the
 * pipeline that produced the measurements.
 *
 * Written WITHOUT indentation on purpose. This file is machine-read by the app
 * and never read by a human in the repo, so pretty-printing would roughly
 * double its size for no benefit — and `app.json` next to it is already the
 * human-facing artefact.
 */
export function writeMetrics(path: string, previous: ApiMetrics | null): ApiMetrics | null {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const metrics = buildMetrics(previous);
    writeFileSync(path, JSON.stringify(metrics));
    return metrics;
  } catch (e) {
    console.warn("api-metrics: write failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Test seam: current recorded calls. */
export function recordedCalls(): ApiCallRecord[] {
  return calls;
}
