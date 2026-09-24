import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { FormerPlayer } from "../../pipeline/src/types";
import { searchPlayers } from "../../pipeline/src/search";
import {
  loadFormerPlayers,
  loadFavorites,
  toggleFavorite,
  type FormerPlayersState,
} from "../data";

export default function Players() {
  const [state, setState] = useState<FormerPlayersState>({ status: "loading" });
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadFormerPlayers().then(setState);
  }, []);

  const players = state.status === "ready" ? state.data.players : [];
  const results = useMemo(() => searchPlayers(players, query), [players, query]);
  const favPlayers = players.filter((p) => favorites.includes(p.id));
  const selectedPlayer = selected ? players.find((p) => p.id === selected) : null;

  if (state.status === "loading") return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;
  if (state.status === "error") return <div className="empty">Kunde inte läsa spelardata. Försök igen senare.</div>;

  return (
    <div>
      <h1>Spelare</h1>
      <p className="meta">Tidigare Häcken-spelare du följer och deras karriär — utan inloggning.</p>

      <label htmlFor="player-search" className="meta" style={{ display: "block", marginTop: 10 }}>
        Sök tidigare Häcken-spelare
      </label>
      <input
        id="player-search"
        type="search"
        className="search-field"
        placeholder="t.ex. Rygaard, Gustafson …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      {favPlayers.length > 0 && (
        <section aria-labelledby="fav-h">
          <h2 id="fav-h">Mina Häcken-spelare</h2>
          {favPlayers.map((p) => (
            <FormerPlayerRow key={p.id} p={p} favorite onOpen={() => setSelected(p.id)} />
          ))}
        </section>
      )}

      <section aria-labelledby="all-h">
        <h2 id="all-h">{query ? "Sökresultat" : "Alla spelare"}</h2>
        {results.length === 0 ? (
          <div className="card empty">
            {query ? `Inga spelare matchar ”${query}”.` : "Inga tidigare spelare i registret ännu."}
          </div>
        ) : (
          results.map((p) => (
            <FormerPlayerRow
              key={p.id}
              p={p}
              favorite={favorites.includes(p.id)}
              onToggleFav={() => setFavorites(toggleFavorite(p.id))}
              onOpen={() => setSelected(p.id)}
            />
          ))
        )}
      </section>

      {selectedPlayer && (
        <PlayerDetail
          p={selectedPlayer}
          onClose={() => setSelected(null)}
          favorite={favorites.includes(selectedPlayer.id)}
          onToggleFav={() => setFavorites(toggleFavorite(selectedPlayer.id))}
        />
      )}
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
        <div style={{ fontWeight: 600 }}>{p.name}</div>
        <div className="meta">
          {p.currentClub ? `${p.currentClub}${p.currentLeague ? ` · ${p.currentLeague}` : ""}` : "Nuvarande klubb ej verifierad"}
          {favorite ? " · följs" : ""}
        </div>
      </button>
    </div>
  );
}

function PlayerDetail({
  p,
  onClose,
  favorite,
  onToggleFav,
}: {
  p: FormerPlayer;
  onClose: () => void;
  favorite: boolean;
  onToggleFav: () => void;
}) {
  return (
    <div className="card" data-testid="player-detail" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ flex: 1, margin: 0 }}>{p.name}</h2>
        <button
          className={`fav-btn${favorite ? " active" : ""}`}
          onClick={onToggleFav}
          aria-label={favorite ? `Sluta följa ${p.name}` : `Följ ${p.name}`}
          aria-pressed={favorite}
        >
          <Star fill={favorite ? "currentColor" : "none"} aria-hidden />
        </button>
        <button className="fav-btn" onClick={onClose} aria-label="Stäng detaljer">
          ✕
        </button>
      </div>

      <p>
        <strong>Klubb:</strong>{" "}
        {p.currentClub && p.clubVerified ? p.currentClub : p.currentClub ? `${p.currentClub} (overifierat)` : "Nuvarande klubb ej verifierad."}
        {p.currentLeague ? ` · ${p.currentLeague}` : ""}
      </p>

      {p.stats ? (
        <table className="stats">
          <caption className="meta" style={{ captionSide: "top", textAlign: "left", padding: "4px 0" }}>
            Säsongen {p.stats.season ?? ""} {p.stats.competition ? `· ${p.stats.competition}` : ""}
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
              <td className="num">{p.stats.appearances ?? "–"}</td>
              <td className="num">{p.stats.starts ?? "–"}</td>
              <td className="num">{p.stats.minutes ?? "–"}</td>
              <td className="num">{p.stats.goals ?? "–"}</td>
              <td className="num">{p.stats.assists ?? "–"}</td>
              <td className="num">{p.stats.yellowCards ?? "–"}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="meta">Ingen verifierad säsongstatistik ännu.</p>
      )}

      {p.contract ? (
        <p data-testid="contract-info">
          <strong>Kontrakt:</strong>{" "}
          {p.contract.verificationStatus === "confirmed" && p.contract.contractExpiry
            ? `Löper till ${p.contract.contractExpiry}.`
            : p.contract.verificationStatus === "reported" && p.contract.contractExpiry
              ? `Rapporteras löpa till ${p.contract.contractExpiry}.`
              : "Ingen verifierad utgång hittad."}{" "}
          <span className="meta">
            Källa:{" "}
            {p.contract.sourceUrl ? (
              <a href={p.contract.sourceUrl} target="_blank" rel="noopener noreferrer">
                {p.contract.sourceName}
              </a>
            ) : (
              p.contract.sourceName
            )}{" "}
            ({p.contract.discoveredVia})
          </span>
        </p>
      ) : (
        <p data-testid="contract-info" className="meta">
          Kontraktslut ej verifierat.
        </p>
      )}

      {p.latestEvent && (
        <div data-testid="latest-event">
          <strong>Senaste händelsen:</strong> {p.latestEvent.claim}
          <div className="meta">
            Källa:{" "}
            {p.latestEvent.sourceUrl ? (
              <a href={p.latestEvent.sourceUrl} target="_blank" rel="noopener noreferrer">
                {p.latestEvent.sourceName}
              </a>
            ) : (
              p.latestEvent.sourceName
            )}{" "}
            · Upptäckt via {p.latestEvent.discoveredVia} · {p.latestEvent.verificationStatus}
          </div>
        </div>
      )}
    </div>
  );
}
