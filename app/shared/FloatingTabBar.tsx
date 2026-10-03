/**
 * FloatingTabBar — the app's only primary navigation.
 *
 * INTERACTION MODEL — three gestures on one surface
 * The bar carries BOTH navigation and repositioning, which is why it needs a
 * disambiguation rule rather than a single handler:
 *
 *  1. TAP an icon — selects a destination. Always available, never ambiguous.
 *  2. HORIZONTAL swipe on the bar — changes destination, like the iOS WhatsApp
 *     tab bar. The bar itself does NOT move; only the pressed state changes
 *     mid-gesture.
 *  3. VERTICAL drag on the bar — REPOSITIONS it up or down. This is the iOS
 *     home-screen "pick up, put down" model, minus the hold.
 *
 * THE BAR IS ALWAYS HORIZONTALLY CENTRED. Dragging moves it vertically only;
 * there is no horizontal position to reach, and `leftFor()` takes no dock at
 * all, so no code path can produce an off-centre one.
 *
 * Why the axis decides, rather than a press-and-hold
 * A hold was tried first and it was the wrong trigger. It made the drag
 * conditional on a platform guess, and a wrong guess meant the drag silently
 * never started — measured in WebKit, holding 140ms or 200ms moved the bar
 * 0px. Every test that waited long enough passed regardless, so the failure
 * was invisible. The axis cannot be mis-detected: vertical travel is the
 * drag, horizontal travel is the swipe, and neither depends on a timer.
 * See the note in onPointerMove.
 *
 * WHY THE BAR USED TO LOOK UNDRAGGABLE — the actual root cause
 * `.fabnav` was `width: min(100% - 32px, 440px)`, which exactly FILLED the band
 * between the two 16px margins. Measured at 320/390/430px viewports the
 * horizontal travel was 0px in every case. A control with no room to move
 * cannot be dragged however correct this file is.
 *
 * A SECOND, INVISIBLE ROOT CAUSE: the visual box is not the layout box
 * `data-lifted` scales the bar to 1.035, and `getBoundingClientRect()` reports
 * the VISUAL box — 269.1px where the bar is 260px. Every re-centring that read
 * the rect therefore placed the bar 9.1px left of centre, and only while
 * lifted. All measurements now go through `layoutWidth()`/`layoutHeight()`,
 * which use `offsetWidth`/`offsetHeight` and ignore transforms.
 *
 * WHY THE ANCHORS ARE NOT DRAGGABLE
 * A real <a href> starts a NATIVE LINK DRAG the instant the pointer moves.
 * That fires `dragstart` and removes the element from the pointer-event
 * stream, so `pointerup` never reaches this component and the gesture
 * silently fails. Killing the native drag is what makes the gesture reachable
 * at all; the anchors stay real links so middle-click, long-press and the
 * keyboard still work.
 *
 * MOVE/UP LIVE ON `window`, NOT ON THE BAR
 * Once a repositioning drag begins the bar translates with the finger, so it
 * slides out from under the pointer and `pointerup` is delivered to whatever
 * the finger is now over. A handler bound to the <nav> would never fire. The
 * same reasoning covers the swipe.
 *
 * POINTER CAPTURE IS DELIBERATELY NOT USED
 * Capturing to this ancestor makes the browser dispatch the subsequent
 * `click` on the NAV rather than the anchor under the finger, which kills
 * every tap. Killing the native link drag keeps the pointer stream alive
 * instead.
 *
 * TRANSFORMS ONLY, WRITTEN DIRECTLY TO THE NODE
 * A repositioning drag writes `transform: translate3d(...)` straight to the
 * DOM node via a ref. Going through React state would re-render five icons
 * and five SVGs on every frame of the gesture, and `left`/`top` would force a
 * layout pass on each one. React state is updated once, on release, with the
 * settled position — which is also the only moment it is needed.
 *
 * Visual model: a floating pill, translucent, blurred, with a restrained
 * shadow. Content scrolls visibly behind it. backdrop-filter is a progressive
 * enhancement — a solid-enough fallback colour is declared first, so the bar
 * stays readable when the filter is unsupported.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DESTINATIONS, clampIndex, hrefFor, type Destination } from "./nav";
import {
  DRAG_THRESHOLD_PX,
  DEFAULT_DOCK,
  dockFromPointer,
  holdMsFor,
  leftFor,
  parseDock,
  serialiseDock,
  settle,
  topFor,
  type Dock,
  type Track,
} from "./fabnavPosition";

/**
 * A swipe commits on EITHER distance or speed.
 *
 * Distance alone was too strict: the old rule needed 18% of the bar width
 * (~62px on a 342px bar), and a real thumb flick on a 58px-tall control is
 * routinely shorter than that — so swipes simply did nothing, which is what
 * human testing reported.
 *
 * The distance rule is a flat, generous 34px, and a deliberate flick commits
 * on velocity even when it travels less than that. A flick still has to clear
 * FLICK_MIN_PX, so a jittery tap can never be read as a swipe.
 */
