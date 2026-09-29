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
import { nameKeyOf } from "./playerIdentity";

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
  /** Exactly one warning short of a suspension (warningsUntilSuspension === threshold - 1). */
  | "at_risk"
  | "suspended_next" // threshold reached, suspension not yet served
  | "served" // suspension already served
  | "red_suspended" // red card → suspension (serving window unknown)
  | "unknown"
  /**
   * E-005 — the player is not in the current squad. Their cards stay in the
   * ledger (they are real), but they carry no CURRENT risk: they cannot be
   * suspended by a club they no longer play for. Terminal — never upgraded
   * back into a forward-looking risk by this engine.
   */
  | "departed";

/**
 * Current-squad membership, as a tri-state rather than a bare list.
 *
 * `known: false` means membership could NOT be established (e.g. the squad
 * query failed and `squadStats` is `[]`). That is a materially different fact
 * from "this club has zero registered players", and conflating them would let
 * a transient upstream failure demote the entire ledger to `departed` — a
 * silent, total wipe of the risk classification. The distinction is the whole
 * reason this is an object and not `SeasonPlayerStat[]`.
 */
export interface CurrentSquad {
  players: Array<{ playerId: string; playerName: string }>;
  /** False when the squad could not be retrieved. Filtering is then skipped. */
  known: boolean;
}

/** Statuses that assert a live, forward-looking suspension risk. */
const FORWARD_LOOKING: ReadonlySet<DisciplineStatus> = new Set<DisciplineStatus>(["at_risk", "suspended_next"]);

export interface PlayerDiscipline {
  playerId: string;
  playerName: string;
  warningCount: number;
  /**
   * Warnings that still count toward the NEXT suspension, i.e. those not
   * already consumed by a served suspension. Equals `warningCount` when no
   * suspension has been served.
   *
   * This is the number the UI must use: a player with 5 season warnings who
   * served a suspension 2 matches ago is NOT "one warning from suspension"
   * because the earlier 3 no longer count. Showing the season total next to a
   * fixed "one warning away" label is self-contradictory.
   */
  warningsUntilSuspension: number;
  redCards: number;
  status: DisciplineStatus;
  /** Warnings counting toward the next threshold (chronological). */
  relevantWarnings: Array<{ matchId: number; date: string }>;
  /** Date of the match that served a suspension, when detectable. */
  servedAt?: string;
  /** True when the ledger is incomplete (missing matches) — status may be UNKNOWN. */
  incomplete: boolean;
  /**
   * E-005 — true when the player is not in the current squad. Set for
   * `status: "departed"`; the row is retained because the cards are real.
   */
  departed?: boolean;
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
 * @param currentSquad REQUIRED. The current men's squad membership, used to
 *   stop a departed player carrying a forward-looking risk (E-005). Deliberately
 *   not optional and not defaulted: an optional parameter that means "no
 *   filtering" would silently recreate the defect the moment a caller omits it.
 *   Pass `{ players: [], known: false }` when membership is genuinely unknown —
 *   that skips filtering rather than declaring everyone departed.
 */
export function computeSeasonDiscipline(
  events: CardEvent[],
  rule: DisciplineRule,
  finishedMatchDates: string[],
  nextMatch: { matchId: number; date: string } | null,
  currentSquad: CurrentSquad,
): PlayerDiscipline[] {
  // Membership is matched on the canonical id first, with a normalised-name
  // fallback. The fallback matters: event ids for non-squad players are
  // name-derived, so a current player whose id drifted would otherwise be
  // wrongly demoted. Normalising here mirrors `currentSquadDiscipline()` in
  // app/shared/format.ts, which stays as defence in depth.
  const squadIds = new Set(currentSquad.players.map((p) => p.playerId));
  const squadNames = new Set(currentSquad.players.map((p) => nameKeyOf(p.playerName)));
  const inSquad = (playerId: string, playerName: string): boolean =>
    !currentSquad.known || squadIds.has(playerId) || squadNames.has(nameKeyOf(playerName));

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
    // Warnings still counting toward the next suspension.
    let pending = warningCount;
    let status: DisciplineStatus = "none";
    let servedAt: string | undefined;

    const departed = !inSquad(playerId, name);

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
          pending = afterServed.length;
          if (pending >= rule.threshold) {
            status = "suspended_next";
          } else if (pending === rule.threshold - 1) {
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

    // E-005 — a player who has left the club cannot be suspended by it. The
    // two forward-looking statuses are therefore demoted to `departed`.
    //
    // Deliberately narrow:
    //   • `served` and `red_suspended` are HISTORICAL facts about a real
    //     suspension; rewriting them would corrupt the record. They stay.
    //   • `unknown` stays, because we did not learn the status from squad
    //     membership — we lack the finished-match data to determine it.
    //   • The card history, `warningCount`, `warningsUntilSuspension`,
    //     `servedAt` and `relevantWarnings` are all left untouched. Only the
    //     current-risk classification changes.
    if (departed && FORWARD_LOOKING.has(status)) {
      status = "departed";
    }

    // The ledger is incomplete when we could not verify which matches have
    // finished — served detection is then unreliable.
    const incomplete = finishedMatchDates.length === 0 && warningCount > 0;

    out.push({
      playerId,
      playerName: name,
      warningCount,
      warningsUntilSuspension: pending,
      redCards: reds.length,
      status,
      relevantWarnings: relevant.map((w) => ({ matchId: w.matchId, date: w.matchDate })),
      ...(servedAt ? { servedAt } : {}),
      incomplete,
      ...(departed ? { departed: true } : {}),
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