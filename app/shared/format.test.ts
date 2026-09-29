import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  cstatFor,
  currentSquadDiscipline,
  daysUntil,
  formGuide,
  groupDiscipline,
  resultOf,
  scoreFor,
  scorerLine,
  squadByPosition,
  urgentDiscipline,
  groupLabel,
  fmtWhen,
  type TimelineRowItem,
} from "./format";
import type { MatchEvents, PlayerDiscipline, SeasonPlayerStat } from "../../pipeline/src/types";

describe("scoreFor", () => {
  // Regression: the old Home rendered "BK Häcken Kalmar FF 5–0" for this match
  // — no separator and the score placed after the opponent.
  it("puts Häcken's goals first for a home match", () => {
    expect(scoreFor({ scoreHome: 3, scoreAway: 1, homeAway: "home" })).toBe("3–1");
  });
  it("reverses the score for an away match", () => {
    expect(scoreFor({ scoreHome: 0, scoreAway: 5, homeAway: "away" })).toBe("5–0");
  });
  it("returns null when a score is missing", () => {
    expect(scoreFor({ scoreHome: undefined, scoreAway: 1, homeAway: "home" })).toBeNull();
  });
});

describe("resultOf", () => {
  it("classifies from Häcken's perspective, not home/away", () => {
    expect(resultOf({ scoreHome: 0, scoreAway: 5, homeAway: "away" })).toBe("w");
    expect(resultOf({ scoreHome: 3, scoreAway: 1, homeAway: "home" })).toBe("w");
    expect(resultOf({ scoreHome: 1, scoreAway: 1, homeAway: "away" })).toBe("d");
    expect(resultOf({ scoreHome: 1, scoreAway: 3, homeAway: "home" })).toBe("l");
  });
});

describe("formGuide", () => {
  it("returns the newest finished results only", () => {
    const ms = [
      { id: 1, competition: "allsvenskan" as const, season: "2026", date: "2026-09-20T12:00:00Z", homeAway: "away" as const, opponent: "Kalmar", status: "finished" as const, scoreHome: 0, scoreAway: 5 },
      { id: 2, competition: "allsvenskan" as const, season: "2026", date: "2026-09-11T17:00:00Z", homeAway: "home" as const, opponent: "Mjällby", status: "finished" as const, scoreHome: 1, scoreAway: 1 },
      { id: 3, competition: "allsvenskan" as const, season: "2026", date: "2026-10-11T14:30:00Z", homeAway: "home" as const, opponent: "Örgryte", status: "scheduled" as const },
    ];
    expect(formGuide(ms, 5)).toEqual(["w", "d"]);
  });
});

