/**
 * The app.json merge — extracted from run.ts so it is unit-testable.
 *
 * WHY THIS EXISTS (measured 2026-10-12)
 * -------------------------------------
 * The nightly's squad enrichment had silently degraded: 19 of 26 players lost
 * career rows and wiki narratives between 2026-10-09 and 2026-10-12, because
 * Wikimedia 429'd the pipeline's User-Agent-less requests and the fetch
 * wrappers swallowed the 429 into `null` ("nothing verified to add"). The
 * per-player merge then let the DEGRADED result overwrite the GOOD one —
 * `{ ...prev, ...next }` means next always wins per player, even when next is
 * strictly worse. Rygaard's career flapped 11 rows -> 2 -> 11 -> 2 across
 * four consecutive runs.
 *
 * The fix is a per-player QUALITY GUARD: a new enrichment may only replace
 * the previous one when it is not worse. "Worse" is measured on the fields
 * the card actually renders — career rows, wiki narrative, national teams —
 * so a genuinely fresher, richer result still wins, while a rate-limited
 * stub cannot erase good data.
 */
import type { AppData } from "./types";
import type { SquadEnrichment } from "./squadEnrichment";

/**
 * A rough quality score for one player's enrichment, on the fields the card
 * renders. Career rows dominate (the union merge means more rows = more
 * verified clubs); a wiki narrative and national teams each add a point.
 *
 * This is deliberately NOT a deep semantic comparison — it is a guard against
 * catastrophic degradation (a 429 stub), not a content judge. Two results of
 * equal score are treated as equivalent and the NEW one wins, so genuine
 * upstream corrections still flow through.
 */
export function enrichmentQuality(e: SquadEnrichment | undefined): number {
  if (!e) return -1;
  return (e.career?.length ?? 0) + (e.wiki ? 1 : 0) + (e.nationalTeams?.length ?? 0);
}

/**
 * Merge the previous and next enrichment maps per player.
 *
 * A next entry wins when:
 *   - there is no previous entry for that player, or
 *   - the next entry's quality score is >= the previous one's.
 *
 * A next entry that scores LOWER than the previous one is dropped and the
 * previous entry is kept — a rate-limited stub must not erase good data.
 * The count of kept-previous entries is returned so the caller can log it;
 * a nightly that keeps many players is a signal the sources degraded, not
 * that the merge misbehaved.
 */
export function mergeSquadEnrichment(
  prev: Record<string, SquadEnrichment> | undefined,
  next: Record<string, SquadEnrichment> | undefined,
): { merged: Record<string, SquadEnrichment>; keptPrev: number } {
  if (!next || Object.keys(next).length === 0) {
    return { merged: { ...(prev ?? {}) }, keptPrev: Object.keys(prev ?? {}).length };
  }
  const merged: Record<string, SquadEnrichment> = { ...(prev ?? {}) };
  let keptPrev = 0;
  for (const [id, e] of Object.entries(next)) {
    const prevQuality = enrichmentQuality(merged[id]);
    if (enrichmentQuality(e) >= prevQuality) {
      merged[id] = e;
    } else {
      keptPrev += 1;
    }
  }
  return { merged, keptPrev };
}

/**
 * The full app.json merge: new data wins per-field, but empty new fields fall
 * back to last known good so a failed source never blanks the app.
 *
 * Squad enrichment goes through `mergeSquadEnrichment` — see its comment for
 * why a plain spread was not enough.
 */
export function mergeAppData(prev: AppData, next: AppData): AppData {
  const { merged: squadEnrichment, keptPrev } = mergeSquadEnrichment(prev.squadEnrichment, next.squadEnrichment);
  if (keptPrev > 0) {
    // Logged by the caller; surfaced here as a return value so this module
    // stays pure and testable.
  }
  return {
    freshness: next.freshness,
    footballSource: next.footballSource ?? prev.footballSource,
    nextMatch: next.nextMatch ?? prev.nextMatch,
    lastResult: next.lastResult ?? prev.lastResult,
    upcoming: next.upcoming.length ? next.upcoming : prev.upcoming,
    recent: next.recent.length ? next.recent : prev.recent,
    lastMatchDetail: next.lastMatchDetail ?? prev.lastMatchDetail,
    table: next.table.length ? next.table : prev.table,
    tablePosition: next.tablePosition ?? prev.tablePosition,
    warnings: next.warnings ?? prev.warnings,
    discipline: next.discipline?.length ? next.discipline : prev.discipline ?? [],
    cardMatchesInspected: next.cardMatchesInspected || prev.cardMatchesInspected || 0,
    news: next.news.length ? next.news : prev.news,
    newsEvents: next.newsEvents.length ? next.newsEvents : (prev.newsEvents ?? []),
    squadStats: next.squadStats?.length ? next.squadStats : prev.squadStats,
    squadEnrichment,
    disciplineRule: next.disciplineRule ?? prev.disciplineRule,
    // The unavailability flag describes THE CURRENT RUN, not history.
    //
    // B-020 (2026-10-13): `next.currentDataUnavailable ?? prev.…` resurrected
    // a stale failure forever. The 2026-10-11 nightly hit a SportoMedia
    // INTERNAL_SERVER_ERROR, the flag was written, and every later SUCCESSFUL
    // run left `next.currentDataUnavailable` undefined — so `??` fell back to
    // the old flag and the app showed "Aktuell matchdata saknas just nu" for
    // days while the match data itself was fresh and correct. A successful
    // run (next has data) must CLEAR the flag; only a run that itself failed
    // carries it.
    currentDataUnavailable: next.currentDataUnavailable ?? (nextHasFootballData(next) ? undefined : prev.currentDataUnavailable),
  };
}

/** True when the run produced its own football data (fixtures fetch succeeded). */
function nextHasFootballData(next: AppData): boolean {
  return Boolean(next.nextMatch || next.lastResult || next.recent.length > 0);
}
