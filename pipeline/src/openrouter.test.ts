import { describe, it, expect, beforeEach, vi } from "vitest";
import { synthesizeWithOpenRouter, buildOpenRouterRequestPayload } from "./openrouter";
import { beginRun, buildMetrics } from "./apiMetrics";
import type { GeminiArticleInput } from "./gemini";

const ARTICLE: GeminiArticleInput = {
  id: "a1",
  publisher: "BK Häcken",
  title: "Häcken vinner",
  url: "https://example.se/a1",
  publishedAt: "2026-10-04T00:00:00Z",
  text: "Häcken vann 1-0.",
  categoryHint: "men",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const VALID_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          verdicts: [
            { articleId: "a1", scope: "men", confidence: "high", reason: "herr" },
          ],
          events: [{ title: "Häcken vinner", summary: "1-0", articleIds: ["a1"] }],
        }),
      },
    },
  ],
  model: "qwen/qwen3.8-27b:free",
  usage: { total_cost: 0 },
};

describe("openrouter measurement path", () => {
  beforeEach(() => {
    // The metrics recorder is module-global. Without a fresh run per test the
    // counters accumulate and a quota assertion reads someone else's calls.
    beginRun();
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    delete process.env.OPENROUTER_MODEL;
    vi.restoreAllMocks();
  });

  it("sends the same schema and instruction as gemini", () => {
    const p = buildOpenRouterRequestPayload([ARTICLE]);
    // Comparable providers require an identical output contract.
    expect((p.response_format as { type: string }).type).toBe("json_schema");
    expect(p.messages[0].role).toBe("system");
    expect(p.messages[0].content).toContain("BK HÄCKENS HERRLAG");
    expect(p.model).toMatch(/:free$/);
  });

  it("uses the LOWERCASE json-schema dialect OpenRouter can compile", () => {
    // REGRESSION, found by the first real nightly run (37251529017):
    //   HTTP 400  grammar does not compile: xgrammar StructuralTag
    //             compilation failed
    //
    // Gemini's RawSchema uses UPPERCASE type names ("OBJECT", "ARRAY",
    // "STRING"). xgrammar — the constrained-decoding engine behind
    // response_format: json_schema — does not accept that dialect, so the
    // request was rejected BEFORE reaching the model. This looked like a
    // provider outage and was not one.
    //
    // A walk of the schema catches any future re-introduction, at any depth.
    const schema = (buildOpenRouterRequestPayload([ARTICLE]).response_format as {
      json_schema: { schema: unknown };
    }).json_schema.schema;

    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => walk(n, `${path}[${i}]`));
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "type" && typeof v === "string" && v !== v.toLowerCase()) {
          offenders.push(`${path}.type = "${v}"`);
        }
        walk(v, `${path}.${k}`);
      }
    };
    walk(schema, "schema");
    expect(offenders, "uppercase type names are not valid JSON Schema").toEqual([]);
  });

  it("still describes the same shape gemini requires", () => {
    // The dialect may differ; the CONTRACT may not. If these ever stop
    // matching, a provider comparison stops meaning anything.
    const schema = (buildOpenRouterRequestPayload([ARTICLE]).response_format as {
      json_schema: { schema: Record<string, unknown> };
    }).json_schema.schema;
    const props = schema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["events", "verdicts"]);
    expect(schema.required).toEqual(["verdicts", "events"]);
  });

  it("does not call the API when no key is present", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.calls).toBe(0);
    expect(r.error).toContain("OPENROUTER_API_KEY");
  });

  it("reports a successful measured answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(VALID_BODY));
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.ok).toBe(true);
    expect(r.calls).toBe(1);
    expect(r.answer?.events).toHaveLength(1);
    expect(r.unknownIds).toEqual([]);
  });

  it("makes EXACTLY ONE request even when the provider rate-limits us", async () => {
    // The whole safety argument for an unattended nightly. A shared free pool
    // 429s often; if this retried, every night would spend quota for nothing.
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "rate-limited", code: 429 } }, 429),
    );
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.calls).toBe(1);
    expect(r.error).toContain("429");
  });

  it("never retries a 5xx either", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "boom" }, 503),
    );
    await synthesizeWithOpenRouter([ARTICLE]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects an answer that fails our own validation", async () => {
    // A 200 with unusable content is NOT a success. This is the B-004 lesson:
    // HTTP 200 is not correctness.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "sorry, I cannot help" } }] }),
    );
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.ok).toBe(false);
    expect(r.answer).toBeNull();
    expect(r.error).toContain("validation");
  });

  it("flags ids the model invented", async () => {
    const body = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdicts: [
                { articleId: "a1", scope: "men", confidence: "high", reason: "herr" },
                { articleId: "MADE-UP", scope: "men", confidence: "low", reason: "?" },
              ],
              events: [{ title: "T", summary: "s", articleIds: ["a1"] }],
            }),
          },
        },
      ],
      usage: { total_cost: 0 },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.unknownIds).toEqual(["MADE-UP"]);
  });

  it("records cost 0 as REPORTED-FREE, not as unknown", async () => {
    // 0 and null must never be conflated: "free" and "we do not know" imply
    // opposite decisions about whether to keep running this.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(VALID_BODY));
    await synthesizeWithOpenRouter([ARTICLE]);
    const run = buildMetrics(null).latestRun;
    const row = run?.services.find((s) => s.service === "openrouter");
    expect(row?.costCredits).toBe(0);
    expect(row?.costReported).toBe(1);
  });

  it("records cost null when the provider reports none", async () => {
    // The SERVICE ROW total is always a number, because summing "unknown"
    // values has to produce something. `costReported` is what carries the
    // distinction, so the assertion belongs on that — asserting
    // `costCredits === null` here would be asserting a shape the aggregator
    // deliberately does not produce.
    const body = { ...VALID_BODY, usage: {} };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body));
    await synthesizeWithOpenRouter([ARTICLE]);
    const m = buildMetrics(null);
    const row = m.latestRun?.services.find((s) => s.service === "openrouter");
    // 0 calls reported a cost, which is what makes this total "we do not know"
    // rather than a claim that the call was free.
    expect(row?.costReported).toBe(0);
    expect(row?.costCredits).toBe(0);
    // The individual call still records the honest null.
    const call = m.latestCalls.find((c) => c.service === "openrouter");
    expect(call?.costCredits).toBeNull();
  });

  it("records EXACTLY ONE call per request, never two", async () => {
    // REGRESSION, found by reading the deployed log on 2026-10-05. The nightly
    // logged "ok ... calls=1" while the metrics row read `calls=2`, and the
    // quota was charged 2 for one send.
    //
    // CAUSE: `trackedFetch` already records the HTTP request (real status,
    // duration, byte counts). Calling `noteLlmCall` afterwards pushed a SECOND
    // record for the same request. The stage is hard-capped at one upstream
    // request, so "2" was arithmetically impossible — which is what made it
    // obviously a bookkeeping fault rather than a provider problem.
    //
    // The invariant is the point: one send, one record.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(VALID_BODY));
    await synthesizeWithOpenRouter([ARTICLE]);
    const calls = buildMetrics(null).latestCalls.filter((c) => c.service === "openrouter");
    expect(calls).toHaveLength(1);
    const m = buildMetrics(null);
    expect(m.latestRun?.services.find((s) => s.service === "openrouter")?.calls).toBe(1);
    expect(m.totals.meteredRequests).toBe(1);
  });

  it("records exactly one call even when the provider rate-limits us", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "rate-limited", code: 429 } }, 429),
    );
    await synthesizeWithOpenRouter([ARTICLE]);
    const calls = buildMetrics(null).latestCalls.filter((c) => c.service === "openrouter");
    expect(calls).toHaveLength(1);
    expect(buildMetrics(null).totals.meteredRequests).toBe(1);
  });

  it("charges exactly one metered request against the daily quota", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(VALID_BODY));
    await synthesizeWithOpenRouter([ARTICLE]);
    const m = buildMetrics(null);
    expect(m.totals.meteredRequests).toBe(1);
    expect(m.budget[0]?.requests).toBe(1);
    expect(m.budget[0]?.quotaLimit).toBe(1000);
  });

  it("keeps the key out of the recorded metrics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(VALID_BODY));
    await synthesizeWithOpenRouter([ARTICLE]);
    const m = buildMetrics(null);
    const serialised = JSON.stringify(m);
    expect(serialised).not.toContain("sk-or-v1-test");
    expect(serialised).not.toContain("Bearer");
  });
});