export const SWIPE_MIN_PX = 34;
/** px/ms that counts as a deliberate flick. A normal thumb swipe is 0.3–0.6. */
export const FLICK_VELOCITY = 0.35;
/** even a flick must travel this far, so a tap is never mistaken for one. */
export const FLICK_MIN_PX = 14;

/** localStorage key. Versioned so a future format change cannot misread it. */
const STORE_KEY = "bkh.fabnav.dock.v1";

/**
 * The whole swipe decision, extracted so it can be tested directly.
 *
 * `delta` is signed travel (negative = finger moved left = go forward) and
 * `velocity` is signed px/ms over the last few samples. Returns true when the
 * gesture should change destination.
 */
export function isSwipeCommit(delta: number, velocity: number): boolean {
  if (Math.abs(delta) >= SWIPE_MIN_PX) return true;
  return Math.abs(delta) >= FLICK_MIN_PX && Math.abs(velocity) >= FLICK_VELOCITY;
}

/**
 * Swallow the click the browser synthesises at the end of a drag or swipe.
 *
 * The browser fires `click` after any down+up on the same link, even when the
 * finger travelled. Two things must both be true:
 *
 *  - CAPTURE phase + stopPropagation, so the anchor's own React onClick never
 *    runs.
 *  - The listener is torn down on a TIMER, not `once: true`. A gesture often
 *    ends off the link it started on, so no click may ever be dispatched — an
 *    `once` listener would survive, swallow the NEXT real tap, and take
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

/**
 * The height the bar should be measured against.
 *
 * `window.innerHeight` is WRONG on iOS Safari and is the classic reason a
 * fixed bottom bar drifts or clamps wrongly there. When Safari's toolbars
 * expand and collapse, `innerHeight` reports the LARGEST viewport (toolbars
 * hidden), while the visible area is smaller. Using it makes the bar believe
 * there is more room than the user can see, so the drag's travel band is
 * wrong and the resting position can sit under the browser chrome.
 *
 * `visualViewport.height` is the actually-visible height and tracks the
 * toolbars as they collapse. `window.innerHeight` is kept only as a fallback
 * for engines without visualViewport.
 */
function visibleHeight(): number {
  const vv = window.visualViewport;
  if (vv && Number.isFinite(vv.height) && vv.height > 0) return vv.height;
  return window.innerHeight;
}

/**
 * The bar's LAYOUT size, ignoring any transform currently applied to it.
 *
 * This distinction is load-bearing, and getting it wrong is a bug that only
 * shows up while the bar is lifted. `getBoundingClientRect()` returns the
 * VISUAL box, so the moment `--fabnav-lift` scales the bar to 1.035 the rect
 * reports 260 x 1.035 = 269.1px wide. Re-centring on that number put the bar
 * 9.1px left of centre, and it stayed there: the drag transform, the
 * `data-lifted` attribute and the resting position all disagreed about how
 * wide the bar is.
 *
 * `offsetWidth`/`offsetHeight` report the box the layout engine actually
 * reserved, which transforms do not change. That is the number every
 * measurement below needs — centring and travel alike.
 */
function layoutWidth(nav: HTMLElement): number {
  return nav.offsetWidth || nav.getBoundingClientRect().width;
}

