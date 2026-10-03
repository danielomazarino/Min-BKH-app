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
 * POSITION MODEL — A SINGLE VERTICAL RATIO
 * The bar is stored as { y } and nothing else. It is ALWAYS horizontally
 * centred; the only freedom is how far up or down it may sit.
 *
 * The bar used to be dockable to the left or right edge, which needed an
 * `Edge` union, a mirrored `x`, a midpoint decision and a velocity snap. All
 * of that was deleted rather than left dormant — dead branches in gesture code
 * are exactly how the previous bug stayed hidden — because a fixed centring
 * makes none of it reachable.
 *
 * The zero-travel bug that started all of this also had a HORIZONTAL cause
 * (the pill exactly filled the band), and it is fixed by centring rather than
 * by narrowing: the bar is now `min(260px, 100% - 2 x --fabnav-gap)`, which
 * leaves room for the CONTENT of the pill while removing the freedom to move
 * sideways. So `--fabnav-min-travel` no longer has a purpose and the
 * horizontal travel numbers are gone from the tests too.
 *
 * Storing a ratio rather than a pixel is what makes the position survive an
 * orientation change: a stored `top: 340px` is meaningless on a landscape
 * viewport, whereas a ratio re-clamps onto the new height and lands somewhere
 * legal on its own. It also keeps the safe-area insets — measurable only at
 * runtime — out of persisted state.
 */

/**
 * A resting position. The bar is ALWAYS horizontally centred, so this is a
 * single ratio.
 *
 * WHY THERE IS NO `edge` AND NO `x` ANY MORE
 * The bar was originally dockable to the left or right edge. It is now fixed
 * horizontally, by requirement, so the entire edge/snap model was dead weight:
 * an `Edge` union, a mirrored `x`, a midpoint decision, and a velocity snap
 * that could fling the bar to a side. All of that is deleted rather than left
 * dormant, because dead branches in gesture code are how the last bug hid.
 */
export interface Dock {
  /** 0..1 down the vertical travel, from the top of the usable band. */
  y: number;
}

/**
 * The space the bar may move through.
 *
 * `travelY` is a MEASURED distance, not the viewport size. It is read from the
 * DOM at runtime because the safe-area insets are only known then — hard-coding
 * it here is what produced the zero-travel bug in the first place.
 */
export interface Track {
  /** Px the bar's top edge may travel within the vertical band. */
  travelY: number;
}

/** The default position: horizontally centred, resting at the bottom. */
export const DEFAULT_DOCK: Dock = { y: 1 };

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
 * The bar's left edge in px.
 *
 * Purely centring — the bar has no horizontal freedom at all, so this is a
 * single expression rather than a dock calculation. Kept here so the
 * component never has to know the width or the margins.
 */
export function leftFor(navWidth: number, barWidth: number): number {
  return (navWidth - barWidth) / 2;
}

/** The bar's top edge in px for a given dock. */
export function topFor(dock: Dock, track: Track, topInset: number): number {
  return topInset + clampRatio(dock.y) * track.travelY;
}

/**
 * Convert a live pointer position into a dock, preserving the grab offset.
 *
 * `grabOffsetY` is how far into the bar the finger landed. Without it the bar
 * would snap its own top edge to the finger and jump by that offset the instant
 * it was picked up — the most common way a drag implementation feels broken,
 * and the reason `pointerdown` records the offset rather than waiting for the
 * first `pointermove`.
 */
export function dockFromPointer(
  pointerY: number,
  grabOffsetY: number,
  track: Track,
  insets: { topInset: number },
): Dock {
  const rawY = pointerY - grabOffsetY - insets.topInset;
  return { y: clampRatio(track.travelY > 0 ? rawY / track.travelY : 1) };
}

/**
 * The dock a released bar settles into.
 *
 * There is deliberately NO snapping. A vertical bar rests exactly where it was
 * dropped: there are no edges to snap to, and snapping to a nearest preset
 * would make the bar jump away from a finger that stopped deliberately.
 */
export function settle(dock: Dock): Dock {
  return dock;
}

