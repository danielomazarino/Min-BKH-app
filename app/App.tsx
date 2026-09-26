import { useEffect, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import Home from "./pages/Home";
import Matches from "./pages/Matches";
import FormerPlayers from "./pages/FormerPlayers";
import { loadAppData, loadFormerPlayers, type AppDataState } from "./data";

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
 * Navigation is deliberately reduced to TWO persistent destinations: the
 * supporter brief and former-player search. Matches and Settings are reached
 * contextually (module chevrons and the header glyph) because they are
 * archives and reference surfaces, not daily destinations. The current squad
 * is NOT a destination at all — it appears inside match context.
 */
function AppShell({ state }: { state: AppDataState }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Settings is a sheet, not a page. It is reachable from the header glyph
  // and from the "Om appen" link on the brief, and it is hash-addressable so
  // the iOS back gesture closes it.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#/installningar")) setSettingsOpen(true);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openSettings = () => {
    setSettingsOpen(true);
    window.location.hash = "#/installningar";
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    window.location.hash = pathname === "/" || pathname === "/installningar" ? "#/" : `#${pathname}`;
  };

  const generatedAt = state.status === "ready" ? state.data.freshness.generatedAt : null;
  const stale = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 3600000 > 36 : false;

  return (
    <>
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
        >
          <SettingsIcon aria-hidden />
        </button>
      </header>

      <main>
        <Routes>
          <Route
            path="*"
            element={
              <Home
                state={state}
                onOpenSettings={openSettings}
                onGoMatches={() => navigate("/matcher")}
                onGoNews={() => navigate("/nyheter")}
              />
            }
          />
          <Route path="/matcher" element={<Matches state={state} />} />
          <Route path="/tidigare" element={<FormerPlayers />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Huvudnavigation">
        <a
          href="#/"
          aria-current={pathname === "/" || pathname === "/nyheter" || pathname === "/matcher" ? "page" : undefined}
          data-testid="tab-home"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5.5 9.5V20h13V9.5" />
            <path d="M9.5 20v-5.5h5V20" />
          </svg>
          <span>Brief</span>
        </a>
        <a
          href="#/tidigare"
          aria-current={pathname === "/tidigare" ? "page" : undefined}
          data-testid="tab-former"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span>Tidigare</span>
        </a>
      </nav>

      {settingsOpen && (
        <div className="sheet-backdrop">
          <button type="button" className="sr-only" aria-label="Stäng inställningar" onClick={closeSettings} data-testid="settings-dismiss" />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} data-testid="settings-sheet">
            <div className="sheet-grab" aria-hidden="true" />
            <div className="sheet-head">
              <h2 id="settings-title">Data &amp; källor</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={closeSettings}
                aria-label="Stäng inställningar"
                data-testid="close-settings"
              >
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
  const [formerCount, setFormerCount] = useState<number | null>(null);
  useEffect(() => {
    loadFormerPlayers().then((r) => setFormerCount(r.status === "ready" ? r.data.players.length : null));
  }, []);

  const data = state.status === "ready" ? state.data : null;
  const unavailable = data?.currentDataUnavailable;
  const source = data?.footballSource;

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
            Nyhetshändelser: {data?.newsEvents?.length ?? 0} · Spelare i registret: {formerCount ?? "—"}
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
    </div>
  );
}
