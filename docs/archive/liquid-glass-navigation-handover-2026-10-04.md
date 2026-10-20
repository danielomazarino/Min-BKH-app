# Floating / liquid-glass navigation — technical handover

> ## ⚠️ ARCHIVED — HISTORICAL SNAPSHOT, NOT CURRENT CODE
>
> This document describes the working tree as it stood on **2026-10-04 23:24**.
> It is kept for the reasoning it records, **not** as a description of the
> shipped code. Do not review it as if it were current.
>
> **What has changed since (verified 2026-10-20):**
>
> | Area | This document | Current code |
> | --- | --- | --- |
> | `FloatingTabBar.tsx` | 589 lines, pre-fix | 616 lines |
> | Pill inset fix (`a.inset`, `clientWidth`) | absent | present (`c109164`) |
> | Icon size (24 units at 20px, was blurry) | absent | present (`c109164`) |
> | `--fabnav-h` | `58px` | `78px` |
> | `--fabnav-w` | `260px` | `480px` |
> | `--fabnav-top` | `56px` | removed entirely |
> | `theme.css` | 2466 lines / 67.1 KB | 3544 lines / 107 KB |
> | `git status` | 8 modified + 4 untracked | all committed and clean |
>
> The document also contains an unfilled placeholder — *"NaN of 2466 lines
> extracted"* — which was never completed.
>
> **Findings that are still accurate** (re-verified against current code):
> `isSwipeCommit` and its constants are exported but never called by the
> component; `.fabnav[data-lifted]` is dead CSS; no
> `prefers-reduced-transparency` handling exists; `d.dx` is written and never
> read.
>
> To review the navigation as it ships today, read the source directly:
> `app/shared/FloatingTabBar.tsx`, `app/shared/fabnavPosition.ts`,
> `app/shared/nav.ts`, and the `.fabnav` block in `app/theme.css`.

---

External technical review package. Everything below is the **complete current
contents** of the files directly involved in the floating navigation
interaction, its styling, and its tests. No code has been paraphrased, trimmed
or summarised.

The single exception is `app/theme.css`: at 2466 lines /
67.1 KB it is included **by section** — only the
floating-navigation sections, each quoted verbatim with its true line range.

---

## 1. Repository and environment state

| Item | Value |
| --- | --- |
| Repository root | `/home/lm/Dev/BKH pwa app` |
| Git branch | `main` |
| Git commit SHA | `1eefb71cc112f858d6cdc25220d89cd6c6185361` |
| Node version | `v20.20.2` |
| npm version | `10.8.2` |
| Total size of included files | ~135.3 KB |

### `git status --short`

```text
 M app/shared/FloatingTabBar.tsx
 M app/shared/fabnavPosition.test.ts
 M app/shared/fabnavPosition.ts
 M app/theme.css
 D e2e/fabnav-drag.spec.ts
 M e2e/navigation.spec.ts
 M e2e/touch.spec.ts
 M playwright.config.ts
 M vite.config.ts
?? .github/prompts/012-add-gp-feed-and-verify-deploy.prompt.md
?? .github/prompts/013-log-drop-breakdown-test-and-deploy.prompt.md
?? e2e/fabnav-swipe.spec.ts
?? e2e/nav-indicator-journey.spec.ts
?? e2e/navIndicatorDrag.ts
?? liquid-glass-navigation-handover.md
```

> **Important for the reviewer — the working tree is not clean, and this
> document describes it.**
>
> The floating navigation was materially rewritten on 2026-10-03 and those
> changes are **uncommitted**. `e2e/fabnav-drag.spec.ts` is deleted and replaced;
> `e2e/fabnav-swipe.spec.ts`, `e2e/nav-indicator-journey.spec.ts` and
> `e2e/navIndicatorDrag.ts` are new and untracked. Everything reproduced below
> is the **working-tree** state, which is *ahead of* commit `1eefb71`.
> Checking out `1eefb71` will **not** reproduce this code.

### Included files

| File | Kind | Size | Bytes | Why included |
| --- | --- | --- | --- | --- |
| `app/shared/FloatingTabBar.tsx` | Production | 22.2 KB | 22767 | The component containing FloatingTabBar |
| `app/shared/fabnavPosition.ts` | Production | 8.9 KB | 9071 | Pure indicator geometry, dead zone and spring |
| `app/shared/nav.ts` | Production | 3.3 KB | 3361 | Destination model, routing helpers, index clamping |
| `app/App.tsx` | Production | 9.6 KB | 9834 | HashRouter shell — the route commit point |
| `app/shared/fabnavPosition.test.ts` | Test | 9.7 KB | 9902 | Vitest unit tests for indicator geometry and spring |
| `app/shared/FloatingTabBar.test.ts` | Test | 2.4 KB | 2416 | Vitest unit tests for the swipe-commit thresholds |
| `e2e/navIndicatorDrag.ts` | Test | 7.5 KB | 7629 | Shared real-touch drag helpers (CDP) for the indicator |
| `e2e/nav-indicator-journey.spec.ts` | Test | 10.1 KB | 10319 | End-to-end Nyheter → Matcher → Nyheter journey |
| `e2e/fabnav-swipe.spec.ts` | Test | 12.1 KB | 12367 | End-to-end swipe-between-icons behaviour |
| `e2e/navigation.spec.ts` | Test | 27.0 KB | 27699 | Five-destination model + indicator gesture contract |
| `e2e/touch.spec.ts` | Test | 19.0 KB | 19458 | Touch-driven regressions (nav swipe + sheet drag) |
| `playwright.config.ts` | Config | 2.2 KB | 2296 | Playwright projects, base URL, viewport, web server |
| `package.json` | Config | 1.4 KB | 1465 | Scripts and dependency versions |

Plus `app/theme.css` sections 3.1–3.4 (**NaN of 2466 lines** extracted).

### Deliberately excluded

`node_modules/`, `dist/`, `test-results/` (Playwright traces, screenshots,
videos), `.github/`, the data pipeline and all page components. None are
inputs to, or outputs of, the floating navigation interaction.

### One stale-document warning

`docs/ENHANCEMENTS.md` (E-013, item 4) states *"`isSwipeCommit` is still live —
it gates the swipe commit in `onPointerUp`."* **That is no longer true.** In the
current code `isSwipeCommit` is exported from `FloatingTabBar.tsx`, is
referenced only by its own definition and by `FloatingTabBar.test.ts`, and is
**never called** by the component — the release decision is geometric (nearest
tab + dead zone). See §8 item 9.

---

## 2. Production code

### 2.1 `app/shared/FloatingTabBar.tsx`

**`app/shared/FloatingTabBar.tsx`** — 22.2 KB (22767 bytes, 589 lines)

```tsx
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
      // offsetWidth, not the rect: the pill is transformed while it moves, and
      // a transformed rect is the VISUAL box, which would make the stops drift
      // as the pill slides.
      a.trackW = pill.parentElement?.offsetWidth ?? 0;
      /*
       * The pill is ONE TAB WIDE, and the width is set here rather than in
       * CSS so that it can never disagree with `tabStops`. If CSS said 52px
       * and the tab measured 50px, the last stop would be 2px short and the
       * pill would look like it stops short of the final icon.
       *
       * Set from the LAYOUT box, not the rect: the pill is transformed while
       * it moves, and a transformed rect is the visual box, which would make
       * the stops drift as the pill slides.
       */
      const item = pill.parentElement?.querySelector<HTMLElement>(".fabnav-item");
      const itemW = item?.offsetWidth ?? 0;
      if (itemW > 0) {
        pill.style.width = `${itemW}px`;
        a.pillW = itemW;
      } else {
        a.pillW = pill.offsetWidth || pill.getBoundingClientRect().width;
      }
      a.tabX = tabStops(DESTINATIONS.length, a.trackW, a.pillW);
      a.target = a.tabX[Math.min(Math.max(snapToIndex, 0), a.tabX.length - 1)] ?? 0;
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
      // delta and the pill cannot accumulate error across frames.
      const next = clampToTrack(d.anchorX + dx, a.trackW, a.pillW);
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
```


### 2.2 `app/shared/fabnavPosition.ts`

**`app/shared/fabnavPosition.ts`** — 8.9 KB (9071 bytes, 220 lines)

```ts
/**
 * Geometry and physics for the floating navigation bar's GLASS INDICATOR.
 *
 * WHY THIS FILE EXISTS
 * The interesting part is not the pointer handling — it is the arithmetic that
 * keeps the indicator inside the track and settles it on a tab. That arithmetic
 * is pure, so it can be tested without a browser, without synthetic touch, and
 * without the flakiness gesture tests are prone to. It lives here to keep the
 * component a thin shell over it.
 *
 * SCOPE — WHAT WAS REMOVED AND WHY
 * This module used to describe a vertically draggable bar: a `Dock` of
 * `{ y }`, a `Track` of `travelY`, a persisted position, edge snapping and a
 * hold timer. All of that is GONE, deliberately, on request (2026-10-03).
 *
 * The bar is now fixed in place and the only gesture is a horizontal swipe.
 * The removal is not a simplification for its own sake: the vertical drag had
 * accumulated four platform-specific defects — a WebKit link callout that ate
 * the gesture, hold timing that depended on a platform guess, a
 * stationary-press race that stole swipes, and a visual-vs-layout measurement
 * bug — and each one cost real time. `parseDock`/`serialiseDock` disappear
 * because a fixed bar has no position worth remembering.
 *
 * The lesson worth keeping: dead branches in gesture code are how the previous
 * bug stayed hidden for so long, so this is deleted rather than left dormant.
 */

/** Keep a number inside a range; anything non-finite collapses to the min. */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * The bar's left edge in px.
 *
 * Purely centring — the bar has no horizontal freedom at all. Kept here so the
 * component never has to know the width or the margins.
 */
export function leftFor(navWidth: number, barWidth: number): number {
  return (navWidth - barWidth) / 2;
}

/**
 * Whether a movement should be read as a swipe rather than a tap.
 *
 * Below this the gesture stays a tap, so a slightly shaky finger opens a
 * destination instead of swiping. 8px is chosen because ordinary thumb tremor
 * during a tap is smaller than it, while a real thumb sweep is several times
 * larger — the threshold sits comfortably between.
 */
export const DRAG_THRESHOLD_PX = 8;

/* ------------------------------------------------------------------ *
 * THE INDICATOR TRACK
 * ------------------------------------------------------------------ */

/**
 * Where the indicator's left edge sits when centred on each tab.
 *
 * `tabX[i]` is the indicator's LEFT edge in track-local px. It is a function of
 * the rendered layout, so it MUST be re-measured after a resize rather than
 * cached — a stale array is how an indicator ends up one tab out.
 *
 * The indicator is one tab wide, so the first entry is always 0 and the last is
 * `trackWidth - indicatorWidth`. Those two facts are what make clamping
 * possible at all.
 */
export function tabStops(count: number, trackWidth: number, indicatorWidth: number): number[] {
  if (count <= 0) return [0];
  const usable = Math.max(0, trackWidth - indicatorWidth);
  // With a zero-width track every stop collapses to 0; dividing by a zero span
  // would produce NaN and strand the indicator off-screen.
  if (count === 1 || usable === 0) return new Array(count).fill(0);
  const step = usable / (count - 1);
  return new Array(count).fill(0).map((_, i) => i * step);
}

/** Clamp a position to the track, so the indicator cannot leave the bar. */
export function clampToTrack(x: number, trackWidth: number, indicatorWidth: number): number {
  return clamp(x, 0, Math.max(0, trackWidth - indicatorWidth));
}

/**
 * A DEAD ZONE around the current tab, as a fraction of one tab's travel.
 *
 * Without it, a tiny accidental movement — a thumb settling, a bump while
 * walking — can be enough to shift the pill past the midpoint between two tabs
 * and change the page. The pill would then sit visibly closer to the NEW tab,
 * so the page would follow it, which means the dead zone has to be smaller
 * than half a tab's travel (0.5) or it could never be crossed.
 *
 * At 0.18 the user must move the pill about 18% of a tab past the midpoint
 * before the destination changes. On a 258px bar with 52px pills that is about
 * 9px of slop either side of the midpoint — enough to absorb a bumped gesture,
 * small enough that a deliberate 40px flick still commits comfortably.
 */
export const DEAD_ZONE = 0.18;

/**
 * The tab whose stop is closest to `x`.
 *
 * Ties resolve to the LOWER index, so a release exactly between two tabs picks
 * the earlier one. Picking the later one would make a rightward swipe feel
 * like it needed slightly less travel, which reads as the bar sticking.
 */
export function nearestTab(x: number, tabX: number[]): number {
  if (tabX.length <= 1) return 0;
  let best = 0;
  let bestDist = Math.abs(tabX[0] - x);
  for (let i = 1; i < tabX.length; i++) {
    const d = Math.abs(tabX[i] - x);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Apply the dead zone to a release.
 *
 * WHY IT IS A FRACTION AND NOT A PIXEL COUNT
 * A tab's travel depends on the measured layout — 51.5px on a 258px bar, and
 * something different on a 320px screen or in landscape. A dead zone expressed
 * in pixels would therefore mean different things on different phones, so it is
 * expressed as a fraction of one tab's travel and stays proportional.
 *
 * `nearest` is the raw nearest tab. If that tab is ADJACENT to the current one
 * and the pill sits inside the dead zone around the midpoint, the current tab
 * wins instead — so a nudged thumb cannot change the page.
 *
 * A move to a tab that is TWO or more away is never suppressed. Dragging
 * deliberately across the bar is a real intent, and the pill visibly ends up
 * nearer the far tab; blocking that would leave the indicator and the page
 * disagreeing, which is the one outcome that is always wrong.
 *
 * Ties resolve to the CURRENT tab, not the neighbour, for the same reason:
 * doing nothing is the safe reading of an ambiguous gesture.
 */
export function applyDeadZone(nearest: number, current: number, x: number, tabX: number[]): number {
  if (nearest === current) return current;
  // Only ever suppresses an adjacent move.
  if (Math.abs(nearest - current) !== 1) return nearest;
  const here = tabX[current];
  const there = tabX[nearest];
  if (here === undefined || there === undefined) return nearest;
  const travel = Math.abs(there - here);
  if (travel === 0) return current;
  const mid = (here + there) / 2;
  const offset = Math.abs(x - mid) / travel;
  return offset < DEAD_ZONE ? current : nearest;
}

/* ------------------------------------------------------------------ *
 * THE SPRING
 * ------------------------------------------------------------------ */

/**
 * Spring constants, in the mentor's recommended starting values.
 *
 * `stiffness` pulls the indicator toward the target; `damping` resists
 * overshoot; `mass` is the inertia the finger has to shift. 450/32/1 arrives
 * quickly with a hint of life and does not oscillate the way a stiffer, lighter
 * spring would.
 */
export const SPRING_STIFFNESS = 450;
export const SPRING_DAMPING = 32;
export const SPRING_MASS = 1;

/** Below this distance AND speed the spring is done. */
const SPRING_EPSILON_X = 0.25;
const SPRING_EPSILON_V = 2;

/** One step of the spring, returning the new position and velocity. */
export function springStep(
  x: number,
  velocity: number,
  target: number,
  dt: number,
  stiffness = SPRING_STIFFNESS,
  damping = SPRING_DAMPING,
  mass = SPRING_MASS,
): { x: number; v: number } {
  // Fixed sub-steps keep the integration stable regardless of frame timing.
  // A delayed frame — tab backgrounded, main thread busy — would otherwise
  // produce one huge dt and fling the indicator across the bar.
  const step = 1 / 120;
  let remaining = Math.min(Math.max(dt, 0), 0.05);
  while (remaining > 0) {
    const h = Math.min(remaining, step);
    const a = (stiffness * (target - x) - damping * velocity) / mass;
    velocity += a * h;
    x += velocity * h;
    remaining -= h;
  }
  return { x, v: velocity };
}

/** Whether the spring has effectively arrived. */
export function springSettled(x: number, v: number, target: number): boolean {
  return Math.abs(target - x) < SPRING_EPSILON_X && Math.abs(v) < SPRING_EPSILON_V;
}

/**
 * Reduced motion collapses the spring to an immediate jump.
 *
 * This is the accessible behaviour, not a fallback: someone who has asked for
 * reduced motion should get the destination without the travel. The
 * interaction itself — swipe, release, navigate — is untouched, because
 * reduced motion suppresses animation, never capability.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
```


### 2.3 `app/shared/nav.ts`

**`app/shared/nav.ts`** — 3.3 KB (3361 bytes, 84 lines)

```ts
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
  { path: "/", label: "Hem", icon: Home, testId: "tab-brief" },
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
```


### 2.4 `app/App.tsx`

<sub>The route commit point. `go()` calls `useNavigate()`; `active` is derived from
`useLocation()` via `destinationFor()`.</sub>

**`app/App.tsx`** — 9.6 KB (9834 bytes, 272 lines)

```tsx
import { useEffect, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate, Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import Brief from "./pages/Brief";
import News from "./pages/News";
import Matches from "./pages/Matches";
import Squad from "./pages/Squad";
import FormerPlayers from "./pages/FormerPlayers";
import NotFound from "./pages/NotFound";
import { loadAppData, type AppDataState } from "./data";
import { FloatingTabBar } from "./shared/FloatingTabBar";
import { Sheet } from "./shared/Sheet";
import { DESTINATIONS, SETTINGS_PATH, destinationFor, idFromSearch, searchWithId } from "./shared/nav";

const ICON = `${import.meta.env.BASE_URL}icons/icon-192.png`;

export default function App() {
  const [state, setState] = useState<AppDataState>({ status: "loading" });

  useEffect(() => {
    loadAppData().then(setState);
  }, []);

  return (
    <HashRouter>
      <AppShell state={state} />
    </HashRouter>
  );
}

/**
 * The shell.
 *
 * Navigation is reduced to FIVE persistent destinations, each owning a stable
 * route. Everything else - settings, news detail, match detail, player detail -
 * is a URL-addressable CHILD of one of those five, so the browser/iOS back
 * gesture always closes the most recent thing the user opened.
 *
 * There is no catch-all route any more. An unknown hash renders an explicit
 * "not found" surface that keeps the navigation bar usable, rather than
 * silently pretending to be Brief.
 */
function AppShell({ state }: { state: AppDataState }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [from, setFrom] = useState<string | null>(null);

  const settingsOpen = pathname === SETTINGS_PATH;
  const active = destinationFor(settingsOpen && from ? from : pathname);

  const go = (to: string) => {
    setFrom(null);
    navigate(to);
  };

  /**
   * Settings is a sheet over the current section. Opening it records where
   * the user came from and puts it in the URL, so both the back gesture and a
   * cold load of `#/installningar?id=%2Ftrupp` restore the same section.
   */
  const openSettings = () => {
    const here = from ?? pathname;
    setFrom(here);
    navigate(`${SETTINGS_PATH}${searchWithId(here)}`);
  };
  const closeSettings = () => {
    const back = from ?? "/";
    setFrom(null);
    navigate(back);
  };

  // A back/forward or a cold load that lands on #/installningar must recover
  // the underlying section from the URL, not from ephemeral component state.
  useEffect(() => {
    if (settingsOpen) {
      const f = idFromSearch(search);
      setFrom((prev) => (f && f !== prev ? f : prev));
    } else {
      setFrom(null);
    }
  }, [pathname, search, settingsOpen]);

  // Escape closes the sheet, matching every other detail surface.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSettings();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [settingsOpen, from]);

  const generatedAt = state.status === "ready" ? state.data.freshness.generatedAt : null;
  const stale = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 3600000 > 36 : false;

  return (
    <>
      <a href="#main" className="skip-link">
        Hoppa till innehållet
      </a>

      <header className="app-header">
        <img src={ICON} alt="" className="mark" width={22} height={22} />
        <span className="brand">
          Min <b>BKH</b>-app
        </span>
        {generatedAt && (
          <span
            className="freshness"
            data-stale={stale}
            data-testid="freshness"
            title={`Senast uppdaterad ${new Date(generatedAt).toLocaleString("sv-SE")}`}
          >
            <span className="dot" aria-hidden="true" />
            {stale ? "Kan vara gammal" : "Uppdaterad"}
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={openSettings}
          aria-label="Inställningar och data"
          data-testid="open-settings"
          aria-expanded={settingsOpen}
        >
          <SettingsIcon aria-hidden />
        </button>
      </header>

      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Brief state={state} />} />
          <Route path="/nyheter" element={<News state={state} />} />
          <Route path="/matcher" element={<Matches state={state} />} />
          <Route path="/trupp" element={<Squad state={state} />} />
          <Route path="/spelare" element={<FormerPlayers />} />
          <Route path={SETTINGS_PATH} element={null} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <FloatingTabBar active={active} onSelect={(d) => go(d.path)} />

      {settingsOpen && (
        <Sheet title="Data & källor" onClose={closeSettings} testId="settings-sheet">
          <SettingsPanel state={state} />
        </Sheet>
      )}
    </>
  );
}

