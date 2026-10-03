/**
 * Geometry for the draggable floating navigation bar.
 *
 * WHY THIS FILE EXISTS
 * The interesting part of a draggable bar is not the pointer handling — it is
 * the arithmetic that keeps the bar inside the viewport. That arithmetic is
 * pure, so it can be tested without a browser, without synthetic touch, and
 * without the flakiness gesture tests are prone to. It lives here to keep the
 * component a thin shell over it.
 *
 * THE BUG THIS FILE WAS WRITTEN FOR
 * `.fabnav` was `width: min(100% - 32px, 440px)` — it exactly FILLS the band
 * between the two 16px margins. Measured in Chromium at three phone widths,
 * the horizontal travel was:
 *
 *     320px viewport -> bar 288px -> travel 0px
 *     390px viewport -> bar 358px -> travel 0px
 *     430px viewport -> bar 398px -> travel 0px
 *
 * A control with zero travel cannot be dragged, however correct the pointer
 * handling is. Every "the bar won't move" report traces to that one CSS
 * declaration. Narrowing the pill (see `--fabnav-w`) is a PREREQUISITE for
 * the feature, not a cosmetic choice made alongside it.
 *
 * POSITION MODEL — EDGES AND RATIOS, NOT PIXELS
 * The bar is stored as { edge, x, y }:
 *
 *   edge = which horizontal side the bar is docked to
 *   x    = 0..1, the fraction of the horizontal travel already covered,
 *          measured FROM the docked edge TOWARD the opposite edge
 *   y    = 0..1, the fraction of the vertical travel covered, measured from
 *          the top of the usable band downward
 *
 * So { x: 0 } always means "hard against the edge named by `edge`", and the
 * two edges are mirrors: {left, 0.25} and {right, 0.25} sit the same distance
 * from their own edge. That is what makes the bar land symmetrically whichever
 * way it is dropped.
 *
 * Storing ratios rather than pixels is what makes the position survive an
 * orientation change: a stored `x: 340px` is meaningless on a landscape
 * viewport, whereas a ratio re-clamps onto the new width and lands somewhere
 * legal on its own. It also keeps the safe-area insets — measurable only at
 * runtime — out of persisted state.
 */

/** Which horizontal side the bar is docked to. */
export type Edge = "left" | "right";

/** A resting position. Every field is a ratio, never a pixel. */
export interface Dock {
  edge: Edge;
  /** 0..1 across the horizontal travel, from the docked edge inward. */
  x: number;
  /** 0..1 down the vertical travel, from the top of the usable band. */
  y: number;
}

/**
 * The space the bar may move through.
 *
 * `travelX`/`travelY` are MEASURED distances, not the viewport size. They are
 * read from the DOM at runtime because the bar's own width and the safe-area
 * insets are only known then — hard-coding them here is what produced the
 * zero-travel bug in the first place.
 */
export interface Track {
  /** Px the bar's left edge may travel between the two margins. */
  travelX: number;
  /** Px the bar's top edge may travel within the vertical band. */
  travelY: number;
}

/** The default position: centred horizontally, sitting at the bottom. */
export const DEFAULT_DOCK: Dock = { edge: "right", x: 0, y: 1 };

/** Keep a number inside a range; anything non-finite collapses to the minimum. */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Clamp a ratio into 0..1. */
function clampRatio(n: number): number {
  return clamp(n, 0, 1);
}

/**
 * The bar's left edge in px for a given dock.
 *
 * `x` is the fraction of travel already covered FROM the docked edge, so the
 * two edges are mirror images: `edge: "left"` walks rightward as x rises,
 * while `edge: "right"` walks leftward. Both branches reduce to the same
 * shape, which is what makes them exactly symmetrical.
 *
 *   {left,  x: 0} -> left margin      {right, x: 0} -> right margin
 *   {left,  x: 1} -> right margin     {right, x: 1} -> left margin
 */
export function leftFor(dock: Dock, track: Track, minMargin: number): number {
  const x = clampRatio(dock.x);
  return dock.edge === "left"
    ? minMargin + x * track.travelX
    : minMargin + (1 - x) * track.travelX;
}

/** The bar's top edge in px for a given dock. */
export function topFor(dock: Dock, track: Track, topInset: number): number {
  return topInset + clampRatio(dock.y) * track.travelY;
}

/**
 * Convert a live pointer position into a dock, preserving the grab offset.
 *
 * `grabOffsetX/Y` is how far into the bar the finger landed. Without it the
 * bar would snap its own left edge to the finger and jump by that offset the
 * instant it was picked up — the most common way a drag implementation feels
 * broken, and the reason `pointerdown` records the offset rather than waiting
 * for the first `pointermove`.
 */
export function dockFromPointer(
  pointerX: number,
  pointerY: number,
  grabOffsetX: number,
  grabOffsetY: number,
  track: Track,
  insets: { minMargin: number; topInset: number },
): Dock {
  // Distance from the left margin: the shared origin for both edges.
  const rawX = pointerX - grabOffsetX - insets.minMargin;
  const rawY = pointerY - grabOffsetY - insets.topInset;

  const x = clampRatio(track.travelX > 0 ? rawX / track.travelX : 0);
  const y = clampRatio(track.travelY > 0 ? rawY / track.travelY : 0);

  // Pick the edge by which side of the travel band the bar ended up on, NOT
  // by the direction the finger is moving. A user who drags past the middle
  // and back again gets the origin side again, which is what every native
  // dock does; deciding on velocity would make the bar jump about under the
  // finger. With no travel there is no "side", so the bar cannot change.
  const edge: Edge = track.travelX > 0 && rawX > track.travelX / 2 ? "right" : "left";
  // `x` runs from the docked edge inward, so mirror it when docked right.
  return { edge, x: edge === "left" ? x : 1 - x, y };
}

