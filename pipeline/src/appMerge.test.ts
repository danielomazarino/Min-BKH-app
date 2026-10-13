import { describe, expect, it } from "vitest";
import { mergeSquadEnrichment, enrichmentQuality, mergeAppData } from "./appMerge";
import type { SquadEnrichment } from "./squadEnrichment";
import type { AppData } from "./types";

/**
 * The regression this suite pins (measured 2026-10-12): the nightly's squad
 * enrichment degraded silently because Wikimedia 429'd User-Agent-less
 * requests, the fetch wrappers swallowed the 429 into null, and the old
 * `{ ...prev, ...next }` merge let the DEGRADED result overwrite the GOOD
 * one. Rygaard flapped 11 career rows -> 2 -> 11 -> 2 across four runs;
 * Wembangomo went 7 rows + wiki -> 1 row, no wiki.
 */
function enrichment(overrides: Partial<SquadEnrichment> = {}): SquadEnrichment {
  return {
    playerId: "fogis:1",
    queryName: "Test Player",
    qid: "Q1",
    name: "Test Player",
    citizenship: ["Sverige"],
    pageUrl: "https://www.wikidata.org/wiki/Special:EntityPage/Q1",
    career: [],
    nationalTeams: [],
    usedInfobox: false,
    candidate: {
      qid: "Q1",
      name: "Test Player",
      alsoKnownAs: [],
      citizenship: [],
      clubs: [],
      career: [],
      nationalTeams: [],
      sitelinks: {},
      hackenClub: false,
      hackenTeam: null,
      pageUrl: "https://www.wikidata.org/wiki/Special:EntityPage/Q1",
      matchScore: 1,
    },
    ...overrides,
  };
}

describe("enrichmentQuality", () => {
  it("scores career rows, wiki presence and national teams", () => {
    const e = enrichment({ career: [{ team: "A", years: "2020", loan: false }, { team: "B", years: "2021", loan: false }], wiki: { lang: "sv", extract: "x", pageUrl: "u" }, nationalTeams: [{ team: "Sverige", years: "2019", loan: false }] });
    expect(enrichmentQuality(e)).toBe(4);
  });

  it("scores an empty stub at 0", () => {
    expect(enrichmentQuality(enrichment())).toBe(0);
  });

  it("scores a missing entry at -1 so a real result always beats absence", () => {
    expect(enrichmentQuality(undefined)).toBe(-1);
  });
});

describe("mergeSquadEnrichment", () => {
  const good = enrichment({
    career: [
      { team: "BK Häcken", years: "2022–", loan: false, apps: 117, goals: 26 },
      { team: "ŁKS Łódź", years: "2021", loan: false, apps: 29, goals: 2 },
      { team: "Nordsjælland", years: "2018–2020", loan: false, apps: 86, goals: 12 },
    ],
    wiki: { lang: "sv", extract: "Mikkel Rygaard Jensen…", pageUrl: "u" },
    usedInfobox: true,
  });
  const degraded = enrichment({ career: [{ team: "BK Häcken", years: "????–????", loan: false }], usedInfobox: false });

  it("a degraded next result does NOT overwrite a richer previous one", () => {
    const { merged, keptPrev } = mergeSquadEnrichment({ "fogis:1": good }, { "fogis:1": degraded });
    expect(merged["fogis:1"].career).toHaveLength(3);
    expect(merged["fogis:1"].wiki).toBeDefined();
    expect(keptPrev).toBe(1);
  });

  it("a richer next result DOES replace the previous one (fresh data flows)", () => {
    const better = enrichment({ career: [{ team: "A", years: "1", loan: false }, { team: "B", years: "2", loan: false }, { team: "C", years: "3", loan: false }, { team: "D", years: "4", loan: false }] });
    const { merged, keptPrev } = mergeSquadEnrichment({ "fogis:1": good }, { "fogis:1": better });
    expect(merged["fogis:1"].career).toHaveLength(4);
    expect(keptPrev).toBe(0);
  });

  it("an equal-score next result wins (upstream corrections still flow)", () => {
    const corrected = enrichment({
      career: [
        { team: "BK Häcken", years: "2022–", loan: false },
        { team: "ŁKS Łódź", years: "2021", loan: false },
        { team: "Nordsjælland", years: "2018–2020", loan: false },
      ],
      wiki: { lang: "sv", extract: "uppdaterad", pageUrl: "u" },
    });
    const { merged } = mergeSquadEnrichment({ "fogis:1": good }, { "fogis:1": corrected });
    expect(merged["fogis:1"].wiki?.extract).toBe("uppdaterad");
  });

  it("a NEW player in next is added even when other players were kept", () => {
    const { merged } = mergeSquadEnrichment({ "fogis:1": good }, { "fogis:2": degraded });
    expect(merged["fogis:1"].career).toHaveLength(3);
    expect(merged["fogis:2"].career).toHaveLength(1);
  });

  it("an empty next map keeps the whole previous map", () => {
    const { merged, keptPrev } = mergeSquadEnrichment({ "fogis:1": good }, {});
    expect(Object.keys(merged)).toEqual(["fogis:1"]);
    expect(keptPrev).toBe(1);
  });

  it("a missing previous map just takes next", () => {
    const { merged } = mergeSquadEnrichment(undefined, { "fogis:1": degraded });
    expect(merged["fogis:1"].career).toHaveLength(1);
  });

  it("a missing next map keeps the whole previous map", () => {
    const { merged } = mergeSquadEnrichment({ "fogis:1": good }, undefined);
    expect(Object.keys(merged)).toEqual(["fogis:1"]);
  });
});

