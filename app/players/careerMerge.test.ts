import { describe, it, expect } from "vitest";
import { clubKey, startYearOf, mergeCareerStints } from "./careerMerge";
import type { CareerStint } from "./wikidata";
import type { InfoboxStint } from "./infobox";

/**
 * The failure this module exists to prevent is SILENT: picking one source
 * drops real clubs. Every fixture below is a real player the user named.
 */

describe("clubKey", () => {
  it("collapses the club-type prefix so two spellings match", () => {
    expect(clubKey("BK Häcken")).toBe(clubKey("Häcken"));
    expect(clubKey("IF Elfsborg")).toBe(clubKey("Elfsborg"));
    expect(clubKey("Kvik Halden FK")).toBe(clubKey("Kvik Halden"));
    expect(clubKey("FC Basel")).toBe(clubKey("Basel"));
  });

  it("does not mangle IFK into K", () => {
    expect(clubKey("IFK Göteborg")).toBe(clubKey("Göteborg"));
    expect(clubKey("IFK Göteborg")).not.toBe(clubKey("K Göteborg"));
  });

  it("keeps genuinely different clubs apart", () => {
    expect(clubKey("BK Häcken")).not.toBe(clubKey("Kalmar FF"));
  });

  it("falls back to the plain name when stripping would empty it", () => {
    expect(clubKey("IF")).toBe("if");
  });
});

describe("startYearOf", () => {
  it("reads the first year", () => {
    expect(startYearOf("2025–")).toBe(2025);
    expect(startYearOf("2014–2016")).toBe(2014);
  });
  it("returns -1 for an unqualified stint so it sorts last", () => {
    expect(startYearOf("????–????")).toBe(-1);
    expect(startYearOf("")).toBe(-1);
  });
});

describe("mergeCareerStints", () => {
  it("keeps the infobox's qualified Häcken row AND Wikidata's extra clubs (Berisha)", () => {
    // Wikidata: 10 stints, Häcken unqualified. Infobox: 9, Häcken 2025–.
    const wd: CareerStint[] = [
      { team: "Empoli FC", teamQid: "Q1", startYear: "2023" },
      { team: "Torino FC", teamQid: "Q2", startYear: "2022", endYear: "2023" },
      { team: "BK Häcken", teamQid: "Q3" }, // no years — the reported bug
    ];
    const ib: InfoboxStint[] = [
      { years: "2023–2024", team: "Empoli", loan: false },
      { years: "2021–2023", team: "Torino", loan: false },
      { years: "2025–", team: "BK Häcken", loan: false },
    ];
    const { stints, usedInfobox } = mergeCareerStints(wd, ib);
    expect(usedInfobox).toBe(true);
    // Häcken appears ONCE, with the infobox's years.
    const hacken = stints.filter((s) => clubKey(s.team) === clubKey("Häcken"));
    expect(hacken).toHaveLength(1);
    expect(hacken[0].years).toBe("2025–");
    // Newest first.
    expect(stints[0].years).toBe("2025–");
  });

  it("appends a Wikidata club the infobox never mentions", () => {
    const wd: CareerStint[] = [
      { team: "BK Häcken", teamQid: "Q3", startYear: "2025" },
      { team: "Nyköpings BIS", teamQid: "Q9", startYear: "2010", endYear: "2010" },
    ];
    const ib: InfoboxStint[] = [{ years: "2025–", team: "Häcken", loan: false }];
    const { stints } = mergeCareerStints(wd, ib);
    expect(stints.map((s) => s.team)).toContain("Nyköpings BIS");
    expect(stints).toHaveLength(2);
  });

  it("sorts unqualified stints last, never first", () => {
    const wd: CareerStint[] = [
      { team: "BK Häcken", teamQid: "Q3" }, // unqualified
      { team: "Kalmar FF", teamQid: "Q4", startYear: "2010", endYear: "2013" },
    ];
    const { stints } = mergeCareerStints(wd, []);
    expect(stints[0].team).toBe("Kalmar FF");
    expect(stints[1].team).toBe("BK Häcken");
  });

  it("reports usedInfobox=false when the infobox contributed nothing", () => {
    const wd: CareerStint[] = [{ team: "BK Häcken", teamQid: "Q3", startYear: "2025" }];
    const { usedInfobox } = mergeCareerStints(wd, []);
    expect(usedInfobox).toBe(false);
  });

  it("carries apps and goals from the infobox row that wins", () => {
    const wd: CareerStint[] = [{ team: "BK Häcken", teamQid: "Q3" }];
    const ib: InfoboxStint[] = [{ years: "2025–", team: "Häcken", loan: false, apps: 12, goals: 3 }];
    const { stints } = mergeCareerStints(wd, ib);
    expect(stints[0].apps).toBe(12);
    expect(stints[0].goals).toBe(3);
  });

  it("collapses 'Atalanta BC' and 'Atalanta' to one row (measured on Berisha)", () => {
    // Wikidata writes "Atalanta BC", the infobox "Atalanta". Without the "bc"
    // prefix strip these were two rows for the same club.
    const wd: CareerStint[] = [{ team: "Atalanta BC", teamQid: "Q1", startYear: "2017", endYear: "2020" }];
    const ib: InfoboxStint[] = [{ years: "2017–2020", team: "Atalanta", loan: false }];
    const { stints } = mergeCareerStints(wd, ib);
    expect(stints).toHaveLength(1);
    expect(stints[0].team).toBe("Atalanta");
  });

  it("collapses 'Albaniens herrlandslag i fotboll' and 'Albanien' to one row", () => {
    const wd = [{ team: "Albaniens herrlandslag i fotboll", teamQid: "Q1", startYear: "2012" }];
    const ib: InfoboxStint[] = [{ years: "2012–", team: "Albanien", loan: false }];
    const { stints } = mergeCareerStints(wd, ib);
    expect(stints).toHaveLength(1);
  });

  it("keeps two genuinely different spells at the same club", () => {
    const wd: CareerStint[] = [];
    const ib: InfoboxStint[] = [
      { years: "2019–2020", team: "SPAL", loan: true },
      { years: "2020–2021", team: "SPAL", loan: false },
    ];
    const { stints } = mergeCareerStints(wd, ib);
    expect(stints).toHaveLength(2);
  });

  it("dedupes identical rows within a single source", () => {
    const wd: CareerStint[] = [
      { team: "BK Häcken", teamQid: "Q3", startYear: "2025" },
      { team: "BK Häcken", teamQid: "Q3", startYear: "2025" },
    ];
    const { stints } = mergeCareerStints(wd, []);
    expect(stints).toHaveLength(1);
  });
});
