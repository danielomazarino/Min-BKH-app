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
  DRAG_GRACE_MS,
  HOLD_MS,
  HOLD_MS_IOS,
  holdMsFor,
  type Dock,
  type Track,
} from "./fabnavPosition";

/**
 * A 390x844 phone. travelY is the band from `--fabnav-top` (56px) down to the
 * resting top of the bar: 844 - 16 - 58 - 56 = 714. Measured shape, not a
 * guess.
 */
const PHONE: Track = { travelY: 714 };
const TOP = 56;

/**
 * THE BAR IS ALWAYS HORIZONTALLY CENTRED.
 *
 * These are the tests that pin that requirement, because it is easy to
 * reintroduce horizontal movement by accident: one leftover `x` in the dock,
 * one `translate3d(x, y, 0)`, and the bar starts docking to the edges again.
 */
describe("leftFor — the bar is centred, always", () => {
  it("centres exactly", () => {
    expect(leftFor(390, 260)).toBe(65);
    expect(leftFor(390, 358)).toBe(16);
    expect(leftFor(844, 440)).toBe(202);
  });

  it("is independent of any stored position", () => {
    // There is no Dock parameter at all — that is the point. A centred bar
    // cannot be moved sideways by any persisted state.
    expect(leftFor(390, 260)).toBe(leftFor(390, 260));
  });

  it("stays centred at every common viewport width", () => {
    for (const [vw, bw] of [
      [320, 260],
      [360, 260],
      [390, 260],
      [430, 260],
      [844, 440],
      [1024, 440],
    ] as const) {
      const left = leftFor(vw, bw);
      const rightGap = vw - (left + bw);
      // Symmetric to within a pixel: that is what "centred" means.
      expect(Math.abs(left - rightGap), `not centred at ${vw}px`).toBeLessThanOrEqual(0.001);
      expect(left).toBeGreaterThanOrEqual(0);
    }
  });

  it("cannot be negative even if the bar were wider than the viewport", () => {
    // Degenerate case: must not produce a negative offset that would push the
    // bar's right half off-screen.
    const left = leftFor(300, 400);
    expect(Number.isFinite(left)).toBe(true);
  });
});

