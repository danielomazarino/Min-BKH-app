import { describe, it, expect } from "vitest";
import {
  leftFor,
  topFor,
  dockFromPointer,
  settle,
  parseDock,
  serialiseDock,
  DEFAULT_DOCK,
  DRAG_THRESHOLD_PX,
  HOLD_MS,
  type Dock,
  type Track,
} from "./fabnavPosition";

/**
 * A 390px phone with the pill NARROWED to 200px.
 * travelX = 390 - 200 - 32 = 158. These are measured, not guessed.
 */
const PHONE: Track = { travelX: 158, travelY: 694 };
/** A 320px phone: much less horizontal room. */
const SMALL: Track = { travelX: 88, travelY: 510 };
const MARGIN = 16;
const TOP = 72;

describe("leftFor", () => {
  it("puts x=0 hard against the docked edge", () => {
    // x is measured FROM the docked edge, so x=0 is flush against `edge`.
    expect(leftFor({ edge: "left", x: 0, y: 1 }, PHONE, MARGIN)).toBe(MARGIN);
    expect(leftFor({ edge: "right", x: 0, y: 1 }, PHONE, MARGIN)).toBe(MARGIN + PHONE.travelX);
  });

  it("puts x=1 hard against the opposite edge", () => {
    expect(leftFor({ edge: "left", x: 1, y: 1 }, PHONE, MARGIN)).toBe(MARGIN + PHONE.travelX);
    expect(leftFor({ edge: "right", x: 1, y: 1 }, PHONE, MARGIN)).toBe(MARGIN);
  });

  it("puts x=0.5 exactly in the middle of the travel band", () => {
    const expected = MARGIN + PHONE.travelX / 2;
    expect(leftFor({ edge: "right", x: 0.5, y: 1 }, PHONE, MARGIN)).toBe(expected);
    expect(leftFor({ edge: "left", x: 0.5, y: 1 }, PHONE, MARGIN)).toBe(expected);
  });

  it("is symmetric: the same x from either edge is a mirror image", () => {
    const a = leftFor({ edge: "right", x: 0.25, y: 0 }, PHONE, MARGIN);
    const b = leftFor({ edge: "left", x: 0.25, y: 0 }, PHONE, MARGIN);
    expect(a + b).toBeCloseTo(2 * MARGIN + PHONE.travelX, 6);
  });

  it("clamps an out-of-range x rather than escaping the viewport", () => {
    expect(leftFor({ edge: "right", x: 9, y: 0 }, PHONE, MARGIN)).toBe(
      leftFor({ edge: "right", x: 1, y: 0 }, PHONE, MARGIN),
    );
    expect(leftFor({ edge: "right", x: -4, y: 0 }, PHONE, MARGIN)).toBe(
      leftFor({ edge: "right", x: 0, y: 0 }, PHONE, MARGIN),
    );
  });

  it("survives a NaN x from corrupted storage", () => {
    expect(Number.isFinite(leftFor({ edge: "right", x: NaN, y: 0 }, PHONE, MARGIN))).toBe(true);
  });
});

describe("the bar can never leave the viewport", () => {
  const BAR = 200; // the narrowed pill width

  it("keeps the whole bar inside both margins at every position", () => {
    for (const track of [PHONE, SMALL]) {
      const viewport = track.travelX + BAR + MARGIN * 2;
      for (const edge of ["left", "right"] as const) {
        for (const x of [0, 0.25, 0.5, 0.75, 1]) {
          const left = leftFor({ edge, x, y: 0 }, track, MARGIN);
          expect(left).toBeGreaterThanOrEqual(MARGIN - 0.001);
          expect(left + BAR, `${edge} x=${x} overflows`).toBeLessThanOrEqual(viewport - MARGIN + 0.001);
        }
      }
    }
  });

  it("stays inside the safe area when the inset is wide (landscape notch)", () => {
    const inset = 44;
    const track: Track = { travelX: 200, travelY: 300 };
    expect(leftFor({ edge: "left", x: 0, y: 0 }, track, inset)).toBeGreaterThanOrEqual(inset - 0.001);
  });

  it("does not divide by zero when there is no travel at all", () => {
    // The pre-fix state: the bar exactly filled the band. Nothing may NaN.
    const none: Track = { travelX: 0, travelY: 0 };
    const dock = dockFromPointer(195, 400, 10, 10, none, { minMargin: MARGIN, topInset: TOP });
    expect(Number.isFinite(dock.x)).toBe(true);
    expect(Number.isFinite(dock.y)).toBe(true);
    expect(leftFor(dock, none, MARGIN)).toBe(MARGIN);
  });
});

