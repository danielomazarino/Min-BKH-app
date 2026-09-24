import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { CalendarDays, House, Newspaper, Users } from "lucide-react";
import Home from "./pages/Home";
import Matches from "./pages/Matches";
import News from "./pages/News";
import Players from "./pages/Players";
import { loadAppData, type AppDataState } from "./data";

export default function App() {
  const [state, setState] = useState<AppDataState>({ status: "loading" });

  useEffect(() => {
    loadAppData().then(setState);
  }, []);

  return (
    <HashRouter>
      <header className="app-header">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="Min BKH" className="crest" />
        <div className="title">
          MIN <span>BKH</span>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home state={state} />} />
          <Route path="/matcher" element={<Matches state={state} />} />
          <Route path="/nyheter" element={<News state={state} />} />
          <Route path="/spelare" element={<Players />} />
        </Routes>
        <StaleNote state={state} />
      </main>
      <nav className="bottom-nav" aria-label="Huvudnavigation">
        <NavLink to="/" icon={<House aria-hidden />} label="Hem" />
        <NavLink to="/matcher" icon={<CalendarDays aria-hidden />} label="Matcher" />
        <NavLink to="/nyheter" icon={<Newspaper aria-hidden />} label="Nyheter" />
        <NavLink to="/spelare" icon={<Users aria-hidden />} label="Spelare" />
      </nav>
    </HashRouter>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  // react-router NavLink would be ideal; simple location check keeps deps small.
  const active = window.location.hash === `#${to}` || (to === "/" && (window.location.hash === "" || window.location.hash === "#/"));
  return (
    <a href={`#${to}`} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
      {icon}
      <span>{label}</span>
    </a>
  );
}

function StaleNote({ state }: { state: AppDataState }) {
  if (state.status !== "ready") return null;
  const { data } = state;
  const t = new Date(data.freshness.generatedAt);
  const ageH = (Date.now() - t.getTime()) / 3600000;
  const fmt = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const stale = ageH > 36;
  return (
    <p className={`stale-note${stale ? " warn" : ""}`} data-testid="stale-note">
      {stale ? "Data kan vara inaktuell · " : ""}
      Senast uppdaterad {fmt.format(t)}
    </p>
  );
}
