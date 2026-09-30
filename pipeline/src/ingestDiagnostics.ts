/**
 * Per-source news INGEST diagnostics for the nightly log.
 *
 * WHY THIS IS SEPARATE FROM `run.ts`
 *   `run.ts` calls `main()` at module scope (it is the pipeline entry point),
 *   so importing it from a test would execute the live pipeline — network
 *   fetches and all. The reporting logic therefore lives here as pure
 *   functions over data it is handed, and `run.ts` calls it. That keeps the
 *   arithmetic testable offline.
 *
 * WHAT THIS IS FOR
 *   The nightly log already had two signals, and together they were
 *   ambiguous: a TOTAL drop count, and a per-source "ok"/failed status in
 *   `freshness.sourceStatus`. A source could fetch successfully and
 *   contribute nothing, and the log could not tell that apart from a source
 *   feeding the pipeline normally. Diagnosing B-006 took hours for exactly
 *   this reason.
 *
 * THIS IS OBSERVABILITY ONLY
 *   Nothing here filters, mutates or reorders the arrays it is given. It
 *   reports them. A change that altered which articles survive would be a bug.
 */

export interface DroppedItem {
  url: string;
  reason: string;
}

/** One source's ingest outcome, as reported in the nightly log. */
export interface SourceBreakdown {
  publisher: string;
  fetched: number;
  kept: number;
  dropped: number;
  /** Drop counts keyed by the prefilter's stable reason string. */
  reasons: Record<string, number>;
  /**
   * True when the source returned items but none reached the Gemini stage.
   * This is the case `sourceStatus` reports as "ok" while the source silently
   * contributes nothing — invisible without this flag.
   */
  zeroContribution: boolean;
}

/** Reason recorded for items removed as not men's-team news. */
export const MEN_EXCLUDED_REASON = "not men's-team news";

/**
 * Attribute every fetched item to a source and account for it as kept or
 * dropped, with drops broken down by reason.
 *
 * `dropped` carries only `{ url, reason }`, so the publisher is recovered by
 * mapping the URL back to the item that produced it. `menExcludedUrls` are
 * items that passed the prefilter but were then removed as not men's-team
 * news; they are reported under `MEN_EXCLUDED_REASON` so the arithmetic
 * reconciles — kept + dropped should equal fetched for every source.
 */
export function buildSourceBreakdown<F extends { url: string; publisher: string }>(
  fetched: F[],
  keptUrls: Set<string>,
  dropped: DroppedItem[],
  menExcludedUrls: string[],
): SourceBreakdown[] {
  const publisherOf = new Map<string, string>();
  for (const item of fetched) {
    if (!publisherOf.has(item.url)) publisherOf.set(item.url, item.publisher);
  }

  const byPublisher = new Map<string, SourceBreakdown>();
  const entryFor = (publisher: string): SourceBreakdown => {
    let e = byPublisher.get(publisher);
    if (!e) {
      e = { publisher, fetched: 0, kept: 0, dropped: 0, reasons: {}, zeroContribution: false };
      byPublisher.set(publisher, e);
    }
    return e;
  };

  for (const item of fetched) {
    entryFor(item.publisher).fetched++;
  }
  for (const url of keptUrls) {
    // Guard against a kept URL with no fetched item behind it.
    if (publisherOf.has(url)) entryFor(publisherOf.get(url)!).kept++;
  }

  const recordDrop = (url: string, reason: string) => {
    const publisher = publisherOf.get(url);
    // A URL with no matching fetched item cannot be attributed to a source.
    // It is still counted, under an explicit bucket, so totals stay honest
    // rather than silently disappearing.
    const e = entryFor(publisher ?? "(unattributed)");
    e.dropped++;
    e.reasons[reason] = (e.reasons[reason] ?? 0) + 1;
  };

  for (const d of dropped) recordDrop(d.url, d.reason);
  for (const url of menExcludedUrls) recordDrop(url, MEN_EXCLUDED_REASON);

  const out = [...byPublisher.values()];
  for (const e of out) {
    // A fetched item that was neither kept nor reported dropped would make
    // kept + dropped undercount. Fold any remainder into an explicit
    // "unaccounted" bucket so the per-source line is internally consistent
    // rather than quietly wrong.
    if (e.kept + e.dropped < e.fetched) {
      const gap = e.fetched - e.kept - e.dropped;
      e.dropped += gap;
      e.reasons["unaccounted"] = (e.reasons["unaccounted"] ?? 0) + gap;
    }
    e.zeroContribution = e.fetched > 0 && e.kept === 0;
  }
  // Busiest sources first so a zero-yield source is not buried at the bottom.
  out.sort((a, b) => b.fetched - a.fetched || a.publisher.localeCompare(b.publisher));
  return out;
}

/** Render a breakdown as one aligned line per source, plus a summary line. */
export function formatSourceBreakdown(rows: SourceBreakdown[]): string[] {
  const lines: string[] = [];
  const nameWidth = Math.max(0, ...rows.map((r) => r.publisher.length));
  for (const r of rows) {
    const reasons = Object.entries(r.reasons)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([why, n]) => `${why} ${n}`)
      .join(", ");
    const flag = r.zeroContribution ? "  <-- ZERO CONTRIBUTED (fetched but nothing survived)" : "";
    lines.push(
      `    ${r.publisher.padEnd(nameWidth)}  fetched ${String(r.fetched).padStart(3)}` +
        `  kept ${String(r.kept).padStart(3)}  dropped ${String(r.dropped).padStart(3)}` +
        (reasons ? `  (${reasons})` : "") +
        flag,
    );
  }
  const silent = rows.filter((r) => r.zeroContribution);
  const totalFetched = rows.reduce((n, r) => n + r.fetched, 0);
  const totalKept = rows.reduce((n, r) => n + r.kept, 0);
  lines.push(
    `    news ingest by source: ${rows.length} sources, ${totalFetched} fetched, ` +
      `${totalKept} kept, ${totalFetched - totalKept} dropped` +
      (silent.length
        ? ` — ${silent.length} source(s) returned items but contributed NOTHING: ${silent.map((r) => r.publisher).join(", ")}`
        : ""),
  );
  return lines;
}
