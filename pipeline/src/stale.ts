import { readFileSync, writeFileSync, existsSync } from "node:fs";

/** Stale-data logic shared by pipeline and app. */

export const STALE_THRESHOLD_HOURS = 36;

export function isStale(generatedAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > STALE_THRESHOLD_HOURS * 3600 * 1000;
}

export function formatLastUpdated(generatedAt: string): string {
  const d = new Date(generatedAt);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Senast uppdaterad ${fmt.format(d)}`;
}

/**
 * Last-known-good behaviour: read existing data file; on pipeline failure the
 * caller returns this data unchanged instead of writing empty data.
 */
export function readLastKnownGood<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Write only if new data is non-empty; otherwise preserve last known good. */
export function writeProtected<T extends { freshness?: unknown }>(path: string, data: T, isEmpty: (d: T) => boolean): boolean {
  if (isEmpty(data)) return false;
  writeFileSync(path, JSON.stringify(data, null, 2));
  return true;
}
