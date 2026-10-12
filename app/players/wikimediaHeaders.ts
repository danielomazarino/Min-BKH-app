/**
 * The User-Agent every Wikimedia-facing request must carry.
 *
 * WHY THIS EXISTS (measured 2026-10-12)
 * -------------------------------------
 * Wikimedia's API policy REQUIRES a descriptive User-Agent, and the penalty
 * for omitting it is a hard HTTP 429 — not a descriptive error. Measured on
 * identical URLs from the same machine, same minute:
 *
 *   node fetch without User-Agent  ->  429 (Wikimedia error page)
 *   node fetch with User-Agent     ->  200
 *
 * The nightly pipeline runs in Node, where `fetch` sends NO User-Agent by
 * default. `wikidata.ts` already knew this (measured 2026-09-26) and set the
 * header — which is why the pipeline's SEARCH step always resolved a Q-ID.
 * But `infobox.ts`, `wikipedia.ts` and `translate.ts` sent only `Accept`,
 * so every infobox and summary request from the nightly was 429'd and
 * silently swallowed into `null` ("nothing verified to add"). The result was
 * served: 19 of 26 squad players degraded between 2026-10-09 and 2026-10-12
 * (Rygaard 11 career rows -> 2, Wembangomo 7 -> 1, wiki narratives gone),
 * while the in-app SEARCH tab kept showing full data — the browser supplies
 * its own User-Agent, so the live path never hit the 429.
 *
 * A browser CANNOT set User-Agent from fetch() — it is a forbidden header
 * name, and the browser replaces it with its own. So this header matters for
 * the PIPELINE (Node) and is expected to be ignored (never to throw) in the
 * browser, where the browser's own UA takes over.
 */
export const WIKIMEDIA_USER_AGENT =
  "MinBkhApp/1.0 (supporter PWA; +https://github.com/danielomazarino/Min-BKH-app)";

/**
 * Headers for a Wikimedia-facing request: the mandatory User-Agent plus the
 * JSON accept the parsers expect. Spread the result AFTER any caller-supplied
 * headers so the UA is never lost, and never override an explicit Accept.
 */
export function wikimediaHeaders(extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), Accept: "application/json", "User-Agent": WIKIMEDIA_USER_AGENT };
}
