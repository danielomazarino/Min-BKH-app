/**
 * Canonical player identity layer.
 *
 * Sources provide different identifiers:
 * - SportoMedia squad: fogisId (stable, official SvFF id) + givenName/surName
 * - SportoMedia match events: playerName only (no player id on WARNING events)
 * - Former-player registry: slug ids (e.g. "mattias-bjarsmy")
 *
 * Canonical identity: fogisId when known, otherwise a deterministic normalized
 * name key. The same player resolves to the same identity everywhere.
 */
import { normalizeSearch } from "./search";

export interface PlayerIdentity {
  /** Canonical internal id — stable across sources. */
  playerId: string;
  /** Official SvFF id when known (from SportoMedia squad). */
  fogisId?: number;
  /** Display name. */
  name: string;
  /** Normalized name for matching (diacritic-insensitive). */
  nameKey: string;
}

/** Build the canonical name key: normalized, single-spaced, lowercase. */
export function nameKeyOf(name: string): string {
  return normalizeSearch(name).replace(/\s+/g, " ");
}

/** Canonical id for a player known by fogisId. */
export function canonicalIdFromFogis(fogisId: number): string {
  return `fogis:${fogisId}`;
}

/** Canonical id for a player known only by name (deterministic). */
export function canonicalIdFromName(name: string): string {
  return `name:${nameKeyOf(name)}`;
}

/**
 * Resolve a canonical player id from whatever identifiers are available.
 * fogisId always wins over name because it is official and stable.
 */
export function resolveCanonicalId(opts: { fogisId?: number | null; name: string }): string {
  if (opts.fogisId != null) return canonicalIdFromFogis(opts.fogisId);
  return canonicalIdFromName(opts.name);
}

/**
 * Name normalization that tolerates middle names/particles so
 * "Mikkel Rygaard Jensen" and "Mikkel Rygaard" can be linked when needed.
 * Returns the significant name tokens (first + last).
 */
export function significantNameTokens(name: string): { first: string; last: string } | null {
  const parts = nameKeyOf(name).split(" ").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * Match a player name (from an event) against a canonical squad entry.
 * Uses normalized full-name equality first, then first+last-token match.
 * This is used only to MAP event names to canonical ids at ingestion time —
 * the mapped id is then stored, so fuzzy matching is not used at runtime.
 */
export function matchesSquadPlayer(eventName: string, squadName: string): boolean {
  const a = nameKeyOf(eventName);
  const b = nameKeyOf(squadName);
  if (a === b) return true;
  // Token-prefix match: the shorter name's tokens must all appear, in order,
  // at the start of the longer name ("filip helander eriksen" vs
  // "filip helander" → match; "anna larsson" vs "anna karlsson" → no).
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (long.length === short.length) return false; // equal length but not equal strings
  return short.every((tok, i) => tok === long[i]);
}