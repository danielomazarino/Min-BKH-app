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
