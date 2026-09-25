/**
 * Season-level disciplinary engine.
 *
 * Rule (rules/allsvenskan.json): 3 warnings in DIFFERENT matches in the same
 * competition+season → 1 match suspension in that competition.
 *
 * The engine builds a chronological ledger from match card events and applies
 * the rule over time: a suspension is SERVED when a finished match in the same
 * competition occurred after the warning that reached the threshold.
 * Aggregate yellow-card totals are NOT sufficient evidence of a current
 * suspension — chronology matters.
 */
import type { Competition } from "./types";

export interface CardEvent {
  /** Canonical player id (from the identity layer). */
  playerId: string;
  playerName: string;
  competition: Competition;
  season: string;
  matchId: number;
  matchDate: string;
  kind: "yellow" | "red";
}

export interface NextMatchInfo {
  matchId: number;
  date: string;
}

export type DisciplineStatus =
  | "none"
  | "at_risk" // threshold - 1 warnings
  | "suspended_next" // threshold reached, suspension not yet served
  | "served" // suspension already served
  | "red_suspended" // red card → suspension (serving window unknown)
  | "unknown";

export interface PlayerDiscipline {
  playerId: string;
  playerName: string;
  warningCount: number;
  redCards: number;
  status: DisciplineStatus;
  /** Warnings counting toward the next threshold (chronological). */
  relevantWarnings: Array<{ matchId: number; date: string }>;
  /** Date of the match that served a suspension, when detectable. */
  servedAt?: string;
  /** True when the ledger is incomplete (missing matches) — status may be UNKNOWN. */
  incomplete: boolean;
}

export interface DisciplineRule {
  threshold: number;
  suspensionMatches: number;
}

/**
 * Compute the disciplinary ledger for one competition+season.
 *
 * @param events all card events for the club in the season (chronology derived internally)
 * @param finishedMatchDates match dates (sorted) of FINISHED matches in the same competition+season — used to detect served suspensions
 * @param nextMatch the upcoming match in the competition (or null)
 */
export function computeSeasonDiscipline(
  events: CardEvent[],
  rule: DisciplineRule,
  finishedMatchDates: string[],
  nextMatch: { matchId: number; date: string } | null,
): PlayerDiscipline[] {
  const byPlayer = new Map<string, { name: string; events: CardEvent[] }>();
  for (const ev of events) {
    const entry = byPlayer.get(ev.playerId) ?? { name: ev.playerName, events: [] as CardEvent[] };
    entry.name = ev.playerName;
    entry.events.push(ev);
    byPlayer.set(ev.playerId, entry);
  }

  const out: PlayerDiscipline[] = [];
  for (const [playerId, { name, events: all }] of byPlayer) {
    const yellows = all.filter((e) => e.kind === "yellow");
    const reds = all.filter((e) => e.kind === "red");

    // Distinct matches only: two yellows in one match = red, not two warnings.
    const distinctMatches = new Map<number, CardEvent>();
    for (const w of yellows) distinctMatches.set(w.matchId, w);
    const relevant = [...distinctMatches.values()].sort((a, b) => a.matchDate.localeCompare(b.matchDate));

    const warningCount = relevant.length;
    let status: DisciplineStatus = "none";
    let servedAt: string | undefined;

    if (reds.length > 0) {
      // Red card → suspension; whether it has been served cannot be proven
      // without official suspension records, so mark explicitly.
      status = "red_suspended";
    } else if (warningCount >= rule.threshold) {
      // Threshold reached at the date of the Nth warning. The suspension is
      // served if at least one finished match in the competition happened
      // after that warning date. Without finished dates we cannot prove
      // either way — status is unknown rather than guessed.
      if (finishedMatchDates.length === 0) {
        status = "unknown";
      } else {
        const thresholdDate = relevant[rule.threshold - 1].matchDate;
        const finishedAfter = finishedMatchDates.filter((d) => d > thresholdDate);
        if (finishedAfter.length >= rule.suspensionMatches) {
          status = "served";
          servedAt = finishedAfter[0];
          // Warnings after the served suspension count toward the NEXT threshold.
          const afterServed = relevant.filter((w) => w.matchDate > servedAt!);
          if (afterServed.length >= rule.threshold) {
            status = "suspended_next";
          } else if (afterServed.length === rule.threshold - 1) {
            status = "at_risk";
          }
        } else {
          status = "suspended_next";
        }
      }
    } else if (warningCount === rule.threshold - 1) {
      status = "at_risk";
    } else if (warningCount === 0 && reds.length === 0) {
      status = "none";
    }

    // The ledger is incomplete when we could not verify which matches have
    // finished — served detection is then unreliable.
    const incomplete = finishedMatchDates.length === 0 && warningCount > 0;

    out.push({
      playerId,
      playerName: name,
      warningCount,
      redCards: reds.length,
      status,
      relevantWarnings: relevant.map((w) => ({ matchId: w.matchId, date: w.matchDate })),
      ...(servedAt ? { servedAt } : {}),
      incomplete,
    });
  }

  // If a next match exists, players with "served" status may re-accumulate;
  // nothing extra to compute — the ledger already reflects chronology.
  void nextMatch;
  return out.sort((a, b) => b.warningCount - a.warningCount || a.playerName.localeCompare(b.playerName));
}

/**
 * Build a disciplinary ledger from per-match card events.
 * Deduplicates within a match (two yellows same match = one red-equivalent,
 * counted as a red for status purposes but the source already emits SENDING_OFF).
 */
export function buildLedger(
  perMatch: Array<{ matchId: number; matchDate: string; häckenYellows: string[]; häckenReds: string[] }>,
  idResolver: (playerName: string) => string,
  competition: Competition,
  season: string,
): CardEvent[] {
  const events: CardEvent[] = [];
  for (const m of perMatch) {
    for (const p of new Set(m.häckenYellows)) {
      events.push({ playerId: idResolver(p), playerName: p, competition, season, matchId: m.matchId, matchDate: m.matchDate, kind: "yellow" });
    }
    for (const p of new Set(m.häckenReds)) {
      events.push({ playerId: idResolver(p), playerName: p, competition, season, matchId: m.matchId, matchDate: m.matchDate, kind: "red" });
    }
  }
  return events;
}