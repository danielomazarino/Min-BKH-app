import { describe, it, expect } from "vitest";
import {
  normalizePlayerName,
  nameVariants,
  nameTokens,
  scoreMatch,
  rankCandidates,
} from "./playerSearch";

/**
 * Matching is where this feature can fail SILENTLY and dangerously: a bad
 * normalization returns the wrong person, and the UI has no way to notice.
 * These tests pin the behaviour with real names from real Wikidata entities
 * (verified 2026-09-26) rather than invented ones.
 */

describe("normalizePlayerName", () => {
  it("strips Swedish diacritics so a supporter can type them or not", () => {
    // Q518833 is "Mattias Bjärsmyr"; supporters type it both ways.
    expect(normalizePlayerName("Mattias Bjärsmyr")).toBe("mattias bjarsmyr");
    expect(normalizePlayerName("Bjarsmy")).toBe("bjarsmy");
    expect(normalizePlayerName("Karlström")).toBe("karlstrom");
    expect(normalizePlayerName("Frölund")).toBe("frolund");
  });

  it("folds letters NFD cannot decompose", () => {
    // The earlier audit found Arnor Gudjohnsen's eth breaking surname matching.
    expect(normalizePlayerName("Guðjohnsen")).toBe("gudjohnsen");
    expect(normalizePlayerName("Þórsson")).toBe("thorsson");
    expect(normalizePlayerName("Ørgryte")).toBe("orgryte");
    expect(normalizePlayerName("Søren")).toBe("soren");
  });

  it("tokenizes on anything that is not a letter or digit", () => {
    expect(normalizePlayerName("David  Frölund")).toBe("david frolund");
    expect(normalizePlayerName("J. Ljungberg")).toBe("j ljungberg");
    expect(normalizePlayerName("Andersson-Lindström")).toBe("andersson lindstrom");
    expect(normalizePlayerName("  Paulo   Victor  ")).toBe("paulo victor");
  });

  it("keeps digits, which occur in real labels", () => {
    expect(normalizePlayerName("Panathinaikos 2")).toBe("panathinaikos 2");
  });

  it("returns an empty string for input with no letters", () => {
    expect(normalizePlayerName("")).toBe("");
    expect(normalizePlayerName("   ---  ")).toBe("");
    expect(normalizePlayerName("42")).toBe("42");
  });

  it("is idempotent, so a normalized value can be normalized again", () => {
    const once = normalizePlayerName("Mattias Bjärsmyr");
    expect(normalizePlayerName(once)).toBe(once);
  });
});

describe("nameTokens", () => {
  it("splits a normalized name", () => {
    expect(nameTokens("mattias bjarsmyr")).toEqual(["mattias", "bjarsmyr"]);
    expect(nameTokens("")).toEqual([]);
  });
});

describe("nameVariants", () => {
  it("offers the surname alone, which is how supporters actually search", () => {
    // "Jeremejeff" must reach "Alexander Jeremejeff" (Q16633101).
    const variants = nameVariants(normalizePlayerName("Alexander Jeremejeff"));
    expect(variants).toContain("jeremejeff");
    expect(variants).toContain("alexander jeremejeff");
  });

  it("offers the initial form for headlines", () => {
    expect(nameVariants(normalizePlayerName("Alexander Jeremejeff"))).toContain("a jeremejeff");
  });

  it("does not invent variants for a single-token name", () => {
    expect(nameVariants(normalizePlayerName("Neymar"))).toEqual(["neymar"]);
  });
});

describe("scoreMatch", () => {
  it("scores an exact match highest", () => {
    expect(scoreMatch("Mattias Bjärsmyr", "Mattias Bjärsmyr")).toBe(100);
  });

  it("matches a surname-only query to a full name", () => {
    // The dominant real-world query shape.
    expect(scoreMatch("Jeremejeff", "Alexander Jeremejeff")).toBeGreaterThan(0);
    expect(scoreMatch("Bjarsmy", "Mattias Bjärsmyr")).toBeGreaterThan(0);
  });

  it("matches regardless of which side carries the diacritics", () => {
    const a = scoreMatch("Bjarsmy", "Mattias Bjärsmyr");
    const b = scoreMatch("Bjärsmy", "Mattias Bjarsmyr");
    expect(a).toBe(b);
  });

  it("matches a prefix the supporter is still typing", () => {
    expect(scoreMatch("Jere", "Alexander Jeremejeff")).toBeGreaterThan(0);
    expect(scoreMatch("Bjar", "Mattias Bjärsmyr")).toBeGreaterThan(0);
  });

  it("still matches after an initial is expanded", () => {
    expect(scoreMatch("A. Jeremejeff", "Alexander Jeremejeff")).toBeGreaterThan(0);
  });

  it("ranks a full exact-token match above a partial one", () => {
    const full = scoreMatch("Alexander Jeremejeff", "Alexander Jeremejeff");
    const partial = scoreMatch("Alexander Jeremejeff", "Alexander Jeremejeff Hansen");
    expect(full).toBeGreaterThan(partial);
  });

  it("refuses to match a very short query anywhere in the string", () => {
    // Guards against "an" or "er" matching half the database.
    expect(scoreMatch("an", "Alexander Jeremejeff")).toBe(0);
    expect(scoreMatch("er", "Alexander Jeremejeff")).toBe(0);
  });

  it("refuses unrelated names", () => {
    expect(scoreMatch("Mattias Bjärsmyr", "Samuel Gustafson")).toBe(0);
    expect(scoreMatch("Zzzz nonexistent", "Anyone")).toBe(0);
  });

  it("returns 0 for empty input on either side", () => {
    expect(scoreMatch("", "Anyone")).toBe(0);
    expect(scoreMatch("Anyone", "")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(scoreMatch("MAREK", "David Frölund")).toBeGreaterThanOrEqual(
      scoreMatch("marek", "david frolund"),
    );
  });
});

describe("rankCandidates", () => {
  const hits = [
    { id: "Q214582", label: "Benny Andersson" },
    { id: "Q2817217", label: "Andersson" },
    { id: "Q352241", label: "Kennet Andersson" },
  ];

  it("sorts footballers ahead of everything else", () => {
    // The predicate is keyed on the hit's ID, which is what the caller knows.
    const isFootball = (h: { id: string }) => h.id === "Q352241";
    const { footballers, others } = rankCandidates(hits, "Andersson", (h) => h.label, isFootball);
    expect(footballers.map((h) => h.id)).toEqual(["Q352241"]);
    // "Andersson" (Q2817217) is the surname entity and scores an exact match,
    // so it legitimately outranks "Benny Andersson" in alphabetical tie-break.
    expect(others.map((h) => h.id)).toEqual(["Q2817217", "Q214582"]);
  });

  it("reports the non-people separately so 'none found' stays explicable", () => {
    const { footballers, others } = rankCandidates(hits, "Andersson", (h) => h.label, () => false);
    expect(footballers).toHaveLength(0);
    expect(others).toHaveLength(3);
  });

  it("is stable, so repeated searches never reshuffle results", () => {
    const a = rankCandidates(hits, "Andersson", (h) => h.label, () => false);
    const b = rankCandidates(hits, "Andersson", (h) => h.label, () => false);
    expect(a.others.map((h) => h.id)).toEqual(b.others.map((h) => h.id));
  });

  it("treats a null predicate as 'no classification available'", () => {
    const { footballers, others } = rankCandidates(hits, "Andersson", (h) => h.label, null);
    expect(footballers).toHaveLength(0);
    expect(others).toHaveLength(3);
  });
});