describe("cstatFor — the discipline label defect", () => {
  const base = {
    playerId: "fogis:1",
    playerName: "X",
    redCards: 0,
    relevantWarnings: [],
    incomplete: false,
  };

  it("states suspension plainly", () => {
    const d: PlayerDiscipline = { ...base, warningCount: 6, warningsUntilSuspension: 3, status: "suspended_next" };
    const s = cstatFor(d, 3);
    expect(s.severity).toBe("suspended");
    expect(s.state).toBe("Avstängd nästa match");
  });

  // The real defect: a player with 5 season warnings who already served a
  // suspension was labelled "En varning från avstängning" beside the text
  // "5 varningar denna säsong". Both true, jointly contradictory.
  it("uses the PENDING count, not the season total", () => {
    const d: PlayerDiscipline = {
      ...base,
      warningCount: 5,
      warningsUntilSuspension: 2,
      status: "at_risk",
      servedAt: "2026-05-17T14:30:00Z",
    };
    const s = cstatFor(d, 3);
    expect(s.state).toBe("En varning kvar");
  });

  it("pluralises correctly and never says 'en' for two", () => {
    const d: PlayerDiscipline = { ...base, warningCount: 1, warningsUntilSuspension: 1, status: "none" };
    expect(cstatFor(d, 3).state).toBe("2 varningar kvar");
  });

  it("flags unknown status rather than guessing", () => {
    const d: PlayerDiscipline = { ...base, warningCount: 3, warningsUntilSuspension: 3, status: "unknown", incomplete: true };
    expect(cstatFor(d, 3).state).toBe("Varningsstatus okänd");
  });

  it("handles a red card honestly", () => {
    const d: PlayerDiscipline = { ...base, warningCount: 0, warningsUntilSuspension: 0, status: "red_suspended", redCards: 1 };
    expect(cstatFor(d, 3).severity).toBe("suspended");
  });

  // E-005. A departed player with 2 season cards is one warning short of a
  // suspension he can never be given. The generic `pending > 0` branch would
  // render that as "1 varning kvar" — the exact misleading claim the item
  // exists to prevent. `departed` must short-circuit it.
  it("does not describe a departed player as a warning away", () => {
    const d: PlayerDiscipline = {
      ...base,
      playerName: "Amor Layouni",
      warningCount: 2,
      warningsUntilSuspension: 2,
      status: "departed",
      departed: true,
    };
    const s = cstatFor(d, 3);
    expect(s.state).toBe("Spelade under säsongen");
    expect(s.severity).toBe("other");
    expect(s.state).not.toMatch(/varning kvar/);
  });

  it("keeps a departed player out of the urgent list", () => {
    const d: PlayerDiscipline = { ...base, warningCount: 2, warningsUntilSuspension: 2, status: "departed", departed: true };
    expect(urgentDiscipline([d])).toEqual([]);
  });

  // E-005, second half. The engine sets `departed: true` on EVERY non-squad
  // row, but it only OVERWRITES `status` to "departed" when the computed
  // status was `at_risk` / `suspended_next`. A departed player whose status is
  // a preserved historical fact (`served`, `red_suspended`) keeps that status —
  // correctly, the engine must not corrupt the record — yet still carries
  // `departed: true`.
  //
  // So a `status`-only check leaks: the row falls through to the generic
  // `pending > 0` branch and renders "1 varning kvar" for a player who can
  // never be suspended by this club. That is the same misleading claim E-005
  // exists to remove, reintroduced through a different door.
  //
  // The `departed` FLAG is the reliable signal, not the status string.
  it("does not describe a departed player as a warning away when status is a preserved historical fact", () => {
    const servedThenLeft: PlayerDiscipline = {
      ...base,
      playerId: "name:served-then-left",
      playerName: "Departed Served",
      // 5 season warnings, 2 still pending after a served suspension, and the
      // player is no longer at the club.
      warningCount: 5,
      warningsUntilSuspension: 2,
      status: "served",
      servedAt: "2026-05-17T14:30:00Z",
      departed: true,
    };
    const s = cstatFor(servedThenLeft, 3);
    expect(s.state).not.toMatch(/varning kvar/);
    expect(s.state).toBe("Spelade under säsongen");
  });

  it("does not describe a departed red-card player as a warning away", () => {
    // `red_suspended` is also preserved for a departed player: the red card
    // really happened and the serving window is genuinely unknown. It is not a
    // forward-looking claim, so it must not be rewritten — but it must also not
    // leak a "varning kvar" countdown.
    //
    // NOTE: this case already passed before the fix, because the
    // `red_suspended` branch is evaluated before the generic `pending > 0`
    // one. It is kept as a regression guard, not as evidence of the bug: the
    // defect lived in the statuses that fall THROUGH to `pending > 0`, namely
    // `served` and `none`.
    const redThenLeft: PlayerDiscipline = {
      ...base,
      playerId: "name:red-then-left",
      playerName: "Departed Red",
      warningCount: 3,
      warningsUntilSuspension: 3,
      status: "red_suspended",
      redCards: 1,
      departed: true,
    };
    const s = cstatFor(redThenLeft, 3);
    expect(s.state).not.toMatch(/varning kvar/);
  });

  it("does not describe a departed player with no cards as being a warning away", () => {
    // `none` is the other status that falls through to `pending > 0`. A player
    // with 2 cards and no served suspension is `none` only when the threshold
    // is above their count, but the branch is reachable and must be guarded.
    const noneThenLeft: PlayerDiscipline = {
      ...base,
      playerId: "name:none-then-left",
      playerName: "Departed None",
      warningCount: 2,
      warningsUntilSuspension: 2,
      status: "none",
      departed: true,
    };
    expect(cstatFor(noneThenLeft, 3).state).not.toMatch(/varning kvar/);
  });

  it("keeps a departed player out of the urgent list even with a preserved status", () => {
    const servedThenLeft: PlayerDiscipline = {
      ...base,
      warningCount: 5,
      warningsUntilSuspension: 2,
      status: "served",
      servedAt: "2026-05-17T14:30:00Z",
      departed: true,
    };
    // `served` is not a forward-looking status, so this already passed via the
    // status allowlist. Asserted here so the two guards cannot drift apart.
    expect(urgentDiscipline([servedThenLeft])).toEqual([]);
  });

  it("does not let a departed row create a misleading at-risk group", () => {
    // `groupDiscipline` buckets by `severity`. A leaked `at-risk` severity would
    // put the player under the "Varningar kvar" heading, which is a claim
    // about a live suspension risk.
    const servedThenLeft: PlayerDiscipline = {
      ...base,
      warningCount: 5,
      warningsUntilSuspension: 2,
      status: "served",
      servedAt: "2026-05-17T14:30:00Z",
      departed: true,
    };
    const groups = groupDiscipline([servedThenLeft], 3);
    const atRisk = groups.find((g) => g.severity === "at-risk");
    expect(atRisk?.players ?? []).toEqual([]);
  });

  it("still describes a CURRENT player with a preserved status normally", () => {
    // Guards against over-correction: the fix must key on `departed`, not on
    // the status string. A CURRENT squad member with a preserved `served`
    // status and 2 pending warnings must still get a warning-away claim — the
    // fix must not leak onto players who are still at the club.
    //
    // Severity for a `served` row is `other` and the wording is "1 varning
    // kvar" — that is PRE-EXISTING behaviour of the generic `pending > 0`
    // branch, verified independently of this change, and it is deliberately
    // not altered here. E-005 is about departed players only.
    const current = {
      ...base,
      warningCount: 5,
      warningsUntilSuspension: 2,
      status: "served" as const,
      servedAt: "2026-05-17T14:30:00Z",
    };
    const s = cstatFor(current, 3);
    expect(s.state).toMatch(/varning kvar/);
    expect(s.state).not.toBe("Spelade under säsongen");
  });

  it("does not apply the departed branch to a CURRENT at_risk player", () => {
    // The direct over-correction guard: same pending count, `departed` absent.
    // `at_risk` must keep its own distinct wording, not the generic branch's.
    const current = {
      ...base,
      warningCount: 5,
      warningsUntilSuspension: 2,
      status: "at_risk" as const,
    };
    expect(cstatFor(current, 3).state).toBe("En varning kvar");
    expect(cstatFor(current, 3).severity).toBe("at-risk");
  });
});

