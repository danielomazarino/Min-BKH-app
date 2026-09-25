/**
 * Normalizers for SportoMedia GraphQL data → app types.
 * All functions are pure and unit-testable.
 */
import type { LeagueTableRow, MatchRef, PlayerMatchStat, SeasonPlayerStat } from "./types";
import { BKH_ABBRV, HAMMARBY_ABBRV, type SmMatch, type SmMatchEvent, type SmSquadPlayer, type SmStandingsRow } from "./sportomedia";
import { resolveCanonicalId } from "./playerIdentity";

/** Guard: Hammarby data must never be presented as BK Häcken. Throws on violation. */
export function assertNotHammarby(abbrv: string, context: string): void {
  if (abbrv === HAMMARBY_ABBRV) {
    throw new Error(`IDENTITY VIOLATION (${context}): Hammarby (${HAMMARBY_ABBRV}) data must never be used for BK Häcken`);
  }
}

/**
 * Validate that a match record belongs to BK Häcken's fixture list:
 * exactly one side must be BKH. Hammarby as the OPPONENT is legitimate
 * (they play in the same league); Hammarby AS Häcken's side is a violation.
 */
export function assertMatchBelongsToHäcken(homeAbbrv: string, visitingAbbrv: string): void {
  const homeIsBkh = homeAbbrv === BKH_ABBRV;
  const visitingIsBkh = visitingAbbrv === BKH_ABBRV;
  if (homeIsBkh && visitingIsBkh) {
    throw new Error(`IDENTITY VIOLATION: both teams marked as ${BKH_ABBRV}`);
  }
  if (!homeIsBkh && !visitingIsBkh) {
    throw new Error(`IDENTITY VIOLATION: match does not involve ${BKH_ABBRV} (got ${homeAbbrv} vs ${visitingAbbrv})`);
  }
  // The Häcken side must not secretly be Hammarby.
  const häckenSide = homeIsBkh ? homeAbbrv : visitingAbbrv;
  if (häckenSide !== BKH_ABBRV) {
    throw new Error(`IDENTITY VIOLATION: Häcken side is ${häckenSide}, expected ${BKH_ABBRV}`);
  }
}

/** Convert SportoMedia gameTime (seconds) to a display minute string. */
export function gameTimeToMinute(gameTime: number | null): string | null {
  if (gameTime == null) return null;
  const minute = Math.floor(gameTime / 60);
  return `${minute}'`;
}

/** Map SportoMedia match status to our MatchRef status. */
export function smStatusToMatchStatus(status: string): MatchRef["status"] {
  switch (status) {
    case "FINISHED":
      return "finished";
    case "UPCOMING":
    case "SCHEDULED":
      return "scheduled";
    case "POSTPONED":
    case "CANCELLED":
      return "postponed";
    default:
      return "other";
  }
}

export function normalizeSmMatch(m: SmMatch): MatchRef {
  assertMatchBelongsToHäcken(m.homeTeamAbbrv, m.visitingTeamAbbrv);
  const homeAway: MatchRef["homeAway"] = m.homeTeamAbbrv === BKH_ABBRV ? "home" : "away";
  const opponent = homeAway === "home" ? m.visitingTeamName : m.homeTeamName;
  const finished = m.status === "FINISHED";
  return {
    id: m.id,
    competition: "allsvenskan",
    season: "2026",
    date: m.startDate,
    homeAway,
    opponent,
    status: smStatusToMatchStatus(m.status),
    scoreHome: finished ? m.homeTeamScore : undefined,
    scoreAway: finished ? m.visitingTeamScore : undefined,
    venue: m.arenaName ?? undefined,
  };
}

/** stats names in SportoMedia standings: gp, w, t (draws), l, gf, ga, d (diff), pts */
export function normalizeSmStandings(rows: SmStandingsRow[]): LeagueTableRow[] {
  return rows.map((r) => {
    const stats: Record<string, string> = {};
    for (const s of r.stats) stats[s.name] = s.value;
    const gf = Number(stats.gf ?? 0);
    const ga = Number(stats.ga ?? 0);
    return {
      rank: r.position,
      team: r.teamName,
      played: Number(stats.gp ?? 0),
      points: Number(stats.pts ?? 0),
      goalDiff: Number.isFinite(Number(stats.d)) ? Number(stats.d) : gf - ga,
    };
  });
}

