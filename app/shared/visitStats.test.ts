import { describe, expect, it, beforeEach } from "vitest";
import {
  recordVisit,
  readVisitStats,
  totalsFor,
  activeDays,
  clearVisitStats,
  dayLabel,
} from "./visitStats";

/**
 * The visit recorder is the most disposable data in the app, and its failure
 * modes matter more than its features: a full or blocked localStorage must
 * never break navigation, and sheets must never be counted as visits.
 */
function setupStore(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
  });
  return store;
}

beforeEach(() => {
  setupStore();
  clearVisitStats();
});

describe("recordVisit", () => {
  it("counts the five destinations under their Swedish names", () => {
    recordVisit("/");
    recordVisit("/nyheter");
    recordVisit("/");
    const totals = totalsFor(readVisitStats());
    expect(totals["Hem"]).toBe(2);
    expect(totals["Nyheter"]).toBe(1);
  });

  it("ignores sheets and unknown paths — overlays are not visits", () => {
    recordVisit("/installningar");
    recordVisit("/matcher?id=123");
    recordVisit("/hittades-inte");
    expect(readVisitStats().days).toHaveLength(0);
  });

  it("groups by local day", () => {
    recordVisit("/");
    const days = readVisitStats().days;
    expect(days).toHaveLength(1);
    expect(days[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("caps a single day so a navigation loop cannot fill storage", () => {
    for (let i = 0; i < 600; i++) recordVisit("/");
    const day = readVisitStats().days[0];
    expect(Object.values(day.counts).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(500);
  });

  it("keeps only the newest 90 days", () => {
    // Simulate by writing directly: 95 pre-existing days, then a new visit.
    const store = setupStore();
    const days = Array.from({ length: 95 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (95 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { day: key, counts: { Hem: 1 } };
    });
    store.set("minbkh-visits-v1", JSON.stringify({ days }));
    recordVisit("/");
    expect(readVisitStats().days).toHaveLength(90);
  });
});

describe("failure tolerance", () => {
  it("a throwing localStorage never breaks recording", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("full");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
      configurable: true,
    });
    expect(() => recordVisit("/")).not.toThrow();
    expect(() => readVisitStats()).not.toThrow();
    expect(() => clearVisitStats()).not.toThrow();
  });

  it("corrupt stored JSON reads as empty, not as a crash", () => {
    setupStore().set("minbkh-visits-v1", "{not json");
    expect(readVisitStats().days).toEqual([]);
    expect(() => recordVisit("/")).not.toThrow();
  });
});

describe("display helpers", () => {
  it("activeDays counts only days with at least one visit", () => {
    const stats = readVisitStats();
    recordVisit("/");
    expect(activeDays(readVisitStats())).toBe(1);
    expect(activeDays(stats)).toBe(0);
  });

  it("dayLabel renders a Swedish short date", () => {
    expect(dayLabel("2026-10-12")).toMatch(/okt/);
  });
});
