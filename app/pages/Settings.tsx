import type { AppDataState } from "../data";
import { loadFormerPlayers, type FormerPlayersState } from "../data";
import { useEffect, useState } from "react";

interface SourceInfo {
  name: string;
  url: string;
  type: "OFFICIELL" | "NYHET" | "STATISTIK" | "UPPTÄCKT";
  role: string;
  provides: string;
  verified: string;
}

const SOURCES: SourceInfo[] = [
  {
    name: "BK Häcken",
    url: "https://bkhacken.se",
    type: "OFFICIELL",
    role: "Primär källa",
    provides: "Klubbnyheter, matchinfo, truppinformation",
    verified: "2026-09-25",
  },
  {
    name: "Allsvenskan (allsvenskan.se)",
    url: "https://allsvenskan.se/",
    type: "OFFICIELL",
    role: "Primär källa",
    provides: "Tävlingsnyheter från seriens officiella kanal",
    verified: "2026-09-25",
  },
  {
    name: "Sportbladet Fotboll",
    url: "https://www.aftonbladet.se/sportbladet/fotboll",
    type: "NYHET",
    role: "Sekundär bevakning",
    provides: "Svensk fotbollsnyhet, övergångar",
    verified: "2026-09-25",
  },
  {
    name: "Expressen Fotboll",
    url: "https://www.expressen.se/sport/fotboll/",
    type: "NYHET",
    role: "Sekundär bevakning",
    provides: "Svensk fotbollsnyhet",
    verified: "2026-09-25",
  },
  {
    name: "SVT Sport",
    url: "https://www.svt.se/sport/",
    type: "NYHET",
    role: "Sekundär bevakning",
    provides: "Allmän svensk sporthäntelse",
    verified: "2026-09-25",
  },
  {
    name: "Bollsvenskan",
    url: "https://bollsvenskan.se/",
    type: "NYHET",
    role: "Sekundär bevakning (artikelnivå varierar)",
    provides: "Allsvenskan-fokus, ibland egen rapportering",
    verified: "2026-09-25",
  },
  {
    name: "SportoMedia (allsvenskan.se)",
    url: "https://allsvenskan.se/",
    type: "OFFICIELL" as const,
    role: "Primär källa för aktuell matchdata",
    provides: "Spelschema, resultat, tabell, händelser, spelarstatistik — säsong 2026",
    verified: "2026-09-25",
  },
  {
    name: "API-Football",
    url: "https://www.api-football.com/",
    type: "STATISTIK",
    role: "Historisk data (säsonger 2022–2024)",
    provides: "Historiska resultat och statistik — aldrig aktuell säsong",
    verified: "2026-09-25",
  },
  {
    name: "Firecrawl Keyless",
    url: "https://www.firecrawl.dev/",
    type: "UPPTÄCKT",
    role: "Upptäckts-/inhämtningsverktyg — aldrig källa",
    provides: "Hittar artiklar om tidigare spelare; artikeln är alltid källan",
    verified: "2026-09-25",
  },
];

export default function Settings({ state }: { state: AppDataState }) {
  const [former, setFormer] = useState<FormerPlayersState>({ status: "loading" });
  useEffect(() => {
    loadFormerPlayers().then(setFormer);
  }, []);

  const data = state.status === "ready" ? state.data : null;
  const generatedAt = data?.freshness.generatedAt;
  const stale = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 3600000 > 36 : false;
  const unavailable = data?.currentDataUnavailable;
  const footballSource = data?.footballSource;

  return (
    <div>
      <h1>Inställningar</h1>

      <section className="settings-section" aria-labelledby="about-h">
        <h2 id="about-h">Om appen</h2>
        <div className="card">
          <div className="source-row">
            <span className="name">Min BKH-app</span>
            <span className="meta">Supporterapp för BK Häckens herrlag. Ej officiell klubbapp.</span>
          </div>
          <div className="source-row">
            <span className="name">Data uppdaterad</span>
            <span className="meta" data-testid="settings-updated">
              {generatedAt
                ? new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
                    new Date(generatedAt),
                  )
                : "okänd"}
              {stale ? " · Data kan vara inaktuell" : ""}
            </span>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="diag-h">
        <h2 id="diag-h">Datastatus</h2>
        <div className="card" data-testid="diagnostics">
          <div className="source-row">
            <span className="name">SportoMedia (aktuell matchdata)</span>
            <span className="meta" data-testid="sm-status">
              {data?.freshness.sourceStatus["sportomedia"] === "ok"
                ? `Fungerar — säsong ${footballSource?.season ?? "2026"} (Allsvenskan).`
                : data?.freshness.sourceStatus["sportomedia"] === "failed"
                  ? "Hämtningen misslyckades."
                  : "Ej använd senaste körningen."}
            </span>
          </div>
          {unavailable && (
            <div className="source-row" data-testid="current-unavailable">
              <span className="name">Aktuell matchdata</span>
              <span className="meta">Ej tillgänglig: {unavailable.reason}</span>
            </div>
          )}
          {footballSource && (
            <div className="source-row">
              <span className="name">Datakälla för matcher</span>
              <span className="meta">
                {footballSource.provider} via {footballSource.publicSite} · säsong {footballSource.season} ·
                {" "}
                {footballSource.dataStatus === "current"
                  ? "aktuell säsong"
                  : footballSource.dataStatus === "historical"
                    ? "historisk säsong"
                    : "ej tillgänglig"}
              </span>
            </div>
          )}
          <div className="source-row">
            <span className="name">API-Football (historisk)</span>
            <span className="meta">
              Historisk källa för säsonger 2022–2024. Används inte för aktuell data.
            </span>
          </div>
          <div className="source-row">
            <span className="name">Nyhetskällor</span>
            <span className="meta">
              {data
                ? Object.entries(data.freshness.sourceStatus)
                    .filter(([k]) => k.startsWith("rss:"))
                    .map(([k, v]) => `${k.replace("rss:", "")}: ${v === "ok" ? "ok" : "fel"}`)
                    .join(" · ") || "inga"
                : "—"}
            </span>
          </div>
          <div className="source-row">
            <span className="name">Antal nyhetshändelser</span>
            <span className="meta">{data?.newsEvents?.length ?? 0}</span>
          </div>
          <div className="source-row">
            <span className="name">Antal spelare i registret</span>
            <span className="meta">{former.status === "ready" ? former.data.players.length : "—"}</span>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="sources-h">
        <h2 id="sources-h">Källor</h2>
        <div className="card" data-testid="source-list">
          {SOURCES.map((s) => (
            <div className="source-row" key={s.name}>
              <span className="name">
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>{" "}
                <span className="badge">{s.type}</span>
              </span>
              <span className="role">
                {s.role} · {s.provides}
              </span>
              <span className="meta">Verifierad {s.verified}</span>
            </div>
          ))}
          <p className="meta" style={{ marginBottom: 0 }}>
            Firecrawl är ett upptäckts-/inhämtningsverktyg — aldrig en nyhetskälla. Artikeln är alltid källan.
          </p>
        </div>
      </section>
    </div>
  );
}
