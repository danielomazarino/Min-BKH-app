import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  translateText,
  readTranslationCache,
  writeTranslationCache,
  clearTranslationCache,
} from "./translate";

/**
 * The failure this module must never produce is a FABRICATED Swedish sentence.
 * Every test below pins one way the source can fail, and asserts the honest
 * answer (null) rather than a guess.
 */

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  return { fetch: vi.fn(async (input: RequestInfo | URL) => handler(String(input))) } as never;
}

beforeEach(() => clearTranslationCache());

describe("translateText", () => {
  it("returns the translated text on success", async () => {
    const deps = stubFetch(() =>
      jsonResponse({ responseData: { translatedText: "Han har tidigare spelat för Kvik Halden." }, responseStatus: 200 }),
    );
    const out = await translateText("Han har tidligere spilt for Kvik Halden", "no", "sv", deps);
    expect(out).toBe("Han har tidigare spelat för Kvik Halden.");
  });

  it("maps Wikipedia's nb to MyMemory's no", async () => {
    let seen = "";
    const deps = stubFetch((url) => {
      seen = url;
      return jsonResponse({ responseData: { translatedText: "Översatt" }, responseStatus: 200 });
    });
    await translateText("tekst", "nb", "sv", deps);
    expect(seen).toContain("langpair=no|sv");
  });

  it("returns null when the API reports a non-200 responseStatus inside a 200 body", async () => {
    const deps = stubFetch(() => jsonResponse({ responseData: { translatedText: "x" }, responseStatus: 429 }));
    expect(await translateText("tekst", "no", "sv", deps)).toBeNull();
  });

  it("returns null when the API echoes the input unchanged (not a translation)", async () => {
    const deps = stubFetch(() =>
      jsonResponse({ responseData: { translatedText: "Han har tidligere spilt" }, responseStatus: 200 }),
    );
    expect(await translateText("Han har tidligere spilt", "no", "sv", deps)).toBeNull();
  });

  it("returns null on a transport failure instead of throwing", async () => {
    const deps = stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await translateText("tekst", "no", "sv", deps)).toBeNull();
  });

  it("returns null on an HTTP error", async () => {
    const deps = stubFetch(() => jsonResponse({}, 500));
    expect(await translateText("tekst", "no", "sv", deps)).toBeNull();
  });

  it("returns the text unchanged when source and target are the same", async () => {
    const deps = stubFetch(() => {
      throw new Error("must not be called");
    });
    expect(await translateText("Hej", "sv", "sv", deps)).toBe("Hej");
  });

  it("returns null for empty input", async () => {
    const deps = stubFetch(() => {
      throw new Error("must not be called");
    });
    expect(await translateText("   ", "no", "sv", deps)).toBeNull();
  });
});

describe("translation cache", () => {
  it("round-trips a value and a null", () => {
    writeTranslationCache("a", "no", "sv", "översatt", 1000);
    expect(readTranslationCache("a", "no", "sv", 1000)).toBe("översatt");
    writeTranslationCache("b", "no", "sv", null, 1000);
    expect(readTranslationCache("b", "no", "sv", 1000)).toBeNull();
  });

  it("expires after the TTL", () => {
    writeTranslationCache("a", "no", "sv", "översatt", 1000);
    expect(readTranslationCache("a", "no", "sv", 1000 + 31 * 60 * 1000)).toBeUndefined();
  });
});
