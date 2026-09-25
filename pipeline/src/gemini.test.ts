/**
 * Behavioural tests for the Gemini news synthesis stage.
 *
 * These do NOT call Gemini. They test the deterministic contract around it:
 * what we send, how we validate the response, how we build events, and how we
 * fail safely. Section 22 of the task.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  buildEventsFromGemini,
  buildGeminiRequestPayload,
  parseGeminiResponse,
  synthesizeWithGemini,
  truncateSummary,
  MAX_SUMMARY_CHARS,
  type GeminiArticleInput,
  type GeminiResult,
} from "./gemini";
import { prefilterNews } from "./newsPrefilter";
import { extractTextFromHtml } from "./articleText";
import type { NewsItem } from "./types";

// ---------- fixtures ----------

const NOW = new Date("2026-09-25T12:00:00Z");

function item(o: Partial<NewsItem> & { id: string; url: string; title: string }): NewsItem {
  return {
    publisher: "BK Häcken",
    publishedAt: "2026-09-20T10:00:00.000Z",
    category: "unknown",
    discoveredVia: "rss",
    ...o,
  };
}

/** The eight supplied regression articles. */
const ARTICLES: NewsItem[] = [
  item({ id: "a1", title: "BK Häcken åker till Kalmar – här är matchtruppen", url: "https://bkhacken.se/nyhet/bk-hacken-aker-till-kalmar-har-ar-matchtruppen", publishedAt: "2026-09-19T08:00:00.000Z" }),
  item({ id: "a2", title: "Inför KFF-BKH: Tillsammans ska vi göra allt vi kan för att ta tre poäng", url: "https://kalmarff.se/infor-kff-bkh-tillsammans-ska-vi-gora-allt-vi-kan-for-att-ta-tre-poang/", publishedAt: "2026-09-19T09:00:00.000Z", publisher: "Kalmar FF" }),
  item({ id: "a3", title: "Gustav Lindgren: Det kändes väldigt bra från den första minuten", url: "https://bkhacken.se/nyhet/gustav-lindgren-det-kandes-valdigt-bra-fran-den-forsta-minuten", publishedAt: "2026-09-20T10:00:00.000Z" }),
  item({ id: "a4", title: "Gustav Lindgren gör hattrick mot Kalmar", url: "https://www.svt.se/sport/fotboll/gustav-lindgren-gor-hattrick-mot-kalmar", publishedAt: "2026-09-20T12:00:00.000Z", publisher: "SVT Sport" }),
  item({ id: "a5", title: "Häcken krossar Kalmar – hattrick av Lindgren", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/Ex8Q0P/hacken-krossar-kalmar-hattrick-av-gustav-lindgren", publishedAt: "2026-09-20T13:00:00.000Z", publisher: "Sportbladet" }),
  item({ id: "a6", title: "Hattrick från Lindgren – Häcken krossade Kalmar", url: "https://fotbolldirekt.se/allsvenskan/hattrick-fran-lindgren-hacken-krossade-kalmar/", publishedAt: "2026-09-20T14:00:00.000Z", publisher: "FotbollDirekt" }),
  item({ id: "a7", title: "Matchguide: Champions League-premiär borta mot FC Inter", url: "https://bkhacken.se/nyhet/matchguide-champions-league-premiar-borta-mot-fc-inter", publishedAt: "2026-09-22T08:00:00.000Z" }),
  item({ id: "a8", title: "Häckens målvakter mot Juventus – två tonåringar", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/6qaWy8/hacken-kan-sta-infor-en-malvaktskris", publishedAt: "2026-09-23T08:00:00.000Z", publisher: "Sportbladet" }),
];

/** A realistic Gemini answer for the eight articles. */
const GOOD_RESULT: GeminiResult = {
  verdicts: [
    { articleId: "a1", scope: "men", confidence: "high", reason: "herrlagets matchtrupp inför Allsvenskanmatch" },
    { articleId: "a2", scope: "men", confidence: "high", reason: "matchförhandsvisning herrlag" },
    { articleId: "a3", scope: "men", confidence: "high", reason: "intervju med herrlagsspelare" },
    { articleId: "a4", scope: "men", confidence: "high", reason: "Allsvenskan herrlag" },
    { articleId: "a5", scope: "men", confidence: "high", reason: "matchreferat herrlag" },
    { articleId: "a6", scope: "men", confidence: "high", reason: "matchreferat herrlag" },
    { articleId: "a7", scope: "women", confidence: "high", reason: "damlagets Champions League" },
    { articleId: "a8", scope: "women", confidence: "high", reason: "damlagets målvakter" },
  ],
  events: [
    { title: "Häcken inför KFF-BKH i Allsvenskan", summary: "Häcken reste till Kalmar inför matchen mot Kalmar FF i Allsvenskan.", articleIds: ["a1", "a2"] },
    { title: "Lindgren hattrick när Häcken krossar Kalmar", summary: "Gustav Lindgren gjorde hattrick när Häcken besegrade Kalmar borta.", articleIds: ["a3", "a4", "a5", "a6"] },
  ],
};

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  vi.unstubAllGlobals();
});

// ---------- 10. regression: the eight supplied articles ----------

describe("regression: the eight supplied articles", () => {
  it("produces two events and excludes both women's articles", () => {
    const events = buildEventsFromGemini(ARTICLES, GOOD_RESULT);
    expect(events).toHaveLength(2);

    const urls = events.flatMap((e) => e.sources.map((s) => s.url));
    expect(urls).toContain(ARTICLES[0].url); // BK Häcken preview
    expect(urls).toContain(ARTICLES[1].url); // Kalmar FF preview
    for (const i of [2, 3, 4, 5]) expect(urls).toContain(ARTICLES[i].url); // Lindgren hat-trick x4
    expect(urls).not.toContain(ARTICLES[6].url); // women's CL
    expect(urls).not.toContain(ARTICLES[7].url); // women's keepers
  });

  it("merges the four different-headline reports of the same match into ONE event", () => {
    const events = buildEventsFromGemini(ARTICLES, GOOD_RESULT);
    const match = events.find((e) => e.sources.length === 4);
    expect(match).toBeDefined();
    expect(match!.sources.map((s) => s.title)).toEqual(
      expect.arrayContaining([ARTICLES[2].title, ARTICLES[3].title, ARTICLES[4].title, ARTICLES[5].title]),
    );
  });

  it("keeps the preview and the match report as separate events", () => {
    const events = buildEventsFromGemini(ARTICLES, GOOD_RESULT);
    expect(events.map((e) => e.sources.length).sort()).toEqual([2, 4]);
  });
});

// ---------- 1 & 2. men's accepted, women's rejected ----------

describe("men's vs women's classification", () => {
  it("accepts a men's article", () => {
    const events = buildEventsFromGemini([ARTICLES[3]], {
      verdicts: [{ articleId: "a4", scope: "men", confidence: "high", reason: "Allsvenskan herrlag" }],
      events: [{ title: "T", summary: "S", articleIds: ["a4"] }],
    });
    expect(events).toHaveLength(1);
  });

  it("rejects a women's article even if Gemini wrongly places it in an event", () => {
    const events = buildEventsFromGemini([ARTICLES[6], ARTICLES[7]], {
      verdicts: [
        { articleId: "a7", scope: "women", confidence: "high", reason: "damlaget" },
        { articleId: "a8", scope: "women", confidence: "high", reason: "damlaget" },
      ],
      events: [{ title: "T", summary: "S", articleIds: ["a7", "a8"] }],
    });
    expect(events).toHaveLength(0);
  });

  it("never classifies from a hard-coded URL or player list", () => {
    // The pre-filter keeps BOTH women's articles as candidates; only the
    // model's scope verdict removes them.
    const { candidates } = prefilterNews(ARTICLES, { now: NOW });
    expect(candidates.map((c) => c.id)).toContain("a7");
    expect(candidates.map((c) => c.id)).toContain("a8");
  });
});

// ---------- 3. same event, different headlines ----------

describe("event grouping is semantic, not title-based", () => {
  it("groups articles whose titles share no words", () => {
    const items = [ARTICLES[3], ARTICLES[4]];
    const events = buildEventsFromGemini(items, {
      verdicts: items.map((i) => ({ articleId: i.id, scope: "men" as const, confidence: "high" as const, reason: "" })),
      events: [{ title: "Ett event", summary: "Sammanfattning", articleIds: ["a4", "a5"] }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].sources).toHaveLength(2);
  });
});

// ---------- 4. different events on the same day stay separate ----------

describe("different events are not merged", () => {
  it("keeps a match report and a contract extension apart", () => {
    const contract = item({ id: "c1", title: "Häcken förlänger avtal med mittfältaren", url: "https://bkhacken.se/nyhet/avtal", publishedAt: "2026-09-20T10:00:00.000Z" });
    const events = buildEventsFromGemini([ARTICLES[3], contract], {
      verdicts: [
        { articleId: "a4", scope: "men", confidence: "high", reason: "" },
        { articleId: "c1", scope: "men", confidence: "high", reason: "" },
      ],
      events: [
        { title: "Match", summary: "Match", articleIds: ["a4"] },
        { title: "Avtal", summary: "Avtal", articleIds: ["c1"] },
      ],
    });
    expect(events).toHaveLength(2);
  });

  it("ignores an event the model lists twice with overlapping articles", () => {
    const events = buildEventsFromGemini([ARTICLES[3], ARTICLES[4]], {
      verdicts: [
        { articleId: "a4", scope: "men", confidence: "high", reason: "" },
        { articleId: "a5", scope: "men", confidence: "high", reason: "" },
      ],
      events: [
        { title: "A", summary: "A", articleIds: ["a4", "a5"] },
        { title: "B", summary: "B", articleIds: ["a5"] },
      ],
    });
    expect(events).toHaveLength(1);
  });
});

// ---------- 5 & 8. provenance and no invented URLs ----------

describe("provenance", () => {
  it("uses our own URLs, publishers, titles and dates — never the model's", () => {
    const events = buildEventsFromGemini(ARTICLES, GOOD_RESULT);
    for (const ev of events) {
      for (const src of ev.sources) {
        const origin = ARTICLES.find((a) => a.url === src.url);
        expect(origin).toBeDefined();
        expect(src.publisher).toBe(origin!.publisher);
        expect(src.title).toBe(origin!.title);
        expect(src.publishedAt).toBe(origin!.publishedAt);
      }
    }
  });

  it("discards a URL that Gemini invented", () => {
    const parsed = parseGeminiResponse(
      JSON.stringify({
        verdicts: [{ articleId: "a4", scope: "men", confidence: "high", reason: "x" }],
        events: [{ title: "T", summary: "S", articleIds: ["a4", "hacker.com/invented"] }],
      }),
      ["a4", "a5"],
    );
    expect(parsed.unknownIds).toEqual(["hacker.com/invented"]);
    expect(parsed.result.events[0].articleIds).toEqual(["a4"]);
  });

  it("never emits a source URL outside the supplied set", () => {
    const parsed = parseGeminiResponse(
      JSON.stringify({ verdicts: [], events: [{ title: "T", summary: "S", articleIds: ["evil"] }] }),
      ["a4"],
    );
    expect(parsed.result.events).toHaveLength(0);
  });
});

// ---------- 6 & 7. summary ----------

describe("summary", () => {
  it("is Swedish and factual", () => {
    const ev = buildEventsFromGemini(ARTICLES, GOOD_RESULT)[0];
    expect(ev.summary).toMatch(/[åäöÅÄÖ]/);
    expect(ev.summary).toBe("Gustav Lindgren gjorde hattrick när Häcken besegrade Kalmar borta.");
  });

  it("is never longer than 200 characters", () => {
    const long = "x".repeat(500);
    expect(truncateSummary(long).length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    for (const ev of buildEventsFromGemini(ARTICLES, GOOD_RESULT)) {
      expect(ev.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    }
  });

  it("is truncated even if Gemini ignores the limit", () => {
    const events = buildEventsFromGemini([ARTICLES[3]], {
      verdicts: [{ articleId: "a4", scope: "men", confidence: "high", reason: "" }],
      events: [{ title: "T", summary: "y".repeat(400), articleIds: ["a4"] }],
    });
    expect(events[0].summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });
});

// ---------- 9. failure behaviour ----------

describe("failure behaviour", () => {
  it("does nothing when GEMINI_API_KEY is missing", async () => {
    const { result, status } = await synthesizeWithGemini([{ id: "a4", publisher: "SVT", title: "T", url: "u", publishedAt: "d", categoryHint: "unknown" }]);
    expect(result).toBeNull();
    expect(status.ok).toBe(false);
    expect(status.calls).toBe(0);
  });

  it("returns null instead of throwing on malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    process.env.GEMINI_API_KEY = "test-key";
    const { result, status } = await synthesizeWithGemini([{ id: "a4", publisher: "SVT", title: "T", url: "u", publishedAt: "d", categoryHint: "unknown" }]);
    expect(result).toBeNull();
    expect(status.ok).toBe(false);
  });

  it("returns null on an HTTP error", async () => {
    // 500 is transient, so the retry path would otherwise burn real backoff here.
    process.env.GEMINI_RETRY_DELAY_MS = "0";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    process.env.GEMINI_API_KEY = "test-key";
    const { result, status } = await synthesizeWithGemini([{ id: "a4", publisher: "SVT", title: "T", url: "u", publishedAt: "d", categoryHint: "unknown" }]);
    expect(result).toBeNull();
    expect(status.error).toContain("HTTP 500");
    delete process.env.GEMINI_RETRY_DELAY_MS;
  });

  it("rejects a response whose shape does not match the schema", () => {
    expect(() => parseGeminiResponse(JSON.stringify({ events: "nope" }), ["a4"])).toThrow();
  });

  it("produces no events from a null Gemini result (caller keeps deterministic events)", () => {
    expect(buildEventsFromGemini(ARTICLES, null)).toHaveLength(0);
  });
});

// ---------- bounded retry (transient failures only) ----------

const ONE_ARTICLE: GeminiArticleInput[] = [
  { id: "a4", publisher: "SVT", title: "T", url: "u", publishedAt: "d", categoryHint: "unknown" },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Fresh object per call — a Response body can only be read once. */
function httpError(status: number, text = "busy"): () => Response {
  return () => new Response(text, { status });
}

const GOOD_BODY = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              verdicts: [{ articleId: "a4", scope: "men", confidence: "high", reason: "Allsvenskan herrlag" }],
              events: [{ title: "Hattrick", summary: "Gustav Lindgren gjorde hattrick mot Kalmar.", articleIds: ["a4"] }],
            }),
          },
        ],
      },
    },
  ],
};

