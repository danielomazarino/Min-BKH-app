/**
 * SettingsPanel — the content of the "Data & källor" sheet.
 *
 * STRUCTURE (rebuilt 2026-11-26, user: "not happy with the structure of the
 * settings page"). The previous version was one long scroll: a Data block, a
 * collapsed "Teknisk information" disclosure holding provenance + the warning
 * rule + the article audit + the whole API measurement log, and a stray
 * "Till startsidan · 5 huvudvyer" line at the bottom.
 *
 * Three problems with that, all structural rather than cosmetic:
 *
 *  1. ONE DISCLOSURE HELD FOUR UNRELATED THINGS. Opening "Teknisk information"
 *     to read the warning rule also dumped a 2 400px measurement table on the
 *     reader. The disclosure was a container, not a decision.
 *  2. THE SUPPORTER'S QUESTION WAS BURIED. "Is the data fresh, and is anything
 *     broken?" is answered by two lines, but they sat above a wall of
 *     provenance and below a heading that promised technical detail.
 *  3. THE FOOTER WAS NOISE. "Till startsidan · 5 huvudvyer" is not a setting
 *     and not information about the data; the tab bar already goes home.
 *
 * The new shape is a short, scannable summary followed by three NAMED
 * sections, each answering one question, each independently collapsible:
 *
 *   Status      — is the data fresh, and did every source answer?
 *   Källor      — which sources, and what did each contribute?
 *   Om appen    — provenance, the warning rule, the build, the audit, metrics.
 *
 * Everything a maintainer needs is still here; it is now reachable by name
 * instead of by opening one undifferentiated drawer.
 */
import { Link, useLocation } from "react-router-dom";
import { ApiMetricsPanel } from "./ApiMetricsPanel";
import { ArticleAudit } from "./ArticleAudit";
import { fmtDateTime } from "./format";
import { SETTINGS_PATH, idFromSearch } from "./nav";
import type { AppDataState } from "../data";

/** A named, independently collapsible section. */
function Section({
  title,
  summary,
  testId,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** One line shown even when collapsed, so the section is scannable shut. */
  summary?: string;
  testId: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="disc" data-testid={testId} open={defaultOpen}>
      <summary>
        <span className="disc-title">{title}</span>
        {summary && <span className="disc-summary">{summary}</span>}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="disc-body stack-3">{children}</div>
    </details>
  );
}

