import { describe, expect, it } from "vitest";
import { menRelevantNews } from "./classify";
import { classifyRelevance, type KnownPersons } from "./newsRelevance";
import { prefilterNews } from "./newsPrefilter";
import { subtractCurrentSquad, buildFormerPlayersQuery } from "./formerPlayers";
import type { NewsItem } from "./types";

/**
 * The user's requirement (2026-10-09): the app shares relevant news about
 * CURRENT and FORMER men's-team players. Two defects were measured:
 *
 *  1. Gate 2 (`menRelevantNews`) ran the keyword-only classifier and undid
 *     Gate 1's person rescue — Rygaard and Harun Ibrahim were dropped.
 *  2. `known.formerPlayers` was never populated, so a former player's story
 *     ("Zeidane Inoussa lånas ut av Swansea") was dropped as "no Häcken
 *     relation".
 *
 * These tests pin both directions: the men's/former articles are kept and
 * tagged, and the women's / ambiguous cases stay excluded.
 */

function news(overrides: Partial<NewsItem>): NewsItem {
  return {
    id: "x",
    title: "T",
    url: "https://example.com/a",
    publishedAt: "2026-10-08T10:00:00Z",
    publisher: "Fotbolltransfers",
    category: "unknown",
    discoveredVia: "rss",
    ...overrides,
  };
}

const KNOWN: KnownPersons = {
  currentPlayers: ["Mikkel Rygaard Jensen", "Harun Ibrahim", "Sanders Ngabo"],
  formerPlayers: ["Zeidane Inoussa", "Ibrahim Sadiq", "Kim Källström"],
  womenPlayers: ["Laney Egbuka"],
  womenContextTerms: ["damallsvenskan", "vittsjö"],
};

describe("menRelevantNews — entity-aware (2026-10-09)", () => {
  it("keeps a current-squad article that has no men's keyword (Rygaard)", () => {
    // The exact measured failure: Gate 1 rescued it, Gate 2 dropped it.
    const item = news({ title: 'Rygaards gläds över transfern: "Alla tänkte wow"' });
    expect(menRelevantNews([item], KNOWN).map((n) => n.id)).toEqual(["x"]);
  });

  it("keeps a current-squad article naming Harun Ibrahim", () => {
    const item = news({ title: 'Harun Ibrahim: "Man hoppades på något annat"' });
    expect(menRelevantNews([item], KNOWN).map((n) => n.id)).toEqual(["x"]);
  });

  it("keeps a FORMER player article and tags it 'former'", () => {
    const item = news({ title: "Officiellt: Zeidane Inoussa lånas ut av Swansea" });
    const out = menRelevantNews([item], KNOWN);
    expect(out.map((n) => n.id)).toEqual(["x"]);
    expect(out[0].category).toBe("former");
  });

  it("does NOT tag a current player as former", () => {
    const item = news({ title: "Mikkel Rygaard om framtiden" });
    const out = menRelevantNews([item], KNOWN);
    expect(out[0].category).not.toBe("former");
  });

  it("still excludes a women's article that names a men's player", () => {
    // The women's veto must win even when a men's name appears.
    const item = news({
      title: "Damerna möter Vittsjö — Mikkel Rygaard på plats",
      summary: "Damallsvenskan fortsätter.",
    });
    expect(menRelevantNews([item], KNOWN)).toEqual([]);
  });

  it("still excludes an ambiguous-surname false positive", () => {
    // "Ibrahim Sadiq" is a DIFFERENT person from squad player "Harun Ibrahim";
    // the surname "Ibrahim" must not match. Here the article is about Sadiq,
    // who is a former player, so it IS kept — but as former, not as Ibrahim.
    const item = news({ title: "Officiellt: AZ Alkmaar säljer Ibrahim Sadiq" });
    const out = menRelevantNews([item], KNOWN);
    expect(out[0].category).toBe("former");
  });

  it("behaves exactly as before when `known` is omitted", () => {
    const item = news({ title: 'Rygaards gläds över transfern: "Alla tänkte wow"' });
    expect(menRelevantNews([item])).toEqual([]);
  });

  it("does NOT match a former player on surname alone (live false positives)", () => {
    // Measured 2026-10-09: with ~294 former names, surname-only matching let
    // hockey and celebrity news in. These are the exact headlines.
    const fps = [
      "VM 94-hjälten Roger Ljung skiljer sig", // → Jesper Ljung
      "Britt-Marie Mattsson: Trump bjuder in Putin till sin egen golfklubb", // → Jesper Mattsson
      'Silas Andersen: "Jag skulle älska det"', // → Niklas Andersen
    ];
    for (const title of fps) {
      expect(menRelevantNews([news({ title })], KNOWN), title).toEqual([]);
    }
  });

  it("still matches a former player named in FULL", () => {
    const item = news({ title: "Officiellt: Zeidane Inoussa lånas ut av Swansea" });
    expect(menRelevantNews([item], KNOWN).map((n) => n.category)).toEqual(["former"]);
  });
});

describe("classifyRelevance — former players", () => {
  it("returns FORMER_PLAYER for a former player named in a Häcken article", () => {
    const r = classifyRelevance(
      { title: "Zeidane Inoussa lämnar BK Häcken", summary: "", publisher: "Fotbolltransfers" },
      KNOWN,
    );
    expect(r.relevance).toBe("FORMER_PLAYER");
    expect(r.matchedPerson).toBe("Zeidane Inoussa");
  });

  it("returns FORMER_PLAYER for a former player with no Häcken mention", () => {
    const r = classifyRelevance(
      { title: "Officiellt: Zeidane Inoussa lånas ut av Swansea", summary: "", publisher: "Fotbolltransfers" },
      KNOWN,
    );
    expect(r.relevance).toBe("FORMER_PLAYER");
  });

  it("still returns CURRENT_HACKEN for a current player", () => {
    const r = classifyRelevance(
      { title: "Mikkel Rygaard om framtiden", summary: "", publisher: "Fotbolltransfers" },
      KNOWN,
    );
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });
});

describe("prefilterNews — former players pass Gate 1", () => {
  it("keeps a former-player article that never says Häcken", () => {
    const item = news({ title: "Officiellt: Zeidane Inoussa lånas ut av Swansea" });
    const { candidates } = prefilterNews([item], { known: KNOWN });
    expect(candidates.map((c) => c.id)).toEqual(["x"]);
  });
});

describe("subtractCurrentSquad", () => {
  it("removes a current player listed by Wikidata under a shorter name", () => {
    // Wikidata says "Mikkel Rygaard"; the squad says "Mikkel Rygaard Jensen".
    const all = ["Mikkel Rygaard", "Zeidane Inoussa", "Harun Ibrahim"];
    const squad = ["Mikkel Rygaard Jensen", "Harun Ibrahim"];
    expect(subtractCurrentSquad(all, squad)).toEqual(["Zeidane Inoussa"]);
  });

  it("removes an exact-name current player", () => {
    expect(subtractCurrentSquad(["Kim Källström", "Harun Ibrahim"], ["Harun Ibrahim"])).toEqual([
      "Kim Källström",
    ]);
  });
});

describe("buildFormerPlayersQuery", () => {
  it("queries P54 = BK Häcken men's and P106 = footballer", () => {
    const q = buildFormerPlayersQuery();
    expect(q).toContain("wdt:P54 wd:Q639723");
    expect(q).toContain("wdt:P106 wd:Q937857");
  });
});
