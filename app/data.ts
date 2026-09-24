import type { AppData, FormerPlayersData } from "./shared/types";

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

export async function loadFormerPlayers(): Promise<FormerPlayersState> {
  try {
    const res = await fetch(`${BASE}data/former-players.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { status: "ready", data };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export type FormerPlayersState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: FormerPlayersData };

// ---------- favorites (localStorage, no account) ----------

const FAV_KEY = "minbkh.favorites";

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  localStorage.setItem(FAV_KEY, JSON.stringify(ids));
}

export function toggleFavorite(id: string): string[] {
  const cur = loadFavorites();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  saveFavorites(next);
  return next;
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