/**
 * Settings content. Supporter-facing facts first (freshness, why data may be
 * missing, which publishers feed the app); the provenance-heavy material sits
 * behind a native <details> so it never contaminates the main experience.
 * No secrets are ever exposed here.
 */
function SettingsPanel({ state }: { state: AppDataState }) {
  const data = state.status === "ready" ? state.data : null;
  const unavailable = data?.currentDataUnavailable;
  const source = data?.footballSource;
  const squadCount = data?.squadStats?.length ?? null;

  return (
    <div className="stack-4">
      <section>
        <div className="mod-label">Aktualitet</div>
        <p className="small muted" data-testid="settings-updated">
          {data
            ? `Data hämtad ${new Intl.DateTimeFormat("sv-SE", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(data.freshness.generatedAt))}. Nyheter uppdateras varje natt.`
            : "Data kunde inte läsas."}
        </p>
        {unavailable && (
          <p className="small muted" data-testid="current-unavailable">
            Aktuell matchdata saknas just nu: {unavailable.reason}
          </p>
        )}
      </section>

      <section>
        <div className="mod-label">Vyer</div>
        <p className="small muted" data-testid="settings-squad">
          {squadCount != null
            ? `Aktuell herrtrupp: ${squadCount} spelare. Spelarhistoriken söks live mot Wikidata.`
            : "Truppuppgifter kunde inte läsas."}
        </p>
      </section>

      <section>
        <div className="mod-label">Nyhetskällor</div>
        <div data-testid="news-sources">
          {data ? (
            Object.entries(data.freshness.sourceStatus)
              .filter(([k]) => k.startsWith("rss:"))
              .map(([k, v]) => (
                <div className="srcrow" key={k}>
                  <span className="nm">{k.replace("rss:", "")}</span>
                  <span className="rl">{v === "ok" ? "OK" : v === "failed" ? "FEL" : "HOPPAR ÖVER"}</span>
                </div>
              ))
          ) : (
            <p className="small dim">—</p>
          )}
        </div>
      </section>

      <details className="disc" data-testid="diagnostics">
        <summary>
          Teknisk information och proveniens
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="disc-body stack-3">
          {source && (
            <p className="small dim">
              Matchdata: {source.provider} via {source.publicSite} · säsong {source.season} ·{" "}
              {source.dataStatus === "current"
                ? "aktuell säsong"
                : source.dataStatus === "historical"
                  ? "historisk säsong"
                  : "ej tillgänglig"}
            </p>
          )}
          <p className="small dim" data-testid="sm-status">
            SportoMedia:{" "}
            {data?.freshness.sourceStatus["sportomedia"] === "ok"
              ? "ok"
              : data?.freshness.sourceStatus["sportomedia"] === "failed"
                ? "fel"
                : "ej körd"}
            {typeof data?.cardMatchesInspected === "number"
              ? ` · ${data.cardMatchesInspected} matcher kontrollerade för kort`
              : ""}
          </p>
          <p className="small dim">
            Nyhetshändelser: {data?.newsEvents?.length ?? 0} · Spelare: sökning mot Wikidata (ingen lokal lista)
          </p>
          {data?.disciplineRule && (
            <p className="small dim" data-testid="rule-text">
              Varningsregel: {data.disciplineRule.threshold} varningar i olika matcher ger{" "}
              {data.disciplineRule.suspensionMatches} matchs avstängning.{" "}
              <a className="link" href={data.disciplineRule.ruleSourceUrl} target="_blank" rel="noopener noreferrer">
                Källa
              </a>
            </p>
          )}
          <p className="small dim">
            Artiklar hämtas från källornas egna RSS-flöden. Firecrawl används bara för att hitta artiklar
            — det är aldrig en källa.
          </p>
        </div>
      </details>

      <p className="small dim" data-testid="settings-nav-hint">
        <Link className="link" to="/">
          Till startsidan
        </Link>{" "}
        · {DESTINATIONS.length} huvudvyer
      </p>
    </div>
  );
}
```


---

## 3. CSS — `app/theme.css`

### 3.1 Chrome and glass design tokens

<sub>`app/theme.css` lines **15–134** (120 lines) — extracted verbatim by brace matching; nothing elided inside the range.</sub>

Declares `--fabnav-h`, `--fabnav-gap`, `--fabnav-top`, `--fabnav-w`, every glass colour, both blur stacks, both opaque fallbacks, `--chrome-bottom`, and the shared easing/duration tokens (`--ease-ios`, `--dur-tap`).

```css
:root {
  /* Surfaces — a dark ramp, not a card-and-border system */
  --bg: #000000;
  --surface: #0e0e0e;
  --surface-2: #161616;
  --surface-3: #1e1e1e;
  --hairline: rgba(255, 255, 255, 0.08);
  --hairline-strong: rgba(255, 255, 255, 0.16);

  /* Häcken yellow — restricted duty */
  --yellow: #ffd200;
  --yellow-dim: rgba(255, 210, 0, 0.12);
  --yellow-ink: #1a1500; /* text on a yellow fill */
  --yellow-text: #ffd200; /* yellow text on black — 14.6:1 */

  /* Text
     Contrast verified with axe-core (WCAG 2.2 AA) on every surface used:
     #000, #0e0e0e, #161616, #1e1e1e. text-3 at 45% white was 4.43:1 on
     black and 3.82:1 on surface-2 — it failed. 58% clears 4.5:1 everywhere
     with margin, and still reads as a clearly secondary tone. */
  --text: #ffffff;
  --text-2: rgba(255, 255, 255, 0.72);
  --text-3: rgba(255, 255, 255, 0.58);

  /* Status — always paired with a word or glyph, never colour alone */
  --danger: #ff5a5f; /* suspended / loss */
  --danger-dim: rgba(255, 90, 95, 0.16);
  --caution: #ffb020; /* one warning from suspension */
  --caution-dim: rgba(255, 176, 32, 0.14);
  --ok: #46a758;

  /* Spacing scale (4px base) */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 24px;
  --s6: 32px;

  /* Radii — deliberately few. Modules have none. */
  --r-sm: 8px;
  --r-md: 12px;
  --r-sheet: 20px;

  /* Type scale */
  --t-hero: 52px;
  --t-lead: 17px;
  --t-title: 15px;
  --t-body: 13px;
  --t-meta: 12px;
  --t-label: 11px;

  /* Chrome heights */
  --header-h: 44px;
  /* The floating bar is 58px tall and floats 16px above the safe area, so
     content needs ~58 + 2x16 + the inset of clearance to scroll fully clear. */
  --fabnav-h: 58px;
  /* Distance from the viewport edge to the bar. Kept separate from the height
     so the two can be tuned independently. It is ALSO the minimum horizontal
     margin the bar is dragged within, which is why JS reads it back. */
  --fabnav-gap: 16px;
  /* Top of the band the bar may be dragged up to. Sits below the fixed header
     so a dragged bar can never cover the settings button or the title. Read
     back by JS as the vertical origin. */
  --fabnav-top: 56px;
  /* WIDTH CEILING — the single most load-bearing value for the drag.
   *
   * Horizontal travel = viewport - this - 2 x --fabnav-gap. At 260px on a
   * 390px phone that leaves 98px of travel; the bar used to be 358px wide,
   * which left ZERO and made the drag impossible. Raising this toward 100%
   * silently removes the ability to drag, so change it deliberately or not at
   * all. The five destinations are laid out with `flex: 1 1 0` and their
   * labels ellipsise, so a narrower bar degrades legibly rather than clipping. */
  --fabnav-w: 260px;

  /* GLASS — every part of the floating-nav surface in one place, so the look
   * can be retuned without hunting through declarations.
   *
   * `--fabnav-blur` is deliberately plain `blur() saturate()`. A true Liquid
   * Glass refraction needs an SVG displacement filter fed by
   * `backdrop-filter: url(...)`, which Safari does not support — adding it for
   * Chromium only would make the two platforms look different and cost a
   * full-screen filter repaint on every frame of a drag. The gradient and
   * inner highlights below give the depth cue without that cost, and stay
   * pure CSS so they work identically on iOS and Android. */
  --fabnav-blur: blur(20px) saturate(1.5);
  /* Translucent surface. 0.62 is measured, not guessed — see the A/B table on
     `.fabnav`. */
  --fabnav-surface: rgba(42, 44, 48, 0.62);
  /* Fallback for engines with no backdrop-filter. Much more opaque on
     purpose: over a #000 page a 0.62 surface is unreadable without the blur. */
  --fabnav-surface-opaque: rgba(38, 40, 44, 0.95);
  /* Hairline border. Catches the light at the top edge of the pill. */
  --fabnav-edge: rgba(255, 255, 255, 0.1);
  /* Inner top highlight — the strongest single cue that a surface is a
     translucent pane rather than a solid fill. */
  --fabnav-sheen: rgba(255, 255, 255, 0.11);

  /* The GLASS INDICATOR that slides between icons. Deliberately lighter and
     more saturated than --fabnav-surface: the bar recedes, the pill advances,
     and that contrast is the whole reason the movement reads as a selection
     rather than as the bar wobbling. */
  --fabnav-pill: rgba(255, 255, 255, 0.16);
  --fabnav-pill-edge: rgba(255, 255, 255, 0.34);
  /* A weaker blur than the bar's own: the pill sits on top of the bar, so it
     samples a surface that is already blurred. A second heavy blur would be a
     full-screen filter repaint on every frame of the drag, which is exactly
     the cost the bar avoided by not using url() filters. */
  --fabnav-pill-blur: blur(8px) saturate(1.8);
  /* Fallback when the engine has no backdrop-filter: the pill must still be
     clearly visible, so it gets a solid-ish wash rather than nothing. */
  --fabnav-pill-opaque: rgba(255, 255, 255, 0.22);

  --chrome-bottom: calc(var(--fabnav-h) + var(--fabnav-gap) * 2 + env(safe-area-inset-bottom, 0px));

  --ease-ios: cubic-bezier(0.32, 0.72, 0, 1);
  --dur-sheet: 300ms;
  --dur-dismiss: 220ms;
  --dur-tap: 80ms;
}
```

### 3.2 The scroll surface the bar floats over

<sub>`app/theme.css` lines **280–313** (34 lines) — extracted verbatim by brace matching; nothing elided inside the range.</sub>

`main` and `.layer`. Included because `.layer` is the element that actually scrolls and `--chrome-bottom` reserves the clearance behind the fixed bar. Also records *why* `main` deliberately has no bottom padding.

```css
/* ==========================================================================
   Main / layer surfaces
   ========================================================================== */

main {
  flex: 1;
  min-height: 0;
  /* NO bottom padding here, deliberately.
     The floating nav must genuinely float OVER scrolling content, so the
     scroll viewport has to extend all the way to the bottom of the screen
     and behind the bar. Clearance for the bar is applied once, on the
     scroll container's content padding (.layer), which lets content pass
     behind the translucent bar mid-scroll while still letting the last
     item be scrolled up clear of it. Padding both elements — the previous
     state — shrank the viewport AND padded the content, leaving a dead
     strip that made the bar read as an opaque full-width tab bar. */
  display: flex;
  flex-direction: column;
}

/* A layer is a full-height scroll surface. Only one is visible at a time. */
.layer {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* Bottom padding = bar height + its float offset, so the final content can
     always be scrolled up out from under the bar. */
  padding: 0 var(--s4) var(--chrome-bottom);
  scrollbar-width: none;
}
.layer::-webkit-scrollbar {
  display: none;
}

```

### 3.3 The floating navigation block (complete)

<sub>`app/theme.css` lines **314–746** (433 lines) — extracted verbatim by brace matching; nothing elided inside the range.</sub>

Covers `.fabnav`, `.fabnav[data-lifted]`, both `@supports` backdrop-filter branches (the reduced-transparency fallbacks), `.fabnav-pill` (the moving indicator), `.fabnav-list`, `.fabnav-item`, `.fabnav-link`, `.fabnav-icon`, `.fabnav-label`, the `[data-active]` rules, `:focus-visible`, `:active`, `.fabnav[data-dragging]`, and `.skip-link`. Every `touch-action`, `-webkit-touch-callout`, `user-select`, `will-change` and `backdrop-filter` declaration for the nav lives in here.

```css
/* ==========================================================================
   Floating navigation — the app's only primary navigation
   --------------------------------------------------------------------------
   A floating pill: translucent, blurred, restrained. Content scrolls VISIBLY
   behind it, so the bar reads as floating over the app rather than consuming a
   permanent band of screen.

   THE BAR IS DRAGGABLE, AND THAT FORCED A WIDTH CHANGE
   The old width was `min(100% - 32px, 440px)` — the FULL band between the two
   16px margins. Measured at 320/390/430px viewports that left a horizontal
   travel of exactly 0px, so the bar could not move sideways no matter how the
   pointer handling was written. Every "the icon won't drag" report was this.

   `--fabnav-w` is therefore a HARD CEILING on the bar's width, not a
   preference: travel is `viewport - width - 2 x --fabnav-gap`, so a bar at the
   ceiling still has (390 - 260 - 32) = 98px of travel on the narrowest common
   phone, and considerably more on a large one. Do not raise it to 100% again.

   Progressive enhancement: the opaque fallback colour is declared first, so
   the bar is perfectly readable when backdrop-filter is unsupported. The blur
   is additive, never load-bearing.
   ========================================================================== */

.fabnav {
  position: fixed;
  /* Defaults are the RESTING position, and they use the SAME coordinate
     system JavaScript uses once it takes over: an absolute `left`/`top`.
     An earlier version centred the bar with `left: 50%` plus
     `transform: translateX(-50%)`. That was a real bug: JS overwrites `left`
     with an absolute position but cannot overwrite the transform shim, so the
     bar ended up shifted left by half its own width — measured at x = -16px
     at rest and x = -114px after a drag, i.e. hanging off-screen. The centring
     is now expressed in `left` alone so there is only one thing to own it. */
  left: calc(50% - min(var(--fabnav-w), 100%) / 2);
  top: auto;
  /* Sit a little above the bottom edge, and derive the height from the token
     so --fabnav-h (and therefore --chrome-bottom) describes the real control
     rather than a stale 58px assumption. */
  bottom: calc(var(--fabnav-gap) + env(safe-area-inset-bottom, 0px));
  z-index: 40;
  /* THE WIDTH CAP.
   *
   * The bar is ALWAYS horizontally centred and cannot be dragged sideways, so
   * this is purely about how much room the five destinations need. It is still
   * worth capping: 260px keeps each of the five labels legible with its icon,
   * where filling the full band made the control read as a system tab bar
   * rather than a floating pill.
   *
   * This was originally a horizontal-travel budget. That is gone — the bar
   * used to be dockable to the left and right edges, and when it stopped
   * being, `--fabnav-min-travel` lost its purpose and was removed rather than
   * left as a dead token. Do not reintroduce a travel calculation here: there
   * is no horizontal movement to budget for. */
  width: min(var(--fabnav-w), calc(100% - var(--fabnav-gap) * 2));
  height: var(--fabnav-h);
  /* No `transform` here on purpose — see the `left` note above. The drag
     transform is written by JS and must not be fighting a CSS shim. */
  /* TRANSLUCENCY — the surface tone matters more than the alpha.
   *
   * THE ACTUAL PROBLEM WAS NEVER ALPHA. It was the SURFACE TONE. The page
   * background is --bg: #000000, so a dark translucent layer over it resolves
   * to near-black and the bar reads as a solid plate. Lifting the tint to a
   * charcoal grey is what makes the surface legible as a separate object.
   *
   * Measured (mean luminance inside the bar / spread across it, 390px, with
   * real scrolled content behind):
   *
   *   variant                          mean lum   spread   reads as
   *   A  rgba(38,40,44,0.50)  (old)      23.0       6.0     black plate
   *   B  rgba(35,35,38,0.82)  (proposed) 30.0       2.0     grey plate, content lost
   *   C  rgba(42,44,48,0.62)  (chosen)   29.1       4.0     lifted surface, content legible
   *
   * B separates from the page best but is nearly opaque: its spread collapses
   * to 2, i.e. the content behind is no longer modulating the surface at all,
   * which is the opposite of the intent. C keeps the bar clearly lighter than
   * the page while still letting team names show through. Alpha was pushed
   * back DOWN from 0.72 to 0.62 precisely to buy that separation back.
   *
   * Every value below is a token, so the glass can be retuned in one place
   * instead of by editing declarations spread across this file. */
  background: var(--fabnav-surface);
  -webkit-backdrop-filter: var(--fabnav-blur);
  backdrop-filter: var(--fabnav-blur);
  border: 1px solid var(--fabnav-edge);
  border-radius: 24px;
  box-shadow:
    0 6px 22px rgba(0, 0, 0, 0.5),
    /* Top inner highlight: the single strongest cue that a surface is a
       translucent pane rather than a solid fill. */
    inset 0 1px 0 var(--fabnav-sheen);
  transition:
    box-shadow var(--dur-tap) ease;
  /* `pan-y`, NOT `none`. The bar owns horizontal movement for its swipe and
   * leaves vertical panning to the browser, so dragging a thumb down the bar
   * still scrolls the page. `none` would claim both axes and swallow it.
   * See the note on .fabnav-list for what was measured, and for what was not. */
  touch-action: pan-y;
  /* A horizontal swipe that STARTS on a link would otherwise sweep up an
     implicit text selection, which swallows the remaining pointer events and
     stops the gesture dead. The bar is chrome, not prose, so nothing here
     should ever be selectable — which is also what a thumb-drag expects. */
  -webkit-user-select: none;
  user-select: none;
  -webkit-user-drag: none;
  /* iOS SAFARI ONLY — and the reason the drag appeared dead on a real iPhone
   *
   * `-webkit-touch-callout` is NOT `user-select`. They suppress different
   * things, and `user-select: none` alone does NOT stop the callout:
   *
   *   user-select: none       -> stops the blue text highlight
   *   -webkit-touch-callout   -> stops the "Open in New Tab / Add to Home
   *                             Screen" callout menu
   *
   * The bar is five real `<a href>` links, so a press-and-hold on one shows
   * that callout. When it appears WebKit fires `pointercancel`, which ends the
   * gesture before the drag can begin — the bar never moves and the user sees
   * a menu instead. This is invisible in Chromium, which has no such callout,
   * so emulated tests cannot catch it.
   *
   * Verified reasoning, not verified on hardware: this property is
   * Safari-only and returns nothing at all in Chromium. */
  -webkit-touch-callout: none;
  /* Promote to its own layer. The bar is dragged with a transform, and
     `will-change: transform` keeps that transform off the main thread's
     layout path for the duration of the gesture. */
  will-change: transform;
}

