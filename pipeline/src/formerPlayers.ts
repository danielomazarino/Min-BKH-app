/**
 * Former BK Häcken men's-team players, resolved from Wikidata at nightly time.
 *
 * WHY THIS EXISTS (user, 2026-10-09)
 * ----------------------------------
 * "The whole app is about sharing relevant news about current and former
 * players in the men's team of BK Häcken … no maintained lists allowed."
 *
 * The news classifier can only recognise a former player if it is told who the
 * former players are. The old hand-curated registry was retired on 2026-09-26
 * (a closed list lies by omission — a supporter who remembers a 32nd player
 * gets a confident "no match"), which left NO former-player signal at all. So
 * an article about Zeidane Inoussa was dropped as "no Häcken relation".
 *
 * This replaces the list with a live query against an open, citable source:
 * every human with P54 (member of sports team) = BK Häcken men's (Q639723) and
 * P106 (occupation) = association football player (Q937857). Measured
 * 2026-10-09: 305 players, ~6 s, one request.
 *
 * NO MAINTAINED LIST. The set is whatever Wikidata says today. A player who
 * joins or leaves is reflected without a code change.
 *
 * FAILURE IS NON-FATAL. A Wikidata outage returns an empty list; the nightly
 * then simply has no former-player signal for that run (current-squad news is
 * unaffected). It must never fail the pipeline.
 */

/** BK Häcken (men's), verified 2026-09-26. */
const HACKEN_MEN_QID = "Q639723";
/** "association football player" (Q937857), verified 2026-09-26. */
const FOOTBALLER_QID = "Q937857";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Every footballer whose P54 includes BK Häcken men's.
 *
 * `wdt:` is the direct (truthy) property path, so deprecated/ranked-down
 * statements are excluded — the same stance the app's own Wikidata reader
 * takes. The label service returns Swedish first, then English, so the names
 * match how the Swedish press writes them.
 */
export function buildFormerPlayersQuery(): string {
  return `SELECT ?player ?playerLabel WHERE {
  ?player wdt:P54 wd:${HACKEN_MEN_QID} .
  ?player wdt:P106 wd:${FOOTBALLER_QID} .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "sv,en". }
}`;
}

export interface FormerPlayersDeps {
  fetch: typeof fetch;
  log?: (msg: string) => void;
  /** Abort the request after this many ms. Default 20 s. */
  timeoutMs?: number;
}

/**
 * Fetch the display names of every footballer Wikidata records as a BK Häcken
 * men's-team player. Returns `[]` on any failure — never throws.
 */
export async function fetchFormerPlayers(deps: FormerPlayersDeps): Promise<string[]> {
  const log = deps.log ?? (() => {});
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(buildFormerPlayersQuery())}&format=json`;
    const res = await deps.fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        // Wikidata asks for a descriptive User-Agent; an anonymous one is
        // rate-limited harder.
        "User-Agent": "MinBKHApp/1.0 (nightly news classifier; +https://github.com/danielomazarino/Min-BKH-app)",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      log(`former players: Wikidata returned HTTP ${res.status} — no former-player signal this run`);
      return [];
    }
    const json = (await res.json()) as {
      results?: { bindings?: Array<{ playerLabel?: { value?: string } }> };
    };
    const names = (json.results?.bindings ?? [])
      .map((b) => b.playerLabel?.value)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    log(`former players: ${names.length} resolved from Wikidata`);
    return names;
  } catch (err) {
    log(`former players: fetch failed (${err instanceof Error ? err.message : String(err)}) — continuing without`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The former players: everyone Wikidata lists, minus the current squad.
 *
 * The subtraction is by normalized name, because the squad's spelling and
 * Wikidata's label can differ ("Mikkel Rygaard Jensen" vs "Mikkel Rygaard").
 * A current player who also appears in the P54 list must NOT be reported as
 * former — the classifier treats the two differently, and the current-squad
 * path is the more specific one.
 */
export function subtractCurrentSquad(all: readonly string[], currentSquad: readonly string[]): string[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  const current = new Set(currentSquad.map(norm));
  // Also drop a Wikidata label that is a prefix of a squad name (or vice
  // versa): "Mikkel Rygaard" is a prefix of "Mikkel Rygaard Jensen".
  const currentTokens = currentSquad.map(norm);
  return all.filter((name) => {
    const n = norm(name);
    if (current.has(n)) return false;
    if (currentTokens.some((c) => c.startsWith(n + " ") || n.startsWith(c + " "))) return false;
    return true;
  });
}
