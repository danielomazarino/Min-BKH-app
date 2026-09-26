/**
 * Former players — a SEARCH experience, and the only player destination.
 *
 * Product rule enforced here: the current 2026 squad is NOT rendered as a list
 * on this screen. Current players belong to the ongoing-season experience and
 * appear in match context (events, cards, suspensions). Former Häcken players
 * are people you search for, remember and follow.
 *
 * Data honesty: the enrichment pipeline currently provides no verified club,
 * statistics or contract for these players. The sheet therefore states what is
 * missing plainly rather than dressing up an empty state — the long-term fix is
 * a separate data-quality workstream.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, Star, X } from "lucide-react";
import type { FormerPlayer } from "../../pipeline/src/types";
import { searchPlayers } from "../../pipeline/src/search";
import { Sheet } from "../shared/Sheet";
import { loadFormerPlayers, loadFavorites, toggleFavorite, type FormerPlayersState } from "../data";
import { fmtDay } from "../shared/format";

const RECENT_KEY = "minbkh.recentSearches";
const MAX_RECENT = 6;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string): string[] {
  const trimmed = q.trim();
  if (trimmed.length < 2) return loadRecent();
  const next = [trimmed, ...loadRecent().filter((x) => x.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recent searches are a convenience, not required */
  }
  return next;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ".split("");

