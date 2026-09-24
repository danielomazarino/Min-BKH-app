import { describe, expect, it } from "vitest";
import { computeWarnings, suspensionServed, type WarningEvent } from "./warnings";
import type { MatchRef } from "./types";

const nextMatch: MatchRef = {
  id: 201,
  competition: "allsvenskan",
  season: "2026",
  date: "2026-10-04T15:00:00Z",
  homeAway: "home",
  opponent: "Djurgårdens IF",
  status: "scheduled",
};

function ev(
  playerId: number,
  matchId: number,
  date: string,
  competition: WarningEvent["competition"] = "allsvenskan",
  season = "2026",
): WarningEvent {
  return { playerId, playerName: `Player${playerId}`, competition, matchId, matchDate: date, season };
}

describe("warning/suspension logic (Allsvenskan 2026: 3 varningar → avstängning)", () => {
  it("player with two warnings and no suspension appears as 'one warning from suspension'", () => {
    const report = computeWarnings(
      [ev(1, 101, "2026-08-01"), ev(1, 102, "2026-08-15")],
      "allsvenskan",
      "2026",
      nextMatch,
    );
    expect(report.atRisk).toHaveLength(1);
    expect(report.atRisk[0].warningCount).toBe(2);
    expect(report.atRisk[0].oneWarningFromSuspension).toBe(true);
    expect(report.atRisk[0].suspendedForNextMatch).toBe(false);
  });

  it("player who reached the threshold is suspended for the next match", () => {
    const report = computeWarnings(
      [ev(1, 101, "2026-08-01"), ev(1, 102, "2026-08-15"), ev(1, 103, "2026-09-01")],
      "allsvenskan",
      "2026",
      nextMatch,
    );
    expect(report.suspended).toHaveLength(1);
    expect(report.suspended[0].suspendedForNextMatch).toBe(true);
  });

  it("two warnings in the SAME match count once (distinct match rule)", () => {
    const report = computeWarnings(
      [ev(1, 101, "2026-08-01"), ev(1, 101, "2026-08-01"), ev(1, 103, "2026-09-01")],
      "allsvenskan",
      "2026",
      nextMatch,
    );
    // Two distinct matches only → at risk, not suspended.
    expect(report.suspended).toHaveLength(0);
    expect(report.atRisk).toHaveLength(1);
  });

  it("warnings from another competition do not affect Allsvenskan status", () => {
    const report = computeWarnings(
      [ev(1, 101, "2026-08-01", "svenska-cupen"), ev(1, 102, "2026-08-15", "svenska-cupen")],
      "allsvenskan",
      "2026",
      nextMatch,
    );
    expect(report.suspended).toHaveLength(0);
    expect(report.atRisk).toHaveLength(0);
  });

  it("warnings from an earlier season do not carry over", () => {
    const report = computeWarnings(
      [ev(1, 101, "2026-08-01", "allsvenskan", "2025"), ev(1, 102, "2025-09-15", "allsvenskan", "2025"), ev(1, 103, "2025-10-01", "allsvenskan", "2025")],
      "allsvenskan",
      "2026",
      nextMatch,
    );
    expect(report.suspended).toHaveLength(0);
    expect(report.atRisk).toHaveLength(0);
  });

  it("a served suspension (finished match after last warning) does not suspend again", () => {
    const finishedAfter: MatchRef = {
      id: 150,
      competition: "allsvenskan",
      season: "2026",
      date: "2026-09-20T15:00:00Z",
      homeAway: "away",
      opponent: "Mjällby AIF",
      status: "finished",
      scoreHome: 1,
      scoreAway: 1,
    };
    expect(suspensionServed("2026-09-01", [finishedAfter])).toBe(true);
    expect(suspensionServed("2026-09-25", [finishedAfter])).toBe(false);
  });

  it("returns unknown rule when no rule config exists for the competition/season", () => {
    const report = computeWarnings([ev(1, 101, "2026-08-01")], "europa", "2026", null);
    expect(report.rule).toBe("unknown");
    expect(report.suspended).toHaveLength(0);
    expect(report.atRisk).toHaveLength(0);
  });
});
