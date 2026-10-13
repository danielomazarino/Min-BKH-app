import { describe, expect, it } from "vitest";
import { buildLedger, computeSeasonDiscipline, type CardEvent, type CurrentSquad } from "./discipline";
import { canonicalIdFromFogis, canonicalIdFromName } from "./playerIdentity";

const RULE = { threshold: 3, suspensionMatches: 1 };

/**
 * Squad fixture helper.
 *
 * The 5th argument to `computeSeasonDiscipline` is REQUIRED. Most existing
 * tests exercise pure classification for players who ARE in the squad, so they
 * declare that squad explicitly via `SQUAD_A` / `SQUAD_B` rather than relying
 * on a permissive default. A default would recreate the bug the moment a
 * caller omitted the argument.
 */
function squad(players: Array<{ playerId: string; playerName: string }>): CurrentSquad {
  return { players, known: true };
}

const SQUAD_A = squad([{ playerId: "fogis:1", playerName: "A" }]);
const SQUAD_B = squad([{ playerId: "fogis:2", playerName: "B" }]);
const SQUAD_AB = squad([
  { playerId: "fogis:1", playerName: "A" },
  { playerId: "fogis:2", playerName: "B" },
]);

/** Squad membership could not be established — e.g. the squad query failed. */
const SQUAD_UNKNOWN: CurrentSquad = { players: [], known: false };

function yellow(playerId: string, playerName: string, matchId: number, date: string): CardEvent {
  return { playerId, playerName, competition: "allsvenskan", season: "2026", matchId, matchDate: date, kind: "yellow" };
}

function red(playerId: string, playerName: string, matchId: number, date: string): CardEvent {
  return { playerId, playerName, competition: "allsvenskan", season: "2026", matchId, matchDate: date, kind: "red" };
}