/**
 * The dock a released bar settles into.
 *
 * `velocityX` is the last measured drag speed in px/ms, signed with the
 * finger. A deliberate flick carries the bar flush to the edge it was heading
 * for even if the finger stopped short, which is what makes a short sharp
 * throw feel responsive rather than obedient. The vertical position is kept.
 */
export function settle(dock: Dock, velocityX: number, track: Track): Dock {
  if (track.travelX > 0 && Math.abs(velocityX) > 0.35) {
    // Positive velocity means the finger moved right, so the bar is thrown
    // towards the right-hand side.
    return { edge: velocityX > 0 ? "right" : "left", x: 0, y: dock.y };
  }
  return dock;
}

/**
 * Validate a dock that came from storage.
 *
 * Anything unrecognised — a key removed by an older build, a hand-edited
 * value, a `null` written by a crash — falls back to the default rather than
 * throwing or stranding the bar off-screen. Persistence is a convenience and
 * must never be able to brick the navigation.
 */
export function parseDock(raw: string | null): Dock {
  if (!raw) return DEFAULT_DOCK;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return DEFAULT_DOCK;
    const o = v as Record<string, unknown>;
    if (o.edge !== "left" && o.edge !== "right") return DEFAULT_DOCK;
    // Every field must be present AND a finite number. A half-written record
    // is treated as absent rather than silently completed, so a partially
    // persisted value cannot masquerade as a real position.
    if (typeof o.x !== "number" || typeof o.y !== "number") return DEFAULT_DOCK;
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return DEFAULT_DOCK;
    // Clamped rather than rejected: a stale ratio of 4 still expresses "the
    // user pushed it all the way", and honouring that beats silently snapping
    // them back to the middle.
    return { edge: o.edge, x: clampRatio(o.x), y: clampRatio(o.y) };
  } catch {
    return DEFAULT_DOCK;
  }
}

/** Serialise for storage. Tiny and version-free on purpose. */
export function serialiseDock(dock: Dock): string {
  return JSON.stringify({ edge: dock.edge, x: dock.x, y: dock.y });
}

/**
 * Whether a movement should be read as a drag rather than a tap.
 *
 * Below this the gesture stays a tap, so a slightly shaky finger opens a
 * destination instead of shoving the navigation around. 8px is chosen because
 * ordinary thumb tremor during a tap is smaller than it, while a real thumb
 * sweep is several times larger — the threshold sits comfortably between.
 */
export const DRAG_THRESHOLD_PX = 8;

/**
 * How long the finger must rest before a press becomes a drag, in ms.
 *
 * IMPORTANT — THIS IS NOW PLATFORM-DEPENDENT, AND THAT IS THE POINT.
 * An earlier version used a single flat 320ms for every platform, chosen so a
 * deliberate press would be unambiguous. On iOS that was actively harmful:
 *
 *  - WebKit shows its "Open in New Tab / Add to Home Screen" callout after a
 *    stationary press on a LINK, at roughly 500ms.
 *  - The bar is five real `<a href>` elements, so a press-and-hold lands on
 *    one by construction.
 *  - The callout fires `pointercancel`, which ends the gesture before the drag
 *    can start. The user sees a context menu, not a moving bar.
 *
 * So the hold exists only to disambiguate on platforms that need it, and iOS
 * gets a much shorter one. iOS is safe with a short hold because
 * `-webkit-touch-callout: none` (see theme.css) removes the callout entirely;
 * the grace window below then covers a slightly slow first move.
 *
 * Do not raise the iOS value. It is the one number standing between a working
 * drag and a context menu on the platform where it failed first.
 */
export const HOLD_MS = 320;

/** The hold used on iOS/iPadOS, where a long press raises a link callout. */
export const HOLD_MS_IOS = 90;

/**
 * Pick the hold duration for the current platform.
 *
 * Detection is by capability, not user-agent string: iPadOS 13+ reports as
 * Macintosh, so a UA test would miss exactly the devices most likely to be
 * held in landscape with a keyboard. `navigator.maxTouchPoints > 1` alongside
 * a Mac platform is the standard, durable way to spot it.
 */
export function holdMsFor(nav: { platform?: string; maxTouchPoints?: number } | undefined): number {
  const p = typeof nav?.platform === "string" ? nav.platform : "";
  const touch = nav?.maxTouchPoints ?? 0;
  const isIPhone = /iPhone|iPod/.test(p);
  // iPadOS 13+ masquerades as "MacIntel" but is still touch-capable.
  const isIPad = /Mac/i.test(p) && touch > 1;
  return isIPhone || isIPad ? HOLD_MS_IOS : HOLD_MS;
}

/**
 * A short window after the drag starts during which the bar still tracks the
 * finger, before a move is finally treated as a navigation swipe.
 *
 * Without it, the first `pointermove` after the hold fires would immediately
 * be classified as a swipe, because `onPointerMove` checks the axis as soon as
 * the finger has travelled DRAG_THRESHOLD_PX. On iOS that window is also the
 * period where the very first move event tends to be large, so the gesture
 * could flip back out of the drag on its first frame.
 */
export const DRAG_GRACE_MS = 90;