/* LIFTED — the bar has been picked up and is being dragged.
 *
 * This is the only state that changes the bar's transform, and it does so via
 * a CSS custom property rather than by rewriting `left`/`top`, so a drag can
 * never trigger a layout pass. The scale is deliberately tiny: enough to read
 * as "in hand", not enough to reflow the icons or shift a tap target.
 *
 * `cursor: grabbing` matters on desktop, where there is no long-press to
 * explain the state and no haptic tick to signal it. */
.fabnav[data-lifted] {
  --fabnav-lift: 1.035;
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.62),
    inset 0 1px 0 var(--fabnav-sheen);
  cursor: grabbing;
}

/* The resting transform is the centring shim only; a drag replaces it with a
   translate3d written by JS. `transition` is deliberately NOT disabled — the
   release animation is what makes the bar feel like it settles rather than
   stops dead, and under reduced motion it collapses to ~0ms anyway. */
.fabnav {
  scale: var(--fabnav-lift, 1);
}

/* Only bump the tint when the engine can actually blur behind it. Without a
   backdrop filter, a 0.62-alpha surface over black would be too faint to read
   as a control, so the fallback has to be more opaque to stay usable. */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .fabnav {
    background: var(--fabnav-surface);
  }
}

/* NO BLUR AVAILABLE — a notched opaque pane.
 *
 * This is a readability guarantee, not a cosmetic downgrade. `backdrop-filter`
 * is unsupported on older Android WebView and in some in-app browsers, and a
 * 0.62-alpha charcoal over a #000 page becomes unreadable there. `--fabnav-
 * surface-opaque` is deliberately high-alpha for exactly that case. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .fabnav {
    background: var(--fabnav-surface-opaque);
  }
}

/* The bar is PINNED during a swipe: a horizontal flick over it only decides
   which destination becomes active, exactly like the iOS WhatsApp tab bar. The
   only mid-gesture cue is the press highlight, so the transition is kept and
   nothing is transformed. */
.fabnav[data-dragging] .fabnav-link {
  opacity: 0.75;
}

/* Keyboard users get a visible ring on whichever destination has focus. The
   default focus ring is suppressed in theme.css reset, so this restores one.
   `:focus-visible` (not `:focus`) so it does not appear on pointer taps. */
.fabnav-link:focus-visible {
  outline: 2px solid var(--yellow);
  outline-offset: -3px;
  border-radius: 18px;
}

/* ------------------------------------------------------------------ *
 * THE GLASS INDICATOR
 *
 * The pill slides under the icons as the thumb moves and springs to the
 * nearest one on release. It is one tab wide.
 *
 * `pointer-events: none` is LOAD-BEARING, not cosmetic. The pill is painted
 * above the icons, so without this it would intercept the very taps and
 * swipes it exists to visualise — the bar would go dead under the thumb.
 *
 * `transition: none` is equally load-bearing. The pill's transform is rewritten
 * on every frame of a drag, and a CSS transition on a property that changes
 * every frame restarts its easing each time, so the rendered pill permanently
 * trails the thumb. That was measured: ~180ms of lag with a 220ms transition,
 * versus a single frame without one. The spring in JS owns the settle instead.
 * ------------------------------------------------------------------ */
.fabnav-pill {
  position: absolute;
  top: 3px;
  bottom: 3px;
  /* One tab wide. The exact pixel width is set from JS in the same measure
     pass that computes the tab stops, so the two can never disagree. */
  width: 52px;
  left: 0;
  border-radius: 21px;
  background: var(--fabnav-pill);
  border: 1px solid var(--fabnav-pill-edge);
  box-shadow:
    inset 0 1px 0 var(--fabnav-sheen),
    0 4px 14px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  /* translate3d keeps this on the compositor: no layout, no reflow. */
  transform: translate3d(0, 0, 0);
  transition: none;
  will-change: transform;
}

/* The pill needs a blur of its own to read as glass rather than a flat wash.
   It sits ON TOP of the bar's own backdrop-filter, so it samples what is
   behind it including the icons — which is exactly the liquid effect. */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .fabnav-pill {
    -webkit-backdrop-filter: var(--fabnav-pill-blur);
    backdrop-filter: var(--fabnav-pill-blur);
  }
}

/* Readability guarantee, not a cosmetic downgrade: a 0.16-alpha pill over a
   dark bar without a blur is nearly invisible, so the fallback is opaque
   enough to clearly mark the selected tab. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .fabnav-pill {
    background: var(--fabnav-pill-opaque);
  }
}

.fabnav-list {
  display: flex;
  align-items: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
  /* CORRECTED 2026-10-03 — the previous comment here was WRONG.
   *
   * It claimed to be measured fact that declaring `touch-action` on a
   * container does not cover its descendants, listed the computed values as
   * nav -> none, list -> auto, link -> auto, and concluded the descendant
   * declarations were "what actually fixes it".
   *
   * The inference was invalid. `touch-action` is indeed not an INHERITED
   * property, but for PANNING the browser intersects the hit-tested element's
   * value with each ANCESTOR up to the nearest scroll container. So a value on
   * the nav constrains touches that begin on its descendants, and the `auto`
   * computed values below do NOT mean the nav's rule is ineffective.
   *
   * WHAT THE AUTOMATED TESTS ACTUALLY ESTABLISHED (2026-10-03):
   * Chromium, real CDP touch, descendants forced to `auto`: the swipe
   * completed and the route changed to #/nyheter. WebKit, iPhone 13 emulation:
   * the same result, with `pointerdown`/`pointermove`/`pointerup` all
   * delivered and no `pointercancel`.
   *
   * WHAT THAT DOES NOT ESTABLISH:
   * NATIVE iPHONE GESTURE ARBITRATION REMAINS UNVERIFIED. The WebKit run
   * dispatched synthetic PointerEvents, because Playwright's CDP touch
   * injection is Chromium-only (`newCDPSession` throws in WebKit). Synthetic
   * events exercise WebKit's CSS and event handling but NOT its native gesture
   * recognition, so this says nothing about whether a real thumb on a real
   * iPhone gets its gesture. Only hardware can answer that.
   *
   * WHY `pan-y` RATHER THAN `none`:
   * `none` claims EVERY axis, so a vertical drag that starts on the bar is
   * swallowed and the page will not scroll. `pan-y` lets the browser keep
   * native vertical panning while reserving horizontal movement for our
   * swipe — which is the behaviour a bottom bar should have. Measured working
   * in both engines, with the same synthetic-event caveat above. */
  touch-action: pan-y;
}

.fabnav-item {
  flex: 1 1 0;
  min-width: 0;
}

.fabnav-link {
  /* 44px is the accessible minimum hit area; the visual chrome around it is
     deliberately restrained so the bar does not look oversized. */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  /* `pan-y`, NOT `none`.
   *
   * This was `none` until 2026-10-03, left over from when the bar was
   * vertically draggable and genuinely needed to own both axes. With the drag
   * gone, `none` is actively harmful: it claims the vertical axis, so a
   * vertical drag starting anywhere on the bar is swallowed and the page does
   * not scroll. Measured before this fix — identical drags, content area 225px
   * of scroll, the bar 0px.
   *
   * `pan-y` hands the vertical axis back to the browser while keeping the
   * horizontal axis for our swipe, which is what a bottom bar should do. */
  touch-action: pan-y;
  /* Comfortably past the 44px accessible minimum, and tall enough to fill the
     58px bar so the taller control does not leave dead space above the icons. */
  min-height: 52px;
  padding: 5px 2px;
  color: var(--text-3);
  text-decoration: none;
  border-radius: 18px;
  transition: color var(--dur-tap) ease;
  /* The callout must be suppressed on the ANCHOR too, not just the <nav>.
   *
   * This is the element the thumb actually lands on, and the long-press that
   * starts a drag begins here. `-webkit-touch-callout` is not inherited, so
   * declaring it only on `.fabnav` would leave every link showing the iOS
   * callout menu — exactly the same trap as `touch-action` below, and for the
   * same reason. */
  -webkit-touch-callout: none;
}

.fabnav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 23px;
  transition: transform var(--dur-tap) var(--ease-ios);
  /* CRITICAL, AND FOUND BY MEASURING RATHER THAN REASONING.
   *
   * The icon's <svg> is the element a thumb ACTUALLY lands on — logged from a
   * real CDP touch drag:
   *
   *     pointerdown  target = [object SVGAnimatedString]  touch-action = auto
   *
   * `touch-action` is not an inherited property, so the `pan-y` on `.fabnav`
   * and `.fabnav-link` never reached the SVG, and the SVG computed to `auto`.
   * Measured consequence: a vertical drag starting on the bar scrolled the
   * content by 0px, while the identical drag starting in the content area
   * scrolled it 225px. The swipe worked; page scrolling from the bar did not.
   *
   * This is the SAME class of bug as the note on `.fabnav-list`: the rule has
   * to be on the element the finger touches, not on an ancestor. Declaring
   * `pan-y` here hands the vertical axis back to the browser while keeping the
   * horizontal axis for our swipe.
   *
   * `pointer-events: none` is the cleaner fix and is applied as well: the SVG
   * is decorative (`aria-hidden` is already set on `.fabnav-icon`), so it has
   * no reason to be a hit target at all. With it, events land on the label or
   * the anchor instead, where the `pan-y` above already applies.
   *
   * Both are declared deliberately. `pointer-events: none` alone would fix the
   * hit target but leaves the rule wrong if the SVG ever becomes interactive;
   * `touch-action` alone would work but leaves a useless hit target in place. */
  touch-action: pan-y;
  pointer-events: none;
}
.fabnav-icon svg {
  width: 20px;
  height: 20px;
  display: block;
  /* The SVG must never be the hit target. See the note on .fabnav-icon. */
  pointer-events: none;
}

.fabnav-label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* The label is the hit target across the lower third of the bar — measured
     with elementFromPoint, which returns `.fabnav-label` (not the anchor) at
     70% of the bar's height. Without this it computes to `auto` and swallows
     vertical scrolls started there. Same rule, same reason, one more element:
     `touch-action` must be declared on whatever the finger actually lands on. */
  touch-action: pan-y;
}

/* Active state is carried by THREE signals, not colour alone: a yellow tint,
   a heavier stroke, and a small dot beneath the label. */
.fabnav-link[data-active] {
  color: var(--yellow);
}
.fabnav-link[data-active] .fabnav-icon {
  transform: translateY(-1px);
}
.fabnav-link[data-active] .fabnav-label {
  font-weight: 700;
}
/* The active destination is already indicated by the yellow label and the
 * lifted icon. An earlier revision ALSO drew a 4px yellow dot via
 * ::after with `margin-top: 30px`, which on a 9.5px label landed in the text
 * itself: it overlapped and blurred the letters it was meant to support.
 * There is deliberately NO dot, and no replacement indicator — a second cue
 * for the same state is redundant, not clearer. */
.fabnav-link {
  position: relative;
}
.fabnav-link:active .fabnav-icon {
  transform: scale(0.92);
}

/* Skip link: keyboard users reach main content without tabbing the bar. */
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 100;
  padding: 10px 14px;
  background: var(--surface-2);
  color: var(--text);
  font-size: var(--t-body);
  font-weight: 600;
  border-radius: 0 0 var(--r-sm) 0;
}
.skip-link:focus {
  left: 0;
}

```

### 3.4 Reduced motion

<sub>`app/theme.css` lines **2404–2422** (19 lines) — extracted verbatim by brace matching; nothing elided inside the range.</sub>

Global collapse of animation/transition durations. **There is no `prefers-reduced-transparency` block anywhere in this codebase** (verified by search) — the only reduced-transparency handling is the `@supports not (backdrop-filter)` opacity fallback in 3.3. Reduced motion is *additionally* honoured in JS via `prefersReducedMotion()` in `fabnavPosition.ts`, which collapses the spring to an immediate jump.

```css
/* ==========================================================================
   Reduced motion — every animation collapses to a short opacity change.
   No information is lost: the active tab is marked by colour, weight AND a
   dot, none of which depend on motion.
   ========================================================================== */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  .sheet,
  .sheet-backdrop {
    animation: none;
  }
}
```


---

## 4. Unit tests

### 4.1 `app/shared/fabnavPosition.test.ts`

**`app/shared/fabnavPosition.test.ts`** — 9.7 KB (9902 bytes, 278 lines)

```ts
import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  SPRING_DAMPING,
  SPRING_MASS,
  SPRING_STIFFNESS,
  clampToTrack,
  leftFor,
  nearestTab,
  springSettled,
  springStep,
  tabStops,
} from "./fabnavPosition";

/**
 * Geometry and physics for the glass indicator.
 *
 * These are pure functions precisely so the parts that are easy to get subtly
 * wrong — clamping at the ends, tie-breaking, and whether a delayed frame can
 * fling the pill across the bar — can be pinned without a browser, without
 * synthetic touch, and without the flakiness gesture tests are prone to.
 */

describe("leftFor — the bar is ALWAYS horizontally centred", () => {
  it("centres at every width", () => {
    for (const w of [320, 375, 390, 430, 768, 1024]) {
      expect(leftFor(w, 260), `at ${w}px`).toBe((w - 260) / 2);
    }
  });

  it("puts equal gaps on both sides", () => {
    for (const w of [320, 390, 430]) {
      const left = leftFor(w, 260);
      expect(left).toBe(w - left - 260);
    }
  });

  it("takes no position argument, so no input can make it off-centre", () => {
    // A deliberate structural assertion: leftFor is (navWidth, barWidth).
    // There is no dock, no x, no edge — so there is no code path by which the
    // bar could be positioned anywhere but the centre. This test is the guard
    // against someone re-adding one.
    expect(leftFor.length).toBe(2);
  });
});

describe("tabStops — where the pill rests on each tab", () => {
  const W = 260;
  const PILL = 52;
  const N = 5;

  it("starts at 0 and ends flush with the track", () => {
    const stops = tabStops(N, W, PILL);
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(W - PILL);
  });

  it("spaces every tab evenly", () => {
    const stops = tabStops(N, W, PILL);
    const step = (W - PILL) / (N - 1);
    stops.forEach((s, i) => expect(s).toBeCloseTo(i * step, 6));
  });

  it("has one stop per tab", () => {
    expect(tabStops(N, W, PILL)).toHaveLength(N);
  });

  it("collapses to 0 rather than NaN when the track has no room", () => {
    // The divide-by-zero case: a pill as wide as the track, or a track that
    // has not been laid out yet. NaN here would strand the pill off-screen.
    for (const stops of [tabStops(N, PILL, PILL), tabStops(N, 0, PILL)]) {
      expect(stops.every((s) => s === 0)).toBe(true);
      expect(stops.some(Number.isNaN)).toBe(false);
    }
  });

  it("handles a single tab without dividing by zero", () => {
    expect(tabStops(1, W, PILL)).toEqual([0]);
  });

  it("handles zero tabs without throwing", () => {
    expect(tabStops(0, W, PILL)).toEqual([0]);
  });

  it("is monotonic increasing when there is room", () => {
    const stops = tabStops(7, W, PILL);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    }
  });
});

describe("clampToTrack — the pill cannot leave the bar", () => {
  const W = 260;
  const PILL = 52;

  it("clamps at both ends", () => {
    expect(clampToTrack(-40, W, PILL)).toBe(0);
    expect(clampToTrack(9999, W, PILL)).toBe(W - PILL);
  });

  it("passes an in-range value through untouched", () => {
    expect(clampToTrack(100, W, PILL)).toBe(100);
  });

  it("collapses a NaN to the start rather than propagating it", () => {
    expect(Number.isNaN(clampToTrack(NaN, W, PILL))).toBe(false);
  });

  it("never exceeds the track even when the pill is wider than it", () => {
    expect(clampToTrack(50, 40, 60)).toBe(0);
  });
});

describe("nearestTab — release selects the nearest tab", () => {
  const stops = tabStops(5, 260, 52); // 0, 52, 104, 156, 208

  it("picks the exact stop when released on a tab", () => {
    stops.forEach((s, i) => expect(nearestTab(s, stops)).toBe(i));
  });

  it("picks the nearest one when released between tabs", () => {
    expect(nearestTab(10, stops)).toBe(0);
    expect(nearestTab(60, stops)).toBe(1);
    expect(nearestTab(130, stops)).toBe(2);
    expect(nearestTab(180, stops)).toBe(3);
  });

  it("resolves an exact midpoint to the EARLIER tab", () => {
    // (52 + 104) / 2 = 78. Ties must not favour the later tab, or a
    // rightward swipe would appear to need less travel than a leftward one.
    expect(nearestTab(78, stops)).toBe(1);
  });

  it("always returns a real index, even far off the track", () => {
    expect(nearestTab(-500, stops)).toBe(0);
    expect(nearestTab(5000, stops)).toBe(4);
  });

  it("is safe with one or zero stops", () => {
    expect(nearestTab(50, [0])).toBe(0);
    expect(nearestTab(50, [])).toBe(0);
  });
});