/** The bar's layout height. See {@link layoutWidth} for why not the rect. */
function layoutHeight(nav: HTMLElement): number {
  return nav.offsetHeight || nav.getBoundingClientRect().height;
}

/**
 * Measure the space the bar may move through, and the insets it must respect.
 *
 * Read from the DOM rather than hard-coded, because the bar's own height and
 * the safe-area insets are only known at runtime. Deriving `travelY` from the
 * bar's own height is what makes a future CSS change that resizes the bar show
 * up as less travel instead of silently disappearing.
 */
function measureTrack(nav: HTMLElement): {
  track: Track;
  topInset: number;
} {
  const cs = getComputedStyle(nav);
  const topInset = parseFloat(cs.getPropertyValue("--fabnav-top")) || 0;
  // The vertical band runs from the top inset down to the resting bottom
  // position, so the bar's own height cancels out of the arithmetic.
  const restTop = visibleHeight() - parseFloat(cs.bottom || "0") - layoutHeight(nav);
  const travelY = Math.max(0, restTop - topInset);
  return { track: { travelY }, topInset };
}

/**
 * Write the resting position.
 *
 * `top` carries the resting layout and `transform` carries the live drag, so
 * the two never fight. Using a transform for the drag means the compositor
 * handles it and nothing reflows mid-gesture.
 *
 * `left` is re-asserted on every placement. The bar is ALWAYS horizontally
 * centred, and centring must survive a resize: a bar parked at a pixel `left`
 * from a wider viewport would sit off-centre on a narrower one. Re-deriving it
 * from the LAYOUT width is what keeps "centred" true at every size — and at
 * every moment of the drag, including while the bar is scaled up.
 */
