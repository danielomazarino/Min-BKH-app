/**
 * Player name normalization and local candidate ranking.
 *
 * This module contains NO I/O. It exists so the network layer stays thin and so
 * the matching rules are unit-testable without a network — which matters,
 * because a matching regression here silently returns the wrong person rather
 * than failing loudly.
 *
 * Two facts from measurement shaped this file:
 *
 *  1. Wikidata's indexed search already resolves aliases for us. Searching
 *     "David Marek" returns Q727444 "David Frölund" first, because Marek is
 *     recorded as an alias. We therefore do NOT maintain our own alias table
 *     — the source of truth is the source.
 *
 *  2. Unaccented input still matches accented labels ("Bjarsmy" -> Q518833
 *     "Mattias Bjärsmyr"). That works because the index folds accents, but it
 *     is fragile enough that we normalize on our side too rather than depend
 *     on it staying that way.
 */

/** Icelandic letters that NFD does not decompose, folded to ASCII equivalents. */
const NON_DECOMPOSING: Record<string, string> = {
  ð: "d", // eth
  đ: "d", // crossed d
  þ: "th", // thorn
  Þ: "th", // thorn
  ł: "l", // l with stroke
  Ł: "l",
  ø: "o",
  Ø: "o",
  æ: "ae",
  Æ: "ae",
  ß: "ss",
  ı: "i",
  ĸ: "k",
};

/**
 * Normalize a person's name for matching.
 *
 * Lowercases, decomposes and strips diacritics, folds the non-decomposing
 * letters above, turns every separator into a single space and trims. The
 * result is ASCII-ish and stable, so equality on this value is a meaningful
 * claim about identity of the NAME STRING — never about identity of the person.
 */
export function normalizePlayerName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u00f0\u0111\u00fe\u00de\u0142\u0141\u00f8\u00d8\u00e6\u00c6\u00df\u0131\u0138]/g, (c) => NON_DECOMPOSING[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Keep letters and digits only; everything else becomes a space so
    // "O'Brien", "Andersson-Lindström" and "Paolo Victor" all tokenize.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Split a normalized name into its tokens. */
export function nameTokens(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * Fold an Icelandic/Scandinavian name into a comparable form where "son"
 * patronymics and "sson"/"sen" endings collapse, and single-name forms match
 * their own initial.
 *
 * This is deliberately conservative: it only ever ADDS candidate pairs, and
 * the caller still shows the user the actual label before they choose. It
 * never decides identity on its own.
 */
export function nameVariants(normalized: string): string[] {
  const out = new Set<string>([normalized]);
  const parts = nameTokens(normalized);
  if (parts.length > 1) {
    const first = parts[0];
    // "Gunnar Nilsson" ~ "Nilsson" (surname-only queries are the common case
    // for a supporter who half-remembers a name).
    for (let i = 1; i < parts.length; i += 1) out.add(parts.slice(i).join(" "));
    // "Gunnar Nilsson" ~ "G. Nilsson"
    if (first.length > 0) out.add(`${first[0]} ${parts.slice(1).join(" ")}`);
  }
  return [...out];
}

/**
 * How closely a query matches a candidate label. 0 means "not a match".
 *
 * Symmetric in the sense that it tries variants of BOTH sides, because the
 * shapes people actually type are not the shapes the catalogue stores:
 * supporters type an initial ("A. Jeremejeff") or a bare surname
 * ("Jeremejeff"), while Wikidata stores the full form. Expanding only the
 * candidate — the obvious first implementation — silently failed the initial
 * case, which a real test caught.
 *
 * The score is a ranking aid for display order only. It never decides identity:
 * the user always sees the actual label before choosing.
 */
export function scoreMatch(query: string, candidate: string): number {
  const q0 = normalizePlayerName(query);
  const c0 = normalizePlayerName(candidate);
  if (q0.length === 0 || c0.length === 0) return 0;

  let best = 0;
  for (const q of nameVariants(q0)) {
    for (const c of nameVariants(c0)) {
      const s = scoreNormalized(q, c);
      if (s > best) best = s;
    }
  }
  return best;
}

function scoreNormalized(q: string, c: string): number {
  if (q === c) return 100;

  const qTokens = nameTokens(q);
  const cTokens = nameTokens(c);

  // Every query token is present somewhere in the candidate.
  const allPresent = qTokens.every((t) => cTokens.includes(t));
  if (allPresent) {
    // A multi-token query matching exactly is stronger than a partial one.
    return qTokens.length === cTokens.length ? 95 : 80;
  }

  // Query is a surname, candidate is the full name.
  if (cTokens.includes(q) && q.indexOf(" ") === -1) return 60;

  // Every query token is a PREFIX of some candidate token: handles typing
  // "Jere" for "Jeremejeff". A one-letter token is only an initial, which the
  // variant expansion above has already handled, so it is excluded here.
  const allPrefix = qTokens.every((t) => t.length >= 3 && cTokens.some((ct) => ct.startsWith(t)));
  if (allPrefix) return 50;

  // Substring anywhere, but only for reasonably long queries so that a two
  // letter query cannot match half the database.
  if (q.length >= 5 && c.includes(q)) return 30;

  return 0;
}

/**
 * Rank raw search hits locally.
 *
 * The upstream index returns things like the surname entity "Andersson" and
 * several actors for a footballer's name. The `isFootball` predicate lets the
 * caller keep footballers and explicitly account for everything it dropped,
 * so "no footballer found" is never confused with "nothing found".
 *
 * `isFootball` is a predicate over the hit rather than a set of ids, because
 * the caller knows the hit's identity (the Q-ID) while this function only
 * sees the display label. Passing a set keyed by label silently classified
 * everything as non-football, which a real test caught.
 *
 * The returned order is the FINAL display order. Callers must not re-sort it:
 * doing so by score alone silently demoted a footballer whose name differs
 * from the query (measured: searching "David Marek" put five non-footballers
 * named "David Marek" above David Frölund, the actual former Häcken player).
 */
export function rankCandidates<T>(
  hits: readonly T[],
  query: string,
  label: (hit: T) => string,
  isFootball: ((hit: T) => boolean) | null,
  aliases?: (hit: T) => readonly string[],
): { ordered: T[]; footballers: T[]; others: T[]; scoreOf: (hit: T) => number } {
  const scored = hits.map((hit) => {
    const names = [label(hit), ...(aliases ? aliases(hit) : [])];
    // Aliases count for matching but never for display, so a player found by
    // an old name scores well without being renamed in the UI.
    const score = Math.max(...names.map((n) => scoreMatch(query, n)), 0);
    return { hit, score, football: isFootball ? isFootball(hit) : false };
  });

  // Footballers first, then best match, then stable label order so repeated
  // searches never reshuffle the list under the user's finger.
  scored.sort((a, b) => {
    if (a.football !== b.football) return a.football ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return label(a.hit).localeCompare(label(b.hit), "sv");
  });

  const byHit = new Map(scored.map((s) => [s.hit, s.score]));
  return {
    ordered: scored.map((s) => s.hit),
    footballers: scored.filter((s) => s.football).map((s) => s.hit),
    others: scored.filter((s) => !s.football).map((s) => s.hit),
    scoreOf: (hit: T) => byHit.get(hit) ?? 0,
  };
}