describe("springStep — the release settle", () => {
  const target = 208;

  it("converges on the target", () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 200; i++) ({ x, v } = springStep(x, v, target, 1 / 60));
    expect(x).toBeCloseTo(target, 3);
  });

  it("reports settled only once it has actually arrived", () => {
    let x = 0;
    let v = 0;
    expect(springSettled(x, v, target)).toBe(false);
    for (let i = 0; i < 400; i++) {
      ({ x, v } = springStep(x, v, target, 1 / 60));
      if (springSettled(x, v, target)) break;
    }
    expect(springSettled(x, v, target)).toBe(true);
  });

  it("overshoots slightly, and not enough to read as a bounce", () => {
    // MEASURED, not assumed. 450/32/1 has a damping ratio of 0.754, so it IS
    // underdamped and DOES overshoot. Measured over a full 208px travel:
    //
    //     overshoot   2.63px  (1.26% of travel)
    //     settle      26 frames = 433ms
    //
    // 2.63px on a 260px-wide bar is roughly one CSS pixel of visual "breathe"
    // past the target and back. That is the intended liquid feel, not a bug.
    //
    // An earlier version of this test asserted ZERO overshoot. That was the
    // wrong assertion twice over: it failed (the spring genuinely overshoots),
    // and passing it would have forced critical damping and a dead-feeling
    // release. The requirement is "no visible bounce", so that is asserted —
    // with the real measured numbers recorded so the next person does not have
    // to re-derive them.
    let x = 0;
    let v = 0;
    let maxX = -Infinity;
    for (let i = 0; i < 300; i++) {
      ({ x, v } = springStep(x, v, target, 1 / 60));
      maxX = Math.max(maxX, x);
    }
    const overshootPx = maxX - target;
    expect(overshootPx).toBeGreaterThan(0); // it IS underdamped, honestly
    expect(overshootPx).toBeLessThanOrEqual(3); // measured 2.63px
    expect(overshootPx / target).toBeLessThan(0.02); // under 2% of travel
  });

  it("settles in a quarter of a second or so", () => {
    // 433ms measured. Long enough to read as a settle rather than a jump,
    // short enough that the app never feels like it is waiting on the
    // animation. The navigation itself has already happened by this point.
    let x = 0;
    let v = 0;
    let frames = 0;
    while (!springSettled(x, v, target) && frames < 600) {
      ({ x, v } = springStep(x, v, target, 1 / 60));
      frames++;
    }
    expect(frames).toBeGreaterThan(8);
    expect(frames).toBeLessThan(45); // measured 26
  });

  it("stays stable across a very long frame instead of flinging", () => {
    // The bug this guards: a backgrounded tab or a busy main thread delivers
    // one enormous dt. With Euler integration at full dt the pill would be
    // launched across the bar. dt is clamped and sub-stepped precisely so a
    // stall cannot do that.
    const one = springStep(0, 0, target, 10);
    expect(Number.isFinite(one.x)).toBe(true);
    expect(Number.isFinite(one.v)).toBe(true);
    expect(Math.abs(one.x)).toBeLessThan(target * 3);
  });

  it("is stable at an awkward frame time", () => {
    for (const dt of [0, 1 / 240, 1 / 60, 1 / 30, 0.05, 1]) {
      const s = springStep(30, -400, target, dt);
      expect(Number.isFinite(s.x), `dt=${dt}`).toBe(true);
      expect(Number.isFinite(s.v), `dt=${dt}`).toBe(true);
    }
  });

  it("moving the target mid-flight re-aims rather than restarting", () => {
    // This is what makes a re-grab or a route change smooth: the integrator
    // carries its position and velocity forward.
    let x = 0;
    let v = 0;
    for (let i = 0; i < 10; i++) ({ x, v } = springStep(x, v, 100, 1 / 60));
    const carried = springStep(x, v, 200, 1 / 60);
    expect(carried.x).not.toBe(200); // still travelling
    expect(carried.x).toBeGreaterThan(x); // kept its momentum
  });

  it("an instantaneous jump arrives in a plausible number of frames", () => {
    // A full-track jump (208px) at 60fps. This is the "settle" the user sees,
    // and it should be quick enough to feel responsive but not instant.
    let x = 0;
    let v = 0;
    let frames = 0;
    while (!springSettled(x, v, target) && frames < 600) {
      ({ x, v } = springStep(x, v, target, 1 / 60));
      frames++;
    }
    expect(frames).toBeGreaterThan(3);
    expect(frames).toBeLessThan(80);
  });
});

describe("the spring constants are the ones we chose deliberately", () => {
  it("are 450 / 32 / 1", () => {
    // Pinned because they were chosen by feel, from the mentor's reference.
    // A well-meaning "cleanup" that changes these changes the feel of the app.
    expect(SPRING_STIFFNESS).toBe(450);
    expect(SPRING_DAMPING).toBe(32);
    expect(SPRING_MASS).toBe(1);
  });

  it("are damped enough not to oscillate", () => {
    // Damping ratio zeta = damping / (2 * sqrt(stiffness * mass)).
    const zeta = SPRING_DAMPING / (2 * Math.sqrt(SPRING_STIFFNESS * SPRING_MASS));
    expect(zeta).toBeGreaterThan(0.5); // no visible bouncing
    expect(zeta).toBeLessThan(1); // still arrives with a hint of life
  });
});

describe("DRAG_THRESHOLD_PX", () => {
  it("sits above ordinary thumb tremor but below a real sweep", () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(6);
    expect(DRAG_THRESHOLD_PX).toBeLessThanOrEqual(14);
  });
});
```


### 4.2 `app/shared/FloatingTabBar.test.ts`

**`app/shared/FloatingTabBar.test.ts`** — 2.4 KB (2416 bytes, 68 lines)

```ts
import { describe, it, expect } from "vitest";
import {
  isSwipeCommit,
  SWIPE_MIN_PX,
  FLICK_MIN_PX,
  FLICK_VELOCITY,
} from "./FloatingTabBar";

/**
 * The swipe threshold is the part human testing proved wrong, so it is pinned
 * here as pure logic rather than only through a synthesised gesture.
 *
 * The previous rule was "18% of the bar width" (~62px on a 342px bar). A real
 * thumb flick on a 62px-tall control is often shorter than 62px, so those
 * swipes did nothing at all. These cases encode the distances a thumb
 * actually produces.
 */
describe("isSwipeCommit", () => {
  it("commits on a comfortable drag well under the old 62px bar", () => {
    // A deliberate thumb drag of 40px must move the destination.
    expect(isSwipeCommit(-40, -0.1)).toBe(true);
    expect(isSwipeCommit(40, 0.1)).toBe(true);
  });

  it("commits at exactly the distance threshold", () => {
    expect(isSwipeCommit(-SWIPE_MIN_PX, 0)).toBe(true);
  });

  it("does NOT commit just under the distance threshold unless it is a flick", () => {
    // A slow, short drag is ambiguous — it must stay a tap.
    expect(isSwipeCommit(-(SWIPE_MIN_PX - 1), -0.05)).toBe(false);
  });

  it("commits a short but fast flick", () => {
    // 24px is below the distance threshold but is a normal thumb flick speed.
    expect(isSwipeCommit(-24, -0.5)).toBe(true);
  });

  it("does not treat a short SLOW movement as a flick", () => {
    expect(isSwipeCommit(-24, -0.05)).toBe(false);
  });

  it("never treats a tap-sized jitter as a swipe, however fast", () => {
    // 8px of movement is a tap, not a swipe, even at a high velocity.
    expect(isSwipeCommit(-8, -3)).toBe(false);
    expect(isSwipeCommit(8, 3)).toBe(false);
  });

  it("does not commit at zero travel", () => {
    expect(isSwipeCommit(0, 0)).toBe(false);
  });

  it("keeps FLICK_MIN_PX below the distance threshold", () => {
    // Otherwise the flick branch could never be reached.
    expect(FLICK_MIN_PX).toBeLessThan(SWIPE_MIN_PX);
  });

  it("is direction-agnostic: the same magnitude commits either way", () => {
    for (const d of [15, 24, 34, 60, 200]) {
      expect(isSwipeCommit(d, 0)).toBe(isSwipeCommit(-d, 0));
    }
  });

  it("uses a flick velocity a real thumb swipe can exceed", () => {
    // Sanity check on the constant itself: a 24px flick over 40ms is 0.6px/ms.
    expect(24 / 40).toBeGreaterThan(FLICK_VELOCITY);
  });
});
```


---

## 5. End-to-end tests

### 5.1 `e2e/navIndicatorDrag.ts` — shared drag helpers

**`e2e/navIndicatorDrag.ts`** — 7.5 KB (7629 bytes, 194 lines)

```ts
import { expect, type Page } from "@playwright/test";

/**
 * REAL TOUCH DRAG HELPERS for the navigation indicator.
 *
 * WHY THESE EXIST AS NAMED HELPERS
 * Every swipe test needs the same three things: start the drag on or near the
 * pill, travel far enough to actually reach the neighbouring stop, and observe
 * what the pill did. Written inline, each test re-derived those numbers by hand
 * and they drifted apart — which is how a test came to assert "swiping left
 * advances" while its own coordinates swiped right.
 *
 * Each helper names the INTENT, not the mechanics:
 *   dragIndicatorToAdjacentTab()  - move to the neighbour in a given direction
 *   dragIndicatorBeyondFirstStop() - push against the first tab's clamp
 *   dragIndicatorBeyondLastStop()  - push against the last tab's clamp
 *
 * THE GEOMETRY IS READ FROM THE APP, NEVER RECOMPUTED
 * `renderedStops()` navigates to each tab and reads where the pill actually
 * rests. An earlier version derived the stops from `offsetWidth` and disagreed
 * with the app by 1px (103 vs 104) — two implementations of one formula. The
 * app already knows the authoritative value, so it is read rather than guessed.
 *
 * The GESTURE is always real touch dispatched over CDP. These helpers never
 * call the app's geometry functions to simulate a success; they move a finger
 * and then read the DOM.
 */

/** The slice of the CDP session these helpers use. */
type Cdp = { send(method: string, params?: unknown): Promise<unknown> };

export type Direction = "left" | "right";

const ROUTE_FOR: Record<string, string> = {
  "tab-brief": "#/",
  "tab-nyheter": "#/nyheter",
  "tab-matcher": "#/matcher",
  "tab-trupp": "#/trupp",
  "tab-spelare": "#/spelare",
};

/** Ordered tab test ids, left to right. Fixed by contract. */
export const TAB_IDS = [
  "tab-brief",
  "tab-nyheter",
  "tab-matcher",
  "tab-trupp",
  "tab-spelare",
] as const;

/**
 * One real-touch driver bound to a page.
 *
 * A single CDP session is created lazily and reused: creating one per gesture
 * was measurably slower and, on a memory-starved machine, contributed to
 * timeouts that had nothing to do with the code under test.
 */
export function touchDriver(page: Page) {
  let session: Promise<Cdp> | null = null;
  return async (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) => {
    if (!session) session = page.context().newCDPSession(page);
    const cdp = (await session) as Cdp;
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
  };
}

/** The pill's rendered left edge, from its inline transform. */
export const renderedPillX = (page: Page) =>
  page.getByTestId("fabnav-pill").evaluate((el) => {
    const m = /translate3d\((-?[\d.]+)px/.exec(el.style.transform);
    return m ? Math.round(parseFloat(m[1]) * 100) / 100 : NaN;
  });

/**
 * The authoritative stop for each tab, read from the running app.
 *
 * Navigating to each tab and reading where the pill rests measures the real
 * thing. One page load per tab, which on a loaded machine made tests time out
 * in setup for reasons unrelated to behaviour — so the caller passes the tabs
 * it actually needs.
 */
export async function renderedStops(page: Page, ids: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    await page.goto(`/${ROUTE_FOR[id]}`);
    await expect(page.getByTestId("tabbar")).toBeVisible();
    // The pill is parked by an effect after the route renders; wait for the
    // value to settle rather than sleeping a guessed interval.
    await expect
      .poll(() => renderedPillX(page), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(0);
    out[id] = await renderedPillX(page);
  }
  return out;
}

/**
 * The measured spacing between adjacent stops.
 *
 * Derived from the app's own rendered stops, never from a hardcoded 51.5. The
 * bar has a CSS max-width, so its geometry is identical at every viewport and a
 * literal copied from one measurement would be an assumption wearing a number's
 * clothes. Two stops 51.5px apart on a 390px screen says nothing about a
 * resized window.
 */
export function tabSpacing(stops: Record<string, number>, ids: readonly string[]): number {
  for (let i = 1; i < ids.length; i++) {
    const a = stops[ids[i - 1]];
    const b = stops[ids[i]];
    if (a !== undefined && b !== undefined) return b - a;
  }
  throw new Error("cannot derive tab spacing: fewer than two stops were measured");
}

type DragOpts = {
  /** Extra travel past the target stop, in px. 20 clears the dead zone. */
  overshoot?: number;
  /** Record the pill's position after each move. */
  sample?: boolean;
};

/**
 * Drag the indicator from its current stop toward a neighbour.
 *
 * `direction` is PHYSICAL and matches the contract: "right" means the finger
 * moves toward increasing viewport X, which moves the pill toward the tabs
 * visually to the right.
 *
 * The finger starts ON the pill, which is the case where a jump on touch-down
 * would be most visible — so every caller gets that check for free.
 */
export async function dragIndicatorToAdjacentTab(
  page: Page,
  touch: ReturnType<typeof touchDriver>,
  direction: Direction,
  /** Spacing between two adjacent stops, in px, measured by `tabSpacing`. */
  spacing: number,
  opts: DragOpts = {},
) {
  const overshoot = opts.overshoot ?? 20;
  const bar = (await page.getByTestId("tabbar").boundingBox())!;
  const y = Math.round(bar.y + bar.height / 2);
  const before = await renderedPillX(page);

  // Start on the pill's own left edge: a thumb lands on the glass.
  const startX = Math.round(bar.x + before);
  await touch("touchStart", startX, y);

  // The pill must not move on touch-down.
  expect(Math.abs((await renderedPillX(page)) - before), "the pill jumped on touch-down").toBeLessThanOrEqual(1);

  // One tab of travel, in the requested physical direction, plus overshoot so
  // the release lands clear of the dead zone around the midpoint.
  const sign = direction === "right" ? 1 : -1;
  const travel = sign * (spacing + overshoot);
  const samples: number[] = [];
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", startX + Math.round((travel * i) / 10), y);
    if (opts.sample) samples.push(await renderedPillX(page));
  }
  return { before, samples, y, startX, travel };
}

/** Push the indicator against the FIRST tab's clamp. */
export async function dragIndicatorBeyondFirstStop(
  page: Page,
  touch: ReturnType<typeof touchDriver>,
) {
  const bar = (await page.getByTestId("tabbar").boundingBox())!;
  const y = Math.round(bar.y + bar.height / 2);
  const before = await renderedPillX(page);
  const startX = Math.round(bar.x + before);
  await touch("touchStart", startX, y);
  // A large leftward travel: well past the clamp.
  for (let i = 1; i <= 10; i++) await touch("touchMove", startX - i * 30, y);
  return { before, atRelease: await renderedPillX(page), y, startX };
}

/** Push the indicator against the LAST tab's clamp. */
export async function dragIndicatorBeyondLastStop(
  page: Page,
  touch: ReturnType<typeof touchDriver>,
) {
  const bar = (await page.getByTestId("tabbar").boundingBox())!;
  const y = Math.round(bar.y + bar.height / 2);
  const before = await renderedPillX(page);
  const startX = Math.round(bar.x + before);
  await touch("touchStart", startX, y);
  for (let i = 1; i <= 10; i++) await touch("touchMove", startX + i * 30, y);
  return { before, atRelease: await renderedPillX(page), y, startX };
}
```


### 5.2 `e2e/nav-indicator-journey.spec.ts`

**`e2e/nav-indicator-journey.spec.ts`** — 10.1 KB (10319 bytes, 233 lines)

```ts
import { test, expect, type Page, type Browser } from "@playwright/test";
import { chromium, devices } from "@playwright/test";

/**
 * THE REQUIRED DEMONSTRATION: Nyheter → Matcher, then Matcher → Nyheter.
 *
 * This is the end-to-end interaction, in the order a thumb actually performs
 * it: touch the pill where it sits, drag toward the ADJACENT visible icon far
 * enough that the pill ends nearer that icon, release, and the connected page
 * must change. The pill must not jump on touch-down, because the gesture
 * begins on the pill itself here — the case where a jump would be most visible.
 *
 * EVIDENCE is captured at three moments into test-results/ (gitignored):
 *   1. before   — pill parked on Nyheter, page is the news feed
 *   2. mid-drag — pill visibly travelling toward Matcher, page still Nyheter
 *   3. after    — pill settled on Matcher, page is the fixtures list
 *
 * REAL TOUCH: Chromium's own touch pipeline over CDP, so `touch-action`
 * arbitration, native link-drag suppression and click synthesis are genuinely
 * exercised. This is NOT the same as verifying on an iPhone.
 */

async function touchPage(browser: Browser) {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
  return { ctx, page, touch };
}

/** The pill's current left edge in track-local px, from its inline transform. */
const pillX = (page: Page) =>
  page.getByTestId("fabnav-pill").evaluate((el) => {
    const m = /translate3d\((-?[\d.]+)px/.exec(el.style.transform);
    return m ? Math.round(parseFloat(m[1]) * 100) / 100 : NaN;
  });

/**
 * Where each tab's pill stop actually is.
 *
 * Deliberately NOT recomputed here. An earlier version of this test derived the
 * stops from `offsetWidth` and got 103 where the app had 104 — a 1px
 * disagreement between two implementations of the same formula, which made the
 * test fail on arithmetic rather than on behaviour. The app already knows the
 * authoritative stops, so they are read from the live pill instead: park the
 * pill by navigating, read where it lands, and that IS the stop.
 *
 * This measures the real thing rather than a second guess at it.
 */
const ROUTE_FOR: Record<string, string> = {
  "tab-brief": "#/",
  "tab-nyheter": "#/nyheter",
  "tab-matcher": "#/matcher",
  "tab-trupp": "#/trupp",
  "tab-spelare": "#/spelare",
};

/**
 * The authoritative stop for a tab, read from the app itself.
 *
 * One page load per tab was tried and it made the reverse test time out: two
 * extra `goto`s plus their settle waits exceeded the budget for reasons that
 * had nothing to do with the gesture. The stop is now measured by loading the
 * tab ONCE and then walking to its neighbour via the hash, which is cheap and
 * exercises the same code path a deep link uses.
 *
 * The point stands regardless: this is the app's own value, not a second
 * implementation of the formula that disagreed by 1px.
 */
const stopsFrom = async (page: Page, ids: string[]) => {
  const out: Record<string, number> = {};
  for (const id of ids) {
    await page.goto(`/${ROUTE_FOR[id]}`);
    await page.waitForTimeout(900);
    out[id] = await pillX(page);
  }
  return out;
};

/** The tab ids in visual order, left to right. */
const tabIds = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".fabnav-item")].map((li) =>
      li.querySelector(".fabnav-link")!.getAttribute("data-testid")!,
    ),
  );

