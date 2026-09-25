import type {
  Competition,
  LeagueTableRow,
  MatchRef,
  PlayerMatchStat,
} from "./types";
import { ALLSVENSKAN_LEAGUE_ID, BKH_TEAM_ID, type FixtureResponse } from "./apifootball";

export function competitionFromLeague(leagueId: number, leagueName: string): Competition {
  if (leagueId === ALLSVENSKAN_LEAGUE_ID || /allsvenskan/i.test(leagueName)) return "allsvenskan";
  if (/svenska cupen/i.test(leagueName)) return "svenska-cupen";
  if (/champions|europa|conference|uefa/i.test(leagueName)) return "europa";
  return "other";
}

const FINISHED = new Set(["FT", "AET", "PEN"]);
const SCHEDULED = new Set(["NS", "TBD", "PST", "SCHEDULED"]);

export function normalizeFixture(f: FixtureResponse): MatchRef {
  const statusShort = f.fixture.status.short;
  const status: MatchRef["status"] = FINISHED.has(statusShort)
    ? "finished"
    : SCHEDULED.has(statusShort)
      ? statusShort === "PST"
        ? "postponed"
        : "scheduled"
      : "other";
  const homeAway: MatchRef["homeAway"] = f.teams.home.id === BKH_TEAM_ID ? "home" : "away";
  const opponent = homeAway === "home" ? f.teams.away.name : f.teams.home.name;
  const venue = f.fixture.venue?.name?.trim() || undefined;
  return {
    id: f.fixture.id,
    competition: competitionFromLeague(f.league.id, f.league.name),
    season: String(f.league.season),
    date: f.fixture.date,
    homeAway,
    opponent,
    status,
    scoreHome: f.goals.home ?? undefined,
    scoreAway: f.goals.away ?? undefined,
    venue,
  };
}

export function sortMatches(matches: MatchRef[]): MatchRef[] {
  return [...matches].sort((a, b) => a.date.localeCompare(b.date));
}

export function pickNextAndLast(matches: MatchRef[]): { next: MatchRef | null; last: MatchRef | null; upcoming: MatchRef[]; recent: MatchRef[] } {
  const now = new Date().toISOString();
  const upcoming = sortMatches(matches.filter((m) => m.date > now && (m.status === "scheduled" || m.status === "other")));
  const finished = sortMatches(matches.filter((m) => m.status === "finished" && m.date <= now));
  const next = upcoming[0] ?? null;
  const last = finished[finished.length - 1] ?? null;
  return { next, last, upcoming: upcoming.slice(0, 10), recent: finished.slice(-10).reverse() };
}

export interface StandingRow {
  rank: number;
  team: { name: string };
  all: { played: number | null; goals: { diff: number | null } | null } | null;
  points: number | null;
}

export function normalizeTable(rows: StandingRow[]): LeagueTableRow[] {
  return rows.map((r) => ({
    rank: r.rank,
    team: r.team?.name ?? "Okänd",
    played: r.all?.played ?? 0,
    points: r.points ?? 0,
    goalDiff: r.all?.goals?.diff ?? 0,
  }));
}

export interface ApiPlayerStat {
  player: { id: number; name: string };
  statistics: Array<{
    games: { minutes: number | null; position?: string; captain?: boolean; substitute?: boolean };
    goals: { total: number | null; assists: number | null };
    cards: { yellow: number | null; red: number | null };
  }>;
}

export function normalizePlayerStats(rows: ApiPlayerStat[]): PlayerMatchStat[] {
  const out: PlayerMatchStat[] = [];
  for (const row of rows) {
    const s = row.statistics[0];
    if (!s) continue;
    out.push({
      playerId: row.player.id,
      playerName: row.player.name,
      minutes: s.games.minutes,
      goals: s.goals.total ?? 0,
      assists: s.goals.assists ?? 0,
      yellowCards: s.cards.yellow ?? 0,
      redCards: s.cards.red ?? 0,
      starter: !s.games.substitute,
    });
  }
  return out;
}
