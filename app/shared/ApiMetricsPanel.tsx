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
import { useEffect, useId, useState } from "react";
import { loadApiMetrics, type MetricsState } from "../data";
import type { ApiMetrics, RunRecord, ServiceAggregate, SourceArticles } from "./types";
import { sourcePurpose } from "./sourcePurpose";

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
  /** Failure explanations from real attempts, deduplicated. */
  errorReasons?: string[];
  /** Distinct services in the group, for the "8 källor" suffix. */
  members: ServiceAggregate[];
}

/**
 * Is this group being CALLED purely to measure it?
 *
 * The distinction the reader needs: a provider can be switched on, doing real
 * work, and still not be trusted with the app's output. OpenRouter is exactly
 * that case tonight — one request per night, logged, and the answer discarded.
 * Labelling that "Påslaget" would imply its output reaches the news feed. It
 * does not, and the panel must not suggest it does.
 *
 * Detection is by SERVICE NAME rather than by a flag on the wire: this is a
 * property of how the pipeline is configured, not of any single call, and the
 * grouping layer has no access to pipeline configuration.
 */
const MEASURING_ONLY = new Set(["openrouter"]);

function isMeasuring(g: Group): boolean {
  return g.calls > 0 && g.members.some((m) => MEASURING_ONLY.has(m.service));
}

/**
 * Why a group is not switched on, in plain Swedish.
 *
 * The reason is already recorded on the call (`noteSkippedCall` stores it in
 * `error`), so this translates the known reasons rather than inventing them.
 * An unrecognised reason falls back to the raw text, because showing a slightly
 * technical string beats showing nothing.
 */
function skipReason(g: Group): string {
  const raw = g.members
    .flatMap((m) => m.skipReasons ?? [])
    .find((r) => r.length > 0);
  if (!raw) return "";
  if (/not wired|gated/i.test(raw)) return "Inte inkopplad — väntar på granskning";
  if (/no key/i.test(raw)) return "Ingen API-nyckel satt";
  if (/not attempted/i.test(raw)) return "Ingen nyckel tillagd i nattjobbet";
  return raw;
}

/**
 * A labelled value inside a source card.
 *
 * The label is always rendered. A bare number is meaningless without knowing
 * what it measures, and the previous grid layout assumed the column position
 * carried that information — which it did not, once the text wrapped.
 */
function Cell({
  label,
  info,
  wide,
  children,
}: {
  label: string;
  info: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "mstatcell wide" : "mstatcell"}>
      <span className="mstatlabel">
        {label}
        <Info label={info} />
      </span>
      <span className="mstatval">{children}</span>
    </div>
  );
}

const sum = (rows: ServiceAggregate[], pick: (s: ServiceAggregate) => number) =>
  rows.reduce((n, s) => n + pick(s), 0);

/**
 * A column explainer.
 *
 * Deliberately NOT a `title` attribute alone: tooltips are mouse-only, so on a
 * phone — which is where this app actually lives — they would be unreachable.
 * This is a real <button> that toggles visible text, so it works with a tap
 * and is announced by a screen reader via aria-expanded.
 */
export function Info({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="minfo">
      <button
        type="button"
        className="minfo-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Vad betyder detta? ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <span className="minfo-body" id={id} role="note">
          {label}
        </span>
      )}
    </span>
  );
}

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
    errorReasons: s.errorReasons,
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
      errorReasons: [...new Set(feeds.flatMap((s) => s.errorReasons ?? []))].slice(0, 5),
      members: feeds,
    });
  }

  return groups.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
}

/**
 * Article counts for one publisher, or undefined when not measured.
 *
 * `undefined` is a real, distinct state and MUST stay distinct from zero. A
 * run from before this was measured has no entry; rendering that as "0
 * artiklar" would claim the source was silent when in fact nobody asked.
 */
function countFor(
  counts: Record<string, SourceArticles> | undefined,
  name: string,
): SourceArticles | undefined {
  return counts?.[name];
}

/**
 * Count label with the honesty rule baked in.
 *
 * "0 av 39" is a genuinely bad result and must be shown as one — that is the
 * whole reason this panel exists. "Not measured" must never become "0".
 */
