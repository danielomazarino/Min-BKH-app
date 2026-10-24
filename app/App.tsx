import { useEffect, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate, Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { ApiMetricsPanel } from "./shared/ApiMetricsPanel";
import { ArticleAudit } from "./shared/ArticleAudit";
import { KitToggle } from "./shared/KitToggle";
import Brief from "./pages/Brief";
import News from "./pages/News";
import Matches from "./pages/Matches";
import Squad from "./pages/Squad";
import FormerPlayers from "./pages/FormerPlayers";
import NotFound from "./pages/NotFound";
import { loadAppData, type AppDataState } from "./data";
import { FloatingTabBar } from "./shared/FloatingTabBar";
import { Sheet } from "./shared/Sheet";
import { UpdateBanner } from "./shared/UpdateBanner";
import { useAppUpdate } from "./shared/useAppUpdate";
import { DESTINATIONS, SETTINGS_PATH, destinationFor, idFromSearch, searchWithId } from "./shared/nav";
import { fmtDateTime } from "./shared/format";

const ICON = `${import.meta.env.BASE_URL}icons/icon-192.png`;

/**
 * The build id, injected at build time onto the `<html>` element.
 *
 * WHY IT IS READ FROM THE DOM AND NOT FROM import.meta.env
 * The id is a HASH OF THE BUILT BUNDLE, so it cannot be known until the bundle
 * has been written — which is after the module graph is transformed. Baking it
 * into the JS would require knowing the output's own hash while producing it.
 * So it is stamped into index.html and read back from there. It is a plain
 * string with no logic attached, so a missing attribute degrades to "unknown"
 * rather than breaking the header.
 *
 * This is the copy that appears UNDER the "Uppdaterad" freshness label, which
 * is where it is readable on a real iPhone. It deliberately renders NOTHING on
 * top of the app: an earlier version stamped a fixed-position overlay across
 * the top of the screen, which was not asked for and obscured the UI.
 */
const BUILD_ID = (() => {
  if (typeof document === "undefined") return "unknown";
  return document.documentElement.getAttribute("data-build") ?? "unknown";
})();

export default function App() {
  const [state, setState] = useState<AppDataState>({ status: "loading" });

  useEffect(() => {
    loadAppData().then(setState);
  }, []);

  return (
    <HashRouter>
      <AppShell state={state} />
    </HashRouter>
  );
}

/**
 * The shell.
 *
 * Navigation is reduced to FIVE persistent destinations, each owning a stable
 * route. Everything else - settings, news detail, match detail, player detail -
 * is a URL-addressable CHILD of one of those five, so the browser/iOS back
 * gesture always closes the most recent thing the user opened.
 *
 * There is no catch-all route any more. An unknown hash renders an explicit
 * "not found" surface that keeps the navigation bar usable, rather than
 * silently pretending to be Brief.
 */
function AppShell({ state }: { state: AppDataState }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [from, setFrom] = useState<string | null>(null);
  const update = useAppUpdate();

  const settingsOpen = pathname === SETTINGS_PATH;
  const active = destinationFor(settingsOpen && from ? from : pathname);

  const go = (to: string) => {
    setFrom(null);
    navigate(to);
  };

  /**
   * Settings is a sheet over the current section. Opening it records where
   * the user came from and puts it in the URL, so both the back gesture and a
   * cold load of `#/installningar?id=%2Ftrupp` restore the same section.
   */
  const openSettings = () => {
    const here = from ?? pathname;
    setFrom(here);
    navigate(`${SETTINGS_PATH}${searchWithId(here)}`);
  };
  const closeSettings = () => {
    const back = from ?? "/";
    setFrom(null);
    navigate(back);
  };

  // A back/forward or a cold load that lands on #/installningar must recover
  // the underlying section from the URL, not from ephemeral component state.
  useEffect(() => {
    if (settingsOpen) {
      const f = idFromSearch(search);
      setFrom((prev) => (f && f !== prev ? f : prev));
    } else {
      setFrom(null);
    }
  }, [pathname, search, settingsOpen]);

  // Escape closes the sheet, matching every other detail surface.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSettings();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [settingsOpen, from]);

  const generatedAt = state.status === "ready" ? state.data.freshness.generatedAt : null;
  const stale = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 3600000 > 36 : false;

  return (
    <>
      <a href="#main" className="skip-link">
        Hoppa till innehållet
      </a>

      <header className="app-header">
        <img src={ICON} alt="" className="mark" width={22} height={22} />
        <span className="brand">
          Min <b>BKH</b>-app
        </span>
        {/* Freshness and the build id stack in one right-aligned group so the
            build id sits directly UNDER "Uppdaterad" without widening the
            header or pushing the settings button around. */}
        <span className="header-status">
          {generatedAt && (
            <span
              className="freshness"
              data-stale={stale}
              data-testid="freshness"
              title={`Senast uppdaterad ${new Date(generatedAt).toLocaleString("sv-SE")}`}
            >
              <span className="dot" aria-hidden="true" />
              {stale ? "Kan vara gammal" : "Uppdaterad"}
            </span>
          )}
          {/* WHICH BUILD IS THIS? Readable on a real iPhone, where the bundle
              hash is invisible and a stale service worker is otherwise
              indistinguishable from "my change did not work". */}
          <span className="build-id" data-testid="build-id" title={`Build ${BUILD_ID}`}>
            {BUILD_ID}
          </span>
        </span>
        {/* The kit toggle sits LEFT of the cog wheel, as requested. Both are
            32px icon buttons, so the pair reads as one control group. */}
        <KitToggle />
        <button
          type="button"
          className="icon-btn"
          onClick={openSettings}
          aria-label="Inställningar och data"
          data-testid="open-settings"
          aria-expanded={settingsOpen}
        >
          <SettingsIcon aria-hidden />
        </button>
      </header>

      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Brief state={state} />} />
          <Route path="/nyheter" element={<News state={state} />} />
          <Route path="/matcher" element={<Matches state={state} />} />
          <Route path="/trupp" element={<Squad state={state} />} />
          <Route path="/spelare" element={<FormerPlayers squadNames={(state.status === "ready" ? state.data.squadStats ?? [] : []).map((p) => p.playerName)} />} />
          <Route path={SETTINGS_PATH} element={null} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <FloatingTabBar active={active} onSelect={(d) => go(d.path)} />

      <UpdateBanner show={update.needRefresh} onUpdate={update.applyUpdate} onDismiss={update.dismiss} />

      {settingsOpen && (
        <Sheet title="Data & källor" onClose={closeSettings} testId="settings-sheet">
          <SettingsPanel state={state} />
        </Sheet>
      )}
    </>
  );
}

