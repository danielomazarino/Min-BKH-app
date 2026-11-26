/**
 * AppHeader — the app's identity row.
 *
 * STRUCTURE (rebuilt 2026-11-26, user request). The header used to be one
 * sticky bar holding everything: the icon, the wordmark, the freshness dot,
 * the raw build hash, the kit toggle and the cog. Three problems:
 *
 *  1. THE BUILD HASH WAS SUPPORTER-FACING CHROME. `9ce9f37.d462647` sat under
 *     "Uppdaterad" in 9px monospace. It exists so a maintainer can tell a
 *     stale service worker from a failed deploy, which is a diagnostic, not
 *     something a supporter should have to read past. It now lives in
 *     Settings → Om appen, where the rest of the diagnostics already are.
 *  2. THE CONTROLS WERE FLAT. The kit toggle and the cog were bare glyphs on
 *     a translucent band. They are now glass buttons that share the tab bar's
 *     visual language, so the app has ONE chrome idiom rather than two.
 *  3. THE WORDMARK SCROLLED WITH THE BAR. The user asked for the name to
 *     scroll away while the controls stay: "The 'Min BKH-app' name of the app
 *     can scroll with the page."
 *
 * HOW THE SCROLLING NAME WORKS
 * The app shell is a fixed viewport with an internal scroll container
 * (`.layer`), so a `position: sticky` header would never move — it is not
 * inside the scroller. Instead the header is `position: fixed` and the
 * wordmark is translated by the active layer's `scrollTop`, read from a
 * passive scroll listener. The controls never move; only the name does.
 *
 * The icon is a real button that opens an About sheet. It is the app's
 * identity, so it is the natural place to answer "what is this?".
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { KitToggle } from "./KitToggle";

/** How far the wordmark travels before it is fully gone. */
const BRAND_FADE_PX = 56;

export function AppHeader({
  onOpenSettings,
  onOpenAbout,
  settingsOpen,
}: {
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  settingsOpen: boolean;
}) {
  const brandRef = useRef<HTMLSpanElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  /**
   * The wordmark follows the ACTIVE layer's scroll position.
   *
   * The app shell is a fixed viewport with an internal scroller (`.layer`), so
   * a sticky header would never move — it is not inside the scroller. The
   * header is fixed and the wordmark is translated by the layer's `scrollTop`.
   *
   * WHY THE LISTENER IS ON `document` IN THE CAPTURE PHASE
   * Scroll events do not bubble, but they DO reach the document during
   * capture. Binding to the element directly was the first attempt and it
   * broke: each page renders a skeleton `.layer` while data loads and then
   * replaces it with a different `.layer` node, so an element-bound listener
   * stayed attached to a detached element and the wordmark never moved.
   * Capturing at the document survives every re-render and route change, and
   * the `classList` check keeps it to the app's own scroller.
   *
   * The transform is written straight to the node: this fires on every frame
   * of a scroll, and re-rendering the header (and therefore all three icon
   * buttons) per frame is the cost the tab bar already avoids the same way.
   * React state changes only when the boolean flips.
   */
  useEffect(() => {
    const el = brandRef.current;
    if (!el) return;

    let wasScrolled = false;
    const paint = (top: number) => {
      const t = Math.min(top, BRAND_FADE_PX);
      el.style.transform = `translate3d(0, ${-t}px, 0)`;
      el.style.opacity = String(Math.max(0, 1 - t / BRAND_FADE_PX));
      // `visibility` rather than only opacity: a fully transparent wordmark
      // must not stay in the accessibility tree or the tab order.
      el.style.visibility = t >= BRAND_FADE_PX ? "hidden" : "visible";
      const nowScrolled = t > 0;
      if (nowScrolled !== wasScrolled) {
        wasScrolled = nowScrolled;
        setScrolled(nowScrolled);
      }
    };

    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.classList.contains("layer")) paint(t.scrollTop);
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // A route change swaps the layer, so re-read the new one's position.
    paint(document.querySelector<HTMLElement>(".layer")?.scrollTop ?? 0);
    return () => document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
  }, [pathname]);

  return (
    <header className="app-header" data-scrolled={scrolled || undefined}>
      {/* THE ICON IS A BUTTON. It is the app's identity, so tapping it answers
          "what is this app?" instead of doing nothing. */}
      <button
        type="button"
        className="mark-btn"
        onClick={onOpenAbout}
        aria-label="Om appen"
        data-testid="open-about"
      >
        <img src={`${import.meta.env.BASE_URL}icons/mark-dark.png`} alt="" className="mark mark-dark" width={26} height={26} />
        <img src={`${import.meta.env.BASE_URL}icons/mark-light.png`} alt="" className="mark mark-light" width={26} height={26} />
      </button>

      {/* The name scrolls away; the controls do not. */}
      <span className="brand" ref={brandRef} data-testid="brand">
        Min <b>BKH</b>-app
      </span>

      <span className="header-actions">
        <KitToggle />
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label="Inställningar och data"
          data-testid="open-settings"
          aria-expanded={settingsOpen}
        >
          <SettingsIcon aria-hidden />
        </button>
      </span>
    </header>
  );
}