describe("computeSeasonDiscipline", () => {
  it("returns none for a player with no cards", () => {
    const res = computeSeasonDiscipline([], RULE, [], null, SQUAD_AB);
    expect(res).toEqual([]);
  });

  it("returns none below threshold", () => {
    const res = computeSeasonDiscipline(
      [yellow("fogis:1", "A", 1, "2026-04-01"), yellow("fogis:1", "A", 2, "2026-04-10")],
      RULE,
      ["2026-04-01", "2026-04-10"],
      null,
      SQUAD_A,
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
      SQUAD_A,
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
      SQUAD_A,
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
      SQUAD_A,
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
      SQUAD_A,
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
      SQUAD_B,
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
      SQUAD_A,
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
      SQUAD_AB,
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
      SQUAD_A,
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
      SQUAD_A,
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
      SQUAD_A,
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
      SQUAD_A,
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

describe("computeSeasonDiscipline · current-squad scoping (E-005)", () => {
  // E-005. The season ledger spans the whole season, so a player who was
  // transferred away mid-season keeps the cards he collected before leaving.
  // Those cards are real and must be retained. But the *current risk
  // classification* was still emitted: a sold player came back as `at_risk`,
  // which reads to a supporter as "one card from a suspension" — a suspension
  // in a competition he can no longer be suspended into by Häcken.
  //
  // Live reproduction against committed data (2026-09-30): 27 squad players,
  // 18 ledger entries, one violation — Amor Layouni (`at_risk`), sold by the club.
  //
  // The fix demotes a departed player to a dedicated terminal status rather
  // than deleting the row, so history is preserved and the row can never be
  // mistaken for a live suspension risk.

  const DEPARTED_WARNINGS = [
    yellow("name:amor layouni", "Amor Layouni", 1, "2026-04-01"),
    yellow("name:amor layouni", "Amor Layouni", 2, "2026-04-10"),
  ];
  const CURRENT_WARNINGS = [
    yellow("fogis:1", "A", 1, "2026-04-01"),
    yellow("fogis:1", "A", 2, "2026-04-10"),
  ];
  const FINISHED = ["2026-04-01", "2026-04-10", "2026-04-20"];

  it("does not report a departed player as at_risk", () => {
    const res = computeSeasonDiscipline([...DEPARTED_WARNINGS, ...CURRENT_WARNINGS], RULE, FINISHED, null, SQUAD_A);
    const layouni = res.find((d) => d.playerName === "Amor Layouni");
    expect(layouni).toBeDefined();
    // Without the fix this was "at_risk" — 2 warnings, one short of 3.
    expect(layouni!.status).not.toBe("at_risk");
    expect(layouni!.status).not.toBe("suspended_next");
    expect(layouni!.status).toBe("departed");
  });

  it("does not report a departed player as suspended_next at the threshold", () => {
    // No finished match after the threshold date → the engine classifies this
    // as suspended_next (pre-fix). Post-fix it must be `departed`.
    const res = computeSeasonDiscipline(
      [
        ...DEPARTED_WARNINGS,
        yellow("name:amor layouni", "Amor Layouni", 3, "2026-04-20"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20"],
      null,
      SQUAD_A,
    );
    const layouni = res.find((d) => d.playerName === "Amor Layouni")!;
    expect(layouni.warningCount).toBe(3);
    expect(layouni.status).not.toBe("suspended_next");
    expect(layouni.status).toBe("departed");
  });

  it("retains a departed player's historical card data", () => {
    const res = computeSeasonDiscipline(DEPARTED_WARNINGS, RULE, FINISHED, null, SQUAD_A);
    const layouni = res[0];
    // The history is genuine data. Demoting the status must not erase it.
    expect(layouni.warningCount).toBe(2);
    expect(layouni.warningsUntilSuspension).toBe(2);
    expect(layouni.relevantWarnings).toHaveLength(2);
    expect(layouni.relevantWarnings.map((w) => w.date)).toEqual(["2026-04-01", "2026-04-10"]);
  });

  it("retains a departed player's red card and red_suspended history", () => {
    // red_suspended means "red card → suspension, serving window unknown".
    // That is a factual historical statement, so it is preserved; it is not a
    // forward-looking "you are out next match" claim.
    const res = computeSeasonDiscipline(
      [red("name:amor layouni", "Amor Layouni", 1, "2026-04-01")],
      RULE,
      FINISHED,
      null,
      SQUAD_A,
    );
    expect(res[0].status).toBe("red_suspended");
    expect(res[0].redCards).toBe(1);
  });

  it("retains a departed player's served suspension with its date", () => {
    const res = computeSeasonDiscipline(
      [
        yellow("name:amor layouni", "Amor Layouni", 1, "2026-04-01"),
        yellow("name:amor layouni", "Amor Layouni", 2, "2026-04-10"),
        yellow("name:amor layouni", "Amor Layouni", 3, "2026-04-20"),
      ],
      RULE,
      ["2026-04-01", "2026-04-10", "2026-04-20", "2026-04-27"],
      null,
      SQUAD_A,
    );
    expect(res[0].status).toBe("served");
    expect(res[0].servedAt).toBe("2026-04-27");
  });

  it("leaves current squad players' classification untouched", () => {
    const res = computeSeasonDiscipline([...DEPARTED_WARNINGS, ...CURRENT_WARNINGS], RULE, FINISHED, null, SQUAD_A);
    const inSquad = res.find((d) => d.playerName === "A")!;
    expect(inSquad.status).toBe("at_risk");
    expect(inSquad.warningCount).toBe(2);
  });

  it("matches squad membership on a normalised name when the id differs", () => {
    // Event ids for non-squad players are name-derived. A current squad member
    // whose name resolves to a different id must still be recognised as in the
    // squad, otherwise a name/id drift would silently demote a real player.
    const res = computeSeasonDiscipline(
      [yellow("name:a", "A", 1, "2026-04-01"), yellow("name:a", "A", 2, "2026-04-10")],
      RULE,
      FINISHED,
      null,
      SQUAD_A, // squad carries playerId "fogis:1" for "A"
    );
    expect(res[0].status).toBe("at_risk");
  });

  it("keeps the real Layouni case as departed, not at_risk", () => {
    // Mirrors the committed data: 2 warnings pre-transfer, not in squadStats.
    const squadStats = SQUAD_A; // Layouni absent
    const res = computeSeasonDiscipline(DEPARTED_WARNINGS, RULE, FINISHED, null, squadStats);
    expect(res[0].playerName).toBe("Amor Layouni");
    expect(res[0].status).toBe("departed");
  });

  describe("insufficient squad data", () => {
    // A failed squad query yields an EMPTY list. Treating that as "nobody is
    // in the squad" would demote every player to `departed` and wipe the
    // entire ledger's risk classification — a catastrophic silent regression.
    // The engine must distinguish "no players" from "membership unknown".
    it("leaves classification untouched when membership is unknown", () => {
      const res = computeSeasonDiscipline(DEPARTED_WARNINGS, RULE, FINISHED, null, SQUAD_UNKNOWN);
      expect(res[0].status).toBe("at_risk");
    });

    it("treats an explicitly empty but known squad as genuinely empty", () => {
      // known:true with zero players is a real (if implausible) upstream fact:
      // the club genuinely has nobody registered. Demotion is then correct.
      const res = computeSeasonDiscipline(DEPARTED_WARNINGS, RULE, FINISHED, null, squad([]));
      expect(res[0].status).toBe("departed");
    });

    it("does not wipe the ledger when membership is unknown", () => {
      const res = computeSeasonDiscipline([...DEPARTED_WARNINGS, ...CURRENT_WARNINGS], RULE, FINISHED, null, SQUAD_UNKNOWN);
      expect(res).toHaveLength(2);
      expect(res.map((d) => d.status).sort()).toEqual(["at_risk", "at_risk"]);
    });
  });

  // ---------------------------------------------------------------------------
  // The Doumbia regression (2026-10-13).
  //
  // Real case: Abdoulaye Doumbia (BK Häcken) collected 6 warnings in 2026.
  // The 3rd (2026-05-17, Mjällby) triggered a suspension served in round 9
  // (2026-05-25, Elfsborg — verified: he is absent from that lineup). The 6th
  // (2026-08-29, Västerås SK) triggered a second suspension served in round
  // 20 (2026-09-05, GAIS — verified: absent from that lineup, and
  // bollsvenskan.se 2026-09-04 reported "Väisänen och Doumbia avstängda mot
  // GAIS"). The old one-shot serve-check reported `suspended_next` for weeks
  // after the second suspension had already been served.
  // ---------------------------------------------------------------------------
  describe("multiple suspensions in one season (the Doumbia case)", () => {
    const DOUMBIA_WARNINGS = [
      yellow("fogis:1564471", "Abdoulaye Doumbia", 6529838, "2026-04-11"),
      yellow("fogis:1564471", "Abdoulaye Doumbia", 6529848, "2026-04-19"),
      yellow("fogis:1564471", "Abdoulaye Doumbia", 6529889, "2026-05-17"),
      yellow("fogis:1564471", "Abdoulaye Doumbia", 6529945, "2026-08-01"),
      yellow("fogis:1564471", "Abdoulaye Doumbia", 6529959, "2026-08-17"),
      yellow("fogis:1564471", "Abdoulaye Doumbia", 6529977, "2026-08-29"),
    ];
    const DOUMBIA_SQUAD = squad([{ playerId: "fogis:1564471", playerName: "Abdoulaye Doumbia" }]);
    // Häcken's finished 2026 Allsvenskan matches (the real fixture dates).
    const SEASON_FINISHED = [
      "2026-04-06", "2026-04-11", "2026-04-19", "2026-04-22", "2026-04-27",
      "2026-05-02", "2026-05-10", "2026-05-17", "2026-05-25", "2026-05-31",
      "2026-07-06", "2026-07-11", "2026-07-19", "2026-07-27", "2026-08-01",
      "2026-08-09", "2026-08-17", "2026-08-21", "2026-08-29", "2026-09-05",
      "2026-09-11", "2026-09-20", "2026-10-11",
    ];

    it("recognises BOTH served suspensions, not just the first", () => {
      const res = computeSeasonDiscipline(DOUMBIA_WARNINGS, RULE, SEASON_FINISHED, null, DOUMBIA_SQUAD);
      const d = res[0];
      expect(d.playerName).toBe("Abdoulaye Doumbia");
      expect(d.status).toBe("served");
      expect(d.servedSuspensions).toEqual(["2026-05-25", "2026-09-05"]);
      expect(d.servedAt).toBe("2026-05-25");
      expect(d.warningsUntilSuspension).toBe(0);
    });

    it("reports suspended_next when the second threshold is NOT yet served", () => {
      // Same warnings, but the season ends right after the 6th yellow —
      // round 20 has not been played. The player IS out for the next match.
      const finished = SEASON_FINISHED.filter((d) => d < "2026-09-05");
      const res = computeSeasonDiscipline(DOUMBIA_WARNINGS, RULE, finished, null, DOUMBIA_SQUAD);
      const d = res[0];
      expect(d.status).toBe("suspended_next");
      expect(d.servedSuspensions).toEqual(["2026-05-25"]);
      // Established semantics: the pending count that triggered the
      // suspension is reported, not zeroed (see the suspended_next tests
      // above).
      expect(d.warningsUntilSuspension).toBe(3);
    });

    it("keeps the first suspension correct when only one threshold is reached", () => {
      const three = DOUMBIA_WARNINGS.slice(0, 3);
      const res = computeSeasonDiscipline(three, RULE, SEASON_FINISHED, null, DOUMBIA_SQUAD);
      const d = res[0];
      expect(d.status).toBe("served");
      expect(d.servedSuspensions).toEqual(["2026-05-25"]);
      expect(d.warningsUntilSuspension).toBe(0);
    });

    it("reports suspended_next when the threshold is reached and no match has finished since", () => {
      // Threshold reached in the very last finished match — nothing after it
      // to serve the suspension in.
      const finished = SEASON_FINISHED.filter((d) => d <= "2026-08-29");
      const res = computeSeasonDiscipline(DOUMBIA_WARNINGS, RULE, finished, null, DOUMBIA_SQUAD);
      const d = res[0];
      expect(d.status).toBe("suspended_next");
      expect(d.servedSuspensions).toEqual(["2026-05-25"]);
      expect(d.warningsUntilSuspension).toBe(3);
    });
  });
});