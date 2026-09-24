import type { FormerPlayer } from "./types";

/**
 * Normalize a string for search: lowercase, strip diacritics so "Bjärsmy"
 * matches "bjarsmy" and vice versa.
 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Search former players by name or alias. Supports partial names and
 * Swedish characters (diacritic-insensitive).
 */
export function searchPlayers(players: FormerPlayer[], query: string): FormerPlayer[] {
  const q = normalizeSearch(query.trim());
  if (!q) return players;
  const match = (p: FormerPlayer): boolean => {
    const haystacks = [p.name, ...(p.aliases ?? [])].map(normalizeSearch);
    return haystacks.some((h) => h.includes(q));
  };
  return players.filter(match);
}
