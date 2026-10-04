/**
 * API measurement panel — the diagnostics view behind the cog wheel.
 *
 * WHY IT EXISTS
 *   This repo has repeatedly been unable to answer basic questions about its
 *   own API usage from inside the app: how many calls a run makes, which
 *   source is slow, what a provider actually costs, and whether a free tier
 *   is being burned. The 84-request Gemini incident and the 20-request/day
 *   free-tier ceiling are both cases where a number should have been visible
 *   before it mattered.
 *
 * WHY IT IS LAZY
 *   The log is fetched only when this section is opened. `app.json` is
 *   fetched on first paint by every supporter, and diagnostics must not tax
 *   the common case to serve the rare one.
 *
 * COST IS SHOWN TWO WAYS, AND THE DISTINCTION IS THE POINT
 *   A provider that reports `cost: 0` has told us the call was genuinely
 *   free. A provider that reports nothing has told us nothing. Collapsing
 *   both to "0" would make an unmeasured month look like a free month, so
 *   unreported totals are labelled as such instead of being shown as zero.
 *
 * SUPPORTER-FACING? NO.
 *   This is technical material and lives behind the existing
 *   "Teknisk information och proveniens" disclosure. No secret is ever
 *   rendered here: the recorder strips query strings before writing.
 */
import { useEffect, useState } from "react";
import { loadApiMetrics, type MetricsState } from "../data";
import type { ApiMetrics, ServiceAggregate } from "./types";

/**
 * Collapse the per-service rows into GROUPS.
 *
 * WHY. A real run makes 63 calls, but listing them raw is unreadable: eight RSS
 * feeds each showing "1 anrop" fill the panel while the two services that
 * actually account for 54 of the calls look like equals. The reader's question
 * is "where does the work go", and the answer is a category, not a hostname.
 *
 * So RSS feeds roll up into one "Nyhetsflöden (8)" row that keeps the
 * per-publisher detail underneath, and everything else stays its own row.
 * Grouping is presentational ONLY — the underlying per-service data is
 * untouched, and the totals still sum from the real records.
 */
interface Group {
  key: string;
  label: string;
  calls: number;
  totalDurationMs: number;
  maxDurationMs: number;
  requestBytes: number;
  responseBytes: number;
  failures: number;
  skipped: number;
  costCredits: number;
  costReported: number;
  /** Distinct services in the group, for the "8 källor" suffix. */
  members: ServiceAggregate[];
}

const sum = (rows: ServiceAggregate[], pick: (s: ServiceAggregate) => number) =>
  rows.reduce((n, s) => n + pick(s), 0);

export function groupServices(services: ServiceAggregate[]): Group[] {
  const feeds = services.filter((s) => s.service.startsWith("rss:"));
  const rest = services.filter((s) => !s.service.startsWith("rss:"));

  const groups: Group[] = rest.map((s) => ({
    key: s.service,
    label: s.service,
    calls: s.calls,
    totalDurationMs: s.totalDurationMs,
    maxDurationMs: s.maxDurationMs,
    requestBytes: s.requestBytes,
    responseBytes: s.responseBytes,
    failures: s.failures,
    skipped: s.skipped,
    costCredits: s.costCredits,
    costReported: s.costReported,
    members: [s],
  }));

  if (feeds.length > 0) {
    groups.push({
      key: "rss",
      label: `Nyhetsflöden (${feeds.length})`,
      calls: sum(feeds, (s) => s.calls),
      totalDurationMs: sum(feeds, (s) => s.totalDurationMs),
      maxDurationMs: Math.max(...feeds.map((s) => s.maxDurationMs)),
      requestBytes: sum(feeds, (s) => s.requestBytes),
      responseBytes: sum(feeds, (s) => s.responseBytes),
      failures: sum(feeds, (s) => s.failures),
      skipped: sum(feeds, (s) => s.skipped),
      costCredits: sum(feeds, (s) => s.costCredits),
      costReported: sum(feeds, (s) => s.costReported),
      members: feeds,
    });
  }

  return groups.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
}

const kb = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;

const ms = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);

const time = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("sv-SE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
};

/**
 * Cost label that refuses to imply "free" when nobody reported a figure.
 *
 * `costReported === 0` with a total of 0 is the case this exists for: the
 * arithmetic says zero, but the honest reading is "unknown", because not one
 * call in the group told us what it cost.
 */
function costLabel(costCredits: number, costReported: number): string {
  if (costReported === 0) return "—";
  if (costCredits === 0) return "0 kr";
  return `${costCredits.toFixed(4)} kr`;
}

