import { describe, expect, it, vi } from "vitest";
import {
  buildResearchPayload,
  parseResearchResponse,
  researchPlayer,
  PlayerResearchSchema,
  candidateModels,
} from "./geminiResearch";

const PLAYER = { id: "test-player", name: "Test Player", aliases: ["tp"], bkhSeasons: "2015-2018" };

/** A complete, well-formed, fully-cited response. */
function goodPayload(overrides: Record<string, unknown> = {}) {
  const fact = (value: string | null, extra: Record<string, unknown> = {}) => ({
    value,
    status: value === null ? "unknown" : "verified",
    confidence: value === null ? "low" : "high",
    sourceUrl: value === null ? undefined : "https://example.com/a",
    ...extra,
  });
  return {
    identity: fact("Test Player", { aliases: ["TP"] }),
    bkhackenRelationship: fact("Spelade för BK Häcken", { team: "Herr", period: "2015-2018" }),
    activityStatus: fact("ACTIVE_AT_CLUB", { value: "ACTIVE_AT_CLUB" }),
    currentClub: fact("Some Club"),
    currentLeague: fact("Superettan"),
    currentCountry: fact("Sverige"),
    contractExpiry: fact(null),
    contractNature: fact(null, { value: "unknown" }),
    careerNotes: fact("Flyttade 2018."),
    ...overrides,
  };
}

describe("research payload", () => {
  it("requests google_search grounding", () => {
    const p = buildResearchPayload(PLAYER);
    expect(p.tools).toEqual([{ google_search: {} }]);
    expect(p.generationConfig.responseMimeType).toBe("application/json");
  });

  it("passes registry seasons as an unverified hint, not a fact", () => {
    const text = buildResearchPayload(PLAYER).contents[0].parts[0].text;
    expect(text).toContain("2015-2018");
    expect(text).toMatch(/ej verifierat/);
  });

  it("defaults to the shared model candidates and honours a pin", () => {
    delete process.env.GEMINI_MODEL;
    expect(candidateModels()).toContain("gemini-3.8-flash");
    process.env.GEMINI_MODEL = "gemini-9.9-pro";
    expect(candidateModels()).toEqual(["gemini-9.9-pro"]);
    delete process.env.GEMINI_MODEL;
  });
});

describe("research schema — UNKNOWN is a valid answer", () => {
  it("accepts an all-unknown response (correct restraint)", () => {
    const r = PlayerResearchSchema.safeParse(goodPayload({
      currentClub: { value: null, status: "unknown", confidence: "low" },
      currentLeague: { value: null, status: "unknown", confidence: "low" },
      currentCountry: { value: null, status: "unknown", confidence: "low" },
      activityStatus: { value: "UNKNOWN", status: "unknown", confidence: "low" },
    }));
    expect(r.success).toBe(true);
  });

  it("rejects a stated value with no sourceUrl", () => {
    const r = PlayerResearchSchema.safeParse(goodPayload({
      currentClub: { value: "Some Club", status: "verified", confidence: "high" },
    }));
    expect(r.success).toBe(false);
  });

  it("rejects value=null unless status is unknown", () => {
    const r = PlayerResearchSchema.safeParse(goodPayload({
      currentClub: { value: null, status: "verified", confidence: "high", sourceUrl: "https://e.com" },
    }));
    expect(r.success).toBe(false);
  });

  it("allows conflicting with a value and a note", () => {
    const r = PlayerResearchSchema.safeParse(goodPayload({
      currentClub: {
        value: "Club A",
        status: "conflicting",
        confidence: "low",
        sourceUrl: "https://e.com",
        note: "två källor säger olika",
      },
    }));
    expect(r.success).toBe(true);
  });

  it("rejects an activity status outside the enum", () => {
    const r = PlayerResearchSchema.safeParse(goodPayload({
      activityStatus: { value: "PROBABLY_RETIRED", status: "reported", confidence: "low", sourceUrl: "https://e.com" },
    }));
    expect(r.success).toBe(false);
  });
});

describe("parseResearchResponse", () => {
  const opts = {
    model: "test-model",
    grounded: true,
    sources: [],
    verifiedAt: "2026-09-26T00:00:00.000Z",
  };

  it("returns null for invalid JSON rather than throwing", () => {
    expect(parseResearchResponse("not json", PLAYER, opts)).toBeNull();
  });

  it("returns null when the payload fails validation", () => {
    expect(parseResearchResponse(JSON.stringify({ identity: {} }), PLAYER, opts)).toBeNull();
  });

  it("keeps provenance and stamps the verification date", () => {
    const p = parseResearchResponse(JSON.stringify(goodPayload()), PLAYER, opts)!;
    expect(p.researchedAt).toBe("2026-09-26T00:00:00.000Z");
    expect(p.grounded).toBe(true);
    expect(p.currentClub.value).toBe("Some Club");
    expect(p.currentClub.sourceUrl).toBe("https://example.com/a");
    expect(p.bkhackenRelationship.team).toBe("Herr");
    expect(p.activityStatus.value).toBe("ACTIVE_AT_CLUB");
  });

  it("preserves an unknown contract as a first-class result", () => {
    const p = parseResearchResponse(JSON.stringify(goodPayload()), PLAYER, opts)!;
    expect(p.contractExpiry.value).toBeNull();
    expect(p.contractExpiry.status).toBe("unknown");
    expect(p.contractExpiry.verifiedAt).toBe("2026-09-26T00:00:00.000Z");
  });

  it("does not invent a contract expiry from a transfer date", () => {
    // careerNotes mention a move; contractExpiry must remain unknown.
    const p = parseResearchResponse(JSON.stringify(goodPayload({
      careerNotes: { value: "Bytte klubb 2018.", status: "verified", confidence: "high", sourceUrl: "https://e.com" },
    })), PLAYER, opts)!;
    expect(p.contractExpiry.value).toBeNull();
  });
});

describe("researchPlayer — quota exhaustion", () => {
  const key = "test-key";

  it("stops immediately on an exhausted-quota 429 instead of burning retries/models", async () => {
    const quotaBody = JSON.stringify({
      error: { code: 429, message: "You exceeded your current quota, please check your plan and billing details." },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(quotaBody, { status: 429 }),
    );
    process.env.GEMINI_RETRY_DELAY_MS = "0";
    delete process.env.GEMINI_MODEL;

    const r = await researchPlayer(PLAYER, key);

    // One call, not 3 retries x 4 models = 12.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.research).toBeNull();
    expect(r.calls).toBe(1);
    expect(r.error).toMatch(/exceeded your current quota/);
    fetchSpy.mockRestore();
    delete process.env.GEMINI_RETRY_DELAY_MS;
  });

  it("returns an error without calling the API when no key is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await researchPlayer(PLAYER, "");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.calls).toBe(0);
    expect(r.error).toMatch(/not set/);
    fetchSpy.mockRestore();
  });
});
