/**
 * API-Football client (Free tier: 100 req/day, 10 req/min).
 * The key exists ONLY as an environment variable in GitHub Actions.
 */

const BASE = "https://v3.football.api-sports.io";

export const BKH_TEAM_ID = 363; // BK Häcken in API-Football (Allsvenskan)
export const ALLSVENSKAN_LEAGUE_ID = 113;
export const SEASON = 2026;

export interface ApiFootballStatus {
  ok: boolean;
  error?: string;
  rateLimitRemaining?: string;
}

let lastCall = 0;
const MIN_INTERVAL_MS = 6200; // stay under 10 req/min

async function call<T>(path: string, params: Record<string, string | number>): Promise<{ data: T | null; status: ApiFootballStatus }> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    return { data: null, status: { ok: false, error: "API_FOOTBALL_KEY not set — skipping API-Football" } };
  }
  // Rate-limit guard
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, {
      headers: { "x-apisports-key": key },
      signal: AbortSignal.timeout(20000),
    });
    const remaining = res.headers.get("x-ratelimit-requests-remaining") ?? undefined;
    if (!res.ok) return { data: null, status: { ok: false, error: `HTTP ${res.status}`, rateLimitRemaining: remaining } };
    const json = (await res.json()) as { response: T; errors: unknown };
    if (json.errors && Object.keys(json.errors).length > 0) {
      return { data: null, status: { ok: false, error: JSON.stringify(json.errors), rateLimitRemaining: remaining } };
    }
    return { data: json.response, status: { ok: true, rateLimitRemaining: remaining } };
  } catch (e) {
    return { data: null, status: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
}

export interface FixtureResponse {
  fixture: { id: number; date: string; status: { short: string; long: string } };
  league: { id: number; name: string; season: number };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}

export async function fetchFixtures(teamId: number, season: number): Promise<{ fixtures: FixtureResponse[] | null; status: ApiFootballStatus }> {
  const { data, status } = await call<FixtureResponse[]>("fixtures", { team: teamId, season });
  return { fixtures: data, status };
}

export async function fetchStandings(leagueId: number, season: number): Promise<{ data: unknown; status: ApiFootballStatus }> {
  return call("standings", { league: leagueId, season });
}

export async function fetchPlayerStatsForFixture(fixtureId: number): Promise<{ data: unknown; status: ApiFootballStatus }> {
  return call("fixtures/players", { fixture: fixtureId });
}

export async function fetchEvents(fixtureId: number): Promise<{ data: unknown; status: ApiFootballStatus }> {
  return call("fixtures/events", { fixture: fixtureId });
}

export async function fetchPlayerStatistics(playerId: number, season: number, leagueId: number): Promise<{ data: unknown; status: ApiFootballStatus }> {
  return call("players", { id: playerId, season, league: leagueId });
}

export async function searchPlayer(name: string): Promise<{ data: Array<{ player: { id: number; name: string } }> | null; status: ApiFootballStatus }> {
  return call("players", { search: name, season: SEASON });
}
