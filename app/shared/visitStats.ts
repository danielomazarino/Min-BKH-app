/**
 * Local visit statistics — counted on the visitor's own device only.
 *
 * WHY LOCAL-ONLY (decision, 2026-10-12)
 * -------------------------------------
 * The app has no analytics backend and sends nothing anywhere. Real
 * cross-visitor statistics would require an external service, a privacy
 * notice, and a data flow out of the app — a product decision, not an
 * engineering detail. What CAN be shown honestly without any of that is the
 * visitor's OWN usage of their own device: which tabs they open, how often.
 * The section is labelled so it can never be mistaken for site-wide numbers.
 *
 * HOW IT WORKS
 * ------------
 * A tiny recorder is installed once per app boot (App.tsx) and appends one
 * entry per route change to localStorage, keyed by day. Storage is bounded:
 * 90 days of history, and a per-day cap of 500 entries so a runaway loop
 * cannot fill the quota. Every write is wrapped — a full or blocked
 * localStorage (private mode, iOS eviction) must never break navigation.
 *
 * WHAT IS COUNTED
 * ---------------
 * The five destinations only, by their Swedish names, plus the date. Sheets
 * (settings, player cards, match details) are deliberately NOT counted: they
 * are overlays on a destination, not visits to one, and counting them would
 * double-count a single tap.
 */

const KEY = "minbkh-visits-v1";
const MAX_DAYS = 90;
const MAX_ENTRIES_PER_DAY = 500;

/** Route path → the Swedish tab name the supporter knows. */
const ROUTE_NAMES: Record<string, string> = {
  "/": "Hem",
  "/nyheter": "Nyheter",
  "/matcher": "Matcher",
  "/trupp": "Trupp",
  "/spelare": "Spelare",
};

export interface VisitDay {
  /** ISO date (yyyy-mm-dd, local time). */
  day: string;
  /** Counts per destination name. */
  counts: Record<string, number>;
}

export interface VisitStats {
  days: VisitDay[];
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function read(): VisitStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { days: [] };
    const parsed = JSON.parse(raw) as VisitStats;
    if (!Array.isArray(parsed.days)) return { days: [] };
    return { days: parsed.days.filter((d) => d && typeof d.day === "string" && d.counts) };
  } catch {
    return { days: [] };
  }
}

function write(stats: VisitStats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // Storage full or blocked: statistics are the most disposable data in
    // the app. Drop them silently rather than break navigation.
  }
}

/**
 * Record one visit to a route path. Called from the router on every
 * destination change; unknown paths (sheets, deep links) are ignored.
 */
export function recordVisit(pathname: string): void {
  const name = ROUTE_NAMES[pathname];
  if (!name) return;
  const stats = read();
  const day = today();
  let entry = stats.days.find((d) => d.day === day);
  if (!entry) {
    entry = { day, counts: {} };
    stats.days.push(entry);
  }
  entry.counts[name] = (entry.counts[name] ?? 0) + 1;
  // Bound a single day so a navigation loop cannot fill the quota.
  const total = Object.values(entry.counts).reduce((a, b) => a + b, 0);
  if (total > MAX_ENTRIES_PER_DAY) return;
  // Keep only the newest MAX_DAYS days.
  stats.days = stats.days.slice(-MAX_DAYS);
  write(stats);
}

/** Read the stats for display. A copy — callers must not mutate the store. */
export function readVisitStats(): VisitStats {
  return read();
}

/** Total visits per destination across the whole retained window. */
export function totalsFor(stats: VisitStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of stats.days) {
    for (const [name, n] of Object.entries(d.counts)) {
      out[name] = (out[name] ?? 0) + n;
    }
  }
  return out;
}

/** The number of days with at least one recorded visit. */
export function activeDays(stats: VisitStats): number {
  return stats.days.filter((d) => Object.values(d.counts).some((n) => n > 0)).length;
}

/** Clear the on-device statistics (offered in the UI — it is the user's data). */
export function clearVisitStats(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — the data is already unreachable.
  }
}

/** Swedish weekday + short date for a stored day key, e.g. "mån 12 okt". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short" }).format(date);
}
