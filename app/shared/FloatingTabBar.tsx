/**
 * FloatingTabBar — the app's only primary navigation.
 *
 * INTERACTION MODEL — a swipe and a tap on one surface
 *
 *  1. TAP an icon — selects a destination. Always available, never ambiguous.
 *  2. SWIPE horizontally anywhere on the bar — a glass indicator tracks the
 *     thumb directly, then springs to the nearest icon on release and
 *     navigates there. Like the iOS WhatsApp tab bar.
 *
 * THERE IS NO VERTICAL DRAG. The bar is fixed. It was draggable vertically
 * until 2026-10-03, on request, and the removal was deliberate: the drag never
 * felt right in real use, and it had accumulated four platform-specific
 * defects (a WebKit link callout that ate the gesture, hold timing that
 * depended on a platform guess, a stationary-press race that stole swipes,
 * and a visual-vs-layout measurement bug), each of which cost real time.
 *
 * The bar stays HORIZONTALLY CENTRED at all times. `leftFor()` takes no
 * position at all, so no code path can produce an off-centre bar.
 *
 * WHY THE ANCHORS ARE NOT NATIVELY DRAGGABLE
 * A real <a href> starts a NATIVE LINK DRAG the instant the pointer moves.
 * That fires `dragstart` and removes the element from the pointer-event
 * stream, so `pointerup` never reaches this component and the gesture
 * silently fails. Killing the native drag is what makes the swipe reachable
 * at all; the anchors stay real links so middle-click, long-press and the
 * keyboard still work.
 *
 * MOVE/UP LIVE ON `window`, NOT ON THE BAR
 * The finger can travel anywhere — including off the bar entirely — before
 * release, so a handler bound to the <nav> would miss the end of the gesture.
 *
 * POINTER CAPTURE IS DELIBERATELY NOT USED
 * Capturing to this ancestor makes the browser dispatch the subsequent
 * `click` on the NAV rather than the anchor under the finger, which kills
 * every tap. Killing the native link drag keeps the pointer stream alive
 * instead.
 *
 * WHY THE INDICATOR IS WRITTEN DIRECTLY, NOT THROUGH REACT STATE
 * The indicator's position changes on every frame of a swipe. React state
 * would re-render five icons and five SVGs per frame, and `left`/`top` would
 * force a layout pass each time. The transform is written straight to the
 * node via a ref; React state changes once, on release, when the destination
 * actually changes.
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
  applyDeadZone,
  clampToTrack,
  leftFor,
  nearestTab,
  prefersReducedMotion,
  springSettled,
  springStep,
  tabStops,
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
 * Swallow the click the browser synthesises at the end of a swipe.
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
 * The bar's LAYOUT width, ignoring any transform.
 *
 * `getBoundingClientRect()` returns the VISUAL box, so it changes whenever the
 * bar is scaled and must never be used to re-centre. `offsetWidth` reports the
 * box the layout engine actually reserved, which transforms do not change.
 */
function layoutWidth(nav: HTMLElement): number {
  return nav.offsetWidth || nav.getBoundingClientRect().width;
}

/**
 * Keep the bar horizontally centred at every viewport size.
 *
 * Re-derived from the measured width because a bar parked at a pixel `left`
 * from a wider viewport would sit off-centre on a narrower one.
 */