export function ApiMetricsPanel() {
  const [state, setState] = useState<MetricsState | null>(null);

  useEffect(() => {
    let live = true;
    loadApiMetrics().then((s) => {
      // Guard against a resolve after unmount, and against a second fetch
      // when React re-runs the effect in development StrictMode.
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);

  if (state === null) {
    return (
      <p className="small dim" data-testid="metrics-loading">
        Mäter…
      </p>
    );
  }

  if (state.status === "unavailable") {
    return (
      <p className="small dim" data-testid="metrics-unavailable">
        Mätloggen finns inte än. Den skapas vid nästa datakörning.
      </p>
    );
  }

  const m: ApiMetrics = state.data;
  const run = m.latestRun;

  return (
    <div className="stack-3" data-testid="api-metrics">
      <p className="small dim">
        Mätloggen gäller den senaste datakörningen och är inte en del av appens
        vanliga innehåll — den läses bara när den här tekniska rutan öppnas.
      </p>

          {/* HOW OLD IS THIS? Without it, a log written by a test run or an old
              deploy is indistinguishable from tonight's, and "63 anrop" reads
              as a live fact. The nightly runs at 03:30 UTC, so an age beyond
              that means the nightly has not written yet — worth saying plainly
              rather than leaving the reader to infer it from a timestamp. */}
          {run && (
            <p className="small dim" data-testid="metrics-age">
              {(() => {
                const ageH = Math.round(
                  (Date.now() - new Date(run.runAt).getTime()) / 3_600_000,
                );
                if (ageH < 1) return "Mätt just nu.";
                if (ageH < 36)
                  return `Mätt ${ageH} timmar sedan. Nästa körning varje natt kl. 03:30 UTC.`;
                return `Denna mätning är ${ageH} timmar gammal. Nattliga körningen har inte skrivit ny data — kontrollera nattens jobb.`;
              })()}
            </p>
          )}

          {run ? (
            <>
          <p className="small dim" data-testid="metrics-run">
            {time(run.runAt)} · {ms(run.durationMs)} ·{" "}
            <strong>
              {run.calls} anrop
            </strong>{" "}
            ({run.failures} misslyckade) ·{" "}
            <span data-testid="metrics-cost">
              kostnad {costLabel(run.costCredits, run.services.reduce((n, s) => n + s.costReported, 0))}
            </span>
          </p>

          {/* WHAT THE NUMBER MEANS. "63 anrop" on its own answers nothing —
              a reader cannot tell whether that is a lot. This says where the
              calls went, in plain terms, with the two dominant services named
              so the shape of the run is obvious at a glance. */}
          <p className="small dim" data-testid="metrics-plain">
            {(() => {
              const groups = groupServices(run.services);
              const top = groups[0];
              const feeds = groups.find((g) => g.key === "rss");
              // The AI service, whichever provider is configured. Matched on
              // `key` because a Group has no `service` field.
              const ai = groups.find(
                (g) => g.key === "openrouter" || g.key === "gemini",
              );
              const pct = (n: number) => (run.calls ? Math.round((n / run.calls) * 100) : 0);
              const parts = [
                `${pct(top.calls)} % av anropen gick till ${top.label}`,
                feeds ? `${feeds.calls} var nyhetsflöden (${feeds.members.length} källor, 1 hämtning var)` : "",
                ai
                  ? ai.skipped > 0
                    ? `ingen AI användes (${ai.label} är inte inkopplad)`
                    : `1 AI-anrop via ${ai.label}`
                  : "ingen AI användes",
              ].filter(Boolean);
              return `${run.calls} anrop: ${parts.join(", ")}.`;
            })()}
          </p>

          {m.latestCallsTruncated && (
            <p className="small dim" data-testid="metrics-truncated">
              Detaljvyn visar {m.latestCalls.length} av {m.latestCallsTotal} anrop.
              Sammanfattningen ovan är komplett.
            </p>
          )}

          <div data-testid="metrics-services">
            {groupServices(run.services).map((g) => (
              <div className="srcrow" key={g.key}>
                <span className="nm">
                  {g.label}
                  <span className="meta">
                    {ms(g.totalDurationMs)} totalt · {ms(g.maxDurationMs)} max ·{" "}
                    {kb(g.requestBytes)} in · {kb(g.responseBytes)} ut
                    {/* A skipped call is NOT an error: it never left the
                        machine. Labelling it "fel" made a clean run look
                        broken in the live UI. */}
                    {g.failures > 0 ? ` · ${g.failures} fel` : ""}
                    {g.skipped > 0 ? ` · ${g.skipped} ej körd` : ""}
                  </span>
                  {/* Per-publisher detail stays available, so grouping hides
                      nothing — it only stops eight identical rows from burying
                      the two services that do the work. */}
                  {g.members.length > 1 && (
                    <span className="meta">
                      {g.members.map((m) => `${m.service.replace("rss:", "")} ${m.calls}`).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="rl">{g.calls} anrop</span>
              </div>
            ))}
          </div>

          {m.budget.length > 0 && (
            <>
              <div className="mod-label">Daglig kvot ({m.budget[0].utcDate})</div>
              {m.budget.map((b) => {
                const pct =
                  b.quotaLimit && b.quotaLimit > 0
                    ? Math.min(100, Math.round((b.requests / b.quotaLimit) * 100))
                    : null;
                return (
                  <p className="small dim" key={`${b.service}:${b.utcDate}`} data-testid="metrics-budget">
                    {b.service}: {b.requests} anrop
                    {b.quotaLimit ? ` av ${b.quotaLimit} (${pct}%)` : ""}
                  </p>
                );
              })}
            </>
          )}

          <p className="small dim">
            Kostnad visas bara när leverantören faktiskt uppger den. 0 är ett
            verkligt värde — en gratis modell som bekräftar ”0 credits”. När
            ingen uppger något står det ”—” i stället för 0, så att en okänd
            månad inte ser ut som en gratis månad.
          </p>
        </>
      ) : (
        <p className="small dim">Ingen körning loggad ännu.</p>
      )}

      {m.history.length > 0 && (
        <>
          <div className="mod-label">Tidigare körningar</div>
          <div data-testid="metrics-history">
            {m.history
              .slice()
              .reverse()
              .map((h) => (
                <div className="srcrow" key={`${h.runAt}-${h.calls}`}>
                  <span className="nm">
                    {time(h.runAt)}
                    <span className="meta">
                      {ms(h.durationMs)} · {h.calls} anrop ·{" "}
                      {h.services.length} källor
                    </span>
                  </span>
                  <span className="rl">{h.failures > 0 ? `${h.failures} fel` : "OK"}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