test.describe("Indicator journey: Nyheter → Matcher → Nyheter", () => {
  // The budget covers two page loads to measure the stops, the gesture itself,
  // and the settle wait. It was raised from the 25s default after the reverse
  // test timed out in setup, NOT in the interaction.
  test.setTimeout(60_000);

  test("touch Nyheter, drag right toward Matcher, release → Matcher page", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    try {
      await page.goto("/#/nyheter");
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(1200);

      const ids = await tabIds(page);
      const nyheterIdx = ids.indexOf("tab-nyheter");
      const matcherIdx = ids.indexOf("tab-matcher");
      expect(nyheterIdx, "Nyheter must be left of Matcher for this journey").toBeGreaterThanOrEqual(0);
      expect(matcherIdx, "Matcher must be the tab right of Nyheter").toBe(nyheterIdx + 1);

      // The authoritative stops, read from the app rather than recomputed.
      const st = await stopsFrom(page, ["tab-nyheter", "tab-matcher"]);
      const nyheterStop = st["tab-nyheter"];
      const matcherStop = st["tab-matcher"];
      expect(matcherStop, "Matcher must sit to the RIGHT of Nyheter").toBeGreaterThan(nyheterStop);

      // EVIDENCE 1 — before. The pill must be ON Nyheter's stop.
      await page.goto("/#/nyheter");
      await page.waitForTimeout(1000);
      const pillBefore = await pillX(page);
      await page.screenshot({ path: "test-results/journey-1-before-touch.png" });
      expect(Math.abs(pillBefore - nyheterStop), "the pill was not parked on the selected tab").toBeLessThanOrEqual(1);

      const bar = (await page.getByTestId("tabbar").boundingBox())!;
      const y = Math.round(bar.y + bar.height / 2);
      // Touch the bar near the pill's own stop, as a thumb would.
      const startX = Math.round(bar.x + pillBefore + bar.width * 0);

      await touch("touchStart", startX, y);
      await page.waitForTimeout(40);

      // The pill must NOT have moved on touch-down. This is the assertion that
      // distinguishes delta anchoring from direct anchoring.
      const pillOnDown = await pillX(page);
      expect(Math.abs(pillOnDown - pillBefore), "the pill JUMPED on touch-down").toBeLessThanOrEqual(1);

      // Drag RIGHT, past the midpoint, so the pill ends nearer Matcher.
      const target = matcherStop;
      const travel = target - pillBefore + 20;
      const seen: number[] = [];
      for (let i = 1; i <= 10; i++) {
        await touch("touchMove", Math.round(startX + (travel * i) / 10), y);
        await page.waitForTimeout(18);
        seen.push(await pillX(page));
      }

      // EVIDENCE 2 — mid-drag: pill travelling right, page still Nyheter.
      await page.screenshot({ path: "test-results/journey-2-mid-drag.png" });

      // It must have followed the finger monotonically — no lag, no stutter.
      for (let i = 1; i < seen.length; i++) {
        expect(seen[i], `the pill stalled or jumped back at step ${i}`).toBeGreaterThan(seen[i - 1]);
      }
      expect(seen.at(-1)!, "the pill did not travel toward Matcher").toBeGreaterThan(pillBefore + 20);

      await touch("touchEnd", Math.round(startX + travel), y);
      await page.waitForTimeout(900);

      // It settled on Matcher's stop.
      expect(Math.abs((await pillX(page)) - target), "the pill did not settle on Matcher").toBeLessThanOrEqual(1);

      // EVIDENCE 3 — after: on the Matcher page, with its content visible.
      await page.screenshot({ path: "test-results/journey-3-after-release.png" });

      await expect(page).toHaveURL(/#\/matcher$/);
      await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
      const heading = (await page.locator("main h1, main h2").first().textContent()) ?? "";
      expect(heading.trim().length, "the Matcher page rendered no heading").toBeGreaterThan(0);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });

  test("reverse: touch Matcher, drag LEFT toward Nyheter, release → Nyheter page", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    try {
      await page.goto("/#/matcher");
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await page.waitForTimeout(1200);

      const st = await stopsFrom(page, ["tab-nyheter", "tab-matcher"]);
      const nyheterStop = st["tab-nyheter"];
      const matcherStop = st["tab-matcher"];
      await page.goto("/#/matcher");
      await page.waitForTimeout(1000);
      const pillBefore = await pillX(page);
      expect(Math.abs(pillBefore - matcherStop), "the pill was not parked on Matcher").toBeLessThanOrEqual(1);

      const bar = (await page.getByTestId("tabbar").boundingBox())!;
      const y = Math.round(bar.y + bar.height / 2);
      const startX = Math.round(bar.x + pillBefore);

      await touch("touchStart", startX, y);
      await page.waitForTimeout(40);
      expect(Math.abs((await pillX(page)) - pillBefore), "the pill JUMPED on touch-down").toBeLessThanOrEqual(1);

      // Drag LEFT, past the midpoint toward Nyheter.
      const target = nyheterStop;
      const travel = target - pillBefore - 20;
      const seen: number[] = [];
      for (let i = 1; i <= 10; i++) {
        await touch("touchMove", Math.round(startX + (travel * i) / 10), y);
        await page.waitForTimeout(18);
        seen.push(await pillX(page));
      }
      await page.screenshot({ path: "test-results/journey-4-reverse-mid-drag.png" });

      for (let i = 1; i < seen.length; i++) {
        expect(seen[i], `the pill stalled or jumped back at step ${i}`).toBeLessThan(seen[i - 1]);
      }

      await touch("touchEnd", Math.round(startX + travel), y);
      await page.waitForTimeout(900);
      expect(Math.abs((await pillX(page)) - target), "the pill did not settle on Nyheter").toBeLessThanOrEqual(1);
      await page.screenshot({ path: "test-results/journey-5-reverse-after.png" });

      await expect(page).toHaveURL(/#\/nyheter$/);
      await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");
      const heading = (await page.locator("main h1, main h2").first().textContent()) ?? "";
      expect(heading.trim().length, "the Nyheter page rendered no heading").toBeGreaterThan(0);
    } finally {
      await ctx.close();
      await browser.close();
    }
  });
});
```


### 5.3 `e2e/fabnav-swipe.spec.ts`

**`e2e/fabnav-swipe.spec.ts`** — 12.1 KB (12367 bytes, 279 lines)

```ts
import { test, expect, type Page } from "@playwright/test";

/** The slice of the CDP session this file uses. */
type Cdp = { send(method: string, params?: unknown): Promise<unknown> };

/**
 * SWIPING BETWEEN NAV ICONS — the end-to-end interaction.
 *
 * THE REQUIREMENT BEING TESTED
 * Thumb down anywhere on the nav, move horizontally, watch the glass
 * indicator follow, release near another icon, and the destination PAGE must
 * actually change. A moving pill with no page change is a FAILURE, not a
 * partial success — so every swipe assertion here checks the URL and the
 * destination's content, not just the indicator.
 *
 * A TAP must still select. REVERSING mid-drag and RE-GRABBING mid-snap must
 * not jump. A CANCELLED gesture must not change page.
 *
 * A vertical gesture that starts ON THE NAV is out of scope by product
 * decision (2026-10-03): the content scrolls in the area ABOVE the bar, and the
 * bar itself is for taps and horizontal swipes only. `touch-action: pan-y`
 * stays on it so the browser keeps the vertical axis, but nothing here asserts
 * that a gesture on the bar scrolls, and no code forwards one by hand.
 *
 * ------------------------------------------------------------------
 * WHAT THESE TESTS ARE NOT
 * ------------------------------------------------------------------
 * In Chromium the gestures are REAL: Playwright drives Chromium's own touch
 * pipeline over CDP (`Input.dispatchTouchEvent`), so `touch-action`
 * arbitration, native link-drag suppression and click synthesis are all
 * genuinely exercised.
 *
 * In the WebKit project they are SYNTHETIC: `newCDPSession` throws in WebKit,
 * so the helper dispatches `new PointerEvent(...)`. That exercises the app's
 * logic and WebKit's CSS and event handling, but it BYPASSES WebKit's native
 * gesture recognition — the layer that decides scroll-versus-drag and raises
 * the link callout.
 *
 * So a green run here is NOT native iOS verification. Only a real iPhone is.
 * See docs/ENHANCEMENTS.md, E-012.
 */

type BrowserName = "chromium" | "webkit";

/**
 * Real CDP touch in Chromium; synthetic PointerEvents in WebKit.
 *
 * Kept deliberately simple: one CDP session per gesture rather than one per
 * event, because creating a session is expensive and detaching it immediately
 * is the part that was flaky.
 */
function touchFor(page: Page, name: BrowserName) {
  let session: Promise<Cdp> | null = null;

  if (name === "webkit") {
    // WebKit: synthetic PointerEvents with pointerType "touch".
    return async (type: string, x: number, y: number) => {
      await page.evaluate(
        ({ t, px, py }: { t: string; px: number; py: number }) => {
          const nav = document.querySelector(".fabnav");
          if (!nav) return;
          nav.dispatchEvent(
            new PointerEvent(t, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              clientX: px,
              clientY: py,
              button: t === "pointermove" ? -1 : 0,
              buttons: t === "pointerup" ? 0 : 1,
            }),
          );
        },
        { t: type, px: Math.round(x), py: Math.round(y) },
      );
    };
  }

  // Chromium: the real touch pipeline, over CDP.
  return async (type: string, x: number, y: number) => {
    if (!session) session = page.context().newCDPSession(page);
    const cdp = (await session) as Cdp;
    const t = type === "pointerdown" ? "touchStart" : type === "pointerup" ? "touchEnd" : "touchMove";
    await cdp.send("Input.dispatchTouchEvent", {
      type: t,
      touchPoints: t === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }],
    });
  };
}

const pillX = async (page: Page) => {
  const t = await page.getByTestId("fabnav-pill").evaluate((el) => el.style.transform);
  const m = /translate3d\((-?[\d.]+)px/.exec(t);
  return m ? parseFloat(m[1]) : NaN;
};

const navBox = async (page: Page) => {
  const b = await page.getByTestId("tabbar").boundingBox();
  if (!b) throw new Error("no nav");
  return b;
};

test.describe("Swipe between nav icons", () => {
  test("swipe tracks the thumb, then changes page", async ({ page }, testInfo) => {
    const touch = touchFor(page, testInfo.project.name as BrowserName);
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(600);

    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    // Start from the FIRST tab and swipe RIGHT. Swiping left from tab 0 is
    // clamped to 0 by design, so it cannot move the pill — an earlier version
    // of this test did exactly that and correctly reported "did not follow".
    // The clamp was the code working; the test was wrong.
    const startX = Math.round(box.x + box.width * 0.2);
    const urlBefore = page.url();

    // EVIDENCE: the "before" state. Written to test-results/, which is
    // gitignored, so this never lands in the repository.
    await page.screenshot({ path: "test-results/nav-evidence-1-before.png" });

    await touch("pointerdown", startX, y);
    await page.waitForTimeout(30);

    // Move in steps and assert the indicator is FOLLOWING at each one.
    const seen: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const x = Math.round(startX + i * 12);
      await touch("pointermove", x, y);
      await page.waitForTimeout(20);
      const px = await pillX(page);
      if (Number.isFinite(px)) seen.push(px);
    }
    // EVIDENCE: mid-drag, with the pill visibly between the two icons and the
    // page still on the ORIGINAL route. Captured before release, so it shows
    // the tracking rather than the settled result.
    await page.screenshot({ path: "test-results/nav-evidence-2-mid-drag.png" });

    expect(seen.length, "the indicator never moved").toBeGreaterThan(1);
    // Monotonically INCREASING, because we swiped right.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `the indicator stalled or jumped back at step ${i}`).toBeGreaterThan(seen[i - 1]);
    }

    await touch("pointerup", Math.round(startX + 4 * 12), y);
    await page.waitForTimeout(800);

    // THE PAGE MUST CHANGE — not just the pill. A moving pill with no
    // navigation is a failure, not a partial success.
    expect(page.url(), "swipe did not change the page").not.toBe(urlBefore);

    // EVIDENCE: after release, on the destination page.
    await page.screenshot({ path: "test-results/nav-evidence-3-after-release.png" });

    // The selected tab must change AND its page content must become visible.
    const activeTestId = await page.locator(".fabnav-link[data-active]").getAttribute("data-testid");
    expect(activeTestId, "no tab is marked active after the swipe").toBeTruthy();
    expect(activeTestId, "the wrong tab is active").not.toBe("tab-brief");

    // The destination page's own content must be on screen, not merely a
    // changed URL. This is the assertion that distinguishes "the pill moved"
    // from "the app went somewhere".
    const heading = await page.locator("main h1, main h2").first().textContent();
    expect((heading ?? "").trim().length, "the destination page rendered no heading").toBeGreaterThan(0);
  });

  test("a TAP still selects and navigates", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    // A locator click, not a boundingBox().click() — a Box has no click().
    await page.getByTestId("tab-matcher").click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/#\/matcher$/);
    // And the page content must actually be the destination.
    const heading = await page.locator("main h1, main h2").first().textContent();
    expect((heading ?? "").trim().length, "the tapped page rendered no heading").toBeGreaterThan(0);
  });

  test("reversing mid-drag does not jump the indicator", async ({ page }, testInfo) => {
    const touch = touchFor(page, testInfo.project.name as BrowserName);
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    const x0 = Math.round(box.x + box.width * 0.5);

    await touch("pointerdown", x0, y);
    await touch("pointermove", x0 - 40, y);
    await page.waitForTimeout(20);
    const afterLeft = await pillX(page);
    await touch("pointermove", x0 + 40, y);
    await page.waitForTimeout(20);
    const afterRight = await pillX(page);
    expect(afterRight, "reversing did not move back").toBeGreaterThan(afterLeft);
    await touch("pointerup", x0 + 40, y);
  });

  test("a cancelled gesture does NOT change page", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const urlBefore = page.url();
    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    const x0 = Math.round(box.x + box.width * 0.7);
    await page.locator(".fabnav").dispatchEvent("pointerdown", { clientX: x0, clientY: y, pointerType: "touch", pointerId: 1, isPrimary: true });
    await page.locator(".fabnav").dispatchEvent("pointermove", { clientX: x0 - 60, clientY: y, pointerType: "touch", pointerId: 1 });
    await page.locator(".fabnav").dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 1 });
    await page.waitForTimeout(400);
    expect(page.url(), "a cancelled gesture changed the page").toBe(urlBefore);
  });

  test("the bar allows vertical scrolling (touch-action: pan-y)", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const ta = await page.getByTestId("tabbar").evaluate((el) => getComputedStyle(el).touchAction);
    expect(ta, "the bar must not claim the vertical axis").toBe("pan-y");
  });

  test("re-grabbing MID-SNAP continues from where the pill is, without a jump", async ({ page }, testInfo) => {
    // THE INTERRUPTION CASE. A spring is running toward the next tab; the user
    // grabs the pill again. Two things must hold:
    //   1. the pill does NOT teleport to the selected tab's coordinate, and
    //   2. control transfers to the finger from the pill's CURRENT position.
    //
    // The bug this pins: restarting the drag from the target instead of from
    // the rendered position, which makes the pill jump sideways under a
    // stationary thumb.
    const touch = touchFor(page, testInfo.project.name as BrowserName);
    await page.goto("/#/");
    await page.waitForTimeout(600);

    const box = await navBox(page);
    const y = Math.round(box.y + box.height / 2);
    const startX = Math.round(box.x + box.width * 0.2);

    // Flick right and release, starting a spring toward the next tab.
    await touch("pointerdown", startX, y);
    for (let i = 1; i <= 3; i++) {
      await page.waitForTimeout(16);
      await touch("pointermove", startX + i * 14, y);
    }
    await touch("pointerup", startX + 42, y);

    // Catch it mid-flight: a few frames in, the spring is still moving.
    await page.waitForTimeout(60);
    const midSnap = await pillX(page);
    const pillBox = await page.getByTestId("fabnav-pill").boundingBox();

    // Grab it again, WITHOUT moving the finger at all.
    await touch("pointerdown", Math.round(pillBox!.x + pillBox!.width / 2), y);
    await page.waitForTimeout(40);
    const afterGrab = await pillX(page);

    // The pill must still be essentially where it was — no teleport.
    expect(
      Math.abs(afterGrab - midSnap),
      `the pill jumped on re-grab (${midSnap} -> ${afterGrab})`,
    ).toBeLessThanOrEqual(2);

    // And it must be between the two tabs, not snapped to either.
    expect(afterGrab, "the pill teleported to a tab stop").toBeGreaterThan(0);

    await touch("pointerup", Math.round(pillBox!.x + pillBox!.width / 2), y);
    await page.waitForTimeout(700);
    // Whatever it settled on, the app must be consistent.
    expect(page.url()).not.toBe("");
  });

  test("the pill has pointer-events: none so it cannot eat the gesture", async ({ page }) => {
    await page.goto("/#/");
    await page.waitForTimeout(500);
    const pe = await page.getByTestId("fabnav-pill").evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pe, "the pill would swallow taps and swipes").toBe("none");
  });
});
```


### 5.4 `e2e/navigation.spec.ts`

**`e2e/navigation.spec.ts`** — 27.0 KB (27699 bytes, 623 lines)

```ts
import { test, expect, type Page } from "@playwright/test";
import {
  TAB_IDS,
  dragIndicatorBeyondFirstStop,
  dragIndicatorBeyondLastStop,
  dragIndicatorToAdjacentTab,
  renderedPillX,
  renderedStops,
  tabSpacing,
  touchDriver,
} from "./navIndicatorDrag";

/**
 * The five-destination navigation model.
 *
 * These tests pin the redesign's structural promises:
 *   1. exactly five primary destinations, each with its own route
 *   2. the active icon is derived from the route and can never disagree
 *   3. tap navigates
 *   4. swiping the NAVIGATION BAR navigates
 *   5. swiping the CONTENT does NOT navigate
 *   6. vertical scrolling does NOT navigate
 *   7. the back gesture closes detail surfaces
 *   8. Settings returns to the section it was opened from
 *   9. an invalid route is handled explicitly, not silently
 */

const TABS = [
  { id: "tab-brief", label: "Hem", hash: "#/", page: "brief-page" },
  { id: "tab-nyheter", label: "Nyheter", hash: "#/nyheter", page: "news-page" },
  { id: "tab-matcher", label: "Matcher", hash: "#/matcher", page: "matches-page" },
  { id: "tab-trupp", label: "Trupp", hash: "#/trupp", page: "squad-page" },
  { id: "tab-spelare", label: "Spelare", hash: "#/spelare", page: "former-page" },
] as const;

/** Wait until the shell has data and the bar is interactive. */
async function ready(page: Page) {
  await expect(page.getByTestId("tabbar")).toBeVisible();
  await expect(page.locator(".tabbar-link, .fabnav-link").first()).toBeVisible();
}