/**
 * Validate a dock that came from storage.
 *
 * Anything unrecognised — a key removed by an older build, a hand-edited
 * value, a `null` written by a crash — falls back to the default rather than
 * throwing or stranding the bar off-screen. Persistence is a convenience and
 * must never be able to brick the navigation.
 *
 * A stored record from the OLD edge-based format has no `y`, so it is rejected
 * and the bar returns to bottom-centre. That is the correct outcome: the old
 * horizontal position is meaningless now, and guessing at it could strand the
 * bar partly off-screen.
 */
export function parseDock(raw: string | null): Dock {
  if (!raw) return DEFAULT_DOCK;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return DEFAULT_DOCK;
    const o = v as Record<string, unknown>;
    if (typeof o.y !== "number" || !Number.isFinite(o.y)) return DEFAULT_DOCK;
    // Clamped rather than rejected: a stale ratio of 4 still expresses "the
    // user pushed it all the way", and honouring that beats silently snapping
    // them back to the middle.
    return { y: clampRatio(o.y) };
  } catch {
    return DEFAULT_DOCK;
  }
}

/** Serialise for storage. Tiny and version-free on purpose. */
export function serialiseDock(dock: Dock): string {
  return JSON.stringify({ y: dock.y });
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
 * ===================================================================
 * THIS FUNCTION WAS REBUILT AFTER BEING PROVEN WRONG IN WEBKIT.
 * ===================================================================
 *
 * The first version asked "is this iOS?" and answered with a LONG hold for
 * everything else. Running the real app in WebKit on Linux showed that
 * question cannot be answered reliably:
 *
 *   navigator.platform = "Linux x86_64"      <-- even with an iPhone UA
 *   navigator.maxTouchPoints = 0
 *   => both regexes false => LONG hold chosen
 *
 * and the drag then failed outright. Measured in WebKit, holding before the
 * first move:
 *
 *   hold 140ms -> not lifted, moved 0px   (FAILED)
 *   hold 200ms -> not lifted, moved 0px   (FAILED)
 *   hold 350ms -> lifted,     moved 98px  (worked)
 *
 * A detection failure here is not cosmetic: the user gets NO drag at all,
 * silently, and every test that waits long enough still passes. That is a
 * worse failure than either hold value on its own.
 *
 * THE FIX — INVERT THE QUESTION. Instead of "is this iOS?", ask:
 *
 *   "is this a pointer-FINE device that can afford a long hold?"
 *
 * A desktop mouse can: it has a physical cursor, no callout, and no risk of
 * a thumb resting on it by accident. A TOUCH device cannot afford 320ms,
 * because that is squarely inside the window where WebKit raises the link
 * callout. So:
 *
 *   touch input  -> SHORT hold (safe everywhere: the callout is suppressed in
 *                   CSS regardless of platform)
 *   fine pointer -> LONG hold (safe: no callout exists)
 *
 * This is strictly safer than the old shape. The dangerous case — a long hold
 * on a touch device — is now unreachable by construction rather than by
 * correctly identifying one platform. Getting the platform wrong can no
 * longer break the drag; it can only pick the less convenient of two
 * workable timings.
 *
 * The touch test uses `pointerType` rather than `maxTouchPoints`, because the
 * former describes the ACTUAL input and the latter only describes the
 * hardware. A touchscreen laptop with a mouse is the awkward case, and it is
 * handled correctly: mouse input still gets the long hold.
 */
export function holdMsFor(
  input: { type?: string; maxTouchPoints?: number } | undefined,
  pointerType?: string,
): number {
  // The live input is the strongest signal available: it describes what the
  // finger or cursor is actually doing right now.
  if (pointerType === "touch" || pointerType === "pen") return HOLD_MS_IOS;
  // An EXPLICIT fine pointer settles it: a mouse is a fine pointer whatever
  // the hardware says. Without this early return the touchscreen-laptop case
  // fell through to the `maxTouchPoints` check and wrongly got the short hold.
  if (pointerType === "mouse") return HOLD_MS;
  if (typeof input?.type === "string" && input.type === "touch") return HOLD_MS_IOS;
  // No live pointer type supplied at all: fall back to the hardware.
  return (input?.maxTouchPoints ?? 0) > 0 ? HOLD_MS_IOS : HOLD_MS;
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