/**
 * Settings content — ONE page, not a summary plus a hidden technical twin.
 *
 * Restructured 2026-10-07 (user request): the old layout had a supporter-facing
 * source list AND a technical disclosure that repeated the same article
 * counts, so the same numbers appeared twice with slightly different labels.
 * Now: one source list (with counts), one audit link (the headlines behind
 * the counts), one technical block (only what the list does not already
 * say). Shorter texts throughout.
 */
function SettingsPanel({ state }: { state: AppDataState }) {
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

  return (
    <div className="stack-4">
      {/* ---- DATA: the only section open by default. REORDERED 2026-10-13
              (user: "very unlogical information and order"): the reading
              order is now (1) what data is this and when was it fetched,
              (2) what is broken RIGHT NOW and why, (3) where the deeper
              detail lives. The squad headcount is GONE — it duplicated the
              Trupp tab's own header count and answered no question this
              sheet exists for. The manual update check is GONE too — it
              checked the APP BUNDLE, not the data, which nobody expected
              from a button sitting inside "Data & källor"; the automatic
              hourly check and the update banner already cover it. ---- */}
      <section>
        <div className="mod-label">Data</div>
        <p className="small muted" data-testid="settings-updated">
          {data
            ? `Hämtad ${new Intl.DateTimeFormat("sv-SE", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(data.freshness.generatedAt))} · uppdateras varje natt 03:30 UTC.`
            : "Data kunde inte läsas."}
        </p>
        {source?.retrievedAt && (
          <p className="small dim" data-testid="sportomedia-updated">
            Matchdata från SportoMedia senast hämtad: {fmtDateTime(source.retrievedAt)}.
          </p>
        )}
        {unavailable && (
          <>
            <p className="small muted" data-testid="current-unavailable">
              {unavailableHuman}
            </p>
            {/* WHY IT BROKE, in one sentence, before any detail. The nightly
                names the failing step; showing it here answers "what source
                caused this" without making the reader open anything. */}
            {unavailableStep && (
              <p className="small dim" data-testid="current-unavailable-step">
                Källan som misslyckades: {unavailableStep}.
              </p>
            )}
            {/* The raw reason, for the maintainer. The nightly's error string
                can contain a whole JSON blob; it is collapsed behind a
                disclosure and lives OUT of the supporter's reading path
                (user, 2026-10-13: "the follow rows of unreadable errors"). */}
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
        {!unavailable && (
          <p className="small dim" data-testid="data-all-ok">
            Alla datakällor svarade vid senaste nattkörningen.
          </p>
        )}
        <p className="small dim">
          Detaljer och mätvärden finns under <strong>Teknisk information</strong> nedan.
        </p>
      </section>

      {/* ---- TEKNISK INFORMATION: collapsed. Everything a maintainer needs —
              provenance, the warning rule, the article audit (the list that
              validates the filtering), and the API measurement log with the
              per-source cross-table.

              The separate "Nyhetskällor" section was REMOVED (user,
              2026-10-13): its status rows and counts duplicated what this
              section already shows in more detail. The audit lives here now,
              and the deep link #/installningar?id=artiklar auto-opens it. ---- */}
      <details className="disc" data-testid="diagnostics" open={auditOpen}>
        <summary>
          Teknisk information
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="disc-body stack-3">
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
          <p className="small dim">
            Nyheter hämtas från källornas egna RSS-flöden. Firecrawl används bara för att
            hitta artiklar — aldrig som källa.
          </p>

          {/* THE HEADLINES BEHIND THE COUNTS. The list that validates the
              filtering — every fetched article with its verdict, so a wrong
              drop can be spotted by eye (that is how B-012 was found). It
              lives here now that the separate Nyhetskällor section is gone. */}
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

          {/* API measurement log. Fetched lazily by the panel itself, so it
              costs nothing until someone actually opens this section. The
              per-source cross-table over nights lives here — it is the one
              article-count view that is kept (user, 2026-10-12). */}
          <div className="mod-label">Mätlogg</div>
          <ApiMetricsPanel />
        </div>
      </details>

      <p className="small dim" data-testid="settings-nav-hint">
        <Link className="link" to="/">
          Till startsidan
        </Link>{" "}
        · {DESTINATIONS.length} huvudvyer
      </p>
    </div>
  );
}