export function SettingsPanel({ state }: { state: AppDataState }) {
  const data = state.status === "ready" ? state.data : null;
  const unavailable = data?.currentDataUnavailable;
  const source = data?.footballSource;
  const audit = data?.freshness.articleAudit;
  const { search } = useLocation();
  const auditOpen = idFromSearch(search) === "artiklar";

  /**
   * A raw pipeline error string is not a sentence. The nightly records the
   * upstream failure verbatim ("Fixtures ej tillgängliga: [{\"message\":…
   * INTERNAL_SERVER_ERROR\"}]"), which is diagnosis-grade for a maintainer
   * and noise for a supporter. The supporter gets a plain sentence; the raw
   * detail moves into the technical section where it belongs.
   */
  const unavailableHuman = (() => {
    if (!unavailable) return null;
    if (/fixtures/i.test(unavailable.reason)) {
      return "Matchlistan kunde inte hämtas just nu. Datauppdateringen försöker igen i natt — matcherna kommer tillbaka automatiskt.";
    }
    if (/tabell/i.test(unavailable.reason)) {
      return "Tabellen kunde inte hämtas just nu. Datauppdateringen försöker igen i natt.";
    }
    return "Aktuell matchdata kunde inte hämtas just nu. Datauppdateringen försöker igen i natt.";
  })();

  /**
   * WHICH source failed, named plainly (user, 2026-10-13: "no clear
   * explanation to why and what source"). The reason string carries the
   * failing step as its prefix ("Fixtures ej tillgängliga: …"), so the
   * mapping is a lookup, not a guess. An unmapped reason renders nothing —
   * an invented source name would be worse than none.
   */
  const unavailableStep = (() => {
    if (!unavailable) return null;
    if (/fixtures/i.test(unavailable.reason)) return "SportoMedia (matchlistan)";
    if (/tabell/i.test(unavailable.reason)) return "SportoMedia (tabellen)";
    return null;
  })();

  const fetched = data
    ? new Intl.DateTimeFormat("sv-SE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(data.freshness.generatedAt))
    : null;

  const allOk = !unavailable;

  return (
    <div className="stack-4">
      {/* ---- STATUS: the two questions a supporter actually has, answered
              before anything else. Freshness and "is anything broken" are the
              whole reason this sheet exists; they used to be separated by a
              paragraph of provenance. ---- */}
      <section data-testid="settings-status">
        <div className="mod-label">Status</div>
        <p className="small muted" data-testid="settings-updated">
          {fetched
            ? `Hämtad ${fetched} · uppdateras varje natt 03:30 UTC.`
            : "Data kunde inte läsas."}
        </p>
        {source?.retrievedAt && (
          <p className="small dim" data-testid="sportomedia-updated">
            Matchdata från SportoMedia senast hämtad: {fmtDateTime(source.retrievedAt)}.
          </p>
        )}
        {allOk ? (
          <p className="small dim" data-testid="data-all-ok">
            Alla datakällor svarade vid senaste nattkörningen.
          </p>
        ) : (
          <>
            <p className="small muted" data-testid="current-unavailable">
              {unavailableHuman}
            </p>
            {unavailableStep && (
              <p className="small dim" data-testid="current-unavailable-step">
                Källan som misslyckades: {unavailableStep}.
              </p>
            )}
            {/* The raw reason, for the maintainer. The nightly's error string
                can contain a whole JSON blob; it is collapsed behind a
                disclosure and lives OUT of the supporter's reading path. */}
            <details className="disc" data-testid="current-unavailable-detail">
              <summary>
                Teknisk detalj
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div className="disc-body">
                <p className="small dim err-raw" data-testid="current-unavailable-raw">
                  {unavailable.reason}
                </p>
              </div>
            </details>
          </>
        )}
      </section>

      {/* ---- KÄLLOR: which sources feed the app, and what each contributed.
              The audit link is the headlines behind the counts — the list that
              validates the filtering, so a wrong drop can be spotted by eye
              (that is how B-012 was found). ---- */}
      <Section
        title="Källor"
        summary={audit && audit.length > 0 ? `${audit.length} hämtade artiklar` : undefined}
        testId="settings-sources"
        defaultOpen={auditOpen}
      >
        <p className="small dim">
          Nyheter hämtas från källornas egna RSS-flöden. Firecrawl används bara för att
          hitta artiklar — aldrig som källa.
        </p>
        {audit && audit.length > 0 && (
          <p className="small dim">
            <Link className="link" to={`${SETTINGS_PATH}?id=artiklar`}>
              Granska alla {audit.length} hämtade artiklar →
            </Link>
          </p>
        )}
        {auditOpen && (
          <section>
            <div className="mod-label">Artikelgranskning</div>
            <ArticleAudit audit={audit} />
          </section>
        )}
      </Section>

      {/* ---- OM APPEN: provenance, the warning rule, the measurement log.
              This is the old "Teknisk information" drawer, split so that
              opening it no longer means opening everything. ---- */}
      <Section title="Om appen" testId="diagnostics">
        {source && (
          <p className="small dim">
            Matchdata: {source.provider} via {source.publicSite} · säsong {source.season} ·{" "}
            {source.dataStatus === "current"
              ? "aktuell säsong"
              : source.dataStatus === "historical"
                ? "historisk säsong"
                : "ej tillgänglig"}
          </p>
        )}
        <p className="small dim" data-testid="sm-status">
          SportoMedia:{" "}
          {data?.freshness.sourceStatus["sportomedia"] === "ok"
            ? "ok"
            : data?.freshness.sourceStatus["sportomedia"] === "failed"
              ? "fel"
              : "ej körd"}
          {typeof data?.cardMatchesInspected === "number"
            ? ` · ${data.cardMatchesInspected} matcher kontrollerade för kort`
            : ""}
        </p>
        {data?.disciplineRule && (
          <p className="small dim" data-testid="rule-text">
            Varningsregel: {data.disciplineRule.threshold} varningar i olika matcher ger{" "}
            {data.disciplineRule.suspensionMatches} matchs avstängning.{" "}
            <a className="link" href={data.disciplineRule.ruleSourceUrl} target="_blank" rel="noopener noreferrer">
              Källa
            </a>
          </p>
        )}

        {/* API measurement log. Fetched lazily by the panel itself, so it
            costs nothing until someone actually opens this section. */}
        <div className="mod-label">Mätlogg</div>
        <ApiMetricsPanel />
      </Section>
    </div>
  );
}
