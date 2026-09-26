/**
 * FloatingTabBar — the app's only primary navigation.
 *
 * Interaction model (WhatsApp on iOS, not Liquid Glass):
 *  - TAP an icon to select a destination. This is the deterministic path and
 *    is always available.
 *  - SWIPE horizontally ON THE BAR to move one destination left or right.
 *    The gesture is bound to the bar element itself, so a swipe that starts
 *    in the content area can never change the primary section.
 *  - An ambiguous gesture does nothing. The axis is only decided after
 *    AXIS_GUARD px of travel, and the drag must exceed a fraction of the bar's
 *    width before it commits.
 *
 * Why the anchors are explicitly non-draggable: a real <a href> starts a
 * NATIVE LINK DRAG the instant the pointer moves. That fires `dragstart` and
 * removes the element from the pointer-event stream, so `pointerup` never
 * reaches this component and the swipe silently fails to commit. Killing the
 * native drag is what makes the gesture reachable at all; the anchors stay
 * real links so middle-click, long-press and the keyboard still work.
 *
 * The move/up listeners live on `window`, not on the bar. The bar translates
 * with the finger, so a right-swipe slides the bar out from under the pointer
 * and `pointerup` never reaches a <nav>-level handler. See the effect below.
 *
 * Visual model: a floating pill, translucent, blurred, with a restrained
 * shadow. Content scrolls visibly behind it. backdrop-filter is treated as a
 * progressive enhancement — a solid-enough fallback colour is declared first,
 * so the bar is fully readable when the filter is unsupported.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DESTINATIONS, clampIndex, hrefFor, type Destination } from "./nav";

/** px of movement before we decide whether this is a horizontal or vertical drag. */
const AXIS_GUARD = 14;
/** fraction of the bar width that must be travelled to commit a swipe. */
const SWIPE_RATIO = 0.18;
/** below this many pixels of travel, a horizontal drag is treated as a tap. */
const DEAD_ZONE = 8;

/**
 * Swallow the click that the browser synthesises at the end of a swipe.
 *
 * The browser fires `click` after any down+up on the same link, even when the
 * finger travelled sideways. Two things must both be true:
 *
 *  - CAPTURE phase + stopPropagation, so the anchor's own React onClick never
 *    runs.
 *  - The listener is torn down on a TIMER, not `once: true`. A swipe often
 *    ends off the link it started on, so no click may ever be dispatched —
 *    an `once` listener would survive, swallow the NEXT real tap, and take
 *    navigation down with it.
 */
function stopNextClick(nav: HTMLElement | null) {
  if (!nav) return;
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  nav.addEventListener("click", swallow, { capture: true });
  window.setTimeout(() => nav.removeEventListener("click", swallow, { capture: true }), 400);
}

export function FloatingTabBar({
  active,
  onSelect,
}: {
  /** The destination that owns the current route, or null for an unknown
   *  route — in which case NO icon claims to be active. */
  active: Destination | null;
  onSelect: (d: Destination) => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  // `live` gates the window listeners: they are always attached, but do
  // nothing until a gesture actually starts on the bar.
  const drag = useRef({ live: false, startX: 0, startY: 0, dx: 0, axis: "none" as "none" | "x" | "y" });
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // An unknown route has no index, and no icon is marked active.
  const index = active ? DESTINATIONS.findIndex((d) => d.path === active.path) : -1;
  const current = index >= 0 ? index : 0;

  const commit = useCallback(
    (delta: number) => {
      const width = navRef.current?.offsetWidth ?? window.innerWidth;
      if (Math.abs(delta) < Math.max(DEAD_ZONE * 2, width * SWIPE_RATIO)) return;
      const next = clampIndex(current + (delta < 0 ? 1 : -1));
      if (next === current) return; // at an end: do nothing, do not wrap
      onSelect(DESTINATIONS[next]);
    },
    [current, onSelect],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // Ignore secondary buttons so a right-click never starts a drag.
    if (e.button !== 0) return;
    drag.current = { live: true, startX: e.clientX, startY: e.clientY, dx: 0, axis: "none" };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d.live) return;
    if (d.axis === "x" && e.cancelable) e.preventDefault();
    if (d.axis === "none") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) < AXIS_GUARD && Math.abs(dy) < AXIS_GUARD) return;
      // A mostly-vertical drag is not ours: release it to the page.
      d.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
      if (d.axis === "x") setDragging(true);
      else d.live = false;
    }
    if (d.axis !== "x") return;
    d.dx = e.clientX - d.startX;
    // Rubber-band past the ends so the bar feels bounded rather than broken.
    const atStart = current === 0 && d.dx > 0;
    const atEnd = current === DESTINATIONS.length - 1 && d.dx < 0;
    setOffset(atStart || atEnd ? d.dx * 0.22 : d.dx);
  };

  const endDrag = (commitIt: boolean) => {
    const d = drag.current;
    if (d.axis === "x") {
      // A horizontal swipe is a GESTURE, not a tap. The browser still
      // synthesises a `click` when the pointer goes down and up within the
      // same link, so without suppression the destination under the finger
      // would ALSO fire. Swipe and tap must be mutually exclusive, and BOTH
      // must still run: the commit first, the suppression second.
      if (commitIt) commit(d.dx);
      stopNextClick(navRef.current);
    }
    d.live = false;
    d.axis = "none";
    setOffset(0);
    setDragging(false);
  };

  /**
   * The gesture is tracked on `window`, not on the bar.
   *
   * Regression this fixes: the bar translates WITH the finger, so on a
   * right-swipe the bar slides out from under the pointer and `pointerup` is
   * delivered to whatever the finger is now over. The move/up handlers were on
   * the <nav> and so never fired, `endDrag` never ran, and the swipe silently
   * did nothing. A LEFT swipe happened to work only because the bar slid the
   * same direction as the finger and stayed under it — an asymmetry that
   * looked like a broken "back" gesture.
   *
   * Pointer capture is NOT used: capturing to this ancestor makes the browser
   * dispatch the subsequent `click` on the NAV rather than the anchor under
   * the finger, which kills every tap. Killing the native link drag (below)
   * is what lets the pointer stream survive at all.
   */
  useEffect(() => {
    const move = (e: PointerEvent) => onPointerMove(e);
    const up = () => endDrag(true);
    const cancel = () => endDrag(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  });

  return (
    <nav
      ref={navRef}
      className="fabnav"
      aria-label="Huvudnavigation"
      data-testid="tabbar"
      onPointerDown={onPointerDown}
      onDragStart={(e) => e.preventDefault()}
      style={offset ? { transform: `translateX(${offset}px)` } : undefined}
      data-dragging={dragging || undefined}
    >
      <ul className="fabnav-list">
        {DESTINATIONS.map((d) => {
          const isActive = active !== null && d.path === active.path;
          const Icon = d.icon;
          return (
            <li key={d.path} className="fabnav-item">
              <a
                href={hrefFor(d)}
                className="fabnav-link"
                aria-current={isActive ? "page" : undefined}
                data-testid={d.testId}
                data-active={isActive || undefined}
                // The anchor must stay a real link for keyboard, long-press
                // and middle-click, but it must not start a native drag or
                // the swipe gesture can never complete. See the file header.
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onClick={(e) => {
                  // A real href keeps middle-click, long-press and the
                  // keyboard working; we only intercept the plain left click.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onSelect(d);
                }}
              >
                <span className="fabnav-icon" aria-hidden="true">
                  <Icon x={20} y={20} strokeWidth={isActive ? 2.15 : 1.75} />
                </span>
                <span className="fabnav-label">{d.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
