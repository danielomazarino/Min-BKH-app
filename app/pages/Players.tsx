import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { FormerPlayer, PlayerDiscipline, SeasonPlayerStat } from "../../pipeline/src/types";
import { searchPlayers } from "../../pipeline/src/search";
import {
  loadAppData,
  loadFormerPlayers,
  loadFavorites,
  toggleFavorite,
  type AppDataState,
  type FormerPlayersState,
} from "../data";

/**
 * Players tab — search-oriented.
 *
 * Two clearly separated populations:
 * - AKTUELL TRUPP: verified current 2026 squad (SportoMedia squadStats)
 * - TIDIGARE HÄCKEN-SPELARE: searchable registry with verification status
 *
 * Detail view is a bottom sheet with URL hash state (#/spelare?id=...) so the
 * browser back button closes it naturally.
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const DISCIPLINE_LABEL: Record<PlayerDiscipline["status"], string> = {
  none: "",
  at_risk: "En varning från avstängning",
  suspended_next: "Avstängd nästa match",
  served: "Avstängning avtjänad",
  red_suspended: "Rött kort — avstängningsstatus okänd",
  unknown: "Varningsstatus okänd",
};

export default function Players() {
  const [state, setState] = useState<FormerPlayersState>({ status: "loading" });
  const [app, setApp] = useState<AppDataState | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadFormerPlayers().then(setState);
    loadAppData().then(setApp);
  }, []);

  // URL hash state for the detail sheet: #/spelare?id=<playerId>
  useEffect(() => {
    const readHash = () => {
      const m = window.location.hash.match(/[?&]id=([^&]+)/);
      setSelected(m ? decodeURIComponent(m[1]) : null);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  const openPlayer = (id: string) => {
    window.location.hash = `#/spelare?id=${encodeURIComponent(id)}`;
  };
  const closePlayer = () => {
    window.location.hash = "#/spelare";
  };

  const squad = app?.status === "ready" ? app.data.squadStats ?? [] : [];
  const discipline = app?.status === "ready" ? app.data.discipline ?? [] : [];
  const disciplineById = useMemo(() => new Map(discipline.map((d) => [d.playerId, d])), [discipline]);

  const squadResults = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return squad;
    return squad.filter((p) => norm(p.playerName).includes(q));
  }, [squad, query]);

  const players = state.status === "ready" ? state.data.players : [];
  const results = useMemo(() => searchPlayers(players, query), [players, query]);
  const favPlayers = players.filter((p) => favorites.includes(p.id));
  const selectedSquad = selected?.startsWith("fogis:") || selected?.startsWith("name:")
    ? squad.find((p) => p.playerId === selected) ?? null
    : null;
  const selectedFormer = selected ? players.find((p) => p.id === selected) : null;
  const selectedDiscipline = selected ? disciplineById.get(selected) ?? null : null;

  if (state.status === "loading") return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;
  if (state.status === "error") return <div className="empty">Kunde inte läsa spelardata. Försök igen senare.</div>;

  return (
    <div>
      <h1>Spelare</h1>
      <p className="meta">Sök i aktuell trupp och bland tidigare Häcken-spelare — utan inloggning.</p>

      <label htmlFor="player-search" className="meta" style={{ display: "block", marginTop: 10 }}>
        Sök spelare
      </label>
      <input
        id="player-search"
        type="search"
        className="search-field"
        placeholder="t.ex. Lindgren, Rygaard, Bjärsmy …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      {/* AKTUELL TRUPP — verified current 2026 squad */}
      <section aria-labelledby="squad-h">
        <h2 id="squad-h">Aktuell trupp 2026</h2>
        {squadResults.length === 0 ? (
          <div className="card empty">{query ? `Inga aktuella spelare matchar ”${query}”.` : "Truppdata ej tillgänglig."}</div>
        ) : (
          squadResults.map((p) => {
            const d = disciplineById.get(p.playerId);
            return <SquadPlayerRow key={p.playerId} p={p} discipline={d ?? null} favorite={favorites.includes(p.playerId)} onOpen={() => openPlayer(p.playerId)} onToggleFav={() => setFavorites(toggleFavorite(p.playerId))} />;
          })
        )}
        <p className="meta">Källa: SportoMedia via allsvenskan.se · säsong 2026</p>
      </section>

      {favPlayers.length > 0 && (
        <section aria-labelledby="fav-h">
          <h2 id="fav-h">Mina Häcken-spelare</h2>
          {favPlayers.map((p) => (
            <FormerPlayerRow key={p.id} p={p} favorite onOpen={() => openPlayer(p.id)} />
          ))}
        </section>
      )}

      <section aria-labelledby="all-h">
        <h2 id="all-h">{query ? "Sökresultat — tidigare spelare" : "Tidigare Häcken-spelare"}</h2>
        {results.length === 0 ? (
          <div className="card empty">
            {query ? `Inga tidigare spelare matchar ”${query}”.` : "Inga tidigare spelare i registret ännu."}
          </div>
        ) : (
          results.map((p) => (
            <FormerPlayerRow
              key={p.id}
              p={p}
              favorite={favorites.includes(p.id)}
              onOpen={() => openPlayer(p.id)}
            />
          ))
        )}
      </section>

      {(selectedSquad || selectedFormer) && (
        <PlayerDetailSheet
          squad={selectedSquad ?? null}
          former={selectedFormer ?? null}
          discipline={selectedDiscipline}
          favorite={selected ? favorites.includes(selected) : false}
          onToggleFav={() => selected && setFavorites(toggleFavorite(selected))}
          onClose={closePlayer}
        />
      )}
    </div>
  );
}

