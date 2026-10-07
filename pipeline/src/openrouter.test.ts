import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  synthesizeWithOpenRouter,
  buildOpenRouterRequestPayload,
  describeOpenRouterError,
} from "./openrouter";
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

/**
 * The synthesis path now makes TWO kinds of fetch: a public catalog lookup
 * (GET /models, before the request) and the chat completion itself. A flat
 * mockResolvedValue would feed the catalog JSON to the chat call and vice
 * versa, so mocks must route by URL.
 */
const CATALOG_BODY = {
  data: [
    { id: "google/gemma-4-31b-it:free" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free" },
  ],
};

function mockFetch(chat: unknown, chatStatus = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/models")) return jsonResponse(CATALOG_BODY) as unknown as Response;
    return jsonResponse(chat, chatStatus) as unknown as Response;
  });
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
  model: "google/gemma-4-31b-it:free",
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
    mockFetch(VALID_BODY);
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.ok).toBe(true);
    expect(r.calls).toBe(1);
    expect(r.answer?.events).toHaveLength(1);
    expect(r.unknownIds).toEqual([]);
  });

  it("resolves the model from the catalog and sends THAT model", async () => {
    const spy = mockFetch(VALID_BODY);
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.ok).toBe(true);
    expect(r.model).toBe("google/gemma-4-31b-it:free");
    const body = JSON.parse((spy.mock.calls.find((c) => !String(c[0]).includes("/models"))?.[1] as RequestInit | undefined)?.body as string) as { model: string };
    expect(body.model).toBe("google/gemma-4-31b-it:free");
  });

  it("fails BEFORE the request when the pinned model is delisted", async () => {
    // The 2026-10-06 failure mode: qwen/qwen3.8-27b:free was delisted and
    // every call 404'd. Resolution must convert that into a loud pre-request
    // failure that spends ZERO quota.
    process.env.OPENROUTER_MODEL = "qwen/qwen3.8-27b:free";
    const spy = mockFetch(VALID_BODY);
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.ok).toBe(false);
    expect(r.calls).toBe(0);
    expect(r.error).toContain("delisted");
    // Only the catalog lookup happened — no chat request was sent.
    expect(spy.mock.calls.filter((c) => !String(c[0]).includes("/models"))).toHaveLength(0);
  });

  it("refuses a pin that is not a :free variant", async () => {
    process.env.OPENROUTER_MODEL = "openai/gpt-4o";
    const spy = mockFetch(VALID_BODY);
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.ok).toBe(false);
    expect(r.calls).toBe(0);
    expect(r.error).toContain(":free");
    expect(spy).not.toHaveBeenCalled();
  });

  it("makes EXACTLY ONE chat request even when the provider rate-limits us", async () => {
    // The whole safety argument for an unattended nightly. A shared free pool
    // 429s often; if this retried, every night would spend quota for nothing.
    const spy = mockFetch({ error: { message: "rate-limited", code: 429 } }, 429);
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(spy.mock.calls.filter((c) => !String(c[0]).includes("/models"))).toHaveLength(1);
    expect(r.ok).toBe(false);
    expect(r.calls).toBe(1);
    expect(r.error).toContain("429");
  });

  it("never retries a 5xx either", async () => {
    const spy = mockFetch({ error: "boom" }, 503);
    await synthesizeWithOpenRouter([ARTICLE]);
    expect(spy.mock.calls.filter((c) => !String(c[0]).includes("/models"))).toHaveLength(1);
  });

  it("rejects an answer that fails our own validation", async () => {
    // A 200 with unusable content is NOT a success. This is the B-004 lesson:
    // HTTP 200 is not correctness.
    mockFetch({ choices: [{ message: { content: "sorry, I cannot help" } }] });
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
    mockFetch(body);
    const r = await synthesizeWithOpenRouter([ARTICLE]);
    expect(r.unknownIds).toEqual(["MADE-UP"]);
  });

  it("records cost 0 as REPORTED-FREE, not as unknown", async () => {
    // 0 and null must never be conflated: "free" and "we do not know" imply
    // opposite decisions about whether to keep running this.
    mockFetch(VALID_BODY);
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
    mockFetch(body);
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
    mockFetch(VALID_BODY);
    await synthesizeWithOpenRouter([ARTICLE]);
    const calls = buildMetrics(null).latestCalls.filter((c) => c.service === "openrouter");
    expect(calls).toHaveLength(1);
    const m = buildMetrics(null);
    expect(m.latestRun?.services.find((s) => s.service === "openrouter")?.calls).toBe(1);
    expect(m.totals.meteredRequests).toBe(1);
  });

  it("records exactly one call even when the provider rate-limits us", async () => {
    mockFetch({ error: { message: "rate-limited", code: 429 } }, 429);
    await synthesizeWithOpenRouter([ARTICLE]);
    const calls = buildMetrics(null).latestCalls.filter((c) => c.service === "openrouter");
    expect(calls).toHaveLength(1);
    expect(buildMetrics(null).totals.meteredRequests).toBe(1);
  });

  it("charges exactly one metered request against the daily quota", async () => {
    mockFetch(VALID_BODY);
    await synthesizeWithOpenRouter([ARTICLE]);
    const m = buildMetrics(null);
    expect(m.totals.meteredRequests).toBe(1);
    expect(m.budget[0]?.requests).toBe(1);
    expect(m.budget[0]?.quotaLimit).toBe(1000);
  });

  it("keeps the key out of the recorded metrics", async () => {
    mockFetch(VALID_BODY);
    await synthesizeWithOpenRouter([ARTICLE]);
    const m = buildMetrics(null);
    const serialised = JSON.stringify(m);
    expect(serialised).not.toContain("sk-or-v1-test");
    expect(serialised).not.toContain("Bearer");
  });
});
describe("describeOpenRouterError", () => {
  const SHARED_POOL_429 = JSON.stringify({
    error: {
      message: "Provider returned error",
      code: 429,
      metadata: {
        raw: "google/gemma-4-31b-it:free is temporarily rate-limited upstream.",
        provider_name: "Google AI Studio",
        limit_source: "upstream_provider_shared_pool",
        remedy_hint: "Retry shortly, add your own provider key, or route to another provider",
      },
    },
  });

  it("names the shared pool and the provider for a pool 429", () => {
    const s = describeOpenRouterError(429, SHARED_POOL_429);
    expect(s).toContain("Delad gratis-pool");
    expect(s).toContain("Google AI Studio");
    expect(s).toContain("inte vår kvot");
    expect(s).toContain("Åtgärd:");
  });

  it("explains a 404 as a delisted model", () => {
    const s = describeOpenRouterError(404, '{"error":{"message":"not found"}}');
    expect(s).toContain("404");
    expect(s).toContain("finns inte längre");
  });

  it("explains a 402 as billing", () => {
    const s = describeOpenRouterError(402, "{}");
    expect(s).toContain("fakturering");
  });

  it("explains a 5xx as provider routing failure", () => {
    const s = describeOpenRouterError(503, "plain text body");
    expect(s).toContain("leverantörens fel");
  });

  it("survives a non-JSON body", () => {
    const s = describeOpenRouterError(500, "<html>gateway timeout</html>");
    expect(s).toContain("500");
  });

  it("falls back to the raw message when the limit source is not the shared pool", () => {
    const s = describeOpenRouterError(
      429,
      JSON.stringify({ error: { metadata: { raw: "our own quota is spent" } } }),
    );
    expect(s).toContain("our own quota is spent");
    expect(s).not.toContain("Delad gratis-pool");
  });
});
