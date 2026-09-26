/**
 * FloatingTabBar — the app's only primary navigation.
 *
 * Interaction model (WhatsApp on iOS, not Liquid Glass):
 *  - TAP an icon to select a destination. This is the deterministic path and
 *    is always available.
 *  - SWIPE horizontally ON THE BAR to move one destination left or right.
 *    The bar does NOT move with the finger: like the iOS WhatsApp tab bar it
 *    stays pinned in place, and the swipe only decides WHICH destination
 *    becomes active. Only the pressed/highlight state changes mid-gesture.
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
/**
 * A swipe commits on EITHER distance or speed.
 *
 * Distance alone was too strict: the old rule needed 18% of the bar width
 * (~62px on a 342px bar), and a real thumb flick on a 62px-tall control is
 * routinely shorter than that — so swipes simply did nothing, which is what
 * human testing reported. The nav bar is also the ONLY place this gesture
 * exists (there is deliberately no page-level horizontal swipe), so a missed
 * swipe leaves the user with no way forward except tapping.
 *
 * The distance rule is now a flat, generous 34px, and a deliberate flick
 * commits on velocity even when it travels less than that. A flick still has
 * to clear FLICK_MIN_PX, so a jittery tap can never be read as a swipe.
 */
export const SWIPE_MIN_PX = 34;
/** px/ms that counts as a deliberate flick. A normal thumb swipe is 0.3–0.6. */
export const FLICK_VELOCITY = 0.35;
/** even a flick must travel this far, so a tap is never mistaken for one. */
export const FLICK_MIN_PX = 14;

/**
 * The whole swipe decision, extracted so it can be tested directly.
 *
 * `delta` is signed travel (negative = finger moved left = go forward) and
 * `velocity` is signed px/ms measured over the last few samples of the
 * gesture. Returns true when the gesture should change destination.
 */
export function isSwipeCommit(delta: number, velocity: number): boolean {
  if (Math.abs(delta) >= SWIPE_MIN_PX) return true;
  return Math.abs(delta) >= FLICK_MIN_PX && Math.abs(velocity) >= FLICK_VELOCITY;
}

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
  // `t`/`lastX` let us measure a flick's velocity on release.
  const drag = useRef({
    live: false,
    startX: 0,
    startY: 0,
    dx: 0,
    axis: "none" as "none" | "x" | "y",
    t: 0,
    lastX: 0,
    lastT: 0,
    v: 0,
  });
  // `armed` records that a horizontal gesture was recognised, purely so the
  // CSS can suppress the tap highlight. The bar NEVER moves with the finger:
  // see the interaction-model note in the file header.
  const [armed, setArmed] = useState(false);

  // An unknown route has no index, and no icon is marked active.
  const index = active ? DESTINATIONS.findIndex((d) => d.path === active.path) : -1;
  const current = index >= 0 ? index : 0;

  // The index lives in a ref so `commit` can stay referentially stable. The
  // window listeners are registered once, so they must not close over a value
  // that changes on every navigation — a stale closure here would swipe from
  // the wrong tab.
  const indexRef = useRef(current);
  indexRef.current = current;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const commit = useCallback((delta: number, velocity: number) => {
    // Distance OR speed commits. Velocity is signed like delta, so a fast
    // leftward flick is a negative velocity.
    if (!isSwipeCommit(delta, velocity)) return;
    const from = indexRef.current;
    const next = clampIndex(from + (delta < 0 ? 1 : -1));
    if (next === from) return; // at an end: do nothing, do not wrap
    onSelectRef.current(DESTINATIONS[next]);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // Ignore secondary buttons so a right-click never starts a drag.
    if (e.button !== 0 && e.pointerType === "mouse") return;

    // A gesture that begins on the bar is OURS from the first pixel.
    //
    // Without this, iOS is free to let the pan start, and when it decides the
    // gesture was a scroll it fires `pointercancel` and stops delivering
    // pointermove/pointerup. The swipe then silently does nothing. The
    // `touch-action: none` in theme.css is what actually prevents that, and it
    // MUST be declared on `.fabnav-link` — the element the thumb lands on —
    // because `touch-action` is not an inherited property. This call is a
    // belt-and-braces guard for engines that ignore it.
    if (e.cancelable) e.preventDefault();

    drag.current = {
      live: true,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      axis: "none",
      t: performance.now(),
      lastX: e.clientX,
      lastT: performance.now(),
      v: 0,
    };
  };

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d.live) return;
    if (d.axis === "x" && e.cancelable) e.preventDefault();
    if (d.axis === "none") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) < AXIS_GUARD && Math.abs(dy) < AXIS_GUARD) return;
      // A mostly-vertical drag is not ours: release it to the page.
      d.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
      if (d.axis === "x") setArmed(true);
      else d.live = false;
    }
    if (d.axis !== "x") return;
    // Track distance only. The bar deliberately does NOT translate with the
    // finger — that is what made it feel draggable rather than like the iOS
    // WhatsApp tab bar, which stays pinned while the same swipe steps through
    // its tabs.
    d.dx = e.clientX - d.startX;

    // Instantaneous velocity over the last few px, smoothed. A short fast
    // flick is a deliberate swipe even though it never travels far.
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) {
      const instant = (e.clientX - d.lastX) / dt;
      d.v = d.v === 0 ? instant : d.v * 0.7 + instant * 0.3;
      d.lastX = e.clientX;
      d.lastT = now;
    }
  }, []);

  const endDrag = useCallback((commitIt: boolean) => {
    const d = drag.current;
    if (d.axis === "x") {
      // A horizontal swipe is a GESTURE, not a tap. The browser still
      // synthesises a `click` when the pointer goes down and up within the
      // same link, so without suppression the destination under the finger
      // would ALSO fire. Swipe and tap must be mutually exclusive, and BOTH
      // must still run: the commit first, the suppression second.
      if (commitIt) commit(d.dx, d.v);
      stopNextClick(navRef.current);
    }
    d.live = false;
    d.axis = "none";
    setArmed(false);
  }, [commit]);

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
   *
   * The handlers read from refs, so the listener effect deliberately has NO
   * dependency array. Re-attaching on every render (the previous version)
   * meant a mid-gesture re-render could tear down and rebuild the listener
   * set, and any event landing in that window was lost. Registering once is
   * both cheaper and more robust on a device that drops frames.
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
  }, []);

  return (
    <nav
      ref={navRef}
      className="fabnav"
      aria-label="Huvudnavigation"
      data-testid="tabbar"
      onPointerDown={onPointerDown}
      onDragStart={(e) => e.preventDefault()}
      data-dragging={armed || undefined}
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
                  <Icon x={23} y={23} strokeWidth={isActive ? 2.2 : 1.8} />
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
