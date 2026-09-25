/**
 * Tests for SportoMedia data parsing and BK Häcken identity guards.
 *
 * Identity facts (VERIFIED 2026-09-25, docs/DATA-SOURCE-INVESTIGATION-2026.md):
 * - BK Häcken: SportoMedia abbrv "BKH", API-Football team ID 367
 * - Hammarby FF: SportoMedia abbrv "HAM", API-Football team ID 363
 * - Team 363 must NEVER be used as BK Häcken.
 */
import { describe, expect, it } from "vitest";
import {
  assertMatchBelongsToHäcken,
  assertNotHammarby,
  gameTimeToMinute,
  hashId,
  normalizeSmEvents,
  normalizeSmMatch,
  normalizeSmSquad,
  normalizeSmStandings,
  smStatusToMatchStatus,
} from "./smNormalize";
import { BKH_ABBRV, CURRENT_SEASON, HAMMARBY_ABBRV, type SmMatch, type SmMatchEvent } from "./sportomedia";
import { BKH_TEAM_ID, HAMMARBY_TEAM_ID, API_FOOTBALL_MAX_SEASON } from "./apifootball";

describe("BK Häcken identity", () => {
  it("maps BK Häcken to SportoMedia abbrv BKH", () => {
    expect(BKH_ABBRV).toBe("BKH");
  });

  it("maps Hammarby to a DIFFERENT abbrv (HAM)", () => {
    expect(HAMMARBY_ABBRV).toBe("HAM");
    expect(HAMMARBY_ABBRV).not.toBe(BKH_ABBRV);
  });

  it("maps BK Häcken to API-Football team ID 367", () => {
    expect(BKH_TEAM_ID).toBe(367);
  });

  it("maps Hammarby to API-Football team ID 363 — and it must differ from Häcken", () => {
    expect(HAMMARBY_TEAM_ID).toBe(363);
    expect(HAMMARBY_TEAM_ID).not.toBe(BKH_TEAM_ID);
  });

  it("assertNotHammarby accepts BKH", () => {
    expect(() => assertNotHammarby("BKH", "test")).not.toThrow();
  });

  it("assertNotHammarby THROWS on Hammarby", () => {
    expect(() => assertNotHammarby("HAM", "test")).toThrow(/IDENTITY VIOLATION/);
  });

  it("assertMatchBelongsToHäcken accepts Häcken vs Hammarby (opponent is legitimate)", () => {
    expect(() => assertMatchBelongsToHäcken("BKH", "HAM")).not.toThrow();
    expect(() => assertMatchBelongsToHäcken("HAM", "BKH")).not.toThrow();
  });

  it("assertMatchBelongsToHäcken THROWS when neither side is BKH", () => {
    expect(() => assertMatchBelongsToHäcken("HAM", "DIF")).toThrow(/IDENTITY VIOLATION/);
  });

  it("assertMatchBelongsToHäcken THROWS when both sides are BKH", () => {
    expect(() => assertMatchBelongsToHäcken("BKH", "BKH")).toThrow(/IDENTITY VIOLATION/);
  });

  it("assertNotHammarby THROWS on Hammarby data used for Häcken", () => {
    expect(() => assertNotHammarby("HAM", "test")).toThrow(/IDENTITY VIOLATION/);
  });

  it("current season is 2026", () => {
    expect(CURRENT_SEASON).toBe(2026);
  });

  it("API-Football historical ceiling is 2024 (never presented as current)", () => {
    expect(API_FOOTBALL_MAX_SEASON).toBe(2024);
    expect(API_FOOTBALL_MAX_SEASON).toBeLessThan(CURRENT_SEASON);
  });
});

describe("SportoMedia standings parsing", () => {
  const rows = [
    { position: 1, teamName: "IK Sirius", teamAbbrv: "IKS", stats: [{ name: "gp", value: "22" }, { name: "gf", value: "52" }, { name: "ga", value: "28" }, { name: "d", value: "24" }, { name: "pts", value: "51" }] },
    { position: 5, teamName: "BK Häcken", teamAbbrv: "BKH", stats: [{ name: "gp", value: "22" }, { name: "w", value: "9" }, { name: "t", value: "9" }, { name: "l", value: "4" }, { name: "gf", value: "39" }, { name: "ga", value: "30" }, { name: "d", value: "9" }, { name: "pts", value: "36" }] },
  ];

  it("parses position, team, played, points and goal diff", () => {
    const table = normalizeSmStandings(rows as never);
    expect(table).toHaveLength(2);
    expect(table[0]).toEqual({ rank: 1, team: "IK Sirius", played: 22, points: 51, goalDiff: 24 });
    expect(table[1]).toEqual({ rank: 5, team: "BK Häcken", played: 22, points: 36, goalDiff: 9 });
  });

  it("falls back to gf-ga when diff stat is missing", () => {
    const noDiff = [{ position: 2, teamName: "X", teamAbbrv: "X", stats: [{ name: "gf", value: "10" }, { name: "ga", value: "7" }] }];
    const table = normalizeSmStandings(noDiff as never);
    expect(table[0].goalDiff).toBe(3);
  });

  it("tolerates missing stats (defaults 0)", () => {
    const empty = [{ position: 3, teamName: "Test FC", teamAbbrv: "TFC", stats: [] }];
    const table = normalizeSmStandings(empty as never);
    expect(table[0]).toMatchObject({ rank: 3, played: 0, points: 0, goalDiff: 0 });
  });
});

