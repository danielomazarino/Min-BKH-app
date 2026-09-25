import { describe, expect, it } from "vitest";
import {
  canonicalIdFromFogis,
  canonicalIdFromName,
  matchesSquadPlayer,
  nameKeyOf,
  resolveCanonicalId,
} from "./playerIdentity";

describe("nameKeyOf", () => {
  it("normalizes case, whitespace and diacritics", () => {
    expect(nameKeyOf("  Bjärsmy  ")).toBe(nameKeyOf("bjarsmy"));
    expect(nameKeyOf("Bjärsmy")).toBe("bjarsmy");
    expect(nameKeyOf("Émile")).toBe("emile");
  });
});

describe("canonicalIdFromFogis / canonicalIdFromName", () => {
  it("prefixes fogis ids", () => {
    expect(canonicalIdFromFogis(540307)).toBe("fogis:540307");
  });

  it("normalizes names into stable ids", () => {
    expect(canonicalIdFromName("Filip Helander")).toBe("name:filip helander");
    expect(canonicalIdFromName("filip  helander")).toBe("name:filip helander");
  });
});

describe("resolveCanonicalId", () => {
  it("fogis id wins over name", () => {
    expect(resolveCanonicalId({ fogisId: 42, name: "Someone" })).toBe("fogis:42");
  });

  it("falls back to name when no fogis id", () => {
    expect(resolveCanonicalId({ name: "Filip Helander" })).toBe("name:filip helander");
  });

  it("falls back to name when fogis id is null", () => {
    expect(resolveCanonicalId({ fogisId: null, name: "X" })).toBe("name:x");
  });
});

describe("matchesSquadPlayer", () => {
  it("matches normalized full-name equality", () => {
    expect(matchesSquadPlayer("Filip Helander", "filip helander")).toBe(true);
    expect(matchesSquadPlayer("Bjärsmy", "Bjarsmy")).toBe(true);
  });

  it("matches first+last token form", () => {
    expect(matchesSquadPlayer("Filip Helander Eriksen", "Filip Helander")).toBe(true);
  });

  it("rejects different players", () => {
    expect(matchesSquadPlayer("Anna Larsson", "Anna Karlsson")).toBe(false);
    expect(matchesSquadPlayer("Larsson", "Anna Larsson")).toBe(false);
  });
});