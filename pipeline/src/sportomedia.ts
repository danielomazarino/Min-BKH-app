/**
 * SportoMedia GraphQL client — the data service used by allsvenskan.se
 * (Svensk Elitfotboll's official competition site).
 *
 * Provenance (verified 2026-09-25, see docs/DATA-SOURCE-INVESTIGATION-2026.md):
 *   gql.sportomedia.se/graphql is referenced in allsvenskan.se page source and
 *   serves the official site's own match data. No authentication, no published
 *   API license, no robots.txt, no observed rate limits at low frequency.
 *   Permission classification: B — REASONABLY SUPPORTED (low-frequency use).
 *
 * This is the PRIMARY source for CURRENT football data (season 2026).
 * API-Football is historical only (seasons 2022–2024, team ID 367).
 */

const ENDPOINT_URL = "https://gql.sportomedia.se/graphql";

/** BK Häcken men's team abbreviation in SportoMedia (verified 2026-09-25). */
export const BKH_ABBRV = "BKH";
/** Hammarby's abbreviation — must NEVER be used for BK Häcken. */
export const HAMMARBY_ABBRV = "HAM";
export const ALLSVENSKAN_CONFIG_LEAGUE_NAME = "allsvenskan";
/** Current season (start year). Allsvenskan 2026 = season starting 2026. */
export const CURRENT_SEASON = 2026;

export interface SportoMediaStatus {
  ok: boolean;
  error?: string;
}

