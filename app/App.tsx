import { useEffect, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate, Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import Brief from "./pages/Brief";
import News from "./pages/News";
import Matches from "./pages/Matches";
import Squad from "./pages/Squad";
import FormerPlayers from "./pages/FormerPlayers";
import NotFound from "./pages/NotFound";
import { loadAppData, type AppDataState } from "./data";
import { FloatingTabBar } from "./shared/FloatingTabBar";
import { DESTINATIONS, SETTINGS_PATH, destinationFor, idFromSearch, searchWithId } from "./shared/nav";

const ICON = `${import.meta.env.BASE_URL}icons/icon-192.png`;

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
          <Route path="/spelare" element={<FormerPlayers />} />
          <Route path={SETTINGS_PATH} element={null} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <FloatingTabBar active={active} onSelect={(d) => go(d.path)} />

      {settingsOpen && (
        <div className="sheet-backdrop">
          <button type="button" className="sr-only" aria-label="Stäng inställningar" onClick={closeSettings} data-testid="settings-dismiss" />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} data-testid="settings-sheet">
            <div className="sheet-grab" aria-hidden="true" />
            <div className="sheet-head">
              <h2 id="settings-title">Data &amp; källor</h2>
              <button type="button" className="icon-btn" onClick={closeSettings} aria-label="Stäng inställningar" data-testid="close-settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="sheet-body">
              <SettingsPanel state={state} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Settings content. Supporter-facing facts first (freshness, why data may be
 * missing, which publishers feed the app); the provenance-heavy material sits
 * behind a native <details> so it never contaminates the main experience.
 * No secrets are ever exposed here.
 */
function SettingsPanel({ state }: { state: AppDataState }) {
  const data = state.status === "ready" ? state.data : null;
  const unavailable = data?.currentDataUnavailable;
  const source = data?.footballSource;
  const squadCount = data?.squadStats?.length ?? null;

  return (
    <div className="stack-4">
      <section>
        <div className="mod-label">Aktualitet</div>
        <p className="small muted" data-testid="settings-updated">
          {data
            ? `Data hämtad ${new Intl.DateTimeFormat("sv-SE", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(data.freshness.generatedAt))}. Nyheter uppdateras varje natt.`
            : "Data kunde inte läsas."}
        </p>
        {unavailable && (
          <p className="small muted" data-testid="current-unavailable">
            Aktuell matchdata saknas just nu: {unavailable.reason}
          </p>
        )}
      </section>

      <section>
        <div className="mod-label">Vyer</div>
        <p className="small muted" data-testid="settings-squad">
          {squadCount != null
            ? `Aktuell herrtrupp: ${squadCount} spelare. Spelarhistoriken söks live mot Wikidata.`
            : "Truppuppgifter kunde inte läsas."}
        </p>
      </section>

      <section>
        <div className="mod-label">Nyhetskällor</div>
        <div data-testid="news-sources">
          {data ? (
            Object.entries(data.freshness.sourceStatus)
              .filter(([k]) => k.startsWith("rss:"))
              .map(([k, v]) => (
                <div className="srcrow" key={k}>
                  <span className="nm">{k.replace("rss:", "")}</span>
                  <span className="rl">{v === "ok" ? "OK" : v === "failed" ? "FEL" : "HOPPAR ÖVER"}</span>
                </div>
              ))
          ) : (
            <p className="small dim">—</p>
          )}
        </div>
      </section>

      <details className="disc" data-testid="diagnostics">
        <summary>
          Teknisk information och proveniens
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
          <p className="small dim">
            Nyhetshändelser: {data?.newsEvents?.length ?? 0} · Spelare: sökning mot Wikidata (ingen lokal lista)
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
            Artiklar hämtas från källornas egna RSS-flöden. Firecrawl används bara för att hitta artiklar
            — det är aldrig en källa.
          </p>
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