function centreBar(nav: HTMLElement) {
  nav.style.left = `${leftFor(window.innerWidth, layoutWidth(nav))}px`;
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
  const pillRef = useRef<HTMLDivElement | null>(null);

  /**
   * THE LIVE GESTURE.
   *
   * `live` gates the window listeners: always attached, but inert until a
   * gesture starts on the bar. There is exactly ONE gesture now, so there is
   * no axis to disambigate and no pending state to resolve.
   */
  const drag = useRef({
    live: false,
    /** Whether the finger has travelled far enough to be a swipe, not a tap. */
    moved: false,
    startX: 0,
    /** Vertical origin, used ONLY to forward a vertical drag to the real
     *  scroller. The pill never moves vertically. */
    dx: 0,
    v: 0,
    lastX: 0,
    /** Vertical position of the previous move, for the per-frame scroll delta. */
    lastT: 0,
    /** The indicator's x at the moment the finger landed — see onPointerDown. */
    anchorX: 0,
  });

  /**
   * THE INDICATOR CONTROLLER.
   *
   * These are plain mutable values, deliberately NOT React state: they change
   * on every frame and re-rendering five icons per frame would make the swipe
   * stutter — which is the exact "laggy" feel this is meant to eliminate.
   *
   * `x` is always the LAST RENDERED position, never the selected tab's
   * coordinate. That single rule is what makes a re-grab mid-snap seamless:
   * a new drag anchors the finger to where the pill actually is, instead of
   * teleporting it back to the tab it was heading for.
   */
  const anim = useRef({
    x: 0,
    v: 0,
    target: 0,
    frame: 0,
    lastT: 0,
    /** Live track measurements, re-derived on layout changes. */
    tabX: [] as number[],
    trackW: 0,
    pillW: 0,
    /** The pill's inset from the bar's edges, read from CSS. */
    inset: 0,
    /** Set while a spring is running, so a resize can restart it sanely. */
    animating: false,
  });

  /**
   * `armed` records that a swipe was recognised, purely so CSS can suppress the
   * tap highlight. It is deliberately NOT used to show a pressed state: the
   * glass indicator tracking the thumb is the affordance, and a second cue on
   * the icon would be redundant.
   */
  const [armed, setArmed] = useState(false);

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

  /** Write the indicator's position. Direct, un-transitioned, compositor-only. */
  const paint = useCallback((x: number) => {
    const pill = pillRef.current;
    if (pill) pill.style.transform = `translate3d(${x}px, 0, 0)`;
  }, []);

  /**
   * Re-measure the track and park the indicator on the current tab.
   *
   * MUST run after layout, because every number here comes from rendered
   * geometry. A stale `tabX` is how an indicator ends up one tab out of place
   * and a snap lands on the wrong destination.
   */
  const measure = useCallback(
    (snapToIndex: number) => {
      const pill = pillRef.current;
      if (!pill) return;
      const a = anim.current;
      const nav = pill.parentElement;
      if (!nav) return;

      // THE INSET, read from CSS so there is ONE source of truth.
      //
      // The bar is `position: fixed` with `border: 1px` and a 24px radius. The
      // pill is absolutely positioned against its PADDING box, so its `left: 0`
      // origin is already 1px inside the border — which is exactly what we
      // want, and why the border must NOT be subtracted again below.
      //
      // The original code used `offsetWidth`, which measures the BORDER box,
      // so the last stop overshot by 2px and pushed the pill's corners out
      // through the bar's rounded corner — visible on a real iPhone at
      // Spelare, the right-most tab.
      const pillInset = parseFloat(getComputedStyle(pill).top) || 0;
      a.inset = pillInset;

      // `clientWidth` EXCLUDES the border and includes padding, i.e. it is the
      // padding box — the same box the pill's absolute coordinates resolve
      // against. An earlier version subtracted the border again, which shifted
      // the track 1px and left the pill 5.2px off-centre on tab 0.
      a.trackW = nav.clientWidth;

      // One tab wide, INSET by one step each side so the pill stays inside the
      // rounded corners. Narrowing the pill (rather than shifting it) is what
      // keeps it centred: a stop at `inset + i*tabWidth` with width
      // `tabWidth - 2*inset` has its centre exactly on the tab's centre, and
      // its edges exactly `inset` inside the bar.
      const item = nav.querySelector<HTMLElement>(".fabnav-item");
      const itemW = item?.offsetWidth ?? 0;
      if (itemW > 0) {
        a.pillW = Math.max(1, itemW - pillInset * 2);
        pill.style.width = `${a.pillW}px`;
      } else {
        a.pillW = pill.offsetWidth || pill.getBoundingClientRect().width;
      }
      // `left` stays at the CSS default of 0. The inset is applied by the
      // STOPS, not by moving the pill's origin — setting both double-counted it
      // and pushed the indicator off-centre by the inset amount.

      a.tabX = tabStops(DESTINATIONS.length, a.trackW, a.pillW, pillInset);
      a.target = a.tabX[Math.min(Math.max(snapToIndex, 0), a.tabX.length - 1)] ?? pillInset;
      stopSpring();
      a.x = a.target;
      a.v = 0;
      paint(a.x);
    },
    [paint],
  );

  /** Cancel any running spring WITHOUT touching the current position. */
  const stopSpring = useCallback(() => {
    const a = anim.current;
    if (a.frame) cancelAnimationFrame(a.frame);
    a.frame = 0;
    a.lastT = 0;
    a.animating = false;
  }, []);

  /**
   * Spring the indicator to `target` from wherever it is NOW.
   *
   * The spring is what gives the release its settle. During the drag the
   * position is written directly with no transition, because a CSS transition
   * on a property that changes every frame restarts its easing every frame and
   * the rendered pill permanently trails the thumb — measured at ~180ms of lag
   * before this was changed.
   */
  const springTo = useCallback(
    (target: number) => {
      const a = anim.current;
      stopSpring();
      a.target = target;

      // Reduced motion: arrive immediately, but still arrive. The interaction
      // is untouched; only the travel is removed.
      if (prefersReducedMotion()) {
        a.x = target;
        a.v = 0;
        paint(target);
        return;
      }

      a.animating = true;
      const tick = (time: number) => {
        const dt = a.lastT ? (time - a.lastT) / 1000 : 0;
        a.lastT = time;
        const next = springStep(a.x, a.v, a.target, dt);
        a.x = next.x;
        a.v = next.v;
        if (springSettled(a.x, a.v, a.target)) {
          a.x = a.target;
          a.v = 0;
          paint(a.x);
          a.frame = 0;
          a.animating = false;
          return;
        }
        paint(a.x);
        a.frame = requestAnimationFrame(tick);
      };
      a.frame = requestAnimationFrame(tick);
    },
    [paint, stopSpring],
  );

  /**
   * Navigate to a tab, from either a tap or a swipe.
   *
   * Both paths converge here so they cannot drift apart: the indicator is
   * parked on the destination either way, and the route changes in the same
   * place.
   */
  const goTo = useCallback(
    (next: number) => {
      const clamped = clampIndex(next);
      if (clamped !== indexRef.current) onSelectRef.current(DESTINATIONS[clamped]);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // Ignore secondary buttons so a right-click never starts a gesture.
    if (e.button !== 0 && e.pointerType === "mouse") return;

    const d = drag.current;
    const a = anim.current;

    /**
     * RE-GRAB, WITHOUT A JUMP.
     *
     * If a spring is mid-flight the pill is somewhere between two tabs. The
     * finger must anchor to where the pill ACTUALLY is (`a.x`, the last
     * rendered position) — never to the selected tab's coordinate, which would
     * teleport the pill sideways the instant it is touched. `x` is left exactly
     * as it is and the finger delta is measured from here.
     */
    stopSpring();

    /**
     * RE-GRAB, WITHOUT A JUMP.
     *
     * If a spring is mid-flight the pill is somewhere between two tabs. The
     * finger takes over from exactly there — `a.x`, the last RENDERED position —
     * so the pill never teleports. Resetting the anchor to the touch point
     * instead was tried and REJECTED: a swipe may begin anywhere on the bar, so
     * anchoring to `clientX` made the pill jump to the thumb on the first move
     * (measured 65px on a gesture that should not have moved it at all).
     *
     * The trade-off, recorded honestly: the pill therefore tracks the finger's
     * DELTA rather than sitting under it. A swipe that starts away from the
     * pill's centre leaves a constant offset between thumb and pill. That is
     * the deliberate choice — no jump on touchdown beats perfect centring.
     */
    d.anchorX = a.x;

    d.live = true;
    d.moved = false;
    d.startX = e.clientX;
    d.dx = 0;
    d.v = 0;
    d.lastX = e.clientX;
    d.lastT = performance.now();
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

      const a = anim.current;

      /*
       * A VERTICAL move is NOT ours, and is deliberately left to the browser.
       *
       * `touch-action: pan-y` on the bar permits vertical panning and reserves
       * horizontal for our swipe. The app does not call preventDefault and does
       * not scroll anything by hand: a manual forwardScroll() was tried and
       * removed, because inventing a custom scrolling system is not this
       * feature's job and it would fight the browser's own momentum.
       *
       * UNRESOLVED (product/layout, not a swipe blocker): the bar is
       * `position: fixed`, a SIBLING of `.layer`, which is the element that
       * actually scrolls. A touch starting on the bar therefore has no
       * scrollable ancestor, so `pan-y` grants permission to scroll but there
       * may be nothing here for the browser to scroll. Measured in Chromium:
       * identical vertical drags scroll the content from the content area and
       * scroll 0px from the bar. Whether a fixed nav outside the scroll
       * container should scroll at all is a layout decision, not a bug in the
       * swipe. It is recorded rather than papered over.
       */
      // The pill only tracks HORIZONTAL travel.
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      if (!d.moved) {
        d.moved = true;
        // Only now is it a swipe, so only now may we suppress the tap flash.
        setArmed(true);
        // Haptic confirmation where the platform offers it. Absent on iOS
        // Safari, which is fine — an enhancement, never the only signal.
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate(8);
        }
      }

      // Delta tracking from the anchor, so reversing direction just changes the
      // delta and the pill cannot accumulate error across frames. Clamped with
      // the same inset the stops use, so a drag cannot push the pill past the
      // bar's rounded corners either.
      const next = clampToTrack(d.anchorX + dx, a.trackW, a.pillW, a.inset);
      a.x = next;
      a.v = 0; // the finger owns the position directly while it is down
      paint(next);
    },
    [paint],
  );

  const endDrag = useCallback(
    (commitIt: boolean) => {
      const d = drag.current;
      d.live = false;
      setArmed(false);
      if (!d.moved) return; // a tap: let the anchor's own click through

      const a = anim.current;
      // A CANCELLED gesture snaps back to the tab we are already on and does
      // NOT change page. A cancel is not a completed swipe.
      // The destination is the tab nearest the PILL's resulting position — never
      // the tab under the finger's absolute screen position, and never a forced
      // single step. A deliberate drag therefore selects whatever icon the pill
      // ended up closest to, while a small dead zone around the midpoint absorbs
      // an accidental nudge. See applyDeadZone for why a two-tab move is never
      // suppressed.
      const target = commitIt
        ? applyDeadZone(nearestTab(a.x, a.tabX), indexRef.current, a.x, a.tabX)
        : indexRef.current;
      const stop = a.tabX[Math.min(Math.max(target, 0), a.tabX.length - 1)] ?? 0;
      springTo(stop);
      // The finger travelled, so the browser may synthesise a click on the link
      // it started over. Swallow it so a swipe never also taps.
      stopNextClick(navRef.current);
      if (commitIt) goTo(target);
    },
    [goTo, paint, springTo],
  );

  /**
   * Window-level listeners.
   *
   * The handlers read from refs, so this effect's dependencies are the stable
   * callbacks themselves. Re-attaching on EVERY render (an earlier version)
   * meant a mid-render teardown could lose any event landing in that window.
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
   * Measure, centre, and keep both true at every viewport size — plus move the
   * indicator when the ROUTE changes, so a deep link or a back gesture parks
   * the pill on the tab that is actually showing.
   */
  useEffect(() => {
    const apply = () => {
      const el = navRef.current;
      if (el) centreBar(el);
      measure(current);
    };
    apply();
    // After layout, so the pill's width is known.
    const raf = requestAnimationFrame(apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
    // `current` is a dependency on purpose: a route change must move the pill.
  }, [current, measure]);

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
      {/*
        THE GLASS INDICATOR.
        `pointer-events: none` is essential, not cosmetic: the pill sits on top
        of the icons, and without this it would swallow the very taps and
        swipes it is meant to visualise. It is also aria-hidden — it conveys
        no information the active link's `aria-current` does not already carry.
      */}
      <div
        ref={pillRef}
        className="fabnav-pill"
        aria-hidden="true"
        data-testid="fabnav-pill"
      />
      <ul className="fabnav-list">
        {DESTINATIONS.map((d, i) => {
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
                  // A TAP parks the pill and navigates in one step. The spring
                  // is bypassed deliberately: the pill is already on this tab,
                  // so animating it would be animating nothing.
                  measure(i);
                  goTo(i);
                }}
              >
                <span className="fabnav-icon" aria-hidden="true">
                  {/*
                    The icon box is scaled with the bar (24 -> 34 user units on a
                    24-unit viewBox) so the glyph is not clipped as the CSS grows
                    it from 20px to 30px. `width`/`height` here override the SVG's
                    default 24x24; the CSS still controls the rendered size.
                  */}
                  <Icon
                    width={34}
                    height={34}
                    x={-5}
                    y={-5}
                    strokeWidth={isActive ? 2.4 : 2}
                  />
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