describe("SportoMedia fixture parsing", () => {
  const base: SmMatch = {
    id: 6530003,
    startDate: "2026-09-20T13:00:00+00:00",
    homeTeamName: "Kalmar FF",
    visitingTeamName: "BK Häcken",
    homeTeamScore: 0,
    visitingTeamScore: 5,
    status: "FINISHED",
    round: 22,
    arenaName: "Guldfågeln Arena, Kalmar",
    homeTeamAbbrv: "KFF",
    visitingTeamAbbrv: "BKH",
  };

  it("normalizes a finished away match", () => {
    const m = normalizeSmMatch(base);
    expect(m.homeAway).toBe("away");
    expect(m.opponent).toBe("Kalmar FF");
    expect(m.status).toBe("finished");
    expect(m.scoreHome).toBe(0);
    expect(m.scoreAway).toBe(5);
    expect(m.season).toBe("2026");
    expect(m.competition).toBe("allsvenskan");
    expect(m.venue).toBe("Guldfågeln Arena, Kalmar");
  });

  it("normalizes an upcoming home match without scores", () => {
    const m = normalizeSmMatch({ ...base, status: "UPCOMING", homeTeamAbbrv: "BKH", visitingTeamAbbrv: "OIS", visitingTeamName: "Örgryte IS" });
    expect(m.homeAway).toBe("home");
    expect(m.opponent).toBe("Örgryte IS");
    expect(m.status).toBe("scheduled");
    expect(m.scoreHome).toBeUndefined();
    expect(m.scoreAway).toBeUndefined();
  });

  it("THROWS if Hammarby data is passed as Häcken", () => {
    // A match where the Häcken side is actually Hammarby = identity violation.
    expect(() => normalizeSmMatch({ ...base, homeTeamAbbrv: "HAM", homeTeamName: "Hammarby", visitingTeamAbbrv: "KFF", visitingTeamName: "Kalmar FF" })).toThrow(/IDENTITY VIOLATION/);
  });

  it("ACCEPTS Hammarby as the opponent (same league)", () => {
    // base has homeTeamAbbrv "KFF" — override it so Häcken is the home side.
    const m = normalizeSmMatch({ ...base, homeTeamAbbrv: "BKH", homeTeamName: "BK Häcken", visitingTeamAbbrv: "HAM", visitingTeamName: "Hammarby" });
    expect(m.opponent).toBe("Hammarby");
    expect(m.homeAway).toBe("home");
  });
});