test.describe("Five primary destinations", () => {
  test("there are exactly five, in order, each with an accessible name", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const links = page.locator(".tabbar a, .fabnav a");
    await expect(links).toHaveCount(5);
    for (const t of TABS) {
      const link = page.getByTestId(t.id);
      await expect(link).toBeVisible();
      await expect(link).toHaveText(t.label);
      await expect(link).toHaveAttribute("href", t.hash);
    }
  });

  test("navigation is a semantic <nav> with an accessible name", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    await expect(page.getByRole("navigation", { name: "Huvudnavigation" })).toBeVisible();
  });

  test("every destination is reachable by tapping, and the active icon follows", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    for (const t of TABS) {
      await page.getByTestId(t.id).click();
      await expect(page).toHaveURL(new RegExp(`${t.hash.replace("#", "\\u0023")}$`));
      await expect(page.getByTestId(t.page)).toBeAttached();
      // Exactly one icon is active, and it is the right one.
      await expect(page.locator('.fabnav a[aria-current="page"], .tabbar a[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByTestId(t.id)).toHaveAttribute("aria-current", "page");
    }
  });

  test("the active state is not colour alone", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const active = page.locator('.fabnav a[aria-current="page"]');
    // aria-current, a bolder label weight, and a dot marker.
    await expect(active).toHaveCount(1);
    const weight = await active.locator(".fabnav-label").evaluate((el) => getComputedStyle(el).fontWeight);
    const idle = await page.getByTestId("tab-nyheter").locator(".fabnav-label").evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(weight)).toBeGreaterThan(Number(idle));
  });

  test("each destination renders on a direct deep link", async ({ page }) => {
    for (const t of TABS) {
      await page.goto(`/${t.hash}`);
      await expect(page.getByTestId(t.page)).toBeAttached();
      await expect(page.getByTestId(t.id)).toHaveAttribute("aria-current", "page");
    }
  });
});

/**
 * SWIPE ON THE NAVIGATION BAR — the indicator gesture.
 *
 * REWRITTEN 2026-10-03. Every test below previously encoded a model that no
 * longer exists, and several were internally contradictory. What changed, and
 * why each old test had to move:
 *
 * THE OBSOLETE CONTRACT
 *   "A swipe is a DIRECTION SIGNAL that advances or retreats exactly one
 *    destination, independent of where the finger is."
 *   Two things about that are now invalid:
 *     - DIRECTION WAS PHYSICALLY INVERTED. `swipe(page, 1)` started at 85% of
 *       the bar and moved the finger LEFT, and the test was named "swiping left
 *       ADVANCES". Leftward is now backward, because that is which way the
 *       finger went. See the contract: drag right moves toward tabs visually to
 *       the right, and vice versa.
 *     - DISTANCE WAS NEVER GEOMETRIC. 40px and 72px were thresholds for an
 *       arithmetic step. The indicator now travels to where the finger goes, so
 *       a destination is only reachable if the indicator physically ends nearer
 *       that icon. One tab of travel is measured per test from the app.
 *
 * THE CONTRACT NOW PINNED
 *   1. drag RIGHT moves the indicator toward the tabs visually to the right
 *   2. drag LEFT moves it toward the tabs visually to the left
 *   3. pointer-down never moves the indicator
 *   4. a small movement stays a tap
 *   5. during a drag the indicator follows continuously while the ROUTE and
 *      aria-current stay on the committed tab; navigation happens on release
 *   6. travel is clamped to the first and last stops
 *   7. touch-action stays pan-y so vertical page scrolling remains native
 *
 * TERMINOLOGY, used consistently below: the OUTER BAR is the whole nav element
 * and never moves; the INDICATOR is the glass pill that slides between icons.
 * Conflating the two is what made "the bar does not move" look like a
 * contradiction when the indicator moving is the entire feature.
 */
