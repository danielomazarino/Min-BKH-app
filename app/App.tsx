import { useEffect, useState } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { KitToggle } from "./shared/KitToggle";
import { SettingsPanel } from "./shared/SettingsPanel";
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
import { SETTINGS_PATH, destinationFor, idFromSearch, searchWithId } from "./shared/nav";

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