describe("mergeAppData", () => {
  const base = (): AppData =>
    ({
      freshness: { generatedAt: "2026-10-12T04:00:00Z", sourceStatus: {} },
      news: [],
      newsEvents: [],
      upcoming: [],
      recent: [],
      table: [],
      discipline: [],
      cardMatchesInspected: 0,
    }) as unknown as AppData;

  it("routes squadEnrichment through the quality guard", () => {
    const prev = base();
    prev.squadEnrichment = { "fogis:1": enrichment({ career: [{ team: "A", years: "1", loan: false }, { team: "B", years: "2", loan: false }], wiki: { lang: "sv", extract: "x", pageUrl: "u" } }) };
    const next = base();
    next.squadEnrichment = { "fogis:1": enrichment({ career: [{ team: "A", years: "????", loan: false }] }) };
    const merged = mergeAppData(prev, next);
    expect(merged.squadEnrichment!["fogis:1"].career).toHaveLength(2);
    // freshness still comes from next — the run timestamp must advance.
    expect(merged.freshness.generatedAt).toBe("2026-10-12T04:00:00Z");
  });

  it("empty next fields fall back to previous (unchanged behaviour)", () => {
    const prev = base();
    prev.table = [{ position: 1, team: "BK Häcken", played: 10, points: 20 }] as never;
    const merged = mergeAppData(prev, base());
    expect(merged.table).toHaveLength(1);
  });

  // B-020 (2026-10-13): the unavailability flag must describe the CURRENT run.
  it("clears a stale unavailability flag when the new run has football data", () => {
    const prev = base();
    prev.currentDataUnavailable = {
      reason: "Fixtures ej tillgängliga: INTERNAL_SERVER_ERROR",
      checkedAt: "2026-10-11T03:50:32.080Z",
    };
    const next = base();
    next.nextMatch = { id: 1, date: "2026-10-18", homeTeam: "Malmö FF", awayTeam: "Häcken" } as never;
    const merged = mergeAppData(prev, next);
    expect(merged.currentDataUnavailable).toBeUndefined();
  });

  it("keeps the flag when the new run itself failed (no football data)", () => {
    const prev = base();
    prev.currentDataUnavailable = {
      reason: "Fixtures ej tillgängliga: INTERNAL_SERVER_ERROR",
      checkedAt: "2026-10-11T03:50:32.080Z",
    };
    const merged = mergeAppData(prev, base());
    expect(merged.currentDataUnavailable?.checkedAt).toBe("2026-10-11T03:50:32.080Z");
  });

  it("carries a fresh flag from a run that itself failed", () => {
    const next = base();
    next.currentDataUnavailable = {
      reason: "Fixtures ej tillgängliga: timeout",
      checkedAt: "2026-10-13T03:50:00.000Z",
    };
    const merged = mergeAppData(base(), next);
    expect(merged.currentDataUnavailable?.reason).toBe("Fixtures ej tillgängliga: timeout");
  });
});
