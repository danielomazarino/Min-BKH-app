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
 * `inset` keeps the indicator clear of the bar's rounded corners. The bar is
 * `position: fixed` with a 1px border and a 24px radius; without an inset the
 * first and last stops place the indicator's square corners out past the
 * curve, which is visible as the pill protruding beyond the frame. Found on a
 * real iPhone at Spelare, the right-most tab.
 *
 * The indicator is one tab wide minus one inset each side, so centring it on a
 * tab still centres it on that tab's icon and label. With the defaults
 * (`inset = 0`, indicator exactly one tab) this is the plain even-spacing rule.
 */
export function tabStops(
  count: number,
  trackWidth: number,
  indicatorWidth: number,
  inset = 0,
): number[] {
  if (count <= 0) return [inset];
  const usable = Math.max(0, trackWidth - indicatorWidth - inset * 2);
  // With a zero-width track every stop collapses to the inset; dividing by a
  // zero span would produce NaN and strand the indicator off-screen.
  if (count === 1 || usable === 0) return new Array(count).fill(inset);
  const step = usable / (count - 1);
  return new Array(count).fill(0).map((_, i) => inset + i * step);
}

/**
 * Clamp a position to the track, so the indicator cannot leave the bar.
 *
 * The bounds are inset by the same amount as the stops, so the indicator is
 * clamped to the same region it is allowed to rest in.
 */
export function clampToTrack(
  x: number,
  trackWidth: number,
  indicatorWidth: number,
  inset = 0,
): number {
  const min = inset;
  const max = inset + Math.max(0, trackWidth - indicatorWidth - inset * 2);
  return clamp(x, min, max);
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