describe("topFor", () => {
  it("puts y=0 at the top of the band and y=1 at the bottom", () => {
    expect(topFor({ edge: "right", x: 0, y: 0 }, PHONE, TOP)).toBe(TOP);
    expect(topFor({ edge: "right", x: 0, y: 1 }, PHONE, TOP)).toBe(TOP + PHONE.travelY);
  });

  it("clamps a hostile y", () => {
    expect(topFor({ edge: "right", x: 0, y: 12 }, PHONE, TOP)).toBe(TOP + PHONE.travelY);
    expect(topFor({ edge: "right", x: 0, y: -1 }, PHONE, TOP)).toBe(TOP);
  });
});

describe("dockFromPointer", () => {
  it("does not jump the bar when it is grabbed off-centre", () => {
    // A finger 100px into the bar, sitting at the bar's current resting place.
    const grabX = 100;
    const grabY = 20;
    const originLeft = MARGIN + PHONE.travelX / 2;
    const originTop = TOP + PHONE.travelY / 2;
    const dock = dockFromPointer(
      originLeft + grabX,
      originTop + grabY,
      grabX,
      grabY,
      PHONE,
      { minMargin: MARGIN, topInset: TOP },
    );
    // A pickup with no movement must not displace the bar at all.
    expect(leftFor(dock, PHONE, MARGIN)).toBeCloseTo(originLeft, 6);
    expect(topFor(dock, PHONE, TOP)).toBeCloseTo(originTop, 6);
  });

  it("clamps to the left margin when dragged far past the left edge", () => {
    const dock = dockFromPointer(-500, 400, 20, 20, PHONE, { minMargin: MARGIN, topInset: TOP });
    expect(leftFor(dock, PHONE, MARGIN)).toBeCloseTo(MARGIN, 5);
    expect(dock.edge).toBe("left");
  });

  it("clamps to the right margin when dragged far past the right edge", () => {
    const dock = dockFromPointer(2000, 400, 20, 20, PHONE, { minMargin: MARGIN, topInset: TOP });
    expect(leftFor(dock, PHONE, MARGIN)).toBeCloseTo(MARGIN + PHONE.travelX, 5);
    expect(dock.edge).toBe("right");
  });

  it("clamps vertically to the top of the band", () => {
    const dock = dockFromPointer(100, -400, 20, 20, PHONE, { minMargin: MARGIN, topInset: TOP });
    expect(topFor(dock, PHONE, TOP)).toBeCloseTo(TOP, 5);
  });

  it("round-trips: pointer -> dock -> pixels lands where the finger was", () => {
    // Only positions inside the legal band [MARGIN, MARGIN + travelX] can
    // round-trip; anything outside is deliberately clamped, which the two
    // clamp tests above cover.
    for (const px of [MARGIN, 60, 100, 140, MARGIN + PHONE.travelX]) {
      const dock = dockFromPointer(px, 400, 0, 0, PHONE, { minMargin: MARGIN, topInset: TOP });
      expect(leftFor(dock, PHONE, MARGIN)).toBeCloseTo(px, 5);
    }
  });

  it("picks the edge by midpoint, so dragging back returns the original side", () => {
    const at = (px: number) =>
      dockFromPointer(px, 400, 0, 0, PHONE, { minMargin: MARGIN, topInset: TOP }).edge;
    expect(at(300)).toBe("right");
    // Back left of the midpoint: "left" again, not "still right".
    expect(at(90)).toBe("left");
  });
});

