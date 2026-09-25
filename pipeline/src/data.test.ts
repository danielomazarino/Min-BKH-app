import { describe, expect, it } from "vitest";
import { buildContractInfo, contractExpiryPhrase, contractVerificationStatus, type ContractClaimInput } from "./contract";
import { isStale, formatLastUpdated, readLastKnownGood, writeProtected } from "./stale";
import { loadFavorites, saveFavorites, toggleFavorite } from "../../app/data";
import { normalizeFixture, pickNextAndLast } from "./normalize";
import type { FixtureResponse } from "./apifootball";

describe("contract verification", () => {
  const base: ContractClaimInput = {
    claim: "Kontraktet löper till december 2026",
    sourceName: "Fotbolltransfers",
    sourceUrl: "https://fotbolltransfers.com/spelare/x",
    retrievedAt: "2026-09-24T10:00:00Z",
    discoveredVia: "firecrawl",
    evidenceType: "reported_media",
  };

  it("primary official source → confirmed", () => {
    expect(contractVerificationStatus("primary_official")).toBe("confirmed");
  });

  it("media report → reported, never confirmed", () => {
    expect(contractVerificationStatus("reported_media")).toBe("reported");
  });

  it("rumour/database → unverified", () => {
    expect(contractVerificationStatus("rumour")).toBe("unverified");
    expect(contractVerificationStatus("database_only")).toBe("unverified");
  });

  it("buildContractInfo keeps provenance", () => {
    const info = buildContractInfo(base);
    expect(info?.sourceName).toBe("Fotbolltransfers");
    expect(info?.discoveredVia).toBe("firecrawl");
    expect(info?.verificationStatus).toBe("reported");
  });

  it("phrasing: reported date is never presented as confirmed", () => {
    expect(contractExpiryPhrase("december 2026", "reported")).toMatch(/rapporteras/);
    expect(contractExpiryPhrase("december 2026", "confirmed")).toMatch(/löper till/);
    expect(contractExpiryPhrase(undefined, "unknown")).toMatch(/Ingen verifierad/);
    expect(contractExpiryPhrase("december 2026", "unverified")).toMatch(/Ingen verifierad/);
  });
});

describe("stale-data logic", () => {
  it("data older than 36h is stale", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(isStale("2026-09-23T18:00:00Z", now)).toBe(false);
    expect(isStale("2026-09-22T18:00:00Z", now)).toBe(true);
    expect(isStale("not-a-date", now)).toBe(true);
  });

  it("formats Swedish last-updated string", () => {
    const s = formatLastUpdated("2026-09-23T18:42:00Z");
    expect(s).toMatch(/Senast uppdaterad/);
  });

  it("writeProtected refuses to overwrite with empty data", () => {
    const writes: string[] = [];
    const ok = writeProtected("/tmp/x.json", { items: [] } as never, (d) => (d as { items: unknown[] }).items.length === 0);
    expect(ok).toBe(false);
    void writes;
  });

  it("readLastKnownGood returns null for missing/invalid files", () => {
    expect(readLastKnownGood("/tmp/definitely-missing-minbkh.json")).toBeNull();
  });
});

describe("favorite persistence", () => {
  it("toggles favorites and persists to localStorage", () => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });

    expect(loadFavorites()).toEqual([]);
    let favs = toggleFavorite("p1");
    expect(favs).toEqual(["p1"]);
    expect(saveFavorites).toBeDefined();
    favs = toggleFavorite("p1");
    expect(favs).toEqual([]);
    toggleFavorite("p2");
    expect(loadFavorites()).toEqual(["p2"]);
  });
});

describe("fixture normalization", () => {
  const fixture = (over: Partial<FixtureResponse>): FixtureResponse =>
    ({
      fixture: { id: 1, date: "2026-09-20T14:00:00Z", status: { short: "FT", long: "Full Time" } },
      league: { id: 113, name: "Allsvenskan", season: 2026 },
      teams: { home: { id: 367, name: "BK Häcken" }, away: { id: 400, name: "Kalmar FF" } },
      goals: { home: 5, away: 0 },
      ...over,
    }) as FixtureResponse;

  it("normalizes a finished home fixture", () => {
    const m = normalizeFixture(fixture({}));
    expect(m.homeAway).toBe("home");
    expect(m.opponent).toBe("Kalmar FF");
    expect(m.status).toBe("finished");
    expect(m.scoreHome).toBe(5);
    expect(m.competition).toBe("allsvenskan");
  });

  it("normalizes an away scheduled fixture", () => {
    const m = normalizeFixture(fixture({ teams: { home: { id: 400, name: "AIK" }, away: { id: 367, name: "BK Häcken" } }, fixture: { id: 2, date: "2026-10-04T15:00:00Z", status: { short: "NS", long: "Not Started" } } }));
    expect(m.homeAway).toBe("away");
    expect(m.opponent).toBe("AIK");
    expect(m.status).toBe("scheduled");
  });

  it("picks next upcoming and last finished", () => {
    const { next, last } = pickNextAndLast([
      normalizeFixture(fixture({ fixture: { id: 3, date: "2026-10-04T15:00:00Z", status: { short: "NS", long: "Not Started" } } })),
      normalizeFixture(fixture({})),
    ]);
    expect(next?.id).toBe(3);
    expect(last?.id).toBe(1);
  });
});