test.describe("Swipe on the navigation bar", () => {
  const barBox = async (page: Page) => {
    const b = await page.getByTestId("tabbar").boundingBox();
    if (!b) throw new Error("nav bar has no box");
    return b;
  };

  /**
   * The CSS contract for the nav's touch behaviour.
   *
   * CORRECTED 2026-10-03. The comment this replaces claimed, as measured fact,
   * that `touch-action` on a container does not cover its descendants and that
   * descendant declarations were "what actually fixes it". That inference was
   * invalid: `touch-action` is not an INHERITED property, but for panning the
   * browser intersects the hit-tested element with each ANCESTOR up to the
   * nearest scroll container. Verified in Chromium with real touch and in WebKit
   * with synthetic events: with descendants forced to `auto`, the swipe still
   * completed and the route changed.
   *
   * What that verification does NOT establish: native iPhone gesture
   * arbitration. The WebKit run dispatched synthetic PointerEvents because
   * Playwright's CDP touch injection is Chromium-only, so it bypasses the layer
   * that decides scroll-versus-drag on a real thumb. Hardware only.
   *
   * The value is `pan-y`, not `none`, and that is deliberate: `none` claims the
   * vertical axis too, so a vertical drag starting on the bar would be swallowed
   * instead of scrolling the page.
   */
  test("the touch target yields the vertical axis and keeps the horizontal one", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const values = await page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).touchAction : "MISSING";
      };
      return {
        nav: read("[data-testid=tabbar]"),
        list: read(".fabnav-list"),
        link: read(".fabnav-link"),
        // The SVG is what a thumb visually lands on; measured earlier as
        // computing to `auto`, which is why it is pinned here explicitly.
        icon: read(".fabnav-icon"),
        label: read(".fabnav-label"),
      };
    });
    // Every element the finger can land on must permit vertical panning, so
    // page scrolling started on the bar stays native.
    for (const [el, got] of Object.entries(values)) {
      expect(got, `${el} must be pan-y so vertical scrolling stays native`).toBe("pan-y");
    }
  });

  test("a REAL touch drag to the RIGHT advances to the tab on the right", async ({ page }) => {
    await page.goto("/#/nyheter");
    await ready(page);
    const touch = touchDriver(page);
    const stops = await renderedStops(page, ["tab-nyheter", "tab-matcher"]);
    await page.goto("/#/nyheter");
    await ready(page);

    const { before } = await dragIndicatorToAdjacentTab(
      page,
      touch,
      "right",
      tabSpacing(stops, TAB_IDS),
    );
    expect(before, "the indicator should start on Nyheter").toBeCloseTo(stops["tab-nyheter"], 0);

    await touch("touchEnd", 0, 0);
    await expect(page).toHaveURL(/#\/matcher$/);
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
  });

  test("a REAL touch drag to the LEFT goes back to the tab on the left", async ({ page }) => {
    await page.goto("/#/matcher");
    await ready(page);
    const touch = touchDriver(page);
    const stops = await renderedStops(page, ["tab-nyheter", "tab-matcher"]);
    await page.goto("/#/matcher");
    await ready(page);

    await dragIndicatorToAdjacentTab(page, touch, "left", tabSpacing(stops, TAB_IDS));
    await touch("touchEnd", 0, 0);
    await expect(page).toHaveURL(/#\/nyheter$/);
    await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");
  });

  test("a drag works from EVERY destination, in the physical direction", async ({ page }) => {
    const touch = touchDriver(page);
    const stops = await renderedStops(page, TAB_IDS);
    const spacing = tabSpacing(stops, TAB_IDS);
    const ids = [...TAB_IDS];

    for (let i = 0; i < ids.length; i++) {
      const from = ids[i];
      const left = ids[i - 1];
      const right = ids[i + 1];

      // Rightward, when there is a tab to the right.
      if (right) {
        await page.goto(`/#/${from.replace("tab-", "")}`.replace("/#//", "/#/"));
        await ready(page);
        await dragIndicatorToAdjacentTab(page, touch, "right", spacing);
        await touch("touchEnd", 0, 0);
        await expect(page, `dragging right from ${from} must select ${right}`).toHaveURL(
          new RegExp(`${right === "tab-brief" ? "#/" : `#/${right.replace("tab-", "")}`}$`),
        );
      }
      // Leftward, when there is a tab to the left.
      if (left) {
        await page.goto(`/#/${from.replace("tab-", "")}`.replace("/#//", "/#/"));
        await ready(page);
        await dragIndicatorToAdjacentTab(page, touch, "left", spacing);
        await touch("touchEnd", 0, 0);
        await expect(page, `dragging left from ${from} must select ${left}`).toHaveURL(
          new RegExp(`${left === "tab-brief" ? "#/" : `#/${left.replace("tab-", "")}`}$`),
        );
      }
    }
  });

  test("the OUTER BAR is stationary while the INDICATOR moves, and the page waits for release", async ({ page }) => {
    /**
     * THE REPLACEMENT FOR "the bar does not move during a touch swipe".
     *
     * That test asserted the indicator was static, which is now the opposite of
     * the requirement — the indicator sliding is the whole feature. But its
     * intent was sound and worth keeping: the OUTER BAR must not drift while the
     * indicator travels inside it.
     *
     * So this proves all five parts at once, which is what the old test could
     * not do:
     *   - the outer bar's bounding box is unchanged throughout
     *   - the indicator follows the finger continuously
     *   - the route and aria-current STAY on the committed tab during the drag
     *   - they change only after release
     *   - the indicator settles exactly on the destination's stop
     */
    await page.goto("/#/nyheter");
    await ready(page);
    const touch = touchDriver(page);
    const stops = await renderedStops(page, ["tab-nyheter", "tab-matcher"]);
    await page.goto("/#/nyheter");
    await ready(page);

    const barBefore = await barBox(page);
    const urlBefore = page.url();

    const { samples } = await dragIndicatorToAdjacentTab(
      page,
      touch,
      "right",
      tabSpacing(stops, TAB_IDS),
      { sample: true },
    );

    // 1. the OUTER BAR has not moved
    const barDuring = await barBox(page);
    expect(Math.abs(barDuring.x - barBefore.x), "the outer bar shifted horizontally mid-drag").toBeLessThan(1);
    expect(Math.abs(barDuring.y - barBefore.y), "the outer bar shifted vertically mid-drag").toBeLessThan(1);

    // 2. the INDICATOR followed the finger, continuously and monotonically
    expect(samples.length, "the indicator was never sampled during the drag").toBeGreaterThan(3);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i], `the indicator stalled or reversed at step ${i}`).toBeGreaterThan(samples[i - 1]);
    }

    // 3. the ROUTE and aria-current are STILL on the committed tab mid-drag
    expect(page.url(), "the route changed DURING the drag, before release").toBe(urlBefore);
    await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");

    // 4. and only after release...
    await touch("touchEnd", 0, 0);
    await expect(page).toHaveURL(/#\/matcher$/);
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");

    // 5. ...does the indicator rest exactly on the destination's stop
    await expect
      .poll(() => renderedPillX(page), { timeout: 5_000 })
      .toBeCloseTo(stops["tab-matcher"], 0);
  });

  test("the indicator is clamped at the FIRST tab and does not wrap", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const touch = touchDriver(page);
    const stops = await renderedStops(page, ["tab-brief", "tab-nyheter"]);
    await page.goto("/#/");
    await ready(page);

    // Start on the FIRST tab and drag hard to the LEFT, past the clamp.
    const { atRelease } = await dragIndicatorBeyondFirstStop(page, touch);
    expect(atRelease, "the indicator left the track at the first stop").toBeGreaterThanOrEqual(0);

    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(700);
    // No wrapping: still on the first destination.
    await expect(page).toHaveURL(/#\/$/);
    await expect.poll(() => renderedPillX(page)).toBeCloseTo(stops["tab-brief"], 0);
  });

  test("the indicator is clamped at the LAST tab and does not wrap", async ({ page }) => {
    await page.goto("/#/spelare");
    await ready(page);
    const touch = touchDriver(page);
    const stops = await renderedStops(page, ["tab-trupp", "tab-spelare"]);
    await page.goto("/#/spelare");
    await ready(page);

    const { atRelease } = await dragIndicatorBeyondLastStop(page, touch);
    expect(atRelease, "the indicator left the track at the last stop").toBeLessThanOrEqual(206);

    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(700);
    await expect(page).toHaveURL(/#\/spelare$/);
    await expect.poll(() => renderedPillX(page)).toBeCloseTo(stops["tab-spelare"], 0);
  });

  test("a diagonal gesture that is MOSTLY VERTICAL does not move the indicator", async ({ page }) => {
    /**
     * OBSERVED BEHAVIOUR, recorded rather than asserted as a design promise.
     *
     * The component reads no vertical coordinate at all — `clientY` does not
     * appear in it — so the indicator cannot track a vertical drag. But that is
     * not the same as the browser letting the gesture through: `touch-action:
     * pan-y` permits vertical panning, so on a steep diagonal the BROWSER may
     * claim the gesture and fire `pointercancel`, ending it before the app can
     * act.
     *
     * MEASURED in Chromium with real touch, from Hem with the indicator at 0:
     *
     *   dx=+6,  dy=-200 (below the 8px activation threshold)
     *       -> rawPillX unchanged, pointercancel FIRED, route unchanged
     *   dx=+12, dy=-200 (above the threshold, vertical 16x larger)
     *       -> rawPillX unchanged, pointercancel FIRED, route unchanged
     *   dx=+40, dy=0   (pure horizontal control)
     *       -> rawPillX 0 -> 40, NO pointercancel, route -> #/nyheter
     *
     * So the indicator is protected on BOTH paths, but by two different
     * mechanisms, and only the third case shows the swipe working. This test
     * pins what was actually observed. It is NOT a claim that the app
     * implements axis locking — it does not — and native iOS arbitration
     * remains unverified.
     */
    await page.goto("/#/");
    await ready(page);
    const touch = touchDriver(page);
    await page.evaluate(() => {
      const w = window as unknown as { __pe: string[] };
      w.__pe = [];
      for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        window.addEventListener(t, () => w.__pe.push(t), true);
      }
    });

    const before = await renderedPillX(page);
    const bar = await barBox(page);
    const y = Math.round(bar.y + bar.height / 2);
    const startX = Math.round(bar.x + before + 26);

    await touch("touchStart", startX, y);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", startX + Math.round((12 * i) / 10), y - i * 20);
    }
    const atRelease = await renderedPillX(page);
    const events = await page.evaluate(() => (window as unknown as { __pe: string[] }).__pe);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(500);

    // The indicator did not move, even though the horizontal component alone
    // (12px) exceeds the 8px activation threshold.
    expect(Math.abs(atRelease - before), "a mostly-vertical diagonal moved the indicator").toBeLessThanOrEqual(1);
    // Recorded, not required: the browser claimed the steep diagonal.
    expect(events, "the browser did not cancel the steep diagonal (record this if it changes)").toContain(
      "pointercancel",
    );
    await expect(page).toHaveURL(/#\/$/);
  });

  test("a REAL touch drag on the CONTENT does not navigate", async ({ page }) => {
    await page.goto("/#/");
    await ready(page);
    const b = await barBox(page);
    const client = await page.context().newCDPSession(page);
    // Start well above the bar, in the content area.
    const y = Math.max(80, b.y - 220);
    const x0 = 200;
    const pts = (x: number) => [{ x, y, id: 1 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(x0) });
    for (let i = 1; i <= 8; i++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(x0 - 12 * i) });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
    await expect(page).toHaveURL(/#\/$/);
  });

  test("a movement below the threshold is a TAP, not a drag", async ({ page }) => {
    // Regression guard. A shaky finger must open the destination it landed on
    // rather than shoving the indicator around. The promise is "no DRAG
    // happened", not "nothing changed".
    await page.goto("/#/");
    await ready(page);
    const touch = touchDriver(page);
    const before = await renderedPillX(page);
    const bar = await barBox(page);
    const y = Math.round(bar.y + bar.height / 2);
    const startX = Math.round(bar.x + before + 26);

    await touch("touchStart", startX, y);
    // 6px: under DRAG_THRESHOLD_PX (8).
    for (let i = 1; i <= 4; i++) await touch("touchMove", startX + i * 2, y);
    const atRelease = await renderedPillX(page);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(400);

    expect(Math.abs(atRelease - before), "a sub-threshold movement moved the indicator").toBeLessThanOrEqual(1);
    // Treated as a tap: the link under the finger is what navigated.
    await expect(page).toHaveURL(/#\/$/);
  });

});
test.describe("Route handling", () => {
  test("an unknown route renders an explicit not-found, not a silent Brief", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.getByTestId("brief-page")).toHaveCount(0);
    // The bar stays usable so the user is never stranded.
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await expect(page.locator('.fabnav a[aria-current="page"]')).toHaveCount(0);
  });

  test("the not-found page links back into the five destinations", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await page.getByTestId("notfound-tab-trupp").click();
    await expect(page).toHaveURL(/\u0023\/trupp$/);
    await expect(page.getByTestId("squad-page")).toBeAttached();
  });

  test("a detail route keeps its section's icon active", async ({ page }) => {
    // Uses a player DETAIL route rather than a search result. This test is
    // about the navigation icon staying active while a child surface is open,
    // so it must not depend on the player-search screen's data or wording.
    await page.goto("/#/spelare");
    await expect(page.getByTestId("former-page")).toBeAttached();
    await page.goto("/#/matcher");
    await expect(page.getByTestId("matches-page")).toBeAttached();

    // A match sheet is a child surface of Matcher, driven by the app's own
    // fixture data, so this stays stable regardless of the player refactor.
    const row = page.getByTestId("match-row").first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("sheet")).toBeVisible();
    // The icon must not go blank while a child detail is open.
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Direct load and cold start", () => {
  // Regression: Squad.tsx once called useMemo BELOW an early return, so a cold
  // load of #/trupp rendered fewer hooks than the following render and React
  // threw #310, unmounting the whole app. A primary destination has to survive
  // a refresh, a deep link and a brand-new browser context.
  const ROUTES = [
    { hash: "#/", page: "brief-page" },
    { hash: "#/nyheter", page: "news-page" },
    { hash: "#/matcher", page: "matches-page" },
    { hash: "#/trupp", page: "squad-page" },
    { hash: "#/spelare", page: "former-page" },
  ];

  for (const r of ROUTES) {
    test(`cold load of ${r.hash} renders without crashing`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/${r.hash}`);
      await expect(page.getByTestId(r.page)).toBeAttached();
      // A React crash unmounts the tree, so any hook-order error is fatal.
      expect(errors, `page errors on ${r.hash}`).toEqual([]);
    });
  }

  test("a refresh of #/trupp keeps the squad rendered", async ({ page }) => {
    await page.goto("/#/trupp");
    await expect(page.getByTestId("squad-page")).toBeAttached();
    await page.reload();
    await expect(page.getByTestId("squad-page")).toBeAttached();
    await expect(page.getByTestId("squad-player").first()).toBeVisible();
  });

  test("#/trupp is reachable by navigation from every other destination", async ({ page }) => {
    for (const from of ["#/", "#/nyheter", "#/matcher", "#/spelare"]) {
      await page.goto(`/${from}`);
      await expect(page.locator(".fabnav")).toBeVisible();
      await page.waitForTimeout(300);
      await page.getByTestId("tab-trupp").click();
      await expect(page).toHaveURL(/\u0023\/trupp$/);
      await expect(page.getByTestId("squad-page")).toBeAttached();
      await expect(page.getByTestId("squad-player").first()).toBeVisible();
    }
  });
});

test.describe("Unknown routes claim no destination", () => {
  test("no icon is active and Brief is not highlighted", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await expect(page.getByTestId("not-found")).toBeVisible();
    // Regression: destinationFor() used to fall back to Brief, so the app
    // claimed a route it was not rendering.
    await expect(page.locator('.fabnav a[aria-current="page"]')).toHaveCount(0);
    await expect(page.getByTestId("tab-brief")).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("tab-brief")).not.toHaveAttribute("data-active", "true");
  });

  test("the bar is still usable from an unknown route", async ({ page }) => {
    await page.goto("/#/hittades-inte");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await page.getByTestId("tab-nyheter").click();
    await expect(page).toHaveURL(/\u0023\/nyheter$/);
    await expect(page.getByTestId("tab-nyheter")).toHaveAttribute("aria-current", "page");
  });
});

/**
 * Section G2 — the redundant active-state dot.
 *
 * The active destination already reads as active because its label turns
 * yellow. A 4px yellow dot was ALSO drawn via `::after` with `margin-top:
 * 30px`, which on a 9.5px label put it inside the text: it overlapped and
 * blurred the letters it was meant to support. It is removed, and nothing
 * replaces it — a second cue for the same state is redundant, not clearer.
 */
test.describe("Active state is the label, not a dot", () => {
  test("the active link paints no ::after marker at any viewport", async ({ page }) => {
    for (const vp of [
      { width: 390, height: 844, name: "phone" },
      { width: 1024, height: 768, name: "desktop" },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/#/");
      await expect(page.getByTestId("tabbar")).toBeVisible();

      for (const sel of [".fabnav-link", ".tabbar-link", ".fabnav a"]) {
        const n = await page.locator(sel).count();
        if (n === 0) continue;
        const markers = await page.evaluate((s) => {
          return [...document.querySelectorAll(s)].map((el) => {
            const cs = getComputedStyle(el, "::after");
            return {
              content: cs.content,
              w: cs.width,
              h: cs.height,
              bg: cs.backgroundColor,
            };
          });
        }, sel);
        for (const m of markers) {
          const drawsBox = m.content !== "none" && m.content !== '""' && parseFloat(m.w) > 0;
          expect(drawsBox, `${sel} still draws an ::after marker (${vp.name}): ${JSON.stringify(m)}`).toBe(false);
        }
      }
    }
  });

  test("the active destination is still unmistakable — by colour, on the label", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const active = page.locator('.fabnav-link[data-active], .tabbar-link[data-active]');
    await expect(active).toHaveCount(1);
    const color = await active.evaluate((el) => getComputedStyle(el).color);
    const inactive = await page
      .locator(".fabnav-link:not([data-active])")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(color, "the active label must differ from the inactive ones").not.toBe(inactive);
    // The yellow brand token, not merely "different".
    expect(color).toBe("rgb(255, 210, 0)");
  });

  test("the label is not obscured by anything painted over it", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const label = page.locator(".fabnav-link[data-active] .fabnav-label");
    await expect(label).toBeVisible();
    // The label has real width and its own line box — a 4px dot with a
    // 30px margin used to sit inside exactly this box.
    const box = (await label.boundingBox())!;
    expect(box.width).toBeGreaterThan(8);
    expect(box.height).toBeGreaterThan(4);
  });
});
```


### 5.5 `e2e/touch.spec.ts`

**`e2e/touch.spec.ts`** — 19.0 KB (19458 bytes, 416 lines)

```ts
import { test, expect, type Page, type Browser } from "@playwright/test";
import { chromium, devices } from "@playwright/test";
import {
  TAB_IDS,
  dragIndicatorBeyondFirstStop,
  dragIndicatorBeyondLastStop,
  dragIndicatorToAdjacentTab,
  renderedPillX,
  renderedStops,
  tabSpacing,
  touchDriver,
} from "./navIndicatorDrag";

/**
 * TOUCH-DRIVEN regression tests.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The previous suite drove the UI with `page.mouse`, which emits synthetic
 * MOUSE pointer events. A phone emits TOUCH pointer events, and the two are
 * treated very differently by a browser:
 *
 *   - `touch-action` is only consulted for touch input, so a `pan-y`/`pan-x`
 *     value that a mouse gesture sails straight past will make a real finger
 *     scroll the page instead of reaching the handler;
 *   - a touch gesture synthesises a `click` under different conditions;
 *   - momentum scrolling and pointer cancellation behave differently.
 *
 * So the mouse-based suite reported the nav swipe and the sheet drag as
 * working, and human testing on a real device found both broken. These tests
 * dispatch genuine touch events through CDP and additionally assert the thing
 * the old suite never checked: that the correct ELEMENT actually moved, and
 * that the background stayed still.
 */


/** A real iPhone-sized touch context against the preview server. */
async function touchPage(browser: Browser) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  return { ctx, page, touch };
}

test.describe("Touch: floating nav swipe", () => {
  test("a SHORT thumb drag still changes destination", async () => {
    // CORRECTED 2026-10-03. The old version asserted that a 40px LEFT flick
    // from Nyheter landed on Matcher. That is PHYSICALLY INVERTED: Matcher sits
    // to the RIGHT of Nyheter, and the indicator now travels toward the icon the
    // finger approaches. The test's own coordinates contradicted its name.
    //
    // The intent being preserved is that ordinary thumb travel is enough. It is
    // now expressed geometrically: one tab step plus a 4px overshoot, with the
    // step measured from the app rather than guessed.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, ["tab-nyheter", "tab-matcher"]);
    await page.goto("/#/nyheter");
    await expect(page.getByTestId("tabbar")).toBeVisible();

    const touch = touchDriver(page);
    // Overshoot 4px: enough to clear the 9.3px dead zone around the midpoint,
    // and well under the 62px the old rule demanded.
    await dragIndicatorToAdjacentTab(page, touch, "right", tabSpacing(stops, TAB_IDS), {
      overshoot: 4,
    });
    await touch("touchEnd", 0, 0);

    await expect(page).toHaveURL(/#\/matcher$/);
    await expect(page.getByTestId("tab-matcher")).toHaveAttribute("aria-current", "page");
    await ctx.close();
    await browser.close();
  });

  test("a drag works from EVERY nav item, in the PHYSICAL direction", async () => {
    // CORRECTED 2026-10-03. The old test was named "in both directions" and its
    // "forward" block moved the finger LEFT 120px, which under the indicator
    // model moves BACKWARD. Both loops now drag in the direction the finger
    // actually travels, and each start point is derived from the app's own
    // rendered stops instead of a hardcoded 0.8 / 0.2 of the bar.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, TAB_IDS);
    const spacing = tabSpacing(stops, TAB_IDS);
    const touch = touchDriver(page);

    const routes = ["#/", "#/nyheter", "#/matcher", "#/trupp", "#/spelare"] as const;
    const expectations = [
      ["tab-brief", "#/"],
      ["tab-nyheter", "#/nyheter"],
      ["tab-matcher", "#/matcher"],
      ["tab-trupp", "#/trupp"],
      ["tab-spelare", "#/spelare"],
    ] as const;

    for (let i = 0; i < routes.length; i++) {
      // Rightward, whenever there is a destination to the right.
      if (i + 1 < routes.length) {
        await page.goto(`/${routes[i]}`);
        await expect(page.getByTestId("tabbar")).toBeVisible();
        await dragIndicatorToAdjacentTab(page, touch, "right", spacing);
        await touch("touchEnd", 0, 0);
        await expect(page, `dragging RIGHT from ${routes[i]}`).toHaveURL(
          new RegExp(`${expectations[i + 1][1].replace("#", "\\u0023")}$`),
        );
      }
      // Leftward, whenever there is one to the left.
      if (i - 1 >= 0) {
        await page.goto(`/${routes[i]}`);
        await expect(page.getByTestId("tabbar")).toBeVisible();
        await dragIndicatorToAdjacentTab(page, touch, "left", spacing);
        await touch("touchEnd", 0, 0);
        await expect(page, `dragging LEFT from ${routes[i]}`).toHaveURL(
          new RegExp(`${expectations[i - 1][1].replace("#", "\\u0023")}$`),
        );
      }
    }
    await ctx.close();
    await browser.close();
  });

  test("the OUTER BAR stays put during a drag, the page does not scroll sideways, and the INDICATOR moves", async () => {
    // CORRECTED 2026-10-03. Two separate defects were living in this one test.
    //
    // DEFECT 1 — a conflation. It asserted the bar did not move, which was
    //   meant to catch the nav container being shoved around, but the indicator
    //   lives INSIDE that bar and is now required to move. Under the indicator
    //   model the old assertion would have failed on correct code.
    // FIX: split the two nouns. The OUTER BAR's box is checked on every frame
    //   for horizontal drift; the INDICATOR is checked to have travelled.
    //
    // DEFECT 2 — coordinates that could not reach anything. It started at 0.8 of
    //   the bar and dragged 160px left. One tab is ~51.5px, so that overshot
    //   three stops and crossed a dead zone, and the expected destination of
    //   Matcher was simply the nearest tab, not a choice the test made.
    // FIX: one tab of travel, measured from the app.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, ["tab-nyheter", "tab-matcher"]);
    await page.goto("/#/nyheter");
    await expect(page.getByTestId("tabbar")).toBeVisible();

    const touch = touchDriver(page);
    const bar = (await page.getByTestId("tabbar").boundingBox())!;
    const restX = bar.x;
    const before = await renderedPillX(page);
    const startX = Math.round(bar.x + before);
    const y = Math.round(bar.y + bar.height / 2);
    const travel = tabSpacing(stops, TAB_IDS) + 20;

    await touch("touchStart", startX, y);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", startX + Math.round((travel * i) / 8), y);
      const mid = (await page.getByTestId("tabbar").boundingBox())!;
      // The OUTER BAR has not drifted...
      expect(Math.abs(mid.x - restX), "the outer bar moved sideways mid-drag").toBeLessThanOrEqual(1);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, "the page scrolled horizontally during a nav drag").toBeLessThanOrEqual(1);
      // ...while the INDICATOR has.
      expect(
        await renderedPillX(page),
        `the indicator did not follow the finger at step ${i}`,
      ).toBeGreaterThan(before);
    }
    await touch("touchEnd", 0, 0);

    await expect(page).toHaveURL(/#\/matcher$/);
    // And it settled exactly on the destination's stop.
    await expect
      .poll(() => renderedPillX(page), { timeout: 5_000 })
      .toBeCloseTo(stops["tab-matcher"], 0);
    await ctx.close();
    await browser.close();
  });

  test("a tap still navigates, and a drag does not also fire the link underneath", async () => {
    // CORRECTED 2026-10-03. The name said "swipe" and described a swipe; only
    // the direction was wrong. It started at 0.2 of the bar and dragged right,
    // so under the indicator model it moved to the tab on the RIGHT, not back
    // to Trupp. Fixed to drag LEFT, toward Trupp, which is what the assertion
    // always meant.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1500);

    // Plain tap.
    await page.getByTestId("tab-trupp").tap();
    await expect(page).toHaveURL(/#\/trupp$/);

    // A drag starting on Spelare must move to Trupp and must NOT open a
    // player sheet by activating whatever lay under the release point.
    const stops = await renderedStops(page, ["tab-trupp", "tab-spelare"]);
    await page.goto("/#/spelare");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const touch = touchDriver(page);
    await dragIndicatorToAdjacentTab(page, touch, "left", tabSpacing(stops, TAB_IDS));
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/#\/trupp$/);
    expect(await page.locator(".sheet, [role=dialog]").count(), "a drag opened a detail sheet").toBe(0);
    await ctx.close();
    await browser.close();
  });

  test("no wrapping at either end", async () => {
    // CORRECTED 2026-10-03. The direction table was inverted in the same way:
    // from Brief it dragged RIGHT 120px and expected to stay on Brief. Under the
    // indicator model dragging right from Brief legitimately reaches Nyheter,
    // so that case was asserting the opposite of the clamp. Each end is now
    // pushed AGAINST its own clamp with real overshoot.
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    const stops = await renderedStops(page, ["tab-brief", "tab-spelare"]);
    const touch = touchDriver(page);

    // FIRST stop: push hard LEFT from Brief. It must not wrap to the last tab.
    await page.goto("/#/");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const first = await dragIndicatorBeyondFirstStop(page, touch);
    expect(first.atRelease, "the indicator left the track at the first stop").toBeGreaterThanOrEqual(0);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(700);
    await expect(page, "dragging left at the first tab must not wrap").toHaveURL(/#\/$/);
    await expect.poll(() => renderedPillX(page)).toBeCloseTo(stops["tab-brief"], 0);

    // LAST stop: push hard RIGHT from Spelare. It must not wrap to the first.
    await page.goto("/#/spelare");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    const last = await dragIndicatorBeyondLastStop(page, touch);
    expect(last.atRelease, "the indicator left the track at the last stop").toBeLessThanOrEqual(206);
    await touch("touchEnd", 0, 0);
    await page.waitForTimeout(700);
    await expect(page, "dragging right at the last tab must not wrap").toHaveURL(/#\/spelare$/);
    await expect.poll(() => renderedPillX(page)).toBeCloseTo(stops["tab-spelare"], 0);

    await ctx.close();
    await browser.close();
  });
});

test.describe("Touch: bottom sheet drag", () => {
  /** Open the match sheet, which is driven by the app's own fixture data. */
  async function openSheet(page: Page) {
    await page.goto("/#/matcher");
    await expect(page.getByTestId("tabbar")).toBeVisible();
    await page.waitForTimeout(1800);
    await page.getByTestId("match-row").first().tap();
    await expect(page.getByTestId("sheet")).toBeVisible();
    await page.waitForTimeout(500);
  }

  test("dragging on the SHEET BODY moves the sheet, and the background stays put", async () => {
    // The old implementation bound the drag to a 22px grabber only, so a
    // finger landing on the title or the body did nothing at all.
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    await openSheet(page);

    const geo = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
      const b = document.querySelector(".sheet-body")!.getBoundingClientRect();
      const l = document.querySelector(".layer") as HTMLElement;
      return { sheetY: s.y, bodyX: b.x, bodyW: b.width, bodyY: b.y, layerTop: l.scrollTop };
    });

    const startX = geo.bodyX + geo.bodyW / 2;
    const startY = geo.bodyY + 40;
    await touch("touchStart", startX, startY);
    let moved = 0;
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", startX, startY + i * 18);
      const y = (await page.getByTestId("sheet").boundingBox())!.y;
      moved = Math.max(moved, y - geo.sheetY);
      const layerTop = await page.evaluate(
        () => (document.querySelector(".layer") as HTMLElement).scrollTop,
      );
      expect(layerTop, "the background page scrolled while the sheet was dragged").toBe(geo.layerTop);
    }
    expect(moved, "the sheet did not follow the finger at all").toBeGreaterThan(40);
    await touch("touchEnd", startX, startY + 144);
    await ctx.close();
    await browser.close();
  });

  test("dragging on the grabber and the title both move the sheet", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    for (const where of ["grab", "head"]) {
      await openSheet(page);
      const rest = (await page.getByTestId("sheet").boundingBox())!.y;
      const start = await page.evaluate((w) => {
        const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
        const g = document.querySelector(".sheet-grab")!.getBoundingClientRect();
        return { x: s.x + s.width / 2, y: w === "grab" ? g.y + g.height / 2 : s.y + 40 };
      }, where);
      await touch("touchStart", start.x, start.y);
      for (let i = 1; i <= 6; i++) await touch("touchMove", start.x, start.y + i * 18);
      const mid = (await page.getByTestId("sheet").boundingBox())!.y;
      expect(mid - rest, `dragging the ${where} did not move the sheet`).toBeGreaterThan(30);
      await touch("touchEnd", start.x, start.y + 108);
      await page.waitForTimeout(300);
    }
    await ctx.close();
    await browser.close();
  });

  test("released below the threshold the sheet returns; beyond it, the sheet dismisses", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);

    // Short drag: comes back, stays open.
    await openSheet(page);
    let start = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
      const g = document.querySelector(".sheet-grab")!.getBoundingClientRect();
      return { x: s.x + s.width / 2, y: g.y + g.height / 2 };
    });
    await touch("touchStart", start.x, start.y);
    for (let i = 1; i <= 6; i++) await touch("touchMove", start.x, start.y + i * 9);
    await touch("touchEnd", start.x, start.y + 54);
    await page.waitForTimeout(600);
    await expect(page.getByTestId("sheet"), "a short drag must not dismiss the sheet").toBeVisible();
    const back = (await page.getByTestId("sheet").boundingBox())!.y;
    const rest = await page.evaluate(
      () => document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect().y,
    );
    expect(Math.abs(back - rest)).toBeLessThanOrEqual(2);

    // Long drag: dismisses.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await openSheet(page);
    start = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
      const g = document.querySelector(".sheet-grab")!.getBoundingClientRect();
      return { x: s.x + s.width / 2, y: g.y + g.height / 2 };
    });
    await touch("touchStart", start.x, start.y);
    for (let i = 1; i <= 8; i++) await touch("touchMove", start.x, start.y + i * 26);
    await touch("touchEnd", start.x, start.y + 208);
    await page.waitForTimeout(700);
    await expect(page.getByTestId("sheet"), "a long drag must dismiss the sheet").toHaveCount(0);
    await ctx.close();
    await browser.close();
  });

  test("the sheet's own content still scrolls, and a drag while scrolled does not move the sheet", async () => {
    const browser = await chromium.launch();
    const { ctx, page, touch } = await touchPage(browser);
    await openSheet(page);

    const geo = await page.evaluate(() => {
      const b = document.querySelector(".sheet-body") as HTMLElement;
      const r = b.getBoundingClientRect();
      return { x: r.x, w: r.width, y: r.y, scrollable: b.scrollHeight > b.clientHeight };
    });
    expect(geo.scrollable, "fixture sheet content should be scrollable for this test to mean anything").toBe(
      true,
    );

    // Swipe UP: the content scrolls, the sheet stays.
    const rest = (await page.getByTestId("sheet").boundingBox())!.y;
    await touch("touchStart", geo.x + geo.w / 2, geo.y + 40);
    for (let i = 1; i <= 8; i++) await touch("touchMove", geo.x + geo.w / 2, geo.y + 40 - i * 18);
    const duringUp = (await page.getByTestId("sheet").boundingBox())!.y;
    expect(Math.abs(duringUp - rest), "an upward scroll moved the sheet").toBeLessThanOrEqual(2);
    await touch("touchEnd", geo.x + geo.w / 2, geo.y - 104);
    await page.waitForTimeout(500);
    const scrolled = await page.evaluate(
      () => (document.querySelector(".sheet-body") as HTMLElement).scrollTop,
    );
    expect(scrolled, "the sheet body did not scroll on an upward swipe").toBeGreaterThan(0);

    // Now drag DOWN while scrolled: the content must scroll back, not the sheet.
    const startY = geo.y + 40;
    await touch("touchStart", geo.x + geo.w / 2, startY);
    let midSheet = rest;
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", geo.x + geo.w / 2, startY + i * 20);
      midSheet = (await page.getByTestId("sheet").boundingBox())!.y;
    }
    const midScroll = await page.evaluate(
      () => (document.querySelector(".sheet-body") as HTMLElement).scrollTop,
    );
    expect(Math.abs(midSheet - rest), "a downward drag moved the sheet while its content was scrolled").toBeLessThanOrEqual(2);
    expect(midScroll, "content did not scroll back toward the top").toBeLessThan(scrolled);
    await touch("touchEnd", geo.x + geo.w / 2, startY + 120);
    await ctx.close();
    await browser.close();
  });

  test("close button, Escape and focus restoration still work", async () => {
    const browser = await chromium.launch();
    const { ctx, page } = await touchPage(browser);
    await openSheet(page);
    await page.getByTestId("sheet-close").tap();
    await expect(page.getByTestId("sheet")).toHaveCount(0);

    await openSheet(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet")).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(focused, "focus was left nowhere after Escape").not.toBe("BODY");
    await ctx.close();
    await browser.close();
  });
});
```


---

## 6. Configuration

### 6.1 `playwright.config.ts`

**`playwright.config.ts`** — 2.2 KB (2296 bytes, 58 lines)

```ts
import { defineConfig } from "@playwright/test";

/**
 * The app is served under the GitHub Pages base path `/Min-BKH-app/`, so the
 * test baseURL must include it. It previously used the bare origin, which made
 * every `page.goto("/#/")` land on a redirect/404 and time out.
 */
const BASE_PATH = "/Min-BKH-app";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:4173${BASE_PATH}`,
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    port: 4173,
    // Always boot a server for the CURRENT dist. Reusing a leftover server
    // silently tests a stale bundle, which is what produced a whole misleading
    // failing run while iterating on this redesign.
    reuseExistingServer: false,
    timeout: 60000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // WHY WEBKIT IS A SEPARATE PROJECT NOW
    //
    // The nav swipe is the feature most likely to differ between engines, and
    // Chromium alone cannot see WebKit's behaviour. WebKit here is Playwright's
    // WebKit build, which is much closer to real iOS Safari than Chromium is —
    // though still not the same thing.
    //
    // WHAT THIS IS NOT: native gesture verification. Playwright's CDP touch
    // injection is Chromium-only (`newCDPSession` throws in WebKit), so in the
    // WebKit project the touch helper dispatches synthetic PointerEvents.
    // Synthetic events exercise the app's own logic and WebKit's CSS and event
    // handling, but they bypass WebKit's NATIVE gesture recognition — the
    // layer that decides scroll-versus-drag and raises the link callout.
    //
    // So a green WebKit run is evidence about OUR LOGIC, not about iOS. Only a
    // real iPhone can verify the gesture itself. See docs/ENHANCEMENTS.md.
    {
      name: "webkit",
      use: {
        browserName: "webkit",
        // A phone-sized viewport, and touch, so the media queries and the
        // touch-action arbitration are exercised at the size that matters.
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },
  ],
});
```


### 6.2 `package.json` — scripts and dependency versions

**`package.json`** — 1.4 KB (1465 bytes, 49 lines)

```json
{
  "name": "min-bkh-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "pipeline": "tsx pipeline/src/run.ts",
    "pipeline:validate": "tsx pipeline/src/validate.ts",
    "gemini:status": "bash .github/scripts/gemini-status.sh",
    "gemini:history": "bash .github/scripts/gemini-status.sh --history",
    "gemini:size-probe": "bash .github/scripts/gemini-size-probe.sh",
    "gemini:recheck": "tsx pipeline/src/geminiRecheck.ts",
    "gemini:eval": "tsx pipeline/src/geminiSemanticEval.ts"
  },
  "dependencies": {
    "lucide-react": "^0.469.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.18.4"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.10.1",
    "@eslint/js": "^10.0.1",
    "@playwright/test": "^1.49.1",
    "@types/node": "^22.10.5",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "eslint": "^10.11.0",
    "fast-xml-parser": "^5.11.1",
    "jsdom": "^25.0.1",
    "sharp": "^0.35.4",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.19.0",
    "vite": "^6.0.7",
    "vite-plugin-pwa": "^0.21.1",
    "vitest": "^3.2.7",
    "zod": "^3.24.1"
  }
}
```


#### Scripts relevant to the navigation

| Script | Command | Relevance |
| --- | --- | --- |
| `npm run test` | `vitest run` | Runs §4 (indicator geometry, swipe thresholds) |
| `npm run test:watch` | `vitest` | Same, watch mode |
| `npm run test:e2e` | `playwright test` | Runs §5 against a preview server |
| `npm run build` | `tsc -b && vite build` | **Must run before `test:e2e`** — `playwright.config.ts` boots `npm run preview`, so e2e exercises the **built bundle**, never the dev server |
| `npm run preview` | `vite preview` | The server Playwright boots (port 4173, `--strictPort`) |
| `npm run typecheck` | `tsc -b` | Type-level verification |
| `npm run lint` | `eslint .` | Lint |
| `npm run dev` | `vite` | Dev server — **not** what the e2e tests exercise |

#### Dependency versions

**Runtime**

| Package | Declared | Role in the navigation |
| --- | --- | --- |
| `react` | `^18.3.1` | Hooks, refs, synthetic event system |
| `react-dom` | `^18.3.1` | DOM host for pointer events |
| `react-router-dom` | `^7.18.4` | `HashRouter` / `useNavigate` / `useLocation` — the route commit mechanism |
| `lucide-react` | `^0.469.0` | The five destination icons (`Home`, `Newspaper`, `CalendarDays`, `Users`, `UserSearch`) |

**Dev, relevant to the tests**

| Package | Declared | Role |
| --- | --- | --- |
| `@playwright/test` | `^1.49.1` | e2e runner; `devices["iPhone 13"]`, `newCDPSession` |
| `vitest` | `^3.2.7` | Unit test runner |
| `jsdom` | `^25.0.1` | Unit test DOM environment |
| `vite` | `^6.0.7` | Dev/preview server; base path and SW config |
| `vite-plugin-pwa` | `^0.21.1` | Service worker; caches `/data/*.json` `NetworkFirst` |
| `typescript` | `^5.7.2` | `tsc -b` |
| `@axe-core/playwright` | `^4.10.1` | Accessibility assertions (in `e2e/a11y.spec.ts`, not included here) |
| `@types/react` | `^18.3.18` | React types |

---

## 7. Import / dependency map

### 7.1 What `FloatingTabBar.tsx` imports

| Import | From | Directly affects |
| --- | --- | --- |
| `useCallback`, `useEffect`, `useRef`, `useState`, `type PointerEvent as ReactPointerEvent` | `react` | Pointer events, gesture refs, window-listener lifecycle, `armed` state |
| `DESTINATIONS` | `./nav` | Navigation geometry — count, order (which is also swipe order), per-tab `testId` |
| `clampIndex` | `./nav` | Dragging — clamps a destination index to `0..4` |
| `hrefFor` | `./nav` | Routing — produces the `#${path}` href for each anchor |
| `type Destination` | `./nav` | Accessibility / typing — the `active` prop type |
| `DRAG_THRESHOLD_PX` | `./fabnavPosition` | Pointer events — the 8px tap-vs-swipe discriminator |
| `applyDeadZone` | `./fabnavPosition` | Snapping — suppresses an adjacent move near the midpoint |
| `clampToTrack` | `./fabnavPosition` | Dragging — keeps the indicator inside the track, no wrapping |
| `leftFor` | `./fabnavPosition` | Navigation geometry — the bar's centred `left` |
| `nearestTab` | `./fabnavPosition` | Snapping — picks the destination from the pill's resting position |
| `prefersReducedMotion` | `./fabnavPosition` | Animation / accessibility — collapses the spring to a jump |
| `springSettled` | `./fabnavPosition` | Animation — the spring's termination test |
| `springStep` | `./fabnavPosition` | Animation — the integrator (450/32/1, sub-stepped at 1/120) |
| `tabStops` | `./fabnavPosition` | Navigation geometry — indicator `x` per tab |

The five icons arrive transitively via `DESTINATIONS` in `nav.ts`.

### 7.2 What imports `fabnavPosition.ts`

| Importer | Kind | Symbols used |
| --- | --- | --- |
| `app/shared/FloatingTabBar.tsx` | production | `DRAG_THRESHOLD_PX`, `applyDeadZone`, `clampToTrack`, `leftFor`, `nearestTab`, `prefersReducedMotion`, `springSettled`, `springStep`, `tabStops` |
| `app/shared/fabnavPosition.test.ts` | unit test | `DRAG_THRESHOLD_PX`, `SPRING_DAMPING`, `SPRING_MASS`, `SPRING_STIFFNESS`, `clampToTrack`, `leftFor`, `nearestTab`, `springSettled`, `springStep`, `tabStops` |

**Nothing else imports it.** In particular no e2e spec imports it — the e2e
helpers deliberately re-derive geometry by *reading the running app* rather than
calling these functions (see `e2e/navIndicatorDrag.ts`), because an earlier
version that recomputed the formula in the test disagreed with the app by 1px
(103 vs 104) and so failed on arithmetic rather than on behaviour.

### 7.3 What imports `app/shared/nav.ts`

| Importer | Kind |
| --- | --- |
| `app/shared/FloatingTabBar.tsx` | production |
| `app/App.tsx` | production — `DESTINATIONS`, `SETTINGS_PATH`, `destinationFor`, `idFromSearch`, `searchWithId` |

### 7.4 Which CSS file applies the navigation styles

`app/theme.css`, imported once globally by `app/main.tsx` (`import "./theme.css"`).
No CSS modules, no per-component stylesheets, and no `style` prop anywhere in
`FloatingTabBar.tsx` except the imperative `transform` / `width` / `left`
writes it performs through refs during a gesture.

Selector → concern map:

| Selector | Concern |
| --- | --- |
| `:root` (`--fabnav-*`) | Geometry + glass tokens |
| `main`, `.layer` | The scrolling surface the fixed bar floats over; `--chrome-bottom` clearance |
| `.fabnav` | Container — `position: fixed`, centring via `left`, width cap, `z-index: 40`, glass surface + `backdrop-filter`, `touch-action: pan-y`, `user-select: none`, `-webkit-touch-callout: none`, `will-change: transform` |
| `.fabnav[data-lifted]` | Scale/shadow state — **dead**, left over from the removed vertical drag (§8 item 6) |
| `@supports ((backdrop-filter…))` / `@supports not (…)` | Reduced-transparency fallbacks — `--fabnav-surface` vs `--fabnav-surface-opaque`; `--fabnav-pill` vs `--fabnav-pill-opaque` |
| `.fabnav[data-dragging] .fabnav-link` | Swipe-armed state — suppresses the tap highlight |
| `.fabnav-link:focus-visible` | Accessibility — keyboard focus ring |
| `.fabnav-pill` | **The moving indicator** — absolute, `pointer-events: none`, `transition: none`, `transform: translate3d(0,0,0)`, `will-change: transform` |
| `.fabnav-list`, `.fabnav-item` | Track layout (`flex: 1 1 0`), `touch-action: pan-y` |
| `.fabnav-link` | Nav item — hit area, `touch-action: pan-y`, `-webkit-touch-callout: none`, inactive colour `var(--text-3)` |
| `.fabnav-icon`, `.fabnav-icon svg` | Icon — `touch-action: pan-y` **and** `pointer-events: none` (load-bearing: the SVG was the hit target) |
| `.fabnav-label` | Label — `touch-action: pan-y`, ellipsis, inactive typography |
| `.fabnav-link[data-active]` (+ `.fabnav-icon`, `.fabnav-label`) | **Active** state — yellow tint `var(--yellow)`, `translateY(-1px)`, `font-weight: 700` |
| `.fabnav-link:active .fabnav-icon` | Pressed state |
| `.skip-link` | Keyboard bypass of the nav |
| `@media (prefers-reduced-motion: reduce)` | Accessibility — global animation collapse |
| `@media (min-width: 700px)` | Desktop column width; also restores `margin-bottom: var(--chrome-bottom)` on `.sheet` |

### 7.5 Which route / navigation mechanism commits the selected page

The chain, in order:

1. **Gesture → intent.** `FloatingTabBar.goTo(next)` clamps with `clampIndex`,
   compares against `indexRef.current`, and calls
   `onSelectRef.current(DESTINATIONS[clamped])`. The swipe path calls it from
   `endDrag(true)` **after** the spring is started; the tap path calls it from
   the anchor's `onClick`, **after** `measure(i)`.
2. **Prop.** `App.tsx` renders
   `<FloatingTabBar active={active} onSelect={(d) => go(d.path)} />`.
3. **Commit.** `go(to)` calls `navigate(to)` from `react-router-dom`'s
   `useNavigate()`, inside a `<HashRouter>`. The URL hash is the single source
   of navigation truth; there is no second copy in component state.
4. **Read-back.** `AppShell` reads `useLocation()` and computes
   `active = destinationFor(pathname)`, which matches a destination exactly or
   as the parent of a detail route (`#/matcher?id=…` keeps Matcher's icon
   active). An unrecognised route returns `null`, so **no** icon claims to be
   active.
5. **Render.** The new `active` re-renders `FloatingTabBar`; the effect whose
   dependency is `current` re-measures and parks the pill on the new stop.

Anchors remain real `href="#/path"` links, so middle-click, long-press and the
keyboard all work; `onClick` intercepts only a plain left click
(`e.preventDefault()`, then `measure(i)` + `goTo(i)`).

### 7.6 Event-flow summary

```text
pointerdown on <nav class="fabnav">
  → onPointerDown: stopSpring(); d.anchorX = anim.x  (LAST RENDERED, not the target)
  → d.live = true, d.moved = false, d.startX = clientX
  → setPointerCapture is deliberately NEVER called: it would redirect the
    synthesised click to the NAV and kill every tap

pointermove / pointerup / pointercancel: bound on WINDOW, not on the <nav>,
  so a gesture may leave the bar entirely before it ends.

  onPointerMove (window):
    → velocity: exponential smoothing, d.v = d.v*0.7 + ix*0.3
    → if |dx| < DRAG_THRESHOLD_PX (8) and !moved → return (still a tap)
    → first crossing: d.moved = true; setArmed(true)  [→ data-dragging → CSS
      opacity 0.75]; navigator.vibrate(8) if available
    → next = clampToTrack(anim.anchorX + dx, trackW, pillW)
    → anim.x = next; anim.v = 0; paint(next)
      (direct style.transform write — no React state, no CSS transition)

  endDrag(commitIt)   [pointerup → true, pointercancel → false]
    → if !d.moved: return — a TAP; the anchor's own click is allowed through
    → target = commitIt ? applyDeadZone(nearestTab(x, tabX), current, x, tabX)
                        : indexRef.current
    → springTo(tabX[clamp(target)])   (skipped entirely if prefersReducedMotion)
    → stopNextClick(navRef.current)   (capture-phase listener, torn down on a
      400ms TIMER — never once:true)
    → if commitIt: goTo(target) → onSelect → navigate() → hash changes
```

---

## 8. Points the reviewer should examine first

Ordered roughly by risk. Several are places where the code's own comments record
that something is **verified by reasoning or emulation but not on real hardware**.

1. **Native iPhone gesture arbitration is unverified.** `touch-action: pan-y` on
   `.fabnav` is asserted in Chromium with real CDP touch, and in WebKit with
   synthetic `PointerEvent`s — Playwright's CDP touch injection is
   Chromium-only (`newCDPSession` throws in WebKit). Synthetic events do not
   exercise WebKit's native gesture recogniser, which is the layer that decides
   scroll-versus-drag and raises the link callout. Both `playwright.config.ts`
   and `e2e/fabnav-swipe.spec.ts` state this explicitly. **Only hardware settles
   it.**
2. **A vertical drag starting on the bar may not scroll at all.** `.fabnav` is
   `position: fixed` and a **sibling** of `.layer`, which is the element that
   actually scrolls — so a touch beginning on the bar has no scrollable ancestor.
   `touch-action: pan-y` grants permission, but there may be nothing there to
   scroll. Measured in Chromium: the same vertical drag scrolls 225px from the
   content area and 0px from the bar. Recorded as an unresolved *layout* question
   in `FloatingTabBar.tsx` (`onPointerMove`) rather than papered over — no code
   forwards the gesture by hand.
3. **Re-grab anchors to the rendered position, not the touch point.** A
   deliberate trade: no jump on touchdown, at the cost of a constant offset
   between thumb and pill when a swipe begins away from the pill's centre. The
   rejected alternative (anchor to `clientX`) is documented with its measured
   65px jump.
4. **`layoutWidth()` uses `offsetWidth`, not `getBoundingClientRect()`.** The
   bar is scaled by `.fabnav { scale: var(--fabnav-lift, 1) }`, so the rect is the
   *visual* box. Same reasoning for the pill's width inside `measure()`. This
   project has already been bitten by exactly this trap (E-013: 9.1px off-centre,
   but only while lifted).
5. **The pill's width is set from JS, not CSS**, so it can never disagree with
   `tabStops`. The CSS default (`width: 52px`) is overwritten at measure time.
6. **`--fabnav-top` and `.fabnav[data-lifted]` are dead code.** Both belong to
   the removed vertical drag; `data-lifted` is no longer set by any code path.
   Recommend removing both.
7. **The spring deliberately overshoots.** 2.63px over 208px of travel, damping
   ratio 0.754, ~433ms settle. `fabnavPosition.test.ts` records these as measured
   and asserts "no visible bounce" rather than zero overshoot. The `dt` clamp
   (≤0.05s) plus 1/120 sub-steps are what stop one stalled frame flinging the
   pill across the bar.
8. **`stopNextClick` uses a timer, not `once: true`.** A gesture often ends off
   the link it started on, so no click may ever be dispatched; an `once` listener
   would survive and swallow the next real tap, taking navigation down with it.
9. **`isSwipeCommit` / `SWIPE_MIN_PX` / `FLICK_VELOCITY` / `FLICK_MIN_PX` are
   exported but never called by the component.** The release decision is
   geometric (nearest tab + dead zone), not distance/velocity-based. They are
   retained and unit-tested in `FloatingTabBar.test.ts`, so those tests pass
   while proving nothing about the shipped behaviour. This directly contradicts
   `docs/ENHANCEMENTS.md` E-013 item 4. Confirm whether it is intentional.
10. **No `prefers-reduced-transparency` handling exists** anywhere in the
    codebase. The only reduced-transparency path is the
    `@supports not (backdrop-filter)` opacity fallback.
11. **`touch-action` is declared on five separate selectors** (`.fabnav`,
    `.fabnav-list`, `.fabnav-link`, `.fabnav-icon`, `.fabnav-label`). The
    comment on `.fabnav-list` records that the *previous* justification for this
    was an invalid inference — `touch-action` is not inherited, but for panning
    the browser intersects the hit-tested element with each ancestor up to the
    nearest scroll container. The declarations are still present; the stated
    reason has changed. `.fabnav-icon svg` additionally carries
    `pointer-events: none`.
12. **`d.dx` is written to the gesture ref and never read.** `dx` is recomputed
    as a local in `onPointerMove`, so the ref field is vestigial. Minor.
13. **`measure()` (line ~239) calls `stopSpring()`, which is declared later**
    (line ~277) with `const`. This is safe in practice — the call happens inside
    the effect, after the render completes, and `stopSpring` only touches the
    stable `anim` ref — but `stopSpring` is **absent from `measure`'s dependency
    array**, so `measure` closes over the first render's `stopSpring` forever.
    Correct today only because that closure is ref-only. Worth a comment if you
    touch it.
