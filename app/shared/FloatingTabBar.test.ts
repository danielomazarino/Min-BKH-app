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
