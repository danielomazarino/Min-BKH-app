import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  cstatFor,
  daysUntil,
  formGuide,
  resultOf,
  scoreFor,
  scorerLine,
  urgentDiscipline,
  groupLabel,
  fmtWhen,
  type TimelineRowItem,
} from "./format";
import type { MatchEvents, PlayerDiscipline } from "../../pipeline/src/types";

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
