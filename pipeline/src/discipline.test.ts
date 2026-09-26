import { describe, expect, it } from "vitest";
import { buildLedger, computeSeasonDiscipline, type CardEvent } from "./discipline";
import { canonicalIdFromFogis, canonicalIdFromName } from "./playerIdentity";

const RULE = { threshold: 3, suspensionMatches: 1 };

function yellow(playerId: string, playerName: string, matchId: number, date: string): CardEvent {
  return { playerId, playerName, competition: "allsvenskan", season: "2026", matchId, matchDate: date, kind: "yellow" };
}

function red(playerId: string, playerName: string, matchId: number, date: string): CardEvent {
  return { playerId, playerName, competition: "allsvenskan", season: "2026", matchId, matchDate: date, kind: "red" };
}

describe("computeSeasonDiscipline", () => {
  it("returns none for a player with no cards", () => {
    const res = computeSeasonDiscipline([], RULE, [], null);
    expect(res).toEqual([]);
  });

  it("returns none below threshold", () => {
    const res = computeSeasonDiscipline(
      [yellow("fogis:1", "A", 1, "2026-04-01"), yellow("fogis:1", "A", 2, "2026-04-10")],
      RULE,
      ["2026-04-01", "2026-04-10"],
      null,
    );
    expect(res).toHaveLength(1);
    expect(res[0].warningCount).toBe(2);
    expect(res[0].status).toBe("at_risk");
    expect(res[0].incomplete).toBe(false);
  });

  it("suspends at threshold (3 warnings in distinct matches)", () => {
    const res = computeSeasonDiscipline(
      [
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 2, "2026-04-10"),
        yellow("fogis:1", "A", 3, "2026-04-20"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20"],
      { matchId: 4, date: "2026-04-27" },
    );
    expect(res[0].warningCount).toBe(3);
    expect(res[0].status).toBe("suspended_next");
  });

  it("does not count two yellows in the same match as two warnings", () => {
    const res = computeSeasonDiscipline(
      [
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 2, "2026-04-10"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10"],
      null,
    );
    // Two yellows in match 1 = red-equivalent, only ONE counts as a warning here;
    // distinct-match dedup means warningCount is 2, not 3.
    expect(res[0].warningCount).toBe(2);
    expect(res[0].status).toBe("at_risk");
  });

  it("marks suspension served when a finished match follows the threshold date", () => {
    const res = computeSeasonDiscipline(
      [
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 2, "2026-04-10"),
        yellow("fogis:1", "A", 3, "2026-04-20"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20", "2026-04-27"],
      { matchId: 5, date: "2026-05-03" },
    );
    expect(res[0].status).toBe("served");
    expect(res[0].servedAt).toBe("2026-04-27");
  });

  it("counts subsequent warnings toward the next threshold after serving", () => {
    const res = computeSeasonDiscipline(
      [
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 2, "2026-04-10"),
        yellow("fogis:1", "A", 3, "2026-04-20"),
        yellow("fogis:1", "A", 5, "2026-05-10"),
        yellow("fogis:1", "A", 6, "2026-05-20"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20", "2026-04-27", "2026-05-10", "2026-05-20"],
      { matchId: 7, date: "2026-05-27" },
    );
    // 5 warnings total, one suspension served after match 4 (2026-04-27);
    // warnings after servedAt (2) count toward the next threshold → at_risk.
    expect(res[0].status).toBe("at_risk");
    // relevantWarnings keeps ALL distinct-match warnings of the season;
    // the status logic above only counts those after servedAt.
    expect(res[0].relevantWarnings).toHaveLength(5);
  });

  it("flags red card as red_suspended", () => {
    const res = computeSeasonDiscipline(
      [red("fogis:2", "B", 1, "2026-04-01")],
      RULE,
      ["2026-04-01"],
      { matchId: 2, date: "2026-04-08" },
    );
    expect(res[0].redCards).toBe(1);
    expect(res[0].status).toBe("red_suspended");
  });

  it("marks incomplete when finished match dates are missing", () => {
    const res = computeSeasonDiscipline(
      [yellow("fogis:1", "A", 1, "2026-04-01"), yellow("fogis:1", "A", 2, "2026-04-10"), yellow("fogis:1", "A", 3, "2026-04-20")],
      RULE,
      [], // no finished dates known
      null,
    );
    expect(res[0].incomplete).toBe(true);
    expect(res[0].status).toBe("unknown");
  });

  it("keeps players separate by canonical id", () => {
    const res = computeSeasonDiscipline(
      [yellow("fogis:1", "A", 1, "2026-04-01"), yellow("fogis:2", "B", 1, "2026-04-01")],
      RULE,
      ["2026-04-01"],
      null,
    );
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.playerId).sort()).toEqual(["fogis:1", "fogis:2"]);
  });
});

describe("warningsUntilSuspension", () => {
  // Regression guard for the Home-screen defect: a player with 5 season
  // warnings who already served a suspension was labelled "one warning from
  // suspension" next to the text "5 warnings this season". Both were true and
  // together they were self-contradictory. The engine must expose the number
  // of warnings still counting toward the NEXT suspension.
  it("equals the season total when no suspension has been served", () => {
    const res = computeSeasonDiscipline(
      [yellow("fogis:1", "A", 1, "2026-04-01"), yellow("fogis:1", "A", 2, "2026-04-10")],
      RULE,
      ["2026-04-01", "2026-04-10"],
      { matchId: 3, date: "2026-04-20" },
    );
    expect(res[0].warningCount).toBe(2);
    expect(res[0].warningsUntilSuspension).toBe(2);
    expect(res[0].status).toBe("at_risk");
  });

  it("excludes warnings consumed by a served suspension", () => {
    // 3 warnings reach the threshold, one suspension is served on 04-27, then
    // 2 more warnings. Season total is 5 but only 2 count toward the next one.
    const res = computeSeasonDiscipline(
      [
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 2, "2026-04-10"),
        yellow("fogis:1", "A", 3, "2026-04-20"),
        yellow("fogis:1", "A", 5, "2026-05-10"),
        yellow("fogis:1", "A", 6, "2026-05-20"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20", "2026-04-27", "2026-05-10", "2026-05-20"],
      { matchId: 7, date: "2026-05-27" },
    );
    expect(res[0].warningCount).toBe(5);
    expect(res[0].warningsUntilSuspension).toBe(2);
    // Correctly one warning short — for the NEXT suspension.
    expect(res[0].status).toBe("at_risk");
  });

  it("keeps at_risk exclusive to exactly one warning short, after serving", () => {
    // Serves a suspension, then collects only ONE further warning. The player
    // is 2 short of the next suspension, so `at_risk` would overstate the
    // danger. `at_risk` is reserved for warningsUntilSuspension === threshold-1;
    // consumers must read warningsUntilSuspension to express anything finer.
    const res = computeSeasonDiscipline(
      [
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 2, "2026-04-10"),
        yellow("fogis:1", "A", 3, "2026-04-20"),
        yellow("fogis:1", "A", 5, "2026-05-10"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20", "2026-04-27", "2026-05-10"],
      { matchId: 7, date: "2026-05-27" },
    );
    expect(res[0].warningCount).toBe(4);
    expect(res[0].warningsUntilSuspension).toBe(1);
    // Status reflects that this suspension has been served; the pending
    // distance (1 of 2) is what the UI must render.
    expect(res[0].status).toBe("served");
  });

  it("marks suspended_next when the pending count reaches the threshold", () => {
    const res = computeSeasonDiscipline(
      [
        yellow("fogis:1", "A", 1, "2026-04-01"),
        yellow("fogis:1", "A", 2, "2026-04-10"),
        yellow("fogis:1", "A", 3, "2026-04-20"),
        yellow("fogis:1", "A", 5, "2026-05-10"),
        yellow("fogis:1", "A", 6, "2026-05-20"),
        yellow("fogis:1", "A", 7, "2026-05-30"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20", "2026-04-27", "2026-05-10", "2026-05-20", "2026-05-30"],
      { matchId: 8, date: "2026-06-06" },
    );
    expect(res[0].warningsUntilSuspension).toBe(3);
    expect(res[0].status).toBe("suspended_next");
  });
});

describe("buildLedger", () => {
  it("maps event names to canonical ids via the resolver", () => {
    const events = buildLedger(
      [{ matchId: 1, matchDate: "2026-04-01", häckenYellows: ["Squad Name"], häckenReds: [] }],
      (n) => (n === "Squad Name" ? canonicalIdFromFogis(540307) : canonicalIdFromName(n)),
      "allsvenskan",
      "2026",
    );
    expect(events).toHaveLength(1);
    expect(events[0].playerId).toBe("fogis:540307");
    expect(events[0].kind).toBe("yellow");
  });

  it("dedupes duplicate names within one match", () => {
    const events = buildLedger(
      [{ matchId: 1, matchDate: "2026-04-01", häckenYellows: ["X", "X"], häckenReds: [] }],
      canonicalIdFromName,
      "allsvenskan",
      "2026",
    );
    expect(events).toHaveLength(1);
  });

  it("emits both yellow and red events", () => {
    const events = buildLedger(
      [{ matchId: 1, matchDate: "2026-04-01", häckenYellows: ["X"], häckenReds: ["Y"] }],
      canonicalIdFromName,
      "allsvenskan",
      "2026",
    );
    expect(events.map((e) => e.kind).sort()).toEqual(["red", "yellow"]);
  });
});