describe("bounded retry", () => {
  // GEMINI_RETRY_DELAY_MS=0 removes the real backoff so these run instantly.
  beforeEach(() => {
    process.env.GEMINI_RETRY_DELAY_MS = "0";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
  });
  afterEach(() => {
    delete process.env.GEMINI_RETRY_DELAY_MS;
    delete process.env.GEMINI_MODEL;
  });

  it("retries a 503 and succeeds on the second attempt", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const mock = vi
      .fn()
      .mockImplementationOnce(httpError(503))
      .mockImplementationOnce(() => jsonResponse(GOOD_BODY))
      .mockImplementation(httpError(503));
    vi.stubGlobal("fetch", mock);
    const { result, status } = await synthesizeWithGemini(ONE_ARTICLE);
    expect(result).not.toBeNull();
    expect(status.ok).toBe(true);
    expect(status.model).toBe("gemini-3.8-flash");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("gives up on a 503 after exactly 2 retries (3 attempts total), not an unbounded loop", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const mock = vi.fn().mockImplementation(httpError(503));
    vi.stubGlobal("fetch", mock);
    const { result, status } = await synthesizeWithGemini(ONE_ARTICLE);
    expect(result).toBeNull();
    expect(status.ok).toBe(false);
    expect(status.error).toContain("503");
    expect(mock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does NOT retry a permanent 400", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const mock = vi.fn().mockImplementation(httpError(400, "bad request"));
    vi.stubGlobal("fetch", mock);
    const { result } = await synthesizeWithGemini(ONE_ARTICLE);
    expect(result).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a 401", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const mock = vi.fn().mockImplementation(httpError(401, "unauthorized"));
    vi.stubGlobal("fetch", mock);
    const { result } = await synthesizeWithGemini(ONE_ARTICLE);
    expect(result).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a retired model (404)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const mock = vi.fn().mockImplementation(httpError(404, "no longer available"));
    vi.stubGlobal("fetch", mock);
    const { result } = await synthesizeWithGemini(ONE_ARTICLE);
    expect(result).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

// ---------- request shape & pre-filter ----------

describe("request shape", () => {
  it("sends every article in ONE request with its metadata", () => {
    const payload = buildGeminiRequestPayload([
      { id: "a4", publisher: "SVT Sport", title: "Hattrick", url: "https://svt.se/x", publishedAt: "2026-09-20", text: "Gustav Lindgren gjorde hattrick.", categoryHint: "men" },
    ]) as { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { responseMimeType: string; responseSchema: unknown } };
    const text = payload.contents[0].parts[0].text;
    expect(text).toContain("SVT Sport");
    expect(text).toContain("https://svt.se/x");
    expect(text).toContain("Gustav Lindgren gjorde hattrick.");
    expect(payload.generationConfig.responseMimeType).toBe("application/json");
    expect(payload.generationConfig.responseSchema).toBeDefined();
  });

  it("tells Gemini when article text could not be fetched instead of inventing it", () => {
    const payload = buildGeminiRequestPayload([
      { id: "a4", publisher: "SVT", title: "T", url: "u", publishedAt: "d", text: undefined, categoryHint: "unknown" },
    ]) as { contents: Array<{ parts: Array<{ text: string }> }> };
    expect(payload.contents[0].parts[0].text).toContain("SA INTE GÅ att hämta");
  });
});

describe("deterministic pre-filter", () => {
  const inWindow = item({ id: "n1", title: "Häcken vann", url: "https://x.se/1", publishedAt: "2026-09-20T10:00:00.000Z", publisher: "Sportbladet" });

  it("drops articles outside the date window", () => {
    const old = item({ id: "o1", title: "Häcken gamla nyhet", url: "https://x.se/old", publishedAt: "2025-01-01T10:00:00.000Z", publisher: "Sportbladet" });
    const { candidates, dropped } = prefilterNews([inWindow, old], { now: NOW });
    expect(candidates.map((c) => c.id)).toEqual(["n1"]);
    expect(dropped.some((d) => d.url === old.url)).toBe(true);
  });

  it("drops league coverage with no Häcken relation", () => {
    const league = item({ id: "g1", title: "Allsvenskan: Malmo FF seger", url: "https://x.se/2", publishedAt: "2026-09-20T10:00:00.000Z", publisher: "Allsvenskan" });
    expect(prefilterNews([league], { now: NOW }).candidates).toHaveLength(0);
  });

  it("keeps official club articles even without an explicit Häcken mention", () => {
    const official = item({ id: "h1", title: "Matchguide borta", url: "https://bkhacken.se/x", publishedAt: "2026-09-22T10:00:00.000Z", publisher: "BK Häcken" });
    expect(prefilterNews([official], { now: NOW }).candidates).toHaveLength(1);
  });

  it("drops advertisements", () => {
    const ad = item({ id: "ad1", title: "Köp biljetter till nästa match", url: "https://x.se/3", publishedAt: "2026-09-20T10:00:00.000Z", publisher: "Sportbladet" });
    expect(prefilterNews([ad], { now: NOW }).candidates).toHaveLength(0);
  });
});

describe("article text extraction", () => {
  it("removes scripts, styles and markup", () => {
    const html = `<html><head><style>a{}</style></head><body><script>evil()</script><p>Hej &amp; välkommen</p><p>Mer text här</p></body></html>`;
    const text = extractTextFromHtml(html);
    expect(text).toContain("Hej & välkommen");
    expect(text).not.toContain("evil()");
    expect(text).not.toContain("<p>");
  });
});
