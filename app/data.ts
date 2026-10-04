import type { AppData, ApiMetrics } from "./shared/types";

export type AppDataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AppData };

const BASE = import.meta.env.BASE_URL;

/**
 * Load generated static data. The service worker caches these files, so a
 * network failure falls back to the last cached copy (offline support).
 */
export async function loadAppData(): Promise<AppDataState> {
  try {
    const res = await fetch(`${BASE}data/app.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as AppData;
    return { status: "ready", data };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- API measurement log (diagnostics only) ----------

/**
 * The measurement log is loaded LAZILY, on demand, never during first paint.
 *
 * This is the whole reason it is a separate file rather than a field on
 * AppData: `app.json` is fetched by every supporter on every visit, so adding
 * diagnostics to it would tax the common case to serve the rare one. Opening
 * the cog wheel's diagnostics section is the only trigger, and a failure there
 * must never affect the app, so this resolves to `null` rather than throwing.
 */
export type MetricsState = { status: "loaded"; data: ApiMetrics } | { status: "unavailable" };

export async function loadApiMetrics(): Promise<MetricsState> {
  try {
    const res = await fetch(`${BASE}data/api-metrics.json`);
    if (!res.ok) return { status: "unavailable" };
    return { status: "loaded", data: (await res.json()) as ApiMetrics };
  } catch {
    return { status: "unavailable" };
  }
}

// ---------- favorites (localStorage, no account) ----------

const FAV_KEY = "minbkh.favorites";

/**
 * A starred player, stored with enough to RENDER the list again later.
 *
 * Storing only the Q-ID (as this did originally) is not enough: a starred
 * player has to be listed without re-running the search that found them, and
 * a bare "Q103846058" cannot be shown to a supporter. So the name and the
 * few identifying facts are saved alongside the id.
 *
 * The Häcken link is saved as evidence OF WHAT WAS SHOWN, not as a filter.
 * A player with no recorded Häcken connection must still be starable —
 * gating that would reintroduce the closed-list problem this feature exists
 * to remove (see docs/ENHANCEMENTS.md).
 */
export type StarredPlayer = {
  qid: string;
  name: string;
  /** ISO date, as Wikidata reports it. */
  dateOfBirth?: string | null;
  dateOfDeath?: string | null;
  citizenship?: string | null;
  /** "men" | "women" | null — null means NOT RECORDED, not "no". */
  hackenTeam?: "men" | "women" | null;
  /** ISO timestamp of when the user starred them, newest first. */
  starredAt: number;
};

/** Reads the stored list, tolerating both the old id-only shape and the new one. */
export function loadFavorites(): StarredPlayer[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: StarredPlayer[] = [];
    for (const item of v) {
      if (typeof item === "string") continue; // legacy id-only entry, no name to show
      if (item && typeof item === "object" && typeof (item as StarredPlayer).qid === "string") {
        out.push(item as StarredPlayer);
      }
    }
    return out.sort((a, b) => b.starredAt - a.starredAt);
  } catch {
    return [];
  }
}

export function saveFavorites(list: StarredPlayer[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    /* storage is a convenience, never a requirement */
  }
}

/**
 * Star or unstar. Returns the whole new list so the caller can render it.
 * Starring an already-starred player refreshes the stored snapshot rather
 * than duplicating the entry.
 */
export function toggleFavorite(player: Omit<StarredPlayer, "starredAt">): StarredPlayer[] {
  const cur = loadFavorites();
  const next = cur.some((p) => p.qid === player.qid)
    ? cur.filter((p) => p.qid !== player.qid)
    : [{ ...player, starredAt: Date.now() }, ...cur];
  saveFavorites(next);
  return next.sort((a, b) => b.starredAt - a.starredAt);
}

// ---------- formatting helpers ----------

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short" }).format(d);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function competitionLabel(c: string): string {
  switch (c) {
    case "allsvenskan":
      return "Allsvenskan";
    case "svenska-cupen":
      return "Svenska Cupen";
    case "europa":
      return "Europa";
    default:
      return "Tävling";
  }
}
