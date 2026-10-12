import { describe, expect, it } from "vitest";
import { WIKIMEDIA_USER_AGENT, wikimediaHeaders } from "./wikimediaHeaders";

/**
 * The regression this suite pins (measured 2026-10-12): Wikimedia returns a
 * hard 429 for requests without a User-Agent, and the pipeline's Node fetch
 * sends none by default. The infobox/summary/translation wrappers swallowed
 * those 429s into `null` and the nightly served degraded squad enrichment
 * (19 of 26 players lost career rows and wiki narratives). The UA header is
 * the fix; these tests make sure it stays on every request.
 */
describe("wikimediaHeaders", () => {
  it("always carries a descriptive User-Agent", () => {
    const h = wikimediaHeaders() as Record<string, string>;
    expect(h["User-Agent"]).toBe(WIKIMEDIA_USER_AGENT);
    expect(WIKIMEDIA_USER_AGENT).toMatch(/MinBkhApp/);
    expect(WIKIMEDIA_USER_AGENT).toMatch(/https:/);
  });

  it("always carries Accept: application/json", () => {
    const h = wikimediaHeaders() as Record<string, string>;
    expect(h["Accept"]).toBe("application/json");
  });

  it("preserves caller-supplied headers", () => {
    const h = wikimediaHeaders({ "X-Test": "1" }) as Record<string, string>;
    expect(h["X-Test"]).toBe("1");
  });

  it("the UA survives even when a caller also sets headers", () => {
    const h = wikimediaHeaders({ Accept: "text/html" }) as Record<string, string>;
    expect(h["User-Agent"]).toBe(WIKIMEDIA_USER_AGENT);
  });
});