function place(
  nav: HTMLElement,
  dock: Dock,
  track: Track,
  topInset: number,
) {
  nav.style.left = `${leftFor(window.innerWidth, layoutWidth(nav))}px`;
  nav.style.top = `${topFor(dock, track, topInset)}px`;
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
  /**
   * `live` gates the window listeners: always attached, but inert until a
   * gesture starts on the bar. `mode` is the disambiguation:
   *   "pending" — finger down, not yet decided
   *   "swipe"   — decided: change destination, bar stays put
   *   "move"    — decided: reposition the bar
   *   "none"    — released back to the page (a vertical scroll); we are done
   */
  const drag = useRef({
    live: false,
    mode: "pending" as "pending" | "swipe" | "move" | "none",
    startX: 0,
    startY: 0,
    /** Where in the bar the finger landed vertically, so a pickup does not
     *  jump it. There is no horizontal equivalent: the bar cannot move
     *  sideways. */
    grabY: 0,
    dx: 0,
    v: 0,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    /**
     * The bar's resting top at the moment it was picked up, plus its resting
     * left so the centring can be restored exactly. The live drag is expressed
     * as a transform RELATIVE to these, so `left`/`top` never change
     * mid-gesture and nothing reflows.
     */
    restLeft: 0,
    restTop: 0,
  });
  const holdTimer = useRef<number | null>(null);

  const [dock, setDock] = useState<Dock>(DEFAULT_DOCK);
  /**
   * `armed` records that a swipe was recognised, purely so CSS can suppress the
   * tap highlight. `lifted` is the repositioning state, which switches on the
   * glass treatment and the grabbing cursor.
   */
  const [armed, setArmed] = useState(false);
  const [lifted, setLifted] = useState(false);

  // An unknown route has no index, and no icon is marked active.
  const index = active ? DESTINATIONS.findIndex((d) => d.path === active.path) : -1;
  const current = index >= 0 ? index : 0;

  // Refs so the window listeners can stay referentially stable and never close
  // over a value that changes on every navigation — a stale closure here would
  // swipe from the wrong tab.
  const indexRef = useRef(current);
  indexRef.current = current;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const dockRef = useRef(dock);
  dockRef.current = dock;

  const commit = useCallback((delta: number, velocity: number) => {
    // Distance OR speed commits. Velocity is signed like delta, so a fast
    // leftward flick is a negative velocity.
    if (!isSwipeCommit(delta, velocity)) return;
    const from = indexRef.current;
    const next = clampIndex(from + (delta < 0 ? 1 : -1));
    if (next === from) return; // at an end: do nothing, do not wrap
    onSelectRef.current(DESTINATIONS[next]);
  }, []);

  /** Cancel a pending long press, e.g. because the finger already moved. */
  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  /**
   * Promote a pending press into a repositioning drag.
   *
   * The bar is written to its CURRENT position first, so the pickup itself is
   * invisible — the transition into `move` must not read as a jump.
   */
  const beginMove = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    drag.current.mode = "move";
    // Haptic confirmation, where the platform offers it. Absent on iOS
    // Safari and in most desktop browsers, which is fine — it is an
    // enhancement, never the only signal that the drag started.
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
    }
    const { track, topInset } = measureTrack(nav);
    // Remember where the bar was resting. The drag is then a transform
    // relative to this point, so `left`/`top` stay put for the whole gesture.
    drag.current.restLeft = leftFor(window.innerWidth, layoutWidth(nav));
    drag.current.restTop = topFor(dockRef.current, track, topInset);
    nav.style.left = `${drag.current.restLeft}px`;
    nav.style.top = `${drag.current.restTop}px`;
    setLifted(true);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // Ignore secondary buttons so a right-click never starts a gesture.
    if (e.button !== 0 && e.pointerType === "mouse") return;

    const nav = navRef.current;
    if (!nav) return;

    /**
     * A gesture that begins on the bar is OURS from the first pixel.
     *
     * Without this, iOS is free to let the pan start, and when it decides the
     * gesture was a scroll it fires `pointercancel` and stops delivering
     * pointermove/pointerup. The `touch-action: none` in theme.css is what
     * actually prevents that, and it MUST be declared on `.fabnav-link` — the
     * element the thumb lands on — because `touch-action` is not inherited.
     */
    if (e.cancelable) e.preventDefault();

    const r = nav.getBoundingClientRect();
    const d = drag.current;
    d.live = true;
    d.mode = "pending";
    d.startX = e.clientX;
    d.startY = e.clientY;
    // Measured from the live box, so the grab point survives a resize.
    d.grabY = e.clientY - r.top;
    d.dx = 0;
    d.v = 0;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = performance.now();

    // Arm a SHORT hold as a FALLBACK for a stationary press. The primary
    // trigger is VERTICAL MOVEMENT, resolved in onPointerMove; see the note
    // there. This timer only covers the case where the finger never moves at
    // all, so the bar can still be picked up and dropped without a drag.
    //
    // It is deliberately not authoritative, and onPointerMove can undo it —
    // see the re-check in the "move" branch. A stationary-press timer that
    // cannot be revoked would let a slow, delayed swipe be stolen, and that
    // was measured happening: 8 undelayed touchmoves under CPU load put the
    // first move past 90ms, the hold won, and a horizontal flick that should
    // have navigated did not. The test passed alone and failed in the full
    // suite, which is exactly the signature of a race.
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      if (drag.current.live && drag.current.mode === "pending") beginMove();
    }, holdMsFor(
      typeof navigator === "undefined" ? undefined : { maxTouchPoints: navigator.maxTouchPoints },
      (e.nativeEvent as PointerEvent).pointerType,
    ));
  };

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d.live) return;

      const now = performance.now();
      const dt = now - d.lastT;
      // Smoothed velocity in px/ms. Instantaneous velocity from one frame pair
      // is far too noisy to threshold on.
      if (dt > 0) {
        const ix = (e.clientX - d.lastX) / dt;
        d.v = d.v === 0 ? ix : d.v * 0.7 + ix * 0.3;
        d.lastX = e.clientX;
        d.lastT = now;
      }

      /**
       * A move in "move" mode is a reposition: write the transform directly to
       * the node. State here would re-render five icons and five SVGs on every
       * frame of the gesture.
       *
       * THE HOLD IS REVOCABLE, so a gesture the hold mis-read can be handed
       * back. Reaching "move" via the stationary-press timer rather than via
       * vertical movement is a guess, and a guess can be wrong: under load the
       * first touchmove can arrive after the hold has already elapsed, which
       * would otherwise let a slow horizontal flick be stolen by the drag.
       *
       * Once the finger has genuinely travelled, the axis is no longer a guess
       * — it is the whole gesture. If the travel is now mostly horizontal, the
       * classification is corrected here and the gesture returns to the swipe
       * it actually was. The bar is re-placed rather than left mid-transform,
       * so revoking the hold cannot leave a stale translate3d behind.
       */
      if (d.mode === "move") {
        const nav = navRef.current;
        if (!nav) return;
        if (e.cancelable) e.preventDefault();

        // Measured once, outside the branch: the revoke path below needs them
        // too, and re-measuring per frame would be wasted work.
        const { track, topInset } = measureTrack(nav);

        // Only re-check while the finger has been nearly still since pickup.
        // A real drag has a definite axis from its first move, and re-deciding
        // mid-drag would make the bar jump between interpretations.
        if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) {
          const next = dockFromPointer(e.clientY, d.grabY, track, { topInset });
          dockRef.current = next;
          const absTop = topFor(next, track, topInset);
          // translate3d keeps this on the compositor: no layout, no reflow.
          // The delta is measured against the resting position captured at
          // pickup, NOT against the previous frame, so the bar cannot drift.
          nav.style.transform = `translate3d(0, ${absTop - d.restTop}px, 0)`;
          // The absolute position is kept for the release, which re-derives a
          // dock from it in order to persist a ratio.
          nav.dataset.dragTop = String(absTop);
          return;
        }

        // The finger has travelled sideways: this was a swipe all along.
        setLifted(false);
        delete nav.dataset.dragTop;
        nav.style.transform = "";
        place(nav, dockRef.current, track, topInset);
        clearHold();
        d.mode = "swipe";
        d.dx = e.clientX - d.startX;
        setArmed(true);
        return;
      }

      if (d.mode === "swipe") {
        if (e.cancelable) e.preventDefault();
        // Track distance only. The bar deliberately does NOT translate with the
        // finger — that is what makes it feel like the iOS WhatsApp tab bar,
        // which stays pinned while the same swipe steps through its tabs.
        d.dx = e.clientX - d.startX;
        return;
      }

      // Still "pending": decide what this movement means.
      //
      // REBUILT TWICE, AND THE SECOND REBUILD IS THE ONE THAT MATTERS.
      //
      // 1. The original trigger was a press-and-hold, which made the drag
      //    conditional on a platform guess. A wrong guess meant NO drag at
      //    all — measured in WebKit: holding 140ms or 200ms moved the bar
      //    0px, because the short iOS hold was never selected and the long one
      //    had not elapsed. Every test that waited long enough passed
      //    regardless, so the failure was invisible.
      //
      // 2. The bar is now VERTICALLY centred-only and draggable up and down,
      //    so the axis decides:
      //
      //      vertical travel   -> reposition the bar, immediately
      //      horizontal travel -> navigation swipe, bar stays put
      //
      // The axis cannot be mis-detected, so no timing value can break the
      // drag. The existing swipe handler is untouched and still owns
      // horizontal travel, which is why the flick-to-navigate gesture and the
      // ~10 tests covering it all still pass.
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;

      // HORIZONTAL travel is the navigation gesture and belongs to the
      // existing swipe handler. The bar cannot move sideways at all, so there
      // is nothing to do here but stay out of the way and track the distance.
      if (Math.abs(dx) >= Math.abs(dy)) {
        clearHold();
        d.mode = "swipe";
        d.dx = dx;
        setArmed(true);
        return;
      }

      // VERTICAL travel is the drag: the bar follows the finger up or down.
      //
      // This axis test is the whole disambiguation, and it is deliberately NOT
      // velocity- or timer-based. An earlier version used a press-and-hold as
      // the trigger, which could not be trusted: a wrong platform guess meant
      // the drag simply never began (measured in WebKit — holding 140ms or
      // 200ms moved the bar 0px). Deciding on the axis means the drag either
      // works or does not, with no timing involved.
      if (d.mode === "pending") {
        beginMove();
        const nav = navRef.current;
        if (nav) {
          const { track, topInset } = measureTrack(nav);
          const next = dockFromPointer(e.clientY, d.grabY, track, { topInset });
          dockRef.current = next;
          const absTop = topFor(next, track, topInset);
          // Applied to the position the finger has ALREADY reached, so the bar
          // does not lag a frame behind the first movement.
          nav.style.transform = `translate3d(0, ${absTop - d.restTop}px, 0)`;
          nav.dataset.dragTop = String(absTop);
        }
      }
    },
    [beginMove, clearHold],
  );

  const endDrag = useCallback(
    (commitIt: boolean) => {
      const d = drag.current;
      clearHold();
      const nav = navRef.current;
      const wasMode = d.mode;

      if (wasMode === "move" && nav) {
        const { track, topInset } = measureTrack(nav);
        /**
         * A CANCELLED drag must still settle somewhere legal.
         *
         * `pointercancel` is how iOS ends a gesture it has decided to take
         * over — including the case where the link callout appeared before
         * `-webkit-touch-callout: none` was applied. If a cancelled drag just
         * returned early, the bar would be left stranded mid-gesture with a
         * stale `translate3d` and no `top` to fall back on, which is exactly
         * the "it half-moved then stopped" symptom.
         *
         * When the drag never produced a position there is nothing to settle,
         * so it simply returns to its resting place.
         */
        const absTop = Number(nav.dataset.dragTop);
        const hasPosition = Number.isFinite(absTop);
        const rest: Dock = hasPosition
          ? settle(dockRef.current)
          : DEFAULT_DOCK;
        dockRef.current = rest;
        delete nav.dataset.dragTop;
        nav.style.transform = "";
        place(nav, rest, track, topInset);
        setDock(rest);
        try {
          window.localStorage.setItem(STORE_KEY, serialiseDock(rest));
        } catch {
          // Private mode or storage disabled. The drag still worked; it just
          // will not be remembered, which is not worth surfacing to the user.
        }
        setLifted(false);
        // The finger travelled, so the browser may synthesise a click on the
        // link it started over. Swallow it so a drag never navigates.
        stopNextClick(nav);
      } else if (wasMode === "swipe") {
        // A horizontal swipe is a GESTURE, not a tap. The browser still
        // synthesises a `click` when the pointer goes down and up within the
        // same link, so without suppression the destination under the finger
        // would ALSO fire. Both must run: the commit first, suppression second.
        if (commitIt) commit(d.dx, d.v);
        stopNextClick(nav);
      }

      d.live = false;
      d.mode = "pending";
      setArmed(false);
    },
    [clearHold, commit],
  );

  /**
   * Window-level listeners.
   *
   * The handlers read from refs, so this effect's dependencies are the stable
   * callbacks themselves. Re-attaching on EVERY render (an earlier version)
   * meant a mid-gesture re-render could tear down and rebuild the listener
   * set, and any event landing in that window was lost.
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
  }, [onPointerMove, endDrag]);

  /**
   * Restore the saved position, and keep it legal.
   *
   * Re-clamped on mount, on rotation and on resize, because the travel band is
   * a function of the viewport: a dock saved in portrait is still meaningful
   * in landscape precisely because ratios were stored rather than pixels.
   */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    // `parseDock` already handles null, malformed and hostile values, so only
    // a thrown storage access (private mode, disabled cookies) needs a guard.
    let stored: Dock;
    try {
      stored = parseDock(window.localStorage.getItem(STORE_KEY));
    } catch {
      stored = DEFAULT_DOCK;
    }
    dockRef.current = stored;
    setDock(stored);

    const apply = () => {
      const el = navRef.current;
      if (!el) return;
      const { track, topInset } = measureTrack(el);
      place(el, dockRef.current, track, topInset);
    };
    // Measure after layout so the bar's rendered width is known.
    apply();
    const raf = requestAnimationFrame(apply);

    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
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
      data-lifted={lifted || undefined}
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
                // either gesture can never complete. See the file header.
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