export default function FormerPlayers() {
  const [state, setState] = useState<FormerPlayersState>({ status: "loading" });
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [query, setQuery] = useState("");
  const [letter, setLetter] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  useEffect(() => {
    loadFormerPlayers().then(setState);
  }, []);

  // Detail is hash-addressable so the iOS back gesture closes the sheet.
  useEffect(() => {
    const read = () => {
      const m = window.location.hash.match(/[?&]id=([^&]+)/);
      setOpen(m ? decodeURIComponent(m[1]) : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const openPlayer = (id: string) => {
    window.location.hash = `#/tidigare?id=${encodeURIComponent(id)}`;
  };
  const closePlayer = () => {
    window.location.hash = "#/tidigare";
  };

  const players = state.status === "ready" ? state.data.players : [];
  const searching = query.trim().length > 0;

  const results = useMemo(() => {
    if (searching) return searchPlayers(players, query);
    if (letter) {
      const l = letter.toLocaleLowerCase("sv");
      return players
        .filter((p) => p.name.toLocaleLowerCase("sv").normalize("NFD").replace(/[\u0300-\u036f]/g, "").startsWith(l))
        .sort((a, b) => a.name.localeCompare(b.name, "sv"));
    }
    return [];
  }, [players, query, letter, searching]);

  const favs = useMemo(() => players.filter((p) => favorites.includes(p.id)), [players, favorites]);

  // Only offer letters that actually have players.
  const letters = useMemo(() => {
    const have = new Set(
      players.map((p) => p.name.trim().charAt(0).toLocaleUpperCase("sv").normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
    );
    return ALPHABET.filter((l) => have.has(l));
  }, [players]);

  const onToggleFav = (id: string) => setFavorites(toggleFavorite(id));
  const selected = open ? players.find((p) => p.id === open) ?? null : null;

  const submitSearch = (q: string) => {
    setQuery(q);
    if (q.trim().length >= 2) setRecent(pushRecent(q));
  };

  return (
    <div className="layer" data-testid="former-page">
      <div className="searchbar">
        <h1 className="sr-only">Tidigare Häcken-spelare</h1>
        <div className="field">
          <Search aria-hidden />
          <input
            id="player-search"
            type="search"
            value={query}
            onChange={(e) => submitSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setRecent(pushRecent(query));
            }}
            placeholder="Sök tidigare Häcken-spelare"
            aria-label="Sök tidigare Häcken-spelare"
            autoComplete="off"
            enterKeyHint="search"
          />
          {searching && (
            <button type="button" className="icon-btn" onClick={() => setQuery("")} aria-label="Rensa sökning" data-testid="clear-search">
              <X aria-hidden />
            </button>
          )}
        </div>
      </div>

      {state.status === "loading" && <div className="skeleton" style={{ height: 160 }} aria-busy="true" aria-label="Laddar" />}
      {state.status === "error" && (
        <div className="empty" role="status">
          <strong>Kunde inte läsa spelarregistret</strong>
          Försök igen om en stund.
        </div>
      )}

      {state.status === "ready" && (
        <>
          {/* Favourites first — the people you actually follow. */}
          {favs.length > 0 && !searching && !letter && (
            <section className="module" style={{ paddingTop: 8 }} aria-labelledby="fav-h">
              <h2 className="mod-label" id="fav-h">
                Följda
                <span className="count"> · {favs.length}</span>
              </h2>
              <div className="rail">
                {favs.map((p) => (
                  <button type="button" className="chip" key={p.id} onClick={() => openPlayer(p.id)} data-testid="fav-chip">
                    <span className="ini">{initials(p.name)}</span>
                    <span className="nm">{p.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Recent searches — the "I half-remember a name" aid. */}
          {recent.length > 0 && !searching && !letter && (
            <section className="module" style={{ paddingTop: 4 }} aria-labelledby="recent-h">
              <h2 className="mod-label" id="recent-h">
                Senast sökta
              </h2>
              <div>
                {recent.map((r) => (
                  <button type="button" className="news-row" key={r} onClick={() => setQuery(r)} data-testid="recent-search">
                    <span className="when" style={{ width: 8 }} />
                    <span className="head">{r}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Browse by letter — browsing exists, but is secondary to search. */}
          {!searching && !letter && (
            <section className="module" style={{ paddingTop: 4 }} aria-labelledby="browse-h">
              <h2 className="mod-label" id="browse-h">
                Bläddra
                <span className="count"> · {players.length} spelare</span>
              </h2>
              <div className="az" data-testid="az-index">
                {letters.map((l) => (
                  <button type="button" key={l} onClick={() => setLetter(l)} aria-pressed={letter === l} data-testid="az-letter">
                    {l}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Results */}
          {searching && (
            <section className="module" style={{ paddingTop: 4 }} aria-labelledby="res-h">
              <h2 className="mod-label" id="res-h">
                Sökresultat
                <span className="count"> · {results.length}</span>
              </h2>
              {results.length === 0 ? (
                <p className="empty" data-testid="no-results">
                  <strong>Ingen matchar ”{query}”</strong>
                  Prova ett smeknamn eller en kortare del av namnet.
                </p>
              ) : (
                results.map((p) => (
                  <PlayerRow key={p.id} p={p} fav={favorites.includes(p.id)} onOpen={() => openPlayer(p.id)} onFav={() => onToggleFav(p.id)} />
                ))
              )}
            </section>
          )}

          {letter && (
            <section className="module" style={{ paddingTop: 4 }} aria-labelledby="letter-h">
              <h2 className="mod-label" id="letter-h">
                {letter}
                <span className="count"> · {results.length}</span>
                <button type="button" style={{ marginLeft: "auto" }} onClick={() => setLetter(null)} aria-label="Visa alla bokstäver" data-testid="az-clear">
                  <X aria-hidden style={{ width: 13, height: 13 }} />
                </button>
              </h2>
              {results.length === 0 ? (
                <p className="empty">Inga spelare på {letter}.</p>
              ) : (
                results.map((p) => (
                  <PlayerRow key={p.id} p={p} fav={favorites.includes(p.id)} onOpen={() => openPlayer(p.id)} onFav={() => onToggleFav(p.id)} />
                ))
              )}
            </section>
          )}

          {!searching && !letter && favs.length === 0 && recent.length === 0 && (
            <p className="empty" style={{ paddingTop: 20 }}>
              <strong>Vem minns du?</strong>
              Sök på namn eller smeknamn — appen känner till exempelvis David Frölunds gamla namn Marek.
            </p>
          )}
        </>
      )}

      {selected && (
        <PlayerSheet
          p={selected}
          fav={favorites.includes(selected.id)}
          onFav={() => onToggleFav(selected.id)}
          onClose={closePlayer}
        />
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function PlayerRow({
  p,
  fav,
  onOpen,
  onFav,
}: {
  p: FormerPlayer;
  fav: boolean;
  onOpen: () => void;
  onFav: () => void;
}) {
  const alias = (p.aliases ?? []).find((a) => a.toLowerCase() !== p.name.toLowerCase());
  return (
    <div className="prow" data-testid="former-player">
      <button type="button" className="open" onClick={onOpen} aria-label={`${p.name}, tidigare Häcken-spelare. Visa detaljer.`}>
        <span className="name">
          {p.name}
          <span className="tag">TIDIGARE</span>
        </span>
        <span className="sub">
          {/* Never imply club data we do not have. */}
          {alias ? (
            <>
              även känd som <span className="alias">{alias}</span>
            </>
          ) : p.currentClub ? (
            p.currentClub
          ) : (
            "uppgifter saknas"
          )}
        </span>
      </button>
      <button
        type="button"
        className="star"
        onClick={onFav}
        aria-label={fav ? `Sluta följa ${p.name}` : `Följ ${p.name}`}
        aria-pressed={fav}
        data-testid="fav-toggle"
      >
        <Star fill={fav ? "currentColor" : "none"} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Player detail. Where the pipeline has no verified data, this says so plainly.
 * A future enrichment pipeline will fill these slots; the UI will not pretend
 * they are already filled.
 */
function PlayerSheet({
  p,
  fav,
  onFav,
  onClose,
}: {
  p: FormerPlayer;
  fav: boolean;
  onFav: () => void;
  onClose: () => void;
}) {
  const alias = (p.aliases ?? []).filter((a) => a.toLowerCase() !== p.name.toLowerCase());
  const hasStats = !!p.stats;
  const hasClub = !!(p.currentClub && p.clubVerified);
  const hasContract = !!p.contract?.contractExpiry;

  return (
    <Sheet
      title={p.name}
      subtitle="Tidigare Häcken-spelare"
      onClose={onClose}
      headExtra={
        <button
          type="button"
          className="star"
          onClick={onFav}
          aria-label={fav ? `Sluta följa ${p.name}` : `Följ ${p.name}`}
          aria-pressed={fav}
          data-testid="fav-toggle"
        >
          <Star fill={fav ? "currentColor" : "none"} aria-hidden />
        </button>
      }
    >
      <div className="stack-4">
        {alias.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            Sökbar även som: {alias.join(", ")}
          </p>
        )}

        <div>
          <div className="mod-label">Nuvarande klubb</div>
          {hasClub ? (
            <p className="small" style={{ margin: 0 }}>
              {p.currentClub}
              {p.currentLeague ? ` · ${p.currentLeague}` : ""}
            </p>
          ) : (
            <p className="small dim" style={{ margin: 0 }} data-testid="no-club">
              Ingen verifierad klubbuppgift finns just nu för {p.name}.
            </p>
          )}
        </div>

        {hasStats && p.stats ? (
          <div>
            <div className="mod-label">
              Säsong {p.stats.season ?? ""}
              {p.stats.competition ? ` · ${p.stats.competition}` : ""}
            </div>
            <div className="kv">
              <Stat v={p.stats.appearances} l="Matcher" />
              <Stat v={p.stats.starts} l="Start" />
              <Stat v={p.stats.minutes} l="Min" />
              <Stat v={p.stats.goals} l="Mål" />
              <Stat v={p.stats.assists} l="Assist" />
            </div>
          </div>
        ) : (
          <div>
            <div className="mod-label">Statistik</div>
            <p className="small dim" style={{ margin: 0 }} data-testid="no-stats">
              Ingen verifierad säsongstatistik finns just nu.
            </p>
          </div>
        )}

        <div>
          <div className="mod-label">Kontrakt</div>
          {hasContract && p.contract ? (
            <p className="small" style={{ margin: 0 }} data-testid="contract-info">
              {p.contract.verificationStatus === "confirmed" ? "Löper till" : "Rapporteras löpa till"}{" "}
              {p.contract.contractExpiry}.
            </p>
          ) : (
            <p className="small dim" style={{ margin: 0 }} data-testid="no-contract">
              Kontraktsläget är inte verifierat.
            </p>
          )}
        </div>

        {p.latestEvent && (
          <div>
            <div className="mod-label">Senaste om</div>
            <p className="small" style={{ margin: 0 }} data-testid="latest-event">
              {p.latestEvent.claim}
            </p>
            <p className="small dim" style={{ margin: "4px 0 0" }}>
              {p.latestEvent.verificationStatus === "confirmed" ? "Bekräftad" : "Hittad i"} ·{" "}
              {p.latestEvent.sourceUrl ? (
                <a className="link" href={p.latestEvent.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {p.latestEvent.sourceName}
                </a>
              ) : (
                p.latestEvent.sourceName
              )}{" "}
              {p.latestEvent.publishedAt ? fmtDay(p.latestEvent.publishedAt) : ""}
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Stat({ v, l }: { v: number | null; l: string }) {
  return (
    <div className="k">
      <div className="v">{v ?? "–"}</div>
      <div className="l">{l}</div>
    </div>
  );
}
