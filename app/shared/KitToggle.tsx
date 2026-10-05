/**
 * The kit toggle — a jersey icon in the header that switches the app's
 * colour scheme between the HOME kit (black, current default) and the AWAY
 * kit (white with black and yellow accents).
 *
 * THE ICON SHOWS WHAT YOU GET, NOT WHAT YOU HAVE
 *   The button always renders the jersey of the kit you would switch TO, in
 *   that kit's colours. In the dark (home) app the icon is a WHITE away
 *   jersey; tap it and the app goes white. In the light (away) app the icon
 *   is a BLACK home jersey with yellow trim; tap it and the app goes black.
 *   A toggle that showed the current kit would read as "you are already
 *   here", which is the opposite of an invitation.
 *
 * WHY A REAL BUTTON, NOT A `title` TOOLTIP
 *   Same reasoning as the ⓘ explainers in the metrics panel: tooltips are
 *   mouse-only and this app lives on phones. The accessible name carries the
 *   explanation, and the pressed state is announced via aria-pressed.
 *
 * WHY THE STATE LIVES IN REACT AT ALL
 *   The theme itself is applied to <html> directly by kitTheme.ts (no React
 *   involved — CSS variables do the work). But the ICON must flip when the
 *   theme flips, and the icon is React, so the component keeps a small piece
 *   of state purely to re-render itself. It reads the effective theme on
 *   mount so a system-preference follower starts on the right icon.
 */
import { useEffect, useState } from "react";
import { effectiveTheme, setKitTheme, type KitTheme } from "./kitTheme";

export function KitToggle() {
  // The theme the app is IN right now. The icon shows the OTHER kit.
  const [theme, setTheme] = useState<KitTheme>(() => effectiveTheme());

  // A system-preference change while the user has not chosen must move the
  // icon too, not just the colours — otherwise the icon lies about what a
  // tap will do.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setTheme(effectiveTheme());
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const next: KitTheme = theme === "home" ? "away" : "home";

  return (
    <button
      type="button"
      className="icon-btn kit-toggle"
      onClick={() => {
        setKitTheme(next);
        setTheme(next);
      }}
      aria-pressed={theme === "away"}
      aria-label={
        theme === "home"
          ? "Byt till borta-tema — vit tröja med svart och gult"
          : "Byt till hemmatema — svart tröja med gult"
      }
      data-testid="kit-toggle"
      title={theme === "home" ? "Bortatröjan (ljust läge)" : "Hemmatröjan (mörkt läge)"}
    >
      {/* The jersey of the kit you would switch TO. Drawn inline rather than
          via lucide's Shirt so the fill colours can be the actual kit colours
          — lucide icons are stroke-only and cannot show a white shirt with
          black sleeves. */}
      <svg viewBox="0 0 24 24" aria-hidden="true" className="kit-jersey">
        {next === "away" ? (
          /* AWAY jersey: white body, black sleeves, yellow collar trim. */
          <>
            <path d="M8 3 L4 5.5 L2.5 10 L5.5 11 L5.5 20 L18.5 20 L18.5 11 L21.5 10 L20 5.5 L16 3 C15 4.6 13.6 5.4 12 5.4 C10.4 5.4 9 4.6 8 3 Z" fill="#ffffff" stroke="#1a1a1a" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M8 3 C9 4.6 10.4 5.4 12 5.4 C13.6 5.4 15 4.6 16 3" fill="none" stroke="#ffd200" strokeWidth="1.4" strokeLinecap="round" />
          </>
        ) : (
          /* HOME jersey: black body, yellow sleeves trim. */
          <>
            <path d="M8 3 L4 5.5 L2.5 10 L5.5 11 L5.5 20 L18.5 20 L18.5 11 L21.5 10 L20 5.5 L16 3 C15 4.6 13.6 5.4 12 5.4 C10.4 5.4 9 4.6 8 3 Z" fill="#1a1a1a" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M8 3 C9 4.6 10.4 5.4 12 5.4 C13.6 5.4 15 4.6 16 3" fill="none" stroke="#ffd200" strokeWidth="1.4" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  );
}