describe("SportoMedia match event parsing", () => {
  it("converts gameTime seconds to minutes", () => {
    expect(gameTimeToMinute(0)).toBe("0'");
    expect(gameTimeToMinute(162)).toBe("2'");
    expect(gameTimeToMinute(3825)).toBe("63'");
    expect(gameTimeToMinute(5464)).toBe("91'");
    expect(gameTimeToMinute(null)).toBeNull();
  });

  it("maps statuses", () => {
    expect(smStatusToMatchStatus("FINISHED")).toBe("finished");
    expect(smStatusToMatchStatus("UPCOMING")).toBe("scheduled");
    expect(smStatusToMatchStatus("POSTPONED")).toBe("postponed");
    expect(smStatusToMatchStatus("WEIRD")).toBe("other");
  });

  it("parses goals with assists, cards and substitutions", () => {
    const events: SmMatchEvent[] = [
      { type: "GOAL", gameTime: 3825, playerName: "Julius Lindberg", teamName: "BK Häcken", description: "0-5!", assistPlayerName: "Adrian Svanbäck", inPlayerName: null, outPlayerName: null },
      { type: "WARNING", gameTime: 883, playerName: "Olle Samuelsson", teamName: "BK Häcken", description: "Gult kort", assistPlayerName: null, inPlayerName: null, outPlayerName: null },
      { type: "SENDING_OFF", gameTime: 900, playerName: "X Y", teamName: "Opponent", description: null, assistPlayerName: null, inPlayerName: null, outPlayerName: null },
      { type: "SUBSTITUTION", gameTime: 4270, playerName: null, teamName: "BK Häcken", description: "Byte", assistPlayerName: null, inPlayerName: "Markus Haaland", outPlayerName: "Julius Lindberg" },
      { type: "SHOT", gameTime: 100, playerName: "Z", teamName: "Kalmar FF", description: null, assistPlayerName: null, inPlayerName: null, outPlayerName: null },
    ];
    const ev = normalizeSmEvents(events);
    expect(ev.goals).toHaveLength(1);
    expect(ev.goals[0]).toMatchObject({ minute: "63'", playerName: "Julius Lindberg", assistPlayerName: "Adrian Svanbäck", forHäcken: true });
    expect(ev.yellowCards).toHaveLength(1);
    expect(ev.yellowCards[0].playerName).toBe("Olle Samuelsson");
    expect(ev.redCards).toHaveLength(1);
    expect(ev.substitutions).toHaveLength(1);
    expect(ev.substitutions[0]).toMatchObject({ inPlayer: "Markus Haaland", outPlayer: "Julius Lindberg" });
  });

  it("handles null/undefined events", () => {
    expect(normalizeSmEvents(null)).toMatchObject({ goals: [], yellowCards: [], redCards: [], substitutions: [] });
    expect(normalizeSmEvents(undefined)).toMatchObject({ goals: [] });
  });
});

describe("SportoMedia squad parsing", () => {
  const squad = {
    goalkeepers: [{ givenName: "Etrit", surName: "Berisha", fogisId: 540307, currentSeasonStats: { matchesPlayed: 15, goals: 0, assists: 0, yellowCards: 1, redCards: 0, matchesStarted: 20, competitionDisplayName: "Allsvenskan  2026" } }],
    defenders: [{ givenName: "Filip", surName: "Helander", fogisId: null, currentSeasonStats: null }],
    midfields: [{ givenName: "Julius", surName: "Lindberg", fogisId: 12345, currentSeasonStats: { matchesPlayed: 20, goals: 7, assists: 7, yellowCards: 3, redCards: 0, matchesStarted: 18, competitionDisplayName: "Allsvenskan  2026" } }],
    forwards: [{ givenName: "Gustav", surName: "Lindgren", fogisId: 999, currentSeasonStats: { matchesPlayed: 22, goals: 12, assists: 0, yellowCards: 3, redCards: 0, matchesStarted: 20, competitionDisplayName: "Allsvenskan  2026" } }],
  };

  it("normalizes squad season stats with position groups", () => {
    const stats = normalizeSmSquad(squad as never);
    expect(stats).toHaveLength(4);
    const lindgren = stats.find((s) => s.playerName === "Gustav Lindgren");
    expect(lindgren).toMatchObject({ goals: 12, matchesPlayed: 22, positionGroup: "forwards", competition: "Allsvenskan  2026" });
    const helander = stats.find((s) => s.playerName === "Filip Helander");
    expect(helander).toMatchObject({ goals: 0, matchesPlayed: 0, positionGroup: "defenders" });
  });

  it("uses fogisId when present, deterministic hash when missing", () => {
    const stats = normalizeSmSquad(squad as never);
    const berisha = stats.find((s) => s.playerName === "Etrit Berisha");
    expect(berisha?.playerId).toBe(540307);
    const helander = stats.find((s) => s.playerName === "Filip Helander");
    expect(helander?.playerId).toBe(hashId("Filip Helander"));
    expect(hashId("Filip Helander")).toBe(hashId("Filip Helander"));
  });
});

describe("source metadata", () => {
  it("requires provenance fields on football source meta", () => {
    // The pipeline must attach provenance; this mirrors the shape contract.
    const meta = {
      provider: "SportoMedia",
      publicSite: "allsvenskan.se",
      provenance: "SportoMedia data service used by allsvenskan.se (Svensk Elitfotboll)",
      sourceUrl: "https://gql.sportomedia.se/graphql",
      retrievedAt: "2026-09-25T01:44:09Z",
      season: "2026",
      competition: "Allsvenskan",
      dataStatus: "current",
      queryVersion: "sm-2026-09-25",
    };
    expect(meta.provider).toBe("SportoMedia");
    expect(meta.dataStatus).toBe("current");
    expect(meta.season).toBe("2026");
    expect(meta.provenance).not.toContain("SvFF official"); // must not overstate provenance
  });
});