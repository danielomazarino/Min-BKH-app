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
import type { ApiMetrics } from "./types";

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

      {run ? (
        <>
          <div className="mod-label">Senaste körning</div>
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

          {m.latestCallsTruncated && (
            <p className="small dim" data-testid="metrics-truncated">
              Detaljvyn visar {m.latestCalls.length} av {m.latestCallsTotal} anrop.
              Sammanfattningen ovan är komplett.
            </p>
          )}

          <div data-testid="metrics-services">
            {run.services.map((s) => (
              <div className="srcrow" key={s.service}>
                <span className="nm">
                  {s.service}
                  <span className="meta">
                    {ms(s.totalDurationMs)} totalt · {ms(s.maxDurationMs)} max ·{" "}
                    {kb(s.requestBytes)} in · {kb(s.responseBytes)} ut
                    {/* A skipped call is NOT an error: it never left the
                        machine. Labelling it "fel" made a clean run look
                        broken in the live UI. */}
                    {s.failures > 0 ? ` · ${s.failures} fel` : ""}
                    {s.skipped > 0 ? ` · ${s.skipped} ej körd` : ""}
                  </span>
                </span>
                <span className="rl">{s.calls} anrop</span>
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
