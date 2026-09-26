/**
 * Primary navigation model.
 *
 * The app has exactly FIVE primary destinations and every one of them owns a
 * stable, meaningful hash route. The route IS the navigation state — there is
 * no second, unsynchronised copy in component state. That is the single most
 * important structural decision in this file:
 *
 *   - tapping an icon navigates
 *   - swiping the navigation bar navigates
 *   - the browser back gesture goes back one navigation step
 *   - the active icon is derived from the route, so it can never disagree
 *
 * The ORDER here is also the swipe order, so it is declared once.
 */
import type { ComponentType, SVGProps } from "react";
import { Home, Newspaper, CalendarDays, Users, UserSearch } from "lucide-react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface Destination {
  /** Hash route WITHOUT the leading '#', exactly as HashRouter sees it. */
  path: string;
  /** Visible label. Kept short so five of them fit on a 390px bar. */
  label: string;
  icon: IconType;
  /** test id, used by e2e to assert the active state. */
  testId: string;
}

export const DESTINATIONS: readonly Destination[] = [
  { path: "/", label: "Brief", icon: Home, testId: "tab-brief" },
  { path: "/nyheter", label: "Nyheter", icon: Newspaper, testId: "tab-nyheter" },
  { path: "/matcher", label: "Matcher", icon: CalendarDays, testId: "tab-matcher" },
  { path: "/trupp", label: "Trupp", icon: Users, testId: "tab-trupp" },
  { path: "/spelare", label: "Spelare", icon: UserSearch, testId: "tab-spelare" },
] as const;

export const SETTINGS_PATH = "/installningar";

/**
 * Which destination a pathname belongs to.
 *
 * A detail state such as `#/nyheter?id=…` or `#/matcher?id=…` is a CHILD of
 * its section, not a section of its own: the section's icon stays active
 * while the detail is open. This is what makes the back gesture feel right —
 * closing a detail returns to the section the user was reading.
 *
 * Returns NULL for an unrecognised route. The previous version fell back to
 * Brief, which made the app claim ownership of a URL it was not rendering —
 * the same class of "URL lies" defect the redesign set out to remove. A route
 * no destination owns must leave every icon inactive.
 */
export function destinationFor(pathname: string): Destination | null {
  const exact = DESTINATIONS.find((d) => d.path === pathname);
  if (exact) return exact;
  return DESTINATIONS.find((d) => d.path !== "/" && pathname.startsWith(d.path + "/")) ?? null;
}

/** Clamp an index, used by the swipe handler. */
export function clampIndex(i: number): number {
  return Math.max(0, Math.min(DESTINATIONS.length - 1, i));
}

/** Build the href for a destination without losing the section. */
export function hrefFor(d: Destination): string {
  return `#${d.path}`;
}

/**
 * Read a `?id=` value from a hash that HashRouter has already split for us.
 * Returns null when absent. Values are always decoded exactly once.
 */
export function idFromSearch(search: string): string | null {
  const m = /(?:^|[?&])id=([^&]*)/.exec(search);
  if (!m) return null;
  const v = decodeURIComponent(m[1]);
  return v.length > 0 ? v : null;
}

/** Serialise a detail state back into a query string for the given path. */
export function searchWithId(id: string): string {
  return `?id=${encodeURIComponent(id)}`;
}
