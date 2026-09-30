/**
 * Offline tests for the per-source news ingest diagnostics.
 *
 * WHY THESE MATTER
 *   `freshness.sourceStatus` reports a source "ok" whether it contributed 20
 *   articles or none, and the nightly log's total drop count cannot be
 *   attributed to a source. Together those two signals were ambiguous: a
 *   source that fetched successfully and contributed nothing looked
 *   identical to one feeding the pipeline normally. Diagnosing B-006 took
 *   hours for exactly that reason.
 *
 * NO NETWORK, NO GEMINI
 *   The reporting logic lives in `ingestDiagnostics.ts` rather than `run.ts`
 *   because `run.ts` calls `main()` at module scope — importing it would
 *   execute the live pipeline. These tests therefore import only pure
 *   functions and hand them plain objects.
 */
import { describe, expect, it } from "vitest";
import {
  buildSourceBreakdown,
  formatSourceBreakdown,
  MEN_EXCLUDED_REASON,
} from "./ingestDiagnostics";

const item = (url: string, publisher: string) => ({ url, publisher });

describe("per-source ingest breakdown", () => {
  it("attributes fetches, keeps and drops to each source", () => {
    // BK Häcken: 3 fetched, 1 kept, 2 dropped. Sportbladet: 2 fetched, 1 kept.
    const fetched = [
      item("a1", "BK Häcken"),
      item("a2", "BK Häcken"),
      item("a3", "BK Häcken"),
      item("b1", "Sportbladet"),
      item("b2", "Sportbladet"),
    ];
    const rows = buildSourceBreakdown(
      fetched,
      new Set(["a1", "b1"]),
      [
        { url: "a2", reason: "outside date window" },
        { url: "a3", reason: "no Häcken relation" },
        { url: "b2", reason: "advertisement" },
      ],
      [],
    );

    const h = rows.find((r) => r.publisher === "BK Häcken")!;
    expect(h).toMatchObject({ fetched: 3, kept: 1, dropped: 2, zeroContribution: false });
    expect(h.reasons).toEqual({ "outside date window": 1, "no Häcken relation": 1 });

    const s = rows.find((r) => r.publisher === "Sportbladet")!;
    expect(s).toMatchObject({ fetched: 2, kept: 1, dropped: 1 });
  });

  // THE CASE THAT MATTERS: a healthy source that contributes NOTHING must be
  // unmistakable. `sourceStatus` says "ok" for this source, so without
  // zeroContribution the log would read as though it were working fine.
  it("flags a source that fetched items but contributed none", () => {
    const fetched = [
      item("gp1", "Göteborgs-Posten"),
      item("gp2", "Göteborgs-Posten"),
      item("gp3", "Göteborgs-Posten"),
      item("a1", "BK Häcken"),
    ];
    const rows = buildSourceBreakdown(
      fetched,
      new Set(["a1"]),
      [
        { url: "gp1", reason: "no Häcken relation" },
        { url: "gp2", reason: "general allsvenskan, no Häcken relation" },
        { url: "gp3", reason: "outside date window" },
      ],
      [],
    );

    const gp = rows.find((r) => r.publisher === "Göteborgs-Posten")!;
    expect(gp.fetched).toBe(3);
    expect(gp.kept).toBe(0);
    expect(gp.zeroContribution).toBe(true);
    expect(Object.keys(gp.reasons).sort()).toEqual([
      "general allsvenskan, no Häcken relation",
      "no Häcken relation",
      "outside date window",
    ]);

    // And it is visible in the rendered output, not just the data.
    const text = formatSourceBreakdown(rows).join("\n");
    expect(text).toContain("ZERO CONTRIBUTED");
    expect(text).toContain("Göteborgs-Posten");
    expect(text).toMatch(/1 source\(s\) returned items but contributed NOTHING/);
  });

  it("does not flag a source that was never fetched at all", () => {
    // Zero fetched items is a different problem from zero contribution, and
    // must not be reported as the latter.
    const rows = buildSourceBreakdown([item("a1", "BK Häcken")], new Set(["a1"]), [], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].zeroContribution).toBe(false);
  });

  it("counts items removed as not men's-team news as a distinct reason", () => {
    const fetched = [item("w1", "BK Häcken"), item("a1", "BK Häcken")];
    const rows = buildSourceBreakdown(
      fetched,
      new Set(["a1"]),
      [],
      ["w1"], // passed prefilter, removed by menRelevantNews
    );
    const h = rows.find((r) => r.publisher === "BK Häcken")!;
    expect(h).toMatchObject({ fetched: 2, kept: 1, dropped: 1 });
    expect(h.reasons[MEN_EXCLUDED_REASON]).toBe(1);
    // fetched == kept + dropped, so per-source lines reconcile.
    expect(h.kept + h.dropped).toBe(h.fetched);
  });

  it("keeps totals honest when a dropped URL matches no fetched item", () => {
    // A URL with no fetched item behind it cannot be attributed. It must still
    // be counted, under an explicit bucket, rather than vanishing.
    const rows = buildSourceBreakdown(
      [item("a1", "BK Häcken")],
      new Set(["a1"]),
      [{ url: "ghost", reason: "no Häcken relation" }],
      [],
    );
    const unattributed = rows.find((r) => r.publisher === "(unattributed)")!;
    expect(unattributed).toMatchObject({ fetched: 0, kept: 0, dropped: 1 });
    expect(rows.reduce((n, r) => n + r.dropped, 0)).toBe(1);
  });

  it("never lets kept + dropped undercount fetched", () => {
    // An item that is neither kept nor reported dropped would silently vanish
    // from the arithmetic; it must land in an explicit bucket instead.
    const rows = buildSourceBreakdown(
      [item("a1", "BK Häcken"), item("a2", "BK Häcken")],
      new Set(["a1"]),
      [],
      [],
    );
    const h = rows[0];
    expect(h.kept + h.dropped).toBe(h.fetched);
    expect(h.reasons["unaccounted"]).toBe(1);
  });

  it("renders one line per source plus a summary, not a line per article", () => {
    const fetched = Array.from({ length: 50 }, (_, i) => item(`a${i}`, "BK Häcken"));
    const dropped = fetched.slice(5).map((f) => ({ url: f.url, reason: "no Häcken relation" }));
    const rows = buildSourceBreakdown(fetched, new Set(fetched.slice(0, 5).map((f) => f.url)), dropped, []);
    const lines = formatSourceBreakdown(rows);
    // 1 source line + 1 summary line, regardless of article volume.
    expect(lines).toHaveLength(2);
    // One line per SOURCE, not per article: 50 items collapse to a single row.
    expect(lines[0]).toContain("BK Häcken  fetched  50");
    expect(lines[0]).toContain("kept   5");
    expect(lines[0]).toContain("dropped  45");
    expect(lines[0]).toContain("(no Häcken relation 45)");
    expect(lines[1]).toContain("1 sources, 50 fetched, 5 kept");
    expect(lines[1]).toContain("dropped");
  });
});