describe("urgentDiscipline", () => {
  const mk = (name: string, status: PlayerDiscipline["status"], total: number, pending: number): PlayerDiscipline => ({
    playerId: name,
    playerName: name,
    warningCount: total,
    warningsUntilSuspension: pending,
    redCards: 0,
    status,
    relevantWarnings: [],
    incomplete: false,
  });

  it("puts suspensions before at-risk, then closest-to-suspension first", () => {
    const list = [
      // Both at-risk players are 2 pending, i.e. equally one warning away.
      // The tiebreak therefore favours the higher season total.
      mk("AtRisk2", "at_risk", 2, 2),
      mk("Suspended", "suspended_next", 6, 3),
      mk("AtRisk1", "at_risk", 5, 2),
    ];
    expect(urgentDiscipline(list).map((d) => d.playerName)).toEqual(["Suspended", "AtRisk1", "AtRisk2"]);
  });

  it("ranks a genuinely closer player above a further one regardless of season total", () => {
    // The defect this guards: sorting on warningCount put a player with 5
    // SERVED warnings above someone who is actually about to be suspended.
    const list = [mk("Closer", "at_risk", 3, 2), mk("Further", "none", 9, 1)];
    // "Further" is not near a suspension at all, so it is filtered out.
    expect(urgentDiscipline(list).map((d) => d.playerName)).toEqual(["Closer"]);
  });

  it("excludes players who are not near a suspension", () => {
    const list = [mk("Clear", "none", 0, 0), mk("Served", "served", 4, 0), mk("AtRisk", "at_risk", 2, 2)];
    expect(urgentDiscipline(list).map((d) => d.playerName)).toEqual(["AtRisk"]);
  });
});

