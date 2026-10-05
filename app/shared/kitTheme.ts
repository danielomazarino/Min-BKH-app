/**
 * Kit theme — the app's colour scheme, expressed as BK Häcken kits.
 *
 * WHY KITS AND NOT "DARK/LIGHT"
 *   The user asked for a jersey toggle, and that framing is better than the
 *   generic one: the default black-with-yellow look IS the home kit, and the
 *   white-with-black-and-yellow look IS the away kit. Naming the modes after
 *   the kits means the toggle's icon and label stay truthful — a shirt icon
 *   that shows the kit you would switch TO, not an abstract sun/moon pair
 *   that could mean anything.
 *
 * HOW IT APPLIES
 *   `data-theme` on <html>. Every colour in theme.css is a token defined in
 *   :root, and the light theme redefines those tokens under
 *   [data-theme="light"]. One attribute, no class juggling, and the CSS does
 *   the rest.
 *
 * PERSISTENCE AND THE SYSTEM PREFERENCE
 *   The choice is stored in localStorage under a versioned key. On first
 *   visit — no stored value — the app follows `prefers-color-scheme`, so a
 *   supporter whose phone is set to light gets the away kit without ever
 *   finding the toggle. Once they CHOOSE, their choice wins over the system,
 *   which is what a toggle means.
 *
 *   The system listener is only active while there is no stored choice. After
 *   an explicit choice, following the system again would make the toggle lie.
 */

const STORAGE_KEY = "minbkh.kit-theme";
/** Bump if the stored meaning ever changes shape. */
const STORAGE_VERSION = "v1";

export type KitTheme = "home" | "away";

function stored(): KitTheme | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${STORAGE_VERSION}`);
    return raw === "home" || raw === "away" ? raw : null;
  } catch {
    // Private browsing / storage disabled: follow the system, persist nothing.
    return null;
  }
}

function systemPrefersLight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

/** The theme in effect right now, whether chosen or inherited. */
export function effectiveTheme(): KitTheme {
  const s = stored();
  if (s) return s;
  return systemPrefersLight() ? "away" : "home";
}

/** Apply the theme to the document. Idempotent. */
export function applyTheme(theme: KitTheme): void {
  const root = document.documentElement;
  if (theme === "away") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  // The browser chrome (status bar, tab strip) should follow the page, or a
  // black status bar sits on top of a white app — visible on every iPhone.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "away" ? "#ffffff" : "#000000");
}

/**
 * Set the theme and remember it.
 *
 * Returns nothing and cannot throw: storage failures leave the theme applied
 * for this session, which is the part the user can see.
 */
export function setKitTheme(theme: KitTheme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(`${STORAGE_KEY}:${STORAGE_VERSION}`, theme);
  } catch {
    /* session-only, as above */
  }
}

/**
 * Apply the initial theme BEFORE React renders.
 *
 * Called from main.tsx, before createRoot. Doing it here rather than in an
 * effect removes the dark-to-light flash on a light-preference phone: the
 * first paint is already the right kit. This is the same reason theme
 * initialisation lives in a blocking script in most apps.
 */
export function initKitTheme(): void {
  applyTheme(effectiveTheme());
  // Follow the system ONLY while the user has not chosen. A stored choice
  // must win, or the toggle would silently stop meaning anything.
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener?.("change", () => {
      if (!stored()) applyTheme(effectiveTheme());
    });
  }
}