function countLabel(c: SourceArticles | undefined): string {
  if (!c) return "Ej mätt";
  if (c.fetched === 0) return "Inga artiklar";
  return `${c.kept} av ${c.fetched} behölls`;
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

          {/* WHAT THE NUMBER MEANS. "63 anrop" on its own answers nothing — a reader
              cannot tell whether that is a lot, and cannot tell why one source
              shows 26 calls while another shows 1. This spells out both: what
              a run IS, and why the per-source counts differ. */}
          <p className="small dim" data-testid="metrics-plain">
            {(() => {
              const groups = groupServices(run.services);
              const top = groups[0];
              const feeds = groups.find((g) => g.key === "rss");
              const pct = (n: number) => (run.calls ? Math.round((n / run.calls) * 100) : 0);
              return (
                <>
                  En <strong>körning</strong> är hela nattens datahämtning — en enda
                  omgång som börjar 03:30 UTC och skriver alla källor på en gång.
                  Alla nedan är delar av samma körning, inte olika körningar.{" "}
                  {run.calls} anrop totalt: {pct(top.calls)} % gick till {top.label}
                  {feeds
                    ? `, ${feeds.calls} var nyhetsflöden (${feeds.members.length} källor, en hämtning var)`
                    : ""}
                  .
                </>
              );
            })()}
          </p>
          <p className="small dim">
            <strong>Varför så olika antal?</strong> En källa läses en gång per
            körning — därför står det 1 för varje nyhetsflöde och för AI-tjänsterna.
            {" "}
            <strong>article-text</strong> och <strong>sportomedia</strong> läses
            däremot många gånger, en gång per objekt de hämtar. Det är inte
            fel: de går igenom klubbens artikel- och matchdataserver gång för
            gång. <strong>article-text</strong> är inte Firecrawl — det är en
            vanlig hämtning av artiklarnas egna webbsidor för att läsa själva
            texten, eftersom RSS-beskrivningarna oftast är avklippta.
          </p>

          {m.latestCallsTruncated && (
            <p className="small dim" data-testid="metrics-truncated">
              Detaljvyn visar {m.latestCalls.length} av {m.latestCallsTotal} anrop.
              Sammanfattningen ovan är komplett.
            </p>
          )}

          {/* NOT A GRID ON A PHONE. The first version used six columns, which left
              ~30px per cell on a 390px iPhone: every value wrapped to one or
              two characters per line and the status pill overlapped the
              number beside it. Each source is now a stacked card with the
              name and status on the first line and labelled values below, so
              nothing is ever ambiguous about which column it belongs to. */}
          <div className="mtable" data-testid="metrics-services">
            {groupServices(run.services).map((g) => {
              const purpose = sourcePurpose(g.key);
              /* Feeds report counts per PUBLISHER, so the rolled-up row has to
                 sum its members. A non-feed service has no article count at
                 all, and must be shown "Ej mätt" rather than a zero.
                 Summing skips members with no entry, which is why a run from
                 before this was measured reads as unmeasured, not as zero. */
              const memberCounts = g.members
                .map((mm) => countFor(run.sourceArticles, mm.service.replace("rss:", "")))
                .filter((c): c is SourceArticles => c !== undefined);
              const totals =
                memberCounts.length > 0
                  ? memberCounts.reduce(
                      (a, c) => ({
                        fetched: a.fetched + c.fetched,
                        kept: a.kept + c.kept,
                        dropped: a.dropped + c.dropped,
                      }),
                      { fetched: 0, kept: 0, dropped: 0 },
                    )
                  : undefined;
              // Which of this group's publishers actually contributed anything.
              // "OK" on a source row means it ANSWERED, not that it
              // contributed. Six of eight feeds answered and gave nothing,
              // which is the entire reason these numbers are now visible.
              const contributing = memberCounts.filter((c) => c.kept > 0).length;
              return (
              <div className="metsrow" key={g.key} role="group" aria-label={g.label}>
                <div className="mname">
                  <span>
                    {g.label}
                    {/* WHAT THIS SOURCE DOES. The hostname tells you nothing about
                        the app; this tells a supporter what they would lose.
                        Two sentences, joined with a real space rather than a
                        newline: the explanation renders inside a <span>, where
                        a newline is collapsed to a single space anyway. */}
                    <Info label={`${purpose.what} Om något går sönder: ${purpose.ifBroken}`} />
                    {/* Publisher names under a grouped row, so grouping hides
                        nothing — it only stops eight identical rows from
                        burying the two services that do the work. */}
                    {g.members.length > 1 && (
                      <span className="msub">
                        {g.members.map((m) => m.service.replace("rss:", "")).join(" · ")}
                      </span>
                    )}
                  </span>
                  {/* THREE GENUINELY DIFFERENT STATES, and the distinction is the
                      point of this panel:
                        - N fel       = it ran and something went wrong
                        - Mäter       = running, but its answer is DISCARDED
                        - Ej påslaget = not switched on at all
                      Collapsing "measuring" into "switched on" would imply the
                      output reaches supporters. It does not, and it must not be
                      allowed to by accident. */}
                  {g.failures > 0 ? (
                    <span className="mpill mbad">{g.failures} fel</span>
                  ) : isMeasuring(g) ? (
                    <span className="mpill mmeas" title="Svar används inte i appen">
                      Mäter
                    </span>
                  ) : g.skipped > 0 ? (
                    <span className="mpill moff">Ej påslaget</span>
                  ) : (
                    <span className="mpill mok">Påslaget</span>
                  )}
                  {/* WHY it is not on. A grey pill with no reason is a question
                      the reader has to guess at; the reason is already in the
                      recorded call, so show it rather than hiding it. */}
                  {g.skipped > 0 && skipReason(g) && (
                    <span className="msub skipwhy">{skipReason(g)}</span>
                  )}
                  {/* WHY a real attempt failed. The status code alone ("429")
                      cannot be diagnosed — our quota and the shared upstream
                      pool both answer 429 with opposite remedies. The pipeline
                      patches the readable diagnosis onto the call record, and
                      it is shown here verbatim. */}
                  {g.errorReasons && g.errorReasons.length > 0 && (
                    <span className="msub skipwhy" data-testid="error-reasons">
                      {g.errorReasons.join(" · ")}
                    </span>
                  )}
                </div>

                <div className="mstats">
                  <Cell
                    label="Anrop"
                    info={
                      g.skipped > 0
                        ? "Antal anrop mot källan. En avstängd källa har 0 anrop — den körs inte alls just nu."
                        : "Antal anrop mot den här källan under hela körningen."
                    }
                  >
                    {g.skipped > 0 ? "0" : g.calls}
                  </Cell>
                  <Cell label="Tid" info="Total tid för alla anrop. Lång tid betyder oftast mycket data, inte fler anrop.">
                    {ms(g.totalDurationMs)}
                  </Cell>
                  <Cell label="Längsta" info="Det långsammaste enskilda anropet. Hög siffra här men låg totaltid betyder ett enstaka långsamt svar.">
                    {ms(g.maxDurationMs)}
                  </Cell>
                  <Cell label="Status" info="Påslagen användes i körningen. Ej påslagen betyder att källan inte är inkopplad — det är inte ett fel.">
                    {g.failures > 0 ? `${g.failures} fel` : g.skipped > 0 ? "Ej påslaget" : "Påslaget"}
                  </Cell>
                  <Cell
                    label="Data"
                    wide
                    info="Hur mycket data som skickades till källan (in) och vad den svarade med (ut)."
                  >
                    {kb(g.requestBytes)} in · {kb(g.responseBytes)} ut
                  </Cell>
                  {/* THE COUNT THAT MATTERS MOST. "Anrop: 1" and "Status: OK" can
                      both be true for a feed that returned forty articles and
                      contributed none — and that is precisely what happened to
                      six of the eight feeds in one night. This cell is the only
                      one that answers "did this source actually produce
                      anything". */}
                  <Cell
                    label="Nyheter"
                    wide
                    info={
                      totals
                        ? `Antal artiklar som faktiskt kom in, av de ${totals.fetched} som hämtades. “${contributing} av ${memberCounts.length} källor” betyder att ${contributing === 1 ? "en källa" : `${contributing} källor`} faktiskt bidrog med något — att resten svarade men utan relevanta artiklar.`
                        : "Antal artiklar som faktiskt kom in. Källan har ingen artikelmätning — den är inte en nyhetskälla, eller körningen är äldre än mätningen."
                    }
                  >
                    {countLabel(totals)}
                    {totals && g.key === "rss" && (
                      <span className="msub">
                        {contributing} av {memberCounts.length} källor bidrog
                      </span>
                    )}
                  </Cell>
                </div>

                {/* PER-PUBLISHER COUNTS. The rolled-up row above answers "did
                    the feeds work". This answers "WHICH feed is the problem",
                    which is the question that actually has to be acted on —
                    a total of 6 kept across eight feeds cannot tell you that
                    six of them contributed nothing. Grouping hides nothing only
                    if the detail is reachable from here. */}
                {g.key === "rss" && memberCounts.length > 0 && (
                  <ul className="feedcounts" data-testid="feed-counts">
                    {g.members.map((mm) => {
                      const name = mm.service.replace("rss:", "");
                      const c = countFor(run.sourceArticles, name);
                      return (
                        <li key={mm.service} className={c?.kept ? "fc-ok" : "fc-zero"}>
                          <span className="fc-name">
                            {name}
                            <Info
                              label={`${sourcePurpose(name).what} Om något går sönder: ${sourcePurpose(name).ifBroken}`}
                            />
                          </span>
                          <span className="fc-num">{countLabel(c)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              );
            })}
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

      <SourceCountHistory history={m.history} latest={run} />
    </div>
  );
}

/**
 * Per-source article counts across runs.
 *
 * WHY A TABLE, NOT A CHART
 *   The question this answers is "which feed has gone quiet", and the answer
 *   is a pattern of numbers over rows. A sparkline hides the exact values,
 *   and an exact value is what a maintainer needs to compare one publisher
 *   against another. It also has to work on a 390px phone, where a chart
 *   library is a liability.
 *
 * COLUMN ORDER AND WINDOW (user, 2026-10-07)
 *   The LATEST run is the leftmost data column — the reader's eye starts at
 *   the left, so "tonight" must be where the reading starts, not at the far
 *   end of a scroll. The five runs before it follow in descending date
 *   order. Older runs are dropped from the UI: the pipeline still keeps a
 *   week of history, but a table of eight nightly columns on a phone is
 *   scroll noise, and the older numbers answer no question the reader is
 *   asking.
 *
 * WHY "EJ MÄTT" IS A REAL CELL VALUE
 *   Runs from before this measurement existed have no entry. Printing 0 there
 *   would claim those feeds were silent on those nights, which is an invented
 *   fact. An empty string with a dash is the honest rendering, and the table
 *   is only offered once there is at least one measured run to draw from.
 */
/** How many runs the table shows: the latest plus the five before it. */
const COUNT_HISTORY_RUNS = 6;

function SourceCountHistory({
  history,
  latest,
}: {
  history: RunRecord[];
  latest: RunRecord | null;
}) {
  // `history` is stored oldest-first; newest-first for display. `latestRun`
  // is the current run and is not in `history`.
  const runs = [...(latest ? [latest] : []), ...history]
    .filter((r) => r.runAt)
    .sort((a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime())
    .slice(0, COUNT_HISTORY_RUNS);
  const measured = runs.filter((r) => r.sourceArticles);
  if (measured.length === 0) return null;

  // Union of publishers across all measured runs, so a publisher that
  // disappears from one night's feed still gets its own row.
  const publishers = [
    ...new Set(measured.flatMap((r) => Object.keys(r.sourceArticles ?? {}))),
  ].sort((a, b) => a.localeCompare(b, "sv"));

  return (
    <>
      <div className="mod-label">Artiklar per källa, natt för natt</div>
      <p className="small dim" data-testid="count-history-note">
        Antal artiklar som faktiskt tagits med i appen, senaste körningen till
        vänster och de fem nätterna före den efter. En källa som står på 0
        har svarat men inte bidragit med något — det är inte samma sak som en
        källa som inte svarat alls. “—” betyder att den natten mättes inte
        ännu.
      </p>
      {/* HORIZONTALLY SCROLLABLE, deliberately. Eight publishers plus a date
          column cannot fit 390px legibly, and wrapping a table into a card per
          cell destroys the row-to-column correspondence that makes a table
          readable. Scrolling keeps the table a table. The scroll container is
          keyboard-focusable so it is reachable without a mouse. The window is
          six runs (latest + five), so on a phone the newest columns are
          visible without scrolling at all. */}
      <div className="ctablewrap" tabIndex={0} data-testid="metrics-count-history">
        <table className="ctable">
          <caption className="visually-hidden">
            Antal artiklar som behölls per nyhetskälla för varje nattlig körning.
            Tomma celler betyder att körningen före mätningen startade.
          </caption>
          <thead>
            <tr>
              <th scope="col">Källa</th>
              {runs.map((r) => (
                <th scope="col" key={r.runAt}>
                  {time(r.runAt)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {publishers.map((p) => (
              <tr key={p}>
                <th scope="row">{p}</th>
                {runs.map((r) => {
                  const c = r.sourceArticles?.[p];
                  return (
                    <td
                      key={r.runAt}
                      className={c === undefined ? "cunmeasured" : c.kept === 0 ? "czero" : undefined}
                    >
                      {c === undefined ? "—" : c.kept}
                      {c !== undefined && c.fetched > 0 && (
                        <span className="cfetched"> / {c.fetched}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small dim">
        Efter snedstrecket står hur många artiklar källan levererade totalt den
        natten. 3 av 39 betyder att tre av trettionio artiklar handlade om
        Häcken. <strong>0 av 39</strong> betyder att källan svarade med
        trettionio artiklar, men ingen av dem handlade om Häcken — källan
        fungerar, den levererar bara inget till appen just nu.
      </p>
    </>
  );
}