describe("groupDiscipline — E-002, one status label per GROUP", () => {
  const mk = (name: string, status: PlayerDiscipline["status"], total: number, pending: number): PlayerDiscipline => ({
    playerId: name,
    playerName: name,
    warningCount: total,
    warningsUntilSuspension: pending,
    redCards: 0,
    status,
    relevantWarnings: [],
    incomplete: false,
  });

  it("sorts suspended players into the suspended group and at-risk into the other", () => {
    const groups = groupDiscipline(
      [mk("Rygaard", "at_risk", 5, 2), mk("Doumbia", "suspended_next", 6, 3), mk("Svanback", "at_risk", 2, 2)],
      3,
    );
    expect(groups.map((g) => g.severity)).toEqual(["suspended", "at-risk"]);
    expect(groups[0].players.map((d) => d.playerName)).toEqual(["Doumbia"]);
    expect(groups[1].players.map((d) => d.playerName)).toEqual(["Rygaard", "Svanback"]);
  });

  // THE REGRESSION THIS CHANGE COULD HAVE CAUSED.
  // cstatFor renders "En varning kvar" for a player 1 away and
  // "2 varningar kvar" for one 2 away. Grouping by that string would give
  // three groups for three at-risk players and change nothing at all.
  it("puts players with DIFFERENT state strings in the SAME group", () => {
    const oneAway = mk("OneAway", "at_risk", 5, 2); // state: "En varning kvar"
    const twoAway = mk("TwoAway", "at_risk", 4, 1); // state: "2 varningar kvar"
    expect(cstatFor(oneAway, 3).state).not.toBe(cstatFor(twoAway, 3).state);
    expect(cstatFor(oneAway, 3).severity).toBe(cstatFor(twoAway, 3).severity);

    const groups = groupDiscipline([oneAway, twoAway], 3);
    expect(groups).toHaveLength(1);
    expect(groups[0].severity).toBe("at-risk");
    expect(groups[0].players).toHaveLength(2);
  });

  it("emits exactly ONE header per group, regardless of group size", () => {
    const groups = groupDiscipline(
      [mk("A", "at_risk", 2, 2), mk("B", "at_risk", 3, 2), mk("C", "at_risk", 4, 2), mk("D", "suspended_next", 6, 3)],
      3,
    );
    // 2 groups for 4 players — the whole point of the change.
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => typeof g.label === "string" && g.label.length > 0)).toBe(true);
  });

  it("returns no groups at all for an empty input, so the empty state can render", () => {
    // A bare header with no rows is the failure mode this guards.
    expect(groupDiscipline([], 3)).toEqual([]);
  });

  it("drops no player: group sizes sum to the input length", () => {
    const input = [
      mk("A", "suspended_next", 6, 3),
      mk("B", "at_risk", 2, 2),
      mk("C", "at_risk", 3, 2),
      mk("D", "at_risk", 4, 1),
    ];
    const groups = groupDiscipline(input, 3);
    expect(groups.reduce((n, g) => n + g.players.length, 0)).toBe(input.length);
  });

  it("preserves the caller's order WITHIN a group (closest-to-suspension first)", () => {
    const input = urgentDiscipline([
      mk("Zebra", "at_risk", 9, 1),
      mk("Alpha", "at_risk", 2, 2),
      mk("Middle", "at_risk", 3, 2),
    ]);
    const groups = groupDiscipline(input, 3);
    expect(groups[0].players.map((d) => d.playerName)).toEqual(input.map((d) => d.playerName));
  });

  it("uses count-free header labels that cannot contradict a row", () => {
    // A header reading "En varning kvar" would be false for a player who is
    // two away, so the labels are deliberately neutral category names.
    const groups = groupDiscipline([mk("A", "suspended_next", 6, 3), mk("B", "at_risk", 2, 1)], 3);
    for (const g of groups) expect(g.label).not.toMatch(/\b[0-9]\b/);
    expect(groups.map((g) => g.label)).toEqual(["Avstängd", "Varningar kvar"]);
  });

  it("keeps a red-card player in the suspended group", () => {
    const groups = groupDiscipline([mk("Red", "red_suspended", 0, 0)], 3);
    expect(groups).toHaveLength(1);
    expect(groups[0].severity).toBe("suspended");
  });
});