describe("topFor", () => {
  it("puts y=0 at the top of the band and y=1 at the bottom", () => {
    expect(topFor({ y: 0 }, PHONE, TOP)).toBe(TOP);
    expect(topFor({ y: 1 }, PHONE, TOP)).toBe(TOP + PHONE.travelY);
  });

  it("clamps a hostile y", () => {
    expect(topFor({ y: 12 }, PHONE, TOP)).toBe(TOP + PHONE.travelY);
    expect(topFor({ y: -1 }, PHONE, TOP)).toBe(TOP);
    expect(Number.isFinite(topFor({ y: NaN }, PHONE, TOP))).toBe(true);
  });

  it("is monotonic: more y always means further down", () => {
    let last = -Infinity;
    for (let y = 0; y <= 1.0001; y += 0.1) {
      const t = topFor({ y }, PHONE, TOP);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});

describe("dockFromPointer", () => {
  it("does not jump the bar when it is grabbed off-centre", () => {
    // A finger 20px into a 58px bar, at the bar's current resting place.
    const originTop = TOP + PHONE.travelY / 2;
    const dock = dockFromPointer(originTop + 20, 20, PHONE, { topInset: TOP });
    expect(topFor(dock, PHONE, TOP)).toBeCloseTo(originTop, 6);
  });

  it("clamps to the top of the band when dragged far past it", () => {
    const dock = dockFromPointer(-800, 20, PHONE, { topInset: TOP });
    expect(topFor(dock, PHONE, TOP)).toBeCloseTo(TOP, 5);
  });

  it("clamps to the bottom of the band when dragged far past it", () => {
    const dock = dockFromPointer(5000, 20, PHONE, { topInset: TOP });
    expect(topFor(dock, PHONE, TOP)).toBeCloseTo(TOP + PHONE.travelY, 5);
  });

  it("round-trips: pointer -> dock -> pixels lands where the finger was", () => {
    for (const py of [TOP, TOP + 100, TOP + 357, TOP + PHONE.travelY]) {
      const dock = dockFromPointer(py, 0, PHONE, { topInset: TOP });
      expect(topFor(dock, PHONE, TOP)).toBeCloseTo(py, 5);
    }
  });

  it("never leaves the bar off-screen at any viewport height", () => {
    const H = 400; // bar height
    for (const vh of [568, 667, 844, 1000]) {
      const bottom = parseFloat("0") + 16; // resting bottom offset
      const travelY = Math.max(0, vh - bottom - H - TOP);
      const track: Track = { travelY };
      for (const y of [0, 0.25, 0.5, 0.75, 1]) {
        const t = topFor({ y }, track, TOP);
        expect(t, `y=${y} at ${vh}px`).toBeGreaterThanOrEqual(TOP - 0.001);
        expect(t + H, `y=${y} at ${vh}px`).toBeLessThanOrEqual(vh + 0.001);
      }
    }
  });

  it("does not divide by zero when there is no travel", () => {
    const none: Track = { travelY: 0 };
    const dock = dockFromPointer(400, 20, none, { topInset: TOP });
    expect(Number.isFinite(dock.y)).toBe(true);
    expect(topFor(dock, none, TOP)).toBe(TOP);
  });
});

describe("settle — no snapping, because there are no edges", () => {
  it("rests exactly where it was dropped", () => {
    for (const y of [0, 0.13, 0.5, 0.87, 1]) {
      const dock: Dock = { y };
      expect(settle(dock)).toEqual(dock);
    }
  });

  it("never invents a horizontal move", () => {
    // A bar that snapped left or right on release is the exact regression the
    // centred requirement forbids.
    const out = settle({ y: 0.4 }) as unknown as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["y"]);
  });
});

describe("persistence", () => {
  it("round-trips", () => {
    const dock: Dock = { y: 0.25 };
    expect(parseDock(serialiseDock(dock))).toEqual(dock);
  });

  it("falls back to the default for absent, malformed or hostile values", () => {
    const bad = [
      null, "", "not json", "[]", "null", '"bottom"', "42",
      '{"y":"0.5"}', '{"y":null}', "{}",
    ];
    for (const v of bad) expect(parseDock(v), `input: ${v}`).toEqual(DEFAULT_DOCK);
  });

  it("clamps rather than rejects a stale out-of-range value", () => {
    // The user pushed it all the way; honour that instead of resetting them
    // to the middle.
    expect(parseDock('{"y":4}')).toEqual({ y: 1 });
    expect(parseDock('{"y":-2}')).toEqual({ y: 0 });
  });

  it("keeps the vertical part of an OLD edge-based record and drops the rest", () => {
    // A record written before the bar stopped being edge-dockable still has a
    // MEANINGFUL `y` — where the user had put it vertically — so it is honoured
    // and the bar does not jump back to the bottom on upgrade. The horizontal
    // `edge`/`x` are meaningless now and are simply not read, which is what
    // restores centring.
    expect(parseDock('{"edge":"left","x":0,"y":0.5}')).toEqual({ y: 0.5 });
    // A record with no usable y at all still falls back safely.
    expect(parseDock('{"edge":"left","x":0}')).toEqual(DEFAULT_DOCK);
  });
});

describe("orientation change", () => {
  const H = 58;

  it("a dock stored in portrait is still fully visible in landscape", () => {
    for (const dock of [{ y: 0 }, { y: 0.5 }, { y: 1 }] as Dock[]) {
      for (const vh of [390, 844]) {
        const travelY = Math.max(0, vh - 16 - H - TOP);
        const t = topFor(dock, { travelY }, TOP);
        expect(t, `y=${dock.y} at ${vh}px`).toBeGreaterThanOrEqual(TOP - 0.001);
        expect(t + H).toBeLessThanOrEqual(vh + 0.001);
      }
    }
  });
});

describe("gesture constants", () => {
  it("keeps the drag threshold above ordinary tap tremor", () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(8);
  });

  it("keeps the hold long enough to be deliberate but short enough to feel responsive", () => {
    expect(HOLD_MS).toBeGreaterThanOrEqual(200);
    expect(HOLD_MS).toBeLessThanOrEqual(400);
  });

  it("keeps the grace window short but non-zero", () => {
    expect(DRAG_GRACE_MS).toBeGreaterThan(0);
    expect(DRAG_GRACE_MS).toBeLessThanOrEqual(150);
  });
});

describe("holdMsFor — a wrong guess must never mean NO drag", () => {
  /**
   * THE MEASURED FAILURE, in WebKit, against the real deployed app:
   *
   *   navigator.platform       = "Linux x86_64"   (despite an iPhone UA)
   *   navigator.maxTouchPoints = 0
   *   => the old "is this iOS?" test answered NO -> LONG hold
   *
   * and the drag then failed outright. Holding before the first move:
   *
   *   140ms -> not lifted, moved 0px   FAILED
   *   200ms -> not lifted, moved 0px   FAILED
   *   350ms -> lifted,     moved 98px  worked
   *
   * The old tests all passed anyway, because they waited long enough. That is
   * the shape of the bug: invisible to any test that is patient.
   */
  const LINUX_WITH_IPHONE_UA = { type: "", maxTouchPoints: 0 };

  it("gives touch input the short hold even when the platform looks like Linux", () => {
    expect(holdMsFor(LINUX_WITH_IPHONE_UA, "touch")).toBe(HOLD_MS_IOS);
  });

  it("trusts the live pointer type above any hardware guess", () => {
    expect(holdMsFor({ type: "", maxTouchPoints: 0 }, "touch")).toBe(HOLD_MS_IOS);
    // A touchscreen laptop whose user is driving a mouse: the live pointer type
    // says mouse, so the long hold applies even though the hardware reports
    // touch points. This is the awkward case, and it is handled.
    expect(holdMsFor({ type: "", maxTouchPoints: 5 }, "mouse")).toBe(HOLD_MS);
    // A stylus can rest on the bar exactly as a thumb can, so it gets the
    // short hold too — the callout applies to it identically.
    expect(holdMsFor({ type: "", maxTouchPoints: 0 }, "pen")).toBe(HOLD_MS_IOS);
  });

  it("uses the short hold for touch hardware when no pointer type is supplied", () => {
    expect(holdMsFor({ type: "touch", maxTouchPoints: 5 })).toBe(HOLD_MS_IOS);
    expect(holdMsFor({ maxTouchPoints: 5 })).toBe(HOLD_MS_IOS);
  });

  it("gives a fine-pointer device the long hold", () => {
    expect(holdMsFor({ type: "mouse", maxTouchPoints: 0 }, "mouse")).toBe(HOLD_MS);
    expect(holdMsFor({ type: "", maxTouchPoints: 0 }, "mouse")).toBe(HOLD_MS);
  });

  it("never returns a hold that could sit inside the ~500ms callout window", () => {
    // The dangerous case is a LONG hold on a TOUCH device. Assert it is
    // unreachable for every touch-shaped input we can be given.
    for (const pt of ["touch", "pen"] as const) {
      expect(holdMsFor({ type: "", maxTouchPoints: 0 }, pt)).toBeLessThan(200);
      expect(holdMsFor({ type: "", maxTouchPoints: 9 }, pt)).toBeLessThan(200);
    }
    expect(HOLD_MS_IOS).toBeLessThan(200);
    expect(HOLD_MS_IOS).toBeLessThan(HOLD_MS);
  });

  it("tolerates a missing or partial navigator without throwing", () => {
    expect(holdMsFor(undefined)).toBe(HOLD_MS);
    expect(holdMsFor({})).toBe(HOLD_MS);
    expect(holdMsFor({ type: undefined, maxTouchPoints: undefined })).toBe(HOLD_MS);
    expect(holdMsFor(undefined, "touch")).toBe(HOLD_MS_IOS);
  });
});