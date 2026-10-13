/**
 * On-demand lineup lookup — the pattern the user approved for this feature
 * (2026-10-14): fetch ONCE when the user taps, like the player Wikipedia
 * lookup. NO polling, NO notifications, NO scheduled fetch, NO background
 * refresh. The result lives in component state only; leaving the sheet
 * discards it, and re-tapping re-fetches.
 *
 * WHY BROWSER-SIDE IS POSSIBLE HERE: gql.sportomedia.se reflects any Origin
 * in `access-control-allow-origin` (measured 2026-10-14 with both the
 * production origin and localhost), so the PWA can call it directly. The
 * pipeline never relied on this because it runs server-side.
 *
 * WHY IT CAN STILL COME BACK EMPTY: lineups are published close to kickoff
 * (often ~1 hour before). A query days before the match legitimately returns
 * no lineup — that is "not published yet", not an error, and the UI says so
 * in words.
 *
 * The query mirrors the pipeline's `lineupsQuery` (pipeline/src/
 * sportomedia.ts) so both sides agree on the shape. It is deliberately NOT
 * imported from the pipeline: the pipeline module pulls in `trackedFetch`
 * and the api-metrics recorder, which are server-side concerns the app must
 * not bundle.
 */
import type { SmLineups } from "../../pipeline/src/sportomedia";

const ENDPOINT = "https://gql.sportomedia.se/graphql";

/** Allsvenskan config ids — must match the pipeline's constants. */
const LEAGUE = "allsvenskan";
const SEASON_START = 2026;

export type LineupOutcome =
  | { kind: "ok"; lineups: SmLineups }
  | { kind: "not-published" }
  | { kind: "error"; message: string };

export async function fetchLineupOnDemand(
  matchId: number,
  fetchFn: typeof fetch = fetch,
): Promise<LineupOutcome> {
  const query = `{
  lineups(configLeagueName: "${LEAGUE}", configSeasonStartYear: ${SEASON_START}, id: ${matchId}) {
    ... on Lineups {
      homeTeam { abbrv formation starting { givenName surName position shirtNumber } substitutes { givenName surName } }
      visitingTeam { abbrv formation starting { givenName surName position shirtNumber } substitutes { givenName surName } }
    }
  }
}`;
  try {
    const res = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { kind: "error", message: `HTTP ${res.status}` };
    const json = (await res.json()) as {
      data?: { lineups?: SmLineups | null };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors && json.errors.length > 0) {
      // A not-yet-published lineup surfaces as a GraphQL error or null data
      // depending on the server mood; both mean "nothing to show yet".
      return { kind: "not-published" };
    }
    const l = json.data?.lineups;
    if (!l || (!l.homeTeam && !l.visitingTeam)) return { kind: "not-published" };
    return { kind: "ok", lineups: l };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