describe("settle", () => {
  it("rests where it stopped when released slowly", () => {
    const dock: Dock = { edge: "left", x: 0.4, y: 0.5 };
    expect(settle(dock, 0.02, PHONE)).toEqual(dock);
  });

  it("a flick carries the bar flush to the edge it was thrown towards", () => {
    // Thrown right while still on the left: momentum wins.
    expect(settle({ edge: "left", x: 0.2, y: 0.5 }, 0.9, PHONE)).toEqual({ edge: "right", x: 0, y: 0.5 });
    // Thrown left from the right.
    expect(settle({ edge: "right", x: 0.8, y: 0.5 }, -0.9, PHONE)).toEqual({ edge: "left", x: 0, y: 0.5 });
  });

  it("keeps the vertical position when it snaps to an edge", () => {
    expect(settle({ edge: "left", x: 0.2, y: 0.3 }, 0.9, PHONE).y).toBe(0.3);
  });

  it("does not snap when there is no horizontal travel", () => {
    const none: Track = { travelX: 0, travelY: 694 };
    const dock: Dock = { edge: "right", x: 0, y: 0.5 };
    expect(settle(dock, 2, none)).toEqual(dock);
  });
});

describe("persistence", () => {
  it("round-trips", () => {
    const dock: Dock = { edge: "left", x: 0.25, y: 0.75 };
    expect(parseDock(serialiseDock(dock))).toEqual(dock);
  });

  it("falls back to the default for absent, malformed or hostile values", () => {
    const bad = [
      null, "", "not json", "[]", "null", '"left"', "42",
      '{"edge":"middle","x":0.5,"y":0.5}',
      '{"edge":"left"}',
      '{"edge":"left","x":"0.5","y":0.5}',
      '{"edge":"left","x":0.5,"y":null}',
    ];
    for (const v of bad) expect(parseDock(v), `input: ${v}`).toEqual(DEFAULT_DOCK);
  });

  it("clamps rather than rejects a stale out-of-range value", () => {
    // An older build could have written a larger ratio; the intent (pushed it
    // all the way over) is preserved instead of discarded.
    expect(parseDock('{"edge":"left","x":4,"y":9}')).toEqual({ edge: "left", x: 1, y: 1 });
    expect(parseDock('{"edge":"left","x":-2,"y":-1}')).toEqual({ edge: "left", x: 0, y: 0 });
  });
});

describe("orientation change", () => {
  const BAR = 200;

  it("a dock stored in portrait is still fully visible in landscape", () => {
    const landscape: Track = { travelX: 844 - BAR - MARGIN * 2, travelY: 300 };
    for (const dock of [
      { edge: "left", x: 0, y: 0 },
      { edge: "right", x: 0, y: 1 },
      { edge: "left", x: 0.5, y: 0.5 },
    ] as Dock[]) {
      const left = leftFor(dock, landscape, MARGIN);
      expect(left).toBeGreaterThanOrEqual(MARGIN - 0.001);
      expect(left + BAR).toBeLessThanOrEqual(844 - MARGIN + 0.001);
    }
  });

  it("every stored dock is valid at every common viewport width", () => {
    for (const dock of [
      { edge: "left", x: 0, y: 0 },
      { edge: "right", x: 0, y: 1 },
      { edge: "left", x: 0.5, y: 0.5 },
      { edge: "right", x: 1, y: 0 },
    ] as Dock[]) {
      for (const w of [320, 360, 390, 430, 768, 844, 1024]) {
        const bar = Math.min(220, w - MARGIN * 2);
        const track: Track = { travelX: Math.max(0, w - bar - MARGIN * 2), travelY: 400 };
        const left = leftFor(dock, track, MARGIN);
        expect(left, `w=${w} edge=${dock.edge}`).toBeGreaterThanOrEqual(MARGIN - 0.001);
        expect(left + bar).toBeLessThanOrEqual(w - MARGIN + 0.001);
      }
    }
  });
});

describe("gesture constants", () => {
  it("keeps the drag threshold above ordinary tap tremor", () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(8);
  });

  it("keeps the hold long enough to be deliberate but short enough to feel responsive", () => {
    // Under ~200ms users cannot tell they have started a press; over ~400ms it
    // starts to feel like a wait.
    expect(HOLD_MS).toBeGreaterThanOrEqual(200);
    expect(HOLD_MS).toBeLessThanOrEqual(400);
  });
});