async function gql<T>(query: string): Promise<{ data: T | null; status: SportoMediaStatus }> {
  try {
    const res = await fetch(ENDPOINT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { data: null, status: { ok: false, error: `HTTP ${res.status}` } };
    }
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length) > 0) {
      return { data: null, status: { ok: false, error: JSON.stringify(json.errors).slice(0, 300) } };
    }
    if (!json.data) return { data: null, status: { ok: false, error: "Empty data" } };
    return { data: json.data, status: { ok: true } };
  } catch (e) {
    return { data: null, status: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
}

// ---------- raw response types (subset we consume) ----------

export interface SmStandingsRow {
  position: number;
  teamName: string;
  teamAbbrv: string;
  stats: Array<{ name: string; value: string }>;
}

export interface SmMatch {
  id: number;
  startDate: string;
  homeTeamName: string;
  visitingTeamName: string;
  homeTeamScore: number;
  visitingTeamScore: number;
  status: string;
  round: number | null;
  arenaName: string | null;
  homeTeamAbbrv: string;
  visitingTeamAbbrv: string;
}

export interface SmMatchEvent {
  type: string;
  gameTime: number | null;
  playerName: string | null;
  teamName: string | null;
  description: string | null;
  assistPlayerName: string | null;
  inPlayerName: string | null;
  outPlayerName: string | null;
}

export interface SmLineupPlayer {
  givenName: string;
  surName: string;
  position?: string | null;
  shirtNumber?: number | null;
}

export interface SmLineups {
  homeTeam: { abbrv: string; formation: string | null; starting: SmLineupPlayer[]; substitutes: SmLineupPlayer[] } | null;
  visitingTeam: { abbrv: string; formation: string | null; starting: SmLineupPlayer[]; substitutes: SmLineupPlayer[] } | null;
}

export interface SmSquadPlayer {
  givenName: string;
  surName: string;
  fogisId?: number | null;
  position?: string | null;
  shirtNumber?: number | null;
  nationality?: string | null;
  currentSeasonStats?: {
    matchesPlayed: number;
    goals: number;
    assists: number;
    yellowCards: number;
    redCards: number;
    matchesStarted: number;
    competitionDisplayName?: string | null;
  } | null;
}

// ---------- queries ----------

const STANDINGS_QUERY = `{
  standingsForLeague(configLeagueName: "allsvenskan", configSeasonStartYear: ${CURRENT_SEASON}, type: "total") {
    ... on Standings {
      standings { position teamName teamAbbrv stats { name value } }
    }
  }
}`;

function matchesQuery(from: string, to: string): string {
  return `{
  matchesForTeam(abbrv: "${BKH_ABBRV}", configSeasonStartYear: ${CURRENT_SEASON}, startDate: "${from}", endDate: "${to}") {
    matches {
      id startDate homeTeamName visitingTeamName homeTeamScore visitingTeamScore
      status round arenaName homeTeamAbbrv visitingTeamAbbrv
    }
  }
}`;
}

function matchDetailQuery(id: number): string {
  return `{
  match(id: ${id}, configLeagueName: "allsvenskan", configSeasonStartYear: ${CURRENT_SEASON}) {
    match {
      id startDate homeTeamName visitingTeamName homeTeamScore visitingTeamScore
      status arenaName fogisId
      matchEvents { type gameTime playerName teamName description assistPlayerName inPlayerName outPlayerName }
    }
  }
}`;
}

function lineupsQuery(id: number): string {
  return `{
  lineups(configLeagueName: "allsvenskan", configSeasonStartYear: ${CURRENT_SEASON}, id: ${id}) {
    ... on Lineups {
      homeTeam { abbrv formation starting { givenName surName position shirtNumber } substitutes { givenName surName } }
      visitingTeam { abbrv formation starting { givenName surName position shirtNumber } substitutes { givenName surName } }
    }
  }
}`;
}

const SQUAD_QUERY = `{
  squad(abbrv: "${BKH_ABBRV}", configSeasonStartYear: ${CURRENT_SEASON}) {
    ... on Squad {
      goalkeepers { givenName surName fogisId position shirtNumber nationality currentSeasonStats { matchesPlayed goals assists yellowCards redCards matchesStarted competitionDisplayName } }
      defenders { givenName surName fogisId position shirtNumber nationality currentSeasonStats { matchesPlayed goals assists yellowCards redCards matchesStarted competitionDisplayName } }
      midfields { givenName surName fogisId position shirtNumber nationality currentSeasonStats { matchesPlayed goals assists yellowCards redCards matchesStarted competitionDisplayName } }
      forwards { givenName surName fogisId position shirtNumber nationality currentSeasonStats { matchesPlayed goals assists yellowCards redCards matchesStarted competitionDisplayName } }
    }
  }
}`;

// ---------- fetchers ----------

export async function fetchStandingsSm(): Promise<{ rows: SmStandingsRow[] | null; status: SportoMediaStatus }> {
  const { data, status } = await gql<{ standingsForLeague: { standings: SmStandingsRow[] } }>(STANDINGS_QUERY);
  const rows = data?.standingsForLeague?.standings ?? null;
  if (status.ok && (!rows || rows.length === 0)) {
    return { rows: null, status: { ok: false, error: "Standings empty — season may not have started" } };
  }
  return { rows, status };
}

export async function fetchMatchesSm(from: string, to: string): Promise<{ matches: SmMatch[] | null; status: SportoMediaStatus }> {
  const { data, status } = await gql<{ matchesForTeam: { matches: SmMatch[] } }>(matchesQuery(from, to));
  return { matches: data?.matchesForTeam?.matches ?? null, status };
}

export async function fetchMatchDetailSm(id: number): Promise<{ match: (SmMatch & { fogisId?: number | null; matchEvents?: SmMatchEvent[] }) | null; status: SportoMediaStatus }> {
  const { data, status } = await gql<{ match: { match: SmMatch & { fogisId?: number | null; matchEvents?: SmMatchEvent[] } } }>(matchDetailQuery(id));
  return { match: data?.match?.match ?? null, status };
}

export async function fetchLineupsSm(id: number): Promise<{ lineups: SmLineups | null; status: SportoMediaStatus }> {
  const { data, status } = await gql<{ lineups: SmLineups }>(lineupsQuery(id));
  return { lineups: data?.lineups ?? null, status };
}

export async function fetchSquadSm(): Promise<{ squad: { goalkeepers: SmSquadPlayer[]; defenders: SmSquadPlayer[]; midfields: SmSquadPlayer[]; forwards: SmSquadPlayer[] } | null; status: SportoMediaStatus }> {
  const { data, status } = await gql<{ squad: { goalkeepers: SmSquadPlayer[]; defenders: SmSquadPlayer[]; midfields: SmSquadPlayer[]; forwards: SmSquadPlayer[] } }>(SQUAD_QUERY);
  const s = data?.squad ?? null;
  if (status.ok && !s) return { squad: null, status: { ok: false, error: "Squad empty" } };
  return { squad: s, status };
}