function SquadPlayerRow({
  p,
  discipline,
  favorite,
  onOpen,
  onToggleFav,
}: {
  p: SeasonPlayerStat;
  discipline: PlayerDiscipline | null;
  favorite: boolean;
  onOpen: () => void;
  onToggleFav: () => void;
}) {
  const statusLabel = discipline ? DISCIPLINE_LABEL[discipline.status] : "";
  return (
    <div className="row" data-testid="squad-player">
      <button
        onClick={onOpen}
        style={{ background: "none", border: "none", color: "inherit", textAlign: "left", flex: 1, cursor: "pointer", minHeight: 48 }}
      >
        <div style={{ fontWeight: 600 }}>
          {p.playerName} <span className="badge yellow" style={{ fontSize: "0.7rem" }}>AKTUELL</span>
        </div>
        <div className="meta">
          {p.matchesPlayed} matcher · {p.goals} mål · {p.assists} assist · {p.yellowCards} gula
          {statusLabel ? ` · ${statusLabel}` : ""}
        </div>
      </button>
      <button
        className={`fav-btn${favorite ? " active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav();
        }}
        aria-label={favorite ? `Sluta följa ${p.playerName}` : `Följ ${p.playerName}`}
        aria-pressed={favorite}
      >
        <Star fill={favorite ? "currentColor" : "none"} aria-hidden />
      </button>
    </div>
  );
}

function FormerPlayerRow({
  p,
  favorite,
  onToggleFav,
  onOpen,
}: {
  p: FormerPlayer;
  favorite: boolean;
  onToggleFav?: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="row" data-testid="former-player">
      {onToggleFav && (
        <button
          className={`fav-btn${favorite ? " active" : ""}`}
          onClick={onToggleFav}
          aria-label={favorite ? `Sluta följa ${p.name}` : `Följ ${p.name}`}
          aria-pressed={favorite}
        >
          <Star fill={favorite ? "currentColor" : "none"} aria-hidden />
        </button>
      )}
      <button
        onClick={onOpen}
        style={{ background: "none", border: "none", color: "inherit", textAlign: "left", flex: 1, cursor: "pointer", minHeight: 48 }}
      >
        <div style={{ fontWeight: 600 }}>
          {p.name} <span className="meta" style={{ fontSize: "0.7rem" }}>TIDIGARE</span>
        </div>
        <div className="meta">
          {p.currentClub ? `${p.currentClub}${p.currentLeague ? ` · ${p.currentLeague}` : ""}` : "Nuvarande klubb ej verifierad"}
          {favorite ? " · följs" : ""}
        </div>
      </button>
    </div>
  );
}

function PlayerDetailSheet({
  squad,
  former,
  discipline,
  favorite,
  onToggleFav,
  onClose,
}: {
  squad: SeasonPlayerStat | null;
  former: FormerPlayer | null;
  discipline: PlayerDiscipline | null;
  favorite: boolean;
  onToggleFav: () => void;
  onClose: () => void;
}) {
  const name = squad?.playerName ?? former?.name ?? "";
  const isCurrent = !!squad;

  // Close on browser back: the sheet is driven by hash state, so back already
  // works. Escape key also closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} detaljer`}
        onClick={(e) => e.stopPropagation()}
        data-testid="player-detail"
      >
        <div className="sheet-handle" aria-hidden />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ flex: 1, margin: 0 }}>{name}</h2>
          <span className={`badge ${isCurrent ? "yellow" : ""}`} style={{ fontSize: "0.7rem" }}>
            {isCurrent ? "AKTUELL" : "TIDIGARE"}
          </span>
          <button
            className={`fav-btn${favorite ? " active" : ""}`}
            onClick={onToggleFav}
            aria-label={favorite ? `Sluta följa ${name}` : `Följ ${name}`}
            aria-pressed={favorite}
          >
            <Star fill={favorite ? "currentColor" : "none"} aria-hidden />
          </button>
          <button className="fav-btn" onClick={onClose} aria-label="Stäng detaljer">
            ✕
          </button>
        </div>

        {squad && (
          <>
            <table className="stats" data-testid="squad-stats">
              <caption className="meta" style={{ captionSide: "top", textAlign: "left", padding: "4px 0" }}>
                Allsvenskan 2026 · Källa: SportoMedia via allsvenskan.se
              </caption>
              <thead>
                <tr>
                  <th className="num">M</th>
                  <th className="num">Start</th>
                  <th className="num">Mål</th>
                  <th className="num">Ass</th>
                  <th className="num">Gul</th>
                  <th className="num">Röd</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="num">{squad.matchesPlayed}</td>
                  <td className="num">{squad.matchesStarted}</td>
                  <td className="num">{squad.goals}</td>
                  <td className="num">{squad.assists}</td>
                  <td className="num">{squad.yellowCards}</td>
                  <td className="num">{squad.redCards}</td>
                </tr>
              </tbody>
            </table>
            {discipline && discipline.warningCount > 0 && (
              <p data-testid="discipline-info">
                <strong>Varningar:</strong> {discipline.warningCount} denna säsong.
                {DISCIPLINE_LABEL[discipline.status] ? ` ${DISCIPLINE_LABEL[discipline.status]}.` : ""}
              </p>
            )}
            <p className="meta">Minuter per match är inte tillgängliga från källan.</p>
          </>
        )}

        {former && (
          <>
            <p>
              <strong>Klubb:</strong>{" "}
              {former.currentClub && former.clubVerified
                ? former.currentClub
                : former.currentClub
                  ? `${former.currentClub} (overifierat)`
                  : "Nuvarande klubb ej verifierad."}
              {former.currentLeague ? ` · ${former.currentLeague}` : ""}
            </p>

            {former.stats ? (
              <table className="stats">
                <caption className="meta" style={{ captionSide: "top", textAlign: "left", padding: "4px 0" }}>
                  Säsongen {former.stats.season ?? ""} {former.stats.competition ? `· ${former.stats.competition}` : ""}
                </caption>
                <thead>
                  <tr>
                    <th className="num">M</th>
                    <th className="num">Start</th>
                    <th className="num">Min</th>
                    <th className="num">Mål</th>
                    <th className="num">Ass</th>
                    <th className="num">Gul</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="num">{former.stats.appearances ?? "–"}</td>
                    <td className="num">{former.stats.starts ?? "–"}</td>
                    <td className="num">{former.stats.minutes ?? "–"}</td>
                    <td className="num">{former.stats.goals ?? "–"}</td>
                    <td className="num">{former.stats.assists ?? "–"}</td>
                    <td className="num">{former.stats.yellowCards ?? "–"}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="meta">Ingen verifierad säsongstatistik ännu.</p>
            )}

            {former.contract ? (
              <p data-testid="contract-info">
                <strong>Kontrakt:</strong>{" "}
                {former.contract.verificationStatus === "confirmed" && former.contract.contractExpiry
                  ? `Löper till ${former.contract.contractExpiry}.`
                  : former.contract.verificationStatus === "reported" && former.contract.contractExpiry
                    ? `Rapporteras löpa till ${former.contract.contractExpiry}.`
                    : "Ingen verifierad utgång hittad."}{" "}
                <span className="meta">
                  Källa:{" "}
                  {former.contract.sourceUrl ? (
                    <a href={former.contract.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {former.contract.sourceName}
                    </a>
                  ) : (
                    former.contract.sourceName
                  )}{" "}
                  ({former.contract.discoveredVia})
                </span>
              </p>
            ) : (
              <p data-testid="contract-info" className="meta">
                Kontraktslut ej verifierat.
              </p>
            )}

            {former.latestEvent && (
              <div data-testid="latest-event">
                <strong>Senaste händelsen:</strong> {former.latestEvent.claim}
                <div className="meta">
                  Källa:{" "}
                  {former.latestEvent.sourceUrl ? (
                    <a href={former.latestEvent.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {former.latestEvent.sourceName}
                    </a>
                  ) : (
                    former.latestEvent.sourceName
                  )}{" "}
                  · Upptäckt via {former.latestEvent.discoveredVia} · {former.latestEvent.verificationStatus}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
