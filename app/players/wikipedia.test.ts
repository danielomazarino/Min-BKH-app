import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchWikipediaSummary,
  readWikiCache,
  writeWikiCache,
  clearWikiCache,
  type WikipediaSummary,
} from "./wikipedia";

/**
 * The failure modes here are SILENT and dangerous in one specific way: a
 * title match that is NOT the right person produces a plausible-looking
 * biography for the wrong human being. Every test below pins one such case.
 *
 * The name-collision fixture is REAL, measured 2026-10-06: "Mats Hedén" on
 * sv.wikipedia is a musician (Q5795456); the footballer is Q103846058.
 */

const FOOTBALLER_QID = "Q103846058";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** The real REST summary shape (verified live 2026-10-06). */
function summaryShape(overrides: Record<string, unknown> = {}) {
  return {
    type: "standard",
    title: "Mats Hedén",
    extract: "Mats Hedén är en svensk musiker (klaviatur) i Weeping Willows.",
    thumbnail: { source: "https://thumb.wikimedia.org/wikipedia/commons/thumb/x/400px-x.jpg" },
    content_urls: { desktop: { page: "https://sv.wikipedia.org/wiki/Mats_Hed%C3%A9n" } },
    wikibase_item: "Q5795456", // the MUSICIAN
    ...overrides,
  };
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  return { fetch: vi.fn(async (input: RequestInfo | URL) => handler(String(input))) } as never;
}

beforeEach(() => clearWikiCache());

describe("fetchWikipediaSummary", () => {
  it("returns the summary when the article is about the right entity", async () => {
    const deps = stubFetch((url) => {
      if (url.includes("sv.wikipedia.org")) {
        return jsonResponse(summaryShape({ wikibase_item: FOOTBALLER_QID, extract: "Mats Hedén, född 1976, svensk fotbollsspelare." }));
      }
      throw new Error("unexpected request: " + url);
    });
    const s = await fetchWikipediaSummary(FOOTBALLER_QID, { svwiki: { title: "Mats Hedén" } }, deps);
    expect(s).not.toBeNull();
    expect(s?.extract).toContain("fotbollsspelare");
    expect(s?.wikibaseItem).toBe(FOOTBALLER_QID);
  });

  it("REJECTS an article about a different person with the same name", async () => {
    // The measured live case: sv article exists but is about the musician.
    const deps = stubFetch((url) => {
      if (url.includes("sv.wikipedia.org")) return jsonResponse(summaryShape());
      throw new Error("unexpected request: " + url);
    });
    const s = await fetchWikipediaSummary(FOOTBALLER_QID, { svwiki: { title: "Mats Hedén" } }, deps);
    expect(s).toBeNull();
  });

  it("falls back to English when Swedish has no sitelink", async () => {
    const deps = stubFetch((url) => {
      if (url.includes("en.wikipedia.org")) {
        return jsonResponse(summaryShape({ wikibase_item: FOOTBALLER_QID, extract: "Swedish footballer." }));
      }
      throw new Error("unexpected request: " + url);
    });
    const s = await fetchWikipediaSummary(FOOTBALLER_QID, { enwiki: { title: "Mats Hedén" } }, deps);
    expect(s?.lang).toBe("en");
  });

  it("tries English when the Swedish article 404s", async () => {
    const deps = stubFetch((url) => {
      if (url.includes("sv.wikipedia.org")) return jsonResponse({}, 404);
      if (url.includes("en.wikipedia.org")) {
        return jsonResponse(summaryShape({ wikibase_item: FOOTBALLER_QID, extract: "Swedish footballer." }));
      }
      throw new Error("unexpected request: " + url);
    });
    const s = await fetchWikipediaSummary(FOOTBALLER_QID, { svwiki: { title: "X" }, enwiki: { title: "X" } }, deps);
    expect(s?.lang).toBe("en");
  });

  it("returns null when there is no sitelink at all", async () => {
    const deps = stubFetch(() => {
      throw new Error("must not be called");
    });
    const s = await fetchWikipediaSummary(FOOTBALLER_QID, {}, deps);
    expect(s).toBeNull();
  });

  it("returns null when the extract is empty", async () => {
    const deps = stubFetch(() => jsonResponse(summaryShape({ extract: "", wikibase_item: FOOTBALLER_QID })));
    const s = await fetchWikipediaSummary(FOOTBALLER_QID, { svwiki: { title: "X" } }, deps);
    expect(s).toBeNull();
  });

  it("encodes the title for the URL", async () => {
    let seen = "";
    const deps = stubFetch((url) => {
      seen = url;
      return jsonResponse(summaryShape({ wikibase_item: FOOTBALLER_QID }));
    });
    await fetchWikipediaSummary(FOOTBALLER_QID, { svwiki: { title: "Mattias Bjärsmyr" } }, deps);
    expect(seen).toContain("Mattias_Bj%C3%A4rsmyr");
  });
});

describe("wiki session cache", () => {
  it("round-trips a value", () => {
    const v: WikipediaSummary = {
      lang: "sv",
      extract: "x",
      pageUrl: "https://sv.wikipedia.org/wiki/X",
      wikibaseItem: FOOTBALLER_QID,
    };
    writeWikiCache(FOOTBALLER_QID, v, 1000);
    expect(readWikiCache(FOOTBALLER_QID, 2000)).toEqual(v);
  });

  it("caches a NULL result too — absence is a fact, not a failure", () => {
    // Re-asking every open would spend the request to learn the same nothing.
    writeWikiCache(FOOTBALLER_QID, null, 1000);
    expect(readWikiCache(FOOTBALLER_QID, 2000)).toBeNull();
  });

  it("expires after the TTL", () => {
    const v: WikipediaSummary = {
      lang: "sv",
      extract: "x",
      pageUrl: "https://sv.wikipedia.org/wiki/X",
      wikibaseItem: FOOTBALLER_QID,
    };
    writeWikiCache(FOOTBALLER_QID, v, 1000);
    // 31 minutes later.
    expect(readWikiCache(FOOTBALLER_QID, 1000 + 31 * 60 * 1000)).toBeUndefined();
  });
});
