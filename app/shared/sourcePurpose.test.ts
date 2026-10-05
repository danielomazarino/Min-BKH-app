import { describe, expect, it } from "vitest";
import {
  DESCRIBED_SOURCES,
  hasPurpose,
  sourcePurpose,
} from "./sourcePurpose";

/**
 * The publisher list the PIPELINE actually fetches.
 *
 * Duplicated here on purpose rather than imported. `run.ts` has module-level
 * side effects (it builds a pipeline and reads config), so importing it into a
 * unit test would test the pipeline's side effects instead of this file. The
 * duplication is the assertion: when someone adds a ninth feed, this list
 * stops matching and the test below fails, which is the point.
 *
 * If that failure is annoying, the correct fix is to describe the new source —
 * not to loosen the test.
 */
const LIVE_PUBLISHERS = [
  "BK Häcken",
  "Sportbladet",
  "Expressen",
  "SVT Sport",
  "Bollsvenskan",
  "Allsvenskan",
  "Fotbolltransfers",
  "Göteborgs-Posten",
];

/** The non-feed services that appear in a real run's measurement log. */
const LIVE_SERVICES = ["article-text", "sportomedia", "gemini", "openrouter"];

describe("sourcePurpose", () => {
  it("describes every feed the pipeline actually fetches", () => {
    // A new feed with no description would render as a generic row that says
    // "not described here yet" — technically safe, but it is a silent gap.
    // Fail loudly instead.
    const undescribed = LIVE_PUBLISHERS.filter((p) => !hasPurpose(p));
    expect(undescribed).toEqual([]);
  });

  it("describes every non-feed service in a real run", () => {
    const undescribed = LIVE_SERVICES.filter((s) => !hasPurpose(s));
    expect(undescribed).toEqual([]);
  });

  it("marks OpenRouter as measure-only and nothing else", () => {
    // This is the distinction the whole panel rests on: OpenRouter runs and
    // its answer is discarded. If another provider were silently mislabelled
    // the app would claim its output reaches supporters when it does not.
    expect(sourcePurpose("openrouter").measureOnly).toBe(true);
    for (const key of DESCRIBED_SOURCES) {
      if (key === "openrouter") continue;
      expect(sourcePurpose(key).measureOnly).toBeFalsy();
    }
  });

  it("resolves the rss: prefix used by the measurement log", () => {
    // The log keys feeds as `rss:Sportbladet`; the counts map keys them as
    // `Sportbladet`. Both must resolve to the same text, or the same source
    // would be described two different ways in one screen.
    expect(sourcePurpose("rss:Sportbladet")).toBe(sourcePurpose("Sportbladet"));
  });

  it("never returns an empty explanation, even for an unknown source", () => {
    // A blank row would look like a rendering bug rather than a missing
    // description. The fallback must always say something true.
    for (const key of ["", "rss:", "rss:unknown", "something-new", "x".repeat(200)]) {
      expect(sourcePurpose(key).what.length).toBeGreaterThan(10);
      expect(sourcePurpose(key).ifBroken.length).toBeGreaterThan(10);
    }
  });

  it("does not invent a purpose for a near-miss name", () => {
    // Case-insensitive or fuzzy matching would show one source's purpose
    // beside another source's name. That is worse than the fallback.
    expect(hasPurpose("sportbladet")).toBe(false);
    expect(hasPurpose("Sportbladet Fotboll")).toBe(false);
    expect(sourcePurpose("sportbladet")).toBe(sourcePurpose("rss:totally-unknown"));
  });

  it("says what breaks, not merely that something breaks", () => {
    // "Om den går sönder fungerar inget" tells the reader nothing they can act
    // on. Each entry must name a consequence — either a specific loss, or an
    // explicit statement that the app is unaffected. Both are honest answers;
    // "den fungerar inte" is not.
    for (const key of DESCRIBED_SOURCES) {
      const { ifBroken } = sourcePurpose(key);
      expect(ifBroken).toMatch(/påverkan|kan inte|står kvar|visar inte/i);
    }
  });
});