describe("buildTimeline", () => {
  // This data existed in app.json and was never rendered by the old UI.
  const events: MatchEvents = {
    goals: [
      { minute: "63'", playerName: "Julius Lindberg", teamName: "BK Häcken", assistPlayerName: "Adrian Svanbäck", forHäcken: true },
      { minute: "2'", playerName: "Gustav Lindgren", teamName: "BK Häcken", assistPlayerName: null, forHäcken: true },
    ],
    yellowCards: [{ minute: "21'", playerName: "Amor Layouni", teamName: "BK Häcken" }],
    redCards: [],
    substitutions: [{ minute: "70'", inPlayer: "A", outPlayer: "B", teamName: "BK Häcken" }],
  };

  it("orders events chronologically", () => {
    const tl = buildTimeline(events).filter((i): i is TimelineRowItem => i.kind !== "break");
    expect(tl.map((i) => i.minuteLabel)).toEqual(["2'", "21'", "63'", "70'"]);
  });

  it("inserts a half-time divider exactly once, before the first second-half event", () => {
    const tl = buildTimeline(events);
    const breaks = tl.filter((i) => i.kind === "break");
    expect(breaks).toHaveLength(1);
    const idx = tl.findIndex((i) => i.kind === "break");
    const next = tl[idx + 1];
    expect(next.kind !== "break" && next.minuteLabel).toBe("63'");
  });

  it("does not insert half-time when everything is first half", () => {
    // Explicit fixture: the spread of `events` would have kept the 70' sub.
    const firstHalf: MatchEvents = {
      goals: [{ minute: "10'", playerName: "A", teamName: "BK Häcken", assistPlayerName: null, forHäcken: true }],
      yellowCards: [{ minute: "21'", playerName: "B", teamName: "BK Häcken" }],
      redCards: [],
      substitutions: [],
    };
    expect(buildTimeline(firstHalf).some((i) => i.kind === "break")).toBe(false);
  });

  it("keeps assists with their goal", () => {
    const tl = buildTimeline(events);
    const goal = tl.find((i): i is TimelineRowItem => i.kind === "goal" && i.minuteLabel === "63'");
    expect(goal?.assist).toBe("Adrian Svanbäck");
  });

  it("returns an empty timeline for missing data rather than throwing", () => {
    expect(buildTimeline(null)).toEqual([]);
    expect(buildTimeline(undefined)).toEqual([]);
  });

  it("skips substitutions with no players named", () => {
    const tl = buildTimeline({ ...events, substitutions: [{ minute: "60'", inPlayer: null, outPlayer: null, teamName: "BK Häcken" }] });
    expect(tl.some((i) => i.kind === "sub")).toBe(false);
  });
});

describe("scorerLine", () => {
  it("summarises Häcken's own goals only", () => {
    const ev: MatchEvents = {
      goals: [
        { minute: "2'", playerName: "Gustav Lindgren", teamName: "BK Häcken", assistPlayerName: null, forHäcken: true },
        { minute: "34'", playerName: "Gustav Lindgren", teamName: "BK Häcken", assistPlayerName: null, forHäcken: true },
        { minute: "10'", playerName: "Opponent", teamName: "Kalmar FF", assistPlayerName: null, forHäcken: false },
      ],
      yellowCards: [],
      redCards: [],
      substitutions: [],
    };
    const line = scorerLine(ev);
    expect(line).toContain("Lindgren");
    expect(line).not.toContain("Opponent");
  });

  it("returns an empty string when there are no Häcken goals", () => {
    expect(scorerLine({ goals: [], yellowCards: [], redCards: [], substitutions: [] })).toBe("");
  });
});

describe("time helpers", () => {
  it("daysUntil counts whole days and returns null in the past", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(daysUntil("2026-09-26T11:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-09-25T13:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-09-20T12:00:00Z", now)).toBeNull();
  });

  it("fmtWhen is relative for recent items and absolute after a day", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(fmtWhen("2026-09-25T11:45:00Z", now)).toBe("15 min");
    expect(fmtWhen("2026-09-25T06:00:00Z", now)).toBe("6 h");
    expect(fmtWhen("2026-09-20T12:00:00Z", now)).not.toMatch(/h|min/);
  });

  it("groupLabel buckets by recency", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(groupLabel("2026-09-25T08:00:00Z", now)).toBe("I dag");
    expect(groupLabel("2026-09-24T08:00:00Z", now)).toBe("I går");
    expect(groupLabel("2026-09-22T08:00:00Z", now)).toBe("För 3 dagar sedan");
  });
});

// ---------------------------------------------------------------------------
// Squad — the Trupp destination
// ---------------------------------------------------------------------------

describe("squadByPosition", () => {
  const p = (name: string, group: SeasonPlayerStat["positionGroup"], played = 0) =>
    ({
      playerId: `fogis:${name}`,
      playerName: name,
      positionGroup: group,
      matchesPlayed: played,
      matchesStarted: played,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      competition: "Allsvenskan 2026",
    }) as SeasonPlayerStat;

  it("orders groups the way a team sheet reads: keepers, defence, midfield, attack", () => {
    const groups = squadByPosition([
      p("Anfallare", "forwards"),
      p("Mittfältare", "midfields"),
      p("Försvarare", "defenders"),
      p("Målvakt", "goalkeepers"),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["goalkeepers", "defenders", "midfields", "forwards"]);
    expect(groups.map((g) => g.label)).toEqual(["Målvakter", "Försvar", "Mittfält", "Anfall"]);
  });

  it("omits position groups that have no players", () => {
    const groups = squadByPosition([p("Målvakt", "goalkeepers"), p("Anfallare", "forwards")]);
    expect(groups.map((g) => g.group)).toEqual(["goalkeepers", "forwards"]);
  });

  it("returns an empty array for an empty squad rather than throwing", () => {
    expect(squadByPosition([])).toEqual([]);
  });

  it("sorts regulars first, and the order is stable across calls", () => {
    const squad = [
      p("Nils Nyby", "midfields", 2),
      p("Adam Adofsson", "midfields", 20),
      p("Bo Bertilsson", "midfields", 11),
    ];
    const once = squadByPosition(squad)[0].players.map((x) => x.playerName);
    const twice = squadByPosition([...squad].reverse())[0].players.map((x) => x.playerName);
    expect(once).toEqual(["Adam Adofsson", "Bo Bertilsson", "Nils Nyby"]);
    expect(twice).toEqual(once);
  });
});

describe("currentSquadDiscipline", () => {
  const squad = [
    { playerId: "fogis:1", playerName: "Abdoulaye Doumbia", positionGroup: "defenders", matchesPlayed: 1, matchesStarted: 1, goals: 0, assists: 0, yellowCards: 0, redCards: 0, competition: null },
    { playerId: "fogis:2", playerName: "Brice Wembangomo", positionGroup: "midfields", matchesPlayed: 1, matchesStarted: 1, goals: 0, assists: 0, yellowCards: 0, redCards: 0, competition: null },
  ] as SeasonPlayerStat[];

  const d = (playerId: string, playerName: string, status: PlayerDiscipline["status"]): PlayerDiscipline => ({
    playerId,
    playerName,
    warningCount: 3,
    warningsUntilSuspension: 1,
    redCards: 0,
    status,
    relevantWarnings: [],
    incomplete: false,
  });

  it("keeps a departed player out of the current-squad ledger", () => {
    // The real regression: Amor Layouni had left the club but was still
    // listed as "at_risk", so Brief told supporters he was one card from a
    // suspension for a team he no longer played for.
    const ledger = [
      d("fogis:1", "Abdoulaye Doumbia", "suspended_next"),
      d("name:amor layouni", "Amor Layouni", "at_risk"),
    ];
    const kept = currentSquadDiscipline(ledger, squad);
    expect(kept.map((x) => x.playerName)).toEqual(["Abdoulaye Doumbia"]);
  });

  it("matches on the canonical id, not on name similarity", () => {
    const ledger = [d("fogis:2", "Brice Wembangomo", "at_risk")];
    expect(currentSquadDiscipline(ledger, squad)).toHaveLength(1);
  });

  it("falls back to a diacritic-insensitive name match when only a name survived", () => {
    const ledger = [d("name:brice wembaNgomo", "Brice Wembangomo", "at_risk")];
    expect(currentSquadDiscipline(ledger, squad)).toHaveLength(1);
  });

  it("returns an empty list when there is no squad to scope against", () => {
    expect(currentSquadDiscipline([d("fogis:1", "Abdoulaye Doumbia", "at_risk")], [])).toEqual([]);
    expect(currentSquadDiscipline(undefined, squad)).toEqual([]);
  });
});