/** Goal events with assist info, minute converted from seconds. */
export interface NormalizedGoal {
  minute: string | null;
  playerName: string;
  teamName: string | null;
  assistPlayerName: string | null;
  forHäcken: boolean;
}

/** Yellow-card events for a team. */
export interface NormalizedCard {
  minute: string | null;
  playerName: string;
  teamName: string | null;
}

export interface NormalizedSub {
  minute: string | null;
  inPlayer: string | null;
  outPlayer: string | null;
  teamName: string | null;
}

export interface NormalizedMatchEvents {
  goals: NormalizedGoal[];
  yellowCards: NormalizedCard[];
  redCards: NormalizedCard[];
  substitutions: NormalizedSub[];
}

export function normalizeSmEvents(events: SmMatchEvent[] | undefined | null): NormalizedMatchEvents {
  const out: NormalizedMatchEvents = { goals: [], yellowCards: [], redCards: [], substitutions: [] };
  if (!events) return out;
  for (const e of events) {
    const minute = gameTimeToMinute(e.gameTime);
    switch (e.type) {
      case "GOAL":
        out.goals.push({ minute, playerName: e.playerName ?? "Okänd", teamName: e.teamName, assistPlayerName: e.assistPlayerName ?? null, forHäcken: e.teamName?.includes("Häcken") ?? false });
        break;
      case "WARNING":
        out.yellowCards.push({ minute, playerName: e.playerName ?? "Okänd", teamName: e.teamName });
        break;
      case "SENDING_OFF":
      case "RED_CARD":
        out.redCards.push({ minute, playerName: e.playerName ?? "Okänd", teamName: e.teamName });
        break;
      case "SUBSTITUTION":
        out.substitutions.push({ minute, inPlayer: e.inPlayerName, outPlayer: e.outPlayerName, teamName: e.teamName });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Squad players → PlayerMatchStat-like season stats for the app. */
export function normalizeSmSquadStats(players: SmSquadPlayer[]): PlayerMatchStat[] {
  return players
    .filter((p) => p.currentSeasonStats)
    .map((p) => ({
      playerId: resolveCanonicalId({ fogisId: p.fogisId ?? null, name: `${p.givenName} ${p.surName}`.trim() }),
      playerName: `${p.givenName} ${p.surName}`.trim(),
      minutes: null, // per-season minutes not provided by currentSeasonStats
      goals: p.currentSeasonStats?.goals ?? 0,
      assists: p.currentSeasonStats?.assists ?? 0,
      yellowCards: p.currentSeasonStats?.yellowCards ?? 0,
      redCards: p.currentSeasonStats?.redCards ?? 0,
      starter: false,
    }));
}

/** Deterministic id from name when fogisId is missing. */
export function hashId(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Season stats shape comes from types.ts (canonical string playerId). */

export function normalizeSmSquad(squad: { goalkeepers: SmSquadPlayer[]; defenders: SmSquadPlayer[]; midfields: SmSquadPlayer[]; forwards: SmSquadPlayer[] }): SeasonPlayerStat[] {
  const out: SeasonPlayerStat[] = [];
  const groups = ["goalkeepers", "defenders", "midfields", "forwards"] as const;
  for (const g of groups) {
    for (const p of squad[g as keyof typeof squad] ?? []) {
      const st = p.currentSeasonStats;
      const playerName = `${p.givenName} ${p.surName}`.trim();
      out.push({
        playerId: resolveCanonicalId({ fogisId: p.fogisId ?? null, name: playerName }),
        playerName,
        positionGroup: g,
        matchesPlayed: st?.matchesPlayed ?? 0,
        matchesStarted: st?.matchesStarted ?? 0,
        goals: st?.goals ?? 0,
        assists: st?.assists ?? 0,
        yellowCards: st?.yellowCards ?? 0,
        redCards: st?.redCards ?? 0,
        competition: st?.competitionDisplayName ?? null,
      });
    }
  }
  return out;
}