import { describe, expect, it, beforeEach } from "vitest";
import {
  beginRun,
  buildMetrics,
  noteCost,
  noteLlmCall,
  noteSkippedCall,
  quotaLimitFor,
  readMetrics,
  recordedCalls,
  safeUrl,
  trackedFetch,
  writeMetrics,
  METRICS_VERSION,
  type ApiMetrics,
} from "./apiMetrics";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = () => mkdtempSync(join(tmpdir(), "apimetrics-"));

/** A tiny valid data: URL body reused by several tests below. */
const JSON_URL = `data:application/json,${encodeURIComponent("{}")}`;

beforeEach(() => beginRun());

describe("safeUrl", () => {
  it("drops the query string so an api key can never be written", () => {
    // api-sports puts the credential in the query string. A measurement log
    // that retained it would become a secret-leak surface.
    expect(safeUrl("https://v3.football.api-sports.io/fixtures?key=SECRET123&x=1")).toBe(
      "v3.football.api-sports.io/fixtures",
    );
  });

  it("drops the fragment too", () => {
    expect(safeUrl("https://example.com/a/b#frag")).toBe("example.com/a/b");
  });

  it("still reduces a non-URL to something without a query string", () => {
    expect(safeUrl("not-a-url?token=abc")).toBe("not-a-url");
  });
});

describe("trackedFetch", () => {
  it("records method, status, sizes and duration for a real call", async () => {
    const url = `data:application/json,${encodeURIComponent('{"ok":true}')}`;
    const res = await trackedFetch("test:svc", url, { method: "POST", body: '{"a":1}' });
    expect(res.ok).toBe(true);

    const [call] = recordedCalls();
    expect(call.service).toBe("test:svc");
    expect(call.method).toBe("POST");
    expect(call.status).toBe(200);
    expect(call.ok).toBe(true);
    expect(call.requestBytes).toBe(7);
    expect(call.responseBytes).toBe(11);
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
    expect(call.attempts).toBe(1);
  });

  it("leaves the body readable for the caller", async () => {
    // The size probe reads a CLONE; if it consumed the original, every
    // existing caller would break. This pins that contract.
    const url = `data:application/json,${encodeURIComponent('{"payload":"value"}')}`;
    const res = await trackedFetch("test:svc", url);
    await expect(res.json()).resolves.toEqual({ payload: "value" });
  });

  it("records a failure and rethrows so callers still see the error", async () => {
    const url = "http://127.0.0.1:1/definitely-not-listening";
    await expect(trackedFetch("test:svc", url)).rejects.toBeTruthy();
    const [call] = recordedCalls();
    expect(call.ok).toBe(false);
    expect(call.status).toBeNull();
    expect(call.error).toBeTruthy();
  });

  it("marks metered calls so quota accounting can find them", async () => {
    const url = `data:application/json,${encodeURIComponent("{}")}`;
    await trackedFetch("openrouter", url, {}, { metered: true });
    expect(recordedCalls()[0].metered).toBe(true);
  });
});

describe("cost: 0 and null are different facts", () => {
  it("defaults to null (unreported), never 0", async () => {
    await trackedFetch("rss:unknown", JSON_URL);
    expect(recordedCalls()[0].costCredits).toBeNull();
  });

  it("keeps a REPORTED zero as 0", async () => {
    // A :free model returning "cost: 0" has told us something real.
    noteLlmCall("openrouter", {
      model: "qwen/qwen3.8-27b:free",
      status: 200,
      ok: true,
      durationMs: 1234,
      responseBytes: 900,
      cost: 0,
    });
    expect(recordedCalls()[0].costCredits).toBe(0);
  });

  it("noteCost attaches to the most recent matching call only", async () => {
    await trackedFetch("openrouter", JSON_URL, {}, { metered: true });
    await trackedFetch("rss:other", JSON_URL);
    noteCost("openrouter", 0);
    const calls = recordedCalls();
    expect(calls[0].costCredits).toBe(0);
    // The unrelated call must remain unreported.
    expect(calls[1].costCredits).toBeNull();
  });

  it("separates free from unreported in the aggregate", () => {
    noteLlmCall("openrouter", {
      model: "x:free", status: 200, ok: true, durationMs: 10, responseBytes: 10, cost: 0,
    });
    noteLlmCall("gemini", {
      model: "gemini-3.8-flash", status: 200, ok: true, durationMs: 10, responseBytes: 10, cost: null,
    });
    const m = buildMetrics(null);
    const or = m.latestRun!.services.find((s) => s.service === "openrouter")!;
    const gem = m.latestRun!.services.find((s) => s.service === "gemini")!;
    // Both totals are 0, but only one of them is a CLAIM that money was free.
    expect(or.costCredits).toBe(0);
    expect(or.costReported).toBe(1);
    expect(gem.costCredits).toBe(0);
    expect(gem.costReported).toBe(0);
  });
});

describe("noteSkippedCall", () => {
  it("records a non-attempt with attempts 0", () => {
    // "Did not run" and "ran and was rejected" must not look alike.
    noteSkippedCall("gemini", "not attempted — no key injected", true);
    const [c] = recordedCalls();
    expect(c.attempts).toBe(0);
    expect(c.metered).toBe(true);
    expect(c.ok).toBe(false);
  });
});

describe("buildMetrics", () => {
  it("aggregates per service, sorted by slowest first", () => {
    noteSkippedCall("fast", "x");
    noteLlmCall("slow", { model: "m", status: 200, ok: true, durationMs: 900, responseBytes: 1, cost: 0 });
    const m = buildMetrics(null);
    const names = m.latestRun!.services.map((s) => s.service);
    expect(names[0]).toBe("slow");
  });

  it("carries previous runs forward as bounded history", () => {
    const first = buildMetrics(null);
    const second = buildMetrics(first);
    expect(second.history.length).toBe(1);
    expect(second.history[0].calls).toBe(first.latestRun!.calls);
  });

  it("counts metered requests and quota rows for today only", () => {
    noteLlmCall("openrouter", { model: "m:free", status: 200, ok: true, durationMs: 5, responseBytes: 5, cost: 0 });
    const m = buildMetrics(null);
    expect(m.totals.meteredRequests).toBe(1);
    expect(m.budget).toHaveLength(1);
    expect(m.budget[0].service).toBe("openrouter");
    expect(m.budget[0].requests).toBe(1);
    expect(m.budget[0].quotaLimit).toBe(1000);
    // A quota row must carry the UTC date it belongs to.
    expect(m.budget[0].utcDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("does not count unmetered calls against quota", () => {
    noteSkippedCall("rss:sportbladet", "fetched");
    const m = buildMetrics(null);
    expect(m.totals.meteredRequests).toBe(0);
    expect(m.budget).toHaveLength(0);
  });

  it("does NOT charge quota for a metered call that was never attempted", () => {
    // REGRESSION, found by running the real pipeline on 2026-10-04: the log
    // reported `gemini: 1 av 20` on a night where Gemini was never called,
    // because the key is deliberately not injected. Counting a non-attempt
    // would fabricate quota usage — the exact failure this log exists to
    // prevent, reproduced by the log itself.
    noteSkippedCall("gemini", "not attempted — no key injected", true);
    const m = buildMetrics(null);
    expect(m.budget).toHaveLength(0);
    expect(m.totals.meteredRequests).toBe(1);
  });

  it("reports truncation instead of silently shortening the call list", () => {
    for (let i = 0; i < 40; i++) noteSkippedCall("rss:bulk", "seed");
    const m = buildMetrics(null);
    expect(m.latestCallsTotal).toBe(40);
    expect(m.latestCallsTruncated).toBe(true);
    expect(m.latestCalls.length).toBeLessThan(40);
    // The aggregate must still account for every call, not just the kept ones.
    expect(m.latestRun!.calls).toBe(40);
  });
});

describe("file round trip", () => {
  it("writes and reads back the same version", () => {
    const dir = tmp();
    const p = join(dir, "api-metrics.json");
    noteLlmCall("openrouter", { model: "m:free", status: 200, ok: true, durationMs: 7, responseBytes: 7, cost: 0 });
    expect(writeMetrics(p, null)).not.toBeNull();
    const back = readMetrics(p);
    expect(back?.version).toBe(METRICS_VERSION);
    expect(back?.latestRun?.calls).toBe(1);
  });

  it("rejects a file from an unknown version rather than trusting it", () => {
    const dir = tmp();
    const p = join(dir, "api-metrics.json");
    writeFileSync(p, JSON.stringify({ version: 999, latestRun: { calls: 5 } }));
    expect(readMetrics(p)).toBeNull();
  });

  it("returns null for a corrupt file instead of throwing", () => {
    const dir = tmp();
    const p = join(dir, "api-metrics.json");
    writeFileSync(p, "{not json");
    expect(readMetrics(p)).toBeNull();
  });

  it("returns null for a missing file", () => {
    expect(readMetrics(join(tmp(), "absent.json"))).toBeNull();
  });

  it("never throws when the write fails", () => {
    // A measurement failing must never fail the pipeline it measured.
    // A regular file stands where a directory is needed, so mkdir/write both
    // fail with ENOTDIR.
    const dir = tmp();
    const asFile = join(dir, "blocker");
    writeFileSync(asFile, "i am a file, not a directory");
    expect(writeMetrics(join(asFile, "api-metrics.json"), null)).toBeNull();
  });

  it("keeps the file bounded and free of secrets", () => {
    const dir = tmp();
    const p = join(dir, "api-metrics.json");
    noteLlmCall("openrouter", { model: "m:free", status: 200, ok: true, durationMs: 7, responseBytes: 7, cost: 0 });
    writeMetrics(p, null);
    const raw = readFileSync(p, "utf8");
    expect(raw).not.toMatch(/sk-or-v1-[A-Za-z0-9]{20,}/);
    expect(raw).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/);
    expect(existsSync(p)).toBe(true);
  });
});

describe("quotaLimitFor", () => {
  it("returns the documented ceilings", () => {
    expect(quotaLimitFor("openrouter")).toBe(1000);
    expect(quotaLimitFor("gemini")).toBe(20);
  });

  it("returns null for an unmetered service", () => {
    expect(quotaLimitFor("rss:sportbladet")).toBeNull();
  });
});

describe("history does not grow without bound", () => {
  it("stops at the retention limit", () => {
    let prev: ApiMetrics | null = null;
    for (let i = 0; i < 30; i++) {
      beginRun();
      noteSkippedCall("rss:x", "seed");
      prev = buildMetrics(prev);
    }
    expect(prev!.history.length).toBeLessThanOrEqual(7);
  });
});
