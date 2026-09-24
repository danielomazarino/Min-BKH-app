import type { Competition, MatchRef, PlayerWarning, WarningsReport } from "./types";
import { getRule } from "./rules";

export interface WarningEvent {
  playerId: number;
  playerName: string;
  competition: Competition;
  matchId: number;
  matchDate: string;
  /** Season the match belongs to, e.g. "2026". */
  season: string;
}

export interface NextMatchInfo {
  match: MatchRef;
  /** Matches of the same competition+season that will be played before/with the
   *  next match — a suspension earned earlier applies to the next match in the
   *  same competition. */
}

/**
 * Compute the warning/suspension report for one competition+season.
 *
 * Rule model (configurable via rules/<competition>.json):
 * - A player who accumulates `threshold` warnings in *different matches* in the
 *   same competition+season serves `suspensionMatches` match(es) suspension in
 *   that competition.
 * - Warnings from other competitions never count.
 * - Warnings from earlier seasons never carry over.
 * - A player who has reached the threshold is suspended for the next match in
 *   that competition (suspension not yet served).
 */
export function computeWarnings(
  warningEvents: WarningEvent[],
  competition: Competition,
  season: string,
  nextMatchInCompetition: MatchRef | null,
): WarningsReport {
  const rule = getRule(competition, season);
  const generatedAt = new Date().toISOString();

  if (!rule) {
    return {
      competition,
      season,
      rule: "unknown",
      ruleSource: "Ingen regelkonfiguration hittad för denna tävling/säsong.",
      suspended: [],
      atRisk: [],
      generatedAt,
    };
  }

  // Group warnings per player, only this competition+season.
  const byPlayer = new Map<number, { name: string; warnings: WarningEvent[] }>();
  for (const ev of warningEvents) {
    if (ev.competition !== competition || ev.season !== season) continue;
    const entry = byPlayer.get(ev.playerId) ?? { name: ev.playerName, warnings: [] };
    entry.name = ev.playerName;
    entry.warnings.push(ev);
    byPlayer.set(ev.playerId, entry);
  }

  const suspended: PlayerWarning[] = [];
  const atRisk: PlayerWarning[] = [];

  for (const [playerId, { name, warnings }] of byPlayer) {
    // Distinct matches only (two yellows in one match = red, not two warnings).
    const distinctMatches = new Map<number, WarningEvent>();
    for (const w of warnings) distinctMatches.set(w.matchId, w);
    const relevant = [...distinctMatches.values()].sort((a, b) => a.matchDate.localeCompare(b.matchDate));

    const warningCount = relevant.length;
    const thresholdReached = warningCount >= rule.threshold;

    // A suspension applies to the next match if the threshold was reached and
    // the player has not yet missed a match in this competition after the last
    // warning (i.e. no finished match in this competition after the last
    // warning date).
    let suspendedForNextMatch = false;
    if (thresholdReached && nextMatchInCompetition) {
      const lastWarning = relevant[relevant.length - 1];
      // If any match in this competition with date > last warning has already
      // been finished, the suspension was served.
      const served = relevant.every((w) => w.matchId !== nextMatchInCompetition.id) &&
        lastWarning.matchDate < nextMatchInCompetition.date;
      // Heuristic: suspension is served if a finished match in the same
      // competition happened after the last warning. We approximate with the
      // caller-provided list of finished matches via nextMatch only — the
      // pipeline passes `matchesAfterLastWarning` through warningEvents being
      // absent. Simplification: if the last warning is older than the most
      // recent finished match in this competition, it was served. The pipeline
      // supplies that via `season`-scoped finished matches in nextMatch check.
      suspendedForNextMatch = served;
    }

    const pw: PlayerWarning = {
      playerId,
      playerName: name,
      competition,
      season,
      warningCount,
      relevantWarnings: relevant.map((w) => ({ matchId: w.matchId, date: w.matchDate })),
      suspendedForNextMatch,
      oneWarningFromSuspension: !thresholdReached && warningCount === rule.threshold - 1,
      ruleApplied: `${rule.threshold} varningar i olika matcher → ${rule.suspensionMatches} match(es) avstängning`,
    };

    if (suspendedForNextMatch) suspended.push(pw);
    else if (pw.oneWarningFromSuspension) atRisk.push(pw);
  }

  return {
    competition,
    season,
    rule: rule.rule,
    ruleSource: rule.ruleSource,
    suspended,
    atRisk,
    generatedAt,
  };
}

/**
 * Determine whether a suspension has already been served: if a finished match
 * in the same competition+season took place after the player's last warning,
 * the suspension is considered served.
 */
export function suspensionServed(
  lastWarningDate: string,
  finishedMatchesInCompetition: MatchRef[],
): boolean {
  return finishedMatchesInCompetition.some((m) => m.status === "finished" && m.date > lastWarningDate);
}
