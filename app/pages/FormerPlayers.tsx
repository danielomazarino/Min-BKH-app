/**
 * Spelare — a football-player search, not a list of former players.
 *
 * PRODUCT REVERSAL (2026-09-26): this page used to load a 31-player registry
 * and let you filter it. That was a closed list, so anyone remembering a 32nd
 * player got a confident "no match" — the app lied by omission. The registry is
 * gone as a product concept. What replaces it is a live search over Wikidata,
 * which is open, citable, and has permanent identifiers.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO:
 *
 *  - It does not require a Häcken connection before showing a player. The
 *    premise is "footballer you are looking for", and the Häcken link is
 *    enrichment shown alongside, never a gate. Gating on it would reproduce
 *    the old closed list in a new costume.
 *
 *  - It does not infer a status from missing data. No club recorded does not
 *    mean retired, and does not mean free agent. Absence of evidence is
 *    rendered as "unknown", in words, every time.
 *
 *  - It does not treat a rate limit as an empty result. Those are different
 *    facts and conflating them is the failure this whole feature was built to
 *    end.
 *
 * Search is submit-driven, never per-keystroke: Wikidata allows ~10
 * requests/minute, and a search-as-you-type box would exhaust that in three
 * seconds of normal typing.
 */
import { useCallback, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, Star, X, AlertTriangle, RefreshCw } from "lucide-react";
import { Sheet } from "../shared/Sheet";
import { loadFavorites, toggleFavorite, type StarredPlayer } from "../data";
import { idFromSearch } from "../shared/nav";
import {
  searchPlayersOnline,
  readCache,
  writeCache,
  commonsImageUrl,
  type PlayerCandidate,
  type SearchState,
} from "../players/wikidata";
import { fmtDay } from "../shared/format";

const RECENT_KEY = "minbkh.recentSearches";
const MAX_RECENT = 6;
const MIN_QUERY = 2;

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
  if (trimmed.length < MIN_QUERY) return loadRecent();
  const next = [trimmed, ...loadRecent().filter((x) => x.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage is a convenience, never a requirement */
  }
  return next;
}

export default function FormerPlayers() {
  const [favorites, setFavorites] = useState<StarredPlayer[]>(() => loadFavorites());
  const [draft, setDraft] = useState("");
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [state, setState] = useState<SearchState>({ status: "idle" });
  /**
   * The id of the newest submitted search. A slow response belonging to an
   * older query must never overwrite a newer one — without this, a slow
   * "Bjarsmy" can land after a fast "Frölund" and show the wrong player.
   */
  const latestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detail is hash-addressable so the iOS back gesture closes the sheet, and a
  // cold deep link behaves exactly like an in-app tap.
  const { search } = useLocation();
  const navigate = useNavigate();
  const openQid = idFromSearch(search);

  const openPlayer = (qid: string) => navigate(`/spelare?id=${encodeURIComponent(qid)}`);
  const closePlayer = () => navigate("/spelare");

  const runSearch = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (query.length < MIN_QUERY) {
      setState({ status: "idle" });
      return;
    }
    const id = latestId.current + 1;
    latestId.current = id;

    const cached = readCache(query, Date.now());
    if (cached) {
      setState(cached);
      return;
    }

    setState({ status: "searching", query });
    const result = await searchPlayersOnline(query, { fetch: window.fetch.bind(window) });
    if (id !== latestId.current) return; // superseded
    writeCache(query, result, Date.now());
    setState(result);
  }, []);

  const submit = (q: string) => {
    setDraft(q);
    if (q.trim().length >= MIN_QUERY) setRecent(pushRecent(q));
    void runSearch(q);
  };

  /**
   * Star/unstar. The whole snapshot is saved, not just the id, so the
   * starred list can be rendered later without re-searching. No Häcken
   * connection is required — see the note on `toggleFavorite`.
   */
  const onToggleFav = (c: PlayerCandidate) =>
    setFavorites(
      toggleFavorite({
        qid: c.qid,
        name: c.name,
        dateOfBirth: c.dateOfBirth,
        dateOfDeath: c.dateOfDeath,
        citizenship: c.citizenship[0] ?? null,
        hackenTeam: c.hackenTeam ?? null,
      }),
    );

  const favIds = favorites.map((f) => f.qid);
  const candidates = state.status === "results" ? state.candidates : [];
  const selected = openQid ? candidates.find((c) => c.qid === openQid) ?? null : null;

  /**
   * A STARRED player must be openable even when the search that found them
   * is long gone.
   *
   * `selected` above only looks in the current result set, so tapping a row
   * in "Följda spelare" after clearing the search did nothing at all — the
   * exact dead end the starred section exists to avoid. The stored snapshot
   * carries enough to render the card, so a starred id always resolves.
   *
   * The rebuilt candidate is marked `fromSnapshot` and its card says so,
   * because a snapshot is what was true when the user starred the player,
   * not a fresh lookup.
   */
  const starredFallback: PlayerCandidate | null =
    !selected && openQid
      ? (() => {
          const f = favorites.find((x) => x.qid === openQid);
          if (!f) return null;
          return {
            qid: f.qid,
            name: f.name,
            description: undefined,
            alsoKnownAs: [],
            dateOfBirth: f.dateOfBirth ?? undefined,
            dateOfDeath: f.dateOfDeath ?? undefined,
            citizenship: f.citizenship ? [f.citizenship] : [],
            career: [],
            nationalTeams: [],
            gender: undefined,
            heightCm: undefined,
            clubs: [],
            // The snapshot records what was VERIFIED when the user starred
            // him, so `hackenClub` mirrors it rather than claiming a fresh
            // verification that never happened.
            hackenClub: f.hackenTeam != null,
            hackenTeam: f.hackenTeam ?? null,
            matchScore: 0,
            pageUrl: `https://www.wikidata.org/wiki/Special:EntityPage/${f.qid}`,
            fromSnapshot: true,
          } satisfies PlayerCandidate;
        })()
      : null;

  const open = selected ?? starredFallback;
  // A deep link to a player that is neither in the results nor starred must
  // say so rather than silently doing nothing.
  const selectedMissing = !!openQid && !open;

  return (
    <div className="layer" data-testid="former-page">
      <div className="searchbar">
        <h1 className="sr-only">Sök fotbollsspelare</h1>
        <form
          className="field"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <Search aria-hidden />
          <input
            id="player-search"
            ref={inputRef}
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Sök fotbollsspelare"
            aria-label="Sök fotbollsspelare"
            autoComplete="off"
            enterKeyHint="search"
          />
          {draft.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setDraft("");
                setState({ status: "idle" });
                inputRef.current?.focus();
              }}
              aria-label="Rensa sökning"
              data-testid="clear-search"
            >
              <X aria-hidden />
            </button>
          )}
        </form>
      </div>

      {favorites.length > 0 && (
        <section className="module" style={{ paddingTop: 4 }} aria-labelledby="starred-h" data-testid="starred">
          <h2 className="mod-label" id="starred-h">
            Följda spelare
            <span className="count"> · {favorites.length}</span>
          </h2>
          <p className="small dim" style={{ margin: "0 0 8px" }}>
            Dina sparade spelare. De ligger kvar här även om du rensar sökningen, och påverkar inte om
            uppgifterna om dem är kompletta.
          </p>
          {favorites.map((f) => (
            <StarredRow
              key={f.qid}
              f={f}
              onOpen={() => openPlayer(f.qid)}
              onUnstar={() =>
                setFavorites(
                  toggleFavorite({
                    qid: f.qid,
                    name: f.name,
                    dateOfBirth: f.dateOfBirth,
                    dateOfDeath: f.dateOfDeath,
                    citizenship: f.citizenship,
                    hackenTeam: f.hackenTeam ?? null,
                  }),
                )
              }
            />
          ))}
        </section>
      )}

      {state.status === "idle" && favorites.length === 0 && recent.length === 0 && (
        <p className="empty" style={{ paddingTop: 20 }} data-testid="no-stars-hint">
          <strong>Hittar du ingen du känner igen?</strong>
          Sök på förnamn, efternamn eller ett smeknamn. Appen söker mot Wikidata, som har spelare från hela
          världen — den behöver inte ha spelat för Häcken för att vara rätt person.
        </p>
      )}

      {state.status === "idle" && (
        <>
          {recent.length > 0 && (
            <section className="module" style={{ paddingTop: 4 }} aria-labelledby="recent-h">
              <h2 className="mod-label" id="recent-h">
                Senast sökta
              </h2>
              <div>
                {recent.map((r) => (
                  <button type="button" className="news-row" key={r} onClick={() => submit(r)} data-testid="recent-search">
                    <span className="when" style={{ width: 8 }} />
                    <span className="head">{r}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <p className="empty" style={{ paddingTop: 20 }} data-testid="idle-hint">
            <strong>Vem minns du?</strong>
            Skriv ett namn — förnamn, efternamn eller ett smeknamn. Sökningen går direkt mot Wikidata, som har
            spelare från hela världen, inte bara från Häcken.
          </p>
        </>
      )}

      {state.status === "searching" && (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" aria-label="Söker" data-testid="searching" />
      )}

      {state.status === "results" && (
        <section className="module" style={{ paddingTop: 4 }} aria-labelledby="res-h" data-testid="results">
          <h2 className="mod-label" id="res-h">
            {candidates.length === 1 ? "1 träff" : `${candidates.length} träffar`}
            {state.discarded > 0 && <span className="count"> · {state.discarded} andra ignorerades</span>}
          </h2>
          {candidates.length > 1 && (
            <p className="small dim" style={{ margin: "0 0 8px" }} data-testid="ambiguous-hint">
              Flera träffar. Välj den du letar efter.
            </p>
          )}
          {candidates.map((c) => (
            <CandidateCard
              key={c.qid}
              c={c}
              fav={favIds.includes(c.qid)}
              onOpen={() => openPlayer(c.qid)}
              onFav={() => onToggleFav(c)}
            />
          ))}
        </section>
      )}

      {state.status === "not-found" && (
        <p className="empty" role="status" data-testid="no-results">
          <strong>Ingen träff på ”{state.query}”</strong>
          Wikidata har ingen person med det namnet. Kontrollera stavningen, eller prova bara efternamnet — eller
          sök på ett smeknamn.
        </p>
      )}

      {state.status === "rate-limited" && (
        <div className="empty" role="status" data-testid="rate-limited">
          <strong>Wikidata svarar för långsamt</strong>
          Vi skickade för många förfrågningar. Sök igen om en stund
          {state.retryAfterSeconds ? ` (ca ${state.retryAfterSeconds}s)` : ""}. Vi vet inte om ”{state.query}”
          finns — vi har inte hunnit fråga.
        </div>
      )}

      {state.status === "failed" && (
        <div className="empty" role="status" data-testid="search-failed">
          <strong>Kunde inte söka</strong>
          {state.message}
          <br />
          <button
            type="button"
            className="news-row"
            onClick={() => void runSearch(state.query)}
            style={{ marginTop: 8 }}
            data-testid="retry"
          >
            <RefreshCw aria-hidden style={{ width: 13, height: 13 }} />
            <span className="head">Försök igen</span>
          </button>
        </div>
      )}

      {selectedMissing && (
        <p className="empty" role="status" data-testid="deep-link-missing">
          <strong>Hittade inte den spelaren i resultatet</strong>
          Sök igen på namnet för att hämta uppgifterna.
        </p>
      )}

      {open && (
        <PlayerSheet
          c={open}
          fav={favIds.includes(open.qid)}
          onFav={() => onToggleFav(open)}
          onClose={closePlayer}
        />
      )}
    </div>
  );
}

/**
 * One row of the starred list.
 *
 * This is the answer to "where did the player I just saved go?". It is
 * rendered from the stored snapshot, so it survives a reload, a cleared
 * search, and a Wikidata outage. The Häcken badge is shown as it was
 * recorded at the time of starring and is explicitly not a filter: a player
 * without a recorded link is listed exactly like one with it.
 */
function StarredRow({
  f,
  onOpen,
  onUnstar,
}: {
  f: StarredPlayer;
  onOpen: () => void;
  onUnstar: () => void;
}) {
  return (
    <div className="prow" data-testid="starred-player">
      <button type="button" className="open" onClick={onOpen} aria-label={`${f.name}. Visa uppgifter.`}>
        <span className="name">
          {f.name}
          {f.hackenTeam && <span className="tag">HÄCKEN{f.hackenTeam === "women" ? " DAM" : ""}</span>}
          {!f.hackenTeam && <span className="tag tag-quiet">HÄCKEN OKÄNT</span>}
        </span>
        <span className="sub">
          {f.dateOfBirth ? `f. ${f.dateOfBirth}` : "födelsedatum saknas"}
          {f.dateOfDeath ? ` · d. ${f.dateOfDeath}` : ""}
          {f.citizenship ? ` · ${f.citizenship}` : ""}
        </span>
      </button>
      <button
        type="button"
        className="star"
        onClick={onUnstar}
        aria-label={`Sluta följa ${f.name}`}
        aria-pressed
        data-testid="unstar"
      >
        <Star fill="currentColor" aria-hidden />
      </button>
    </div>
  );
}

/**
 * One candidate. Shows enough to let the user recognise the right person
 * WITHOUT opening anything: name, life dates, nationality, and whether a
 * Häcken link is actually recorded. The Häcken badge is informational only.
 */
function CandidateCard({
  c,
  fav,
  onOpen,
  onFav,
}: {
  c: PlayerCandidate;
  fav: boolean;
  onOpen: () => void;
  onFav: () => void;
}) {
  return (
    <div className="prow" data-testid="former-player">
      <button type="button" className="open" onClick={onOpen} aria-label={`${c.name}. Visa uppgifter.`}>
        <span className="name">
          {c.name}
          {c.hackenTeam && <span className="tag">HÄCKEN{c.hackenTeam === "women" ? " DAM" : ""}</span>}
        </span>
        <span className="sub">
          {c.dateOfBirth ? `f. ${c.dateOfBirth}` : "födelsedatum saknas"}
          {c.dateOfDeath ? ` · d. ${c.dateOfDeath}` : ""}
          {c.citizenship.length > 0 ? ` · ${c.citizenship[0]}` : ""}
        </span>
      </button>
      <button
        type="button"
        className="star"
        onClick={onFav}
        aria-label={fav ? `Sluta följa ${c.name}` : `Följ ${c.name}`}
        aria-pressed={fav}
        data-testid="fav-toggle"
      >
        <Star fill={fav ? "currentColor" : "none"} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Player detail.
 *
 * The blocks are kept strictly apart on purpose:
 *   1. IDENTITY  — what Wikidata says this person is. Facts.
 *   2. HÄCKEN    — whether a club link is recorded. Three-valued, never
 *                  collapsed: men's / women's / not recorded.
 *   3. STATUS    — never inferred. UNKNOWN is a legitimate, common answer.
 *
 * Every block states what it does not know. A confident wrong answer is worse
 * than an admitted gap, and this page is where a supporter is most likely to
 * trust us.
 */
function PlayerSheet({
  c,
  fav,
  onFav,
  onClose,
}: {
  c: PlayerCandidate;
  fav: boolean;
  onFav: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={c.name}
      subtitle={c.description ?? undefined}
      onClose={onClose}
      headExtra={
        <button
          type="button"
          className="star"
          onClick={onFav}
          aria-label={fav ? `Sluta följa ${c.name}` : `Följ ${c.name}`}
          aria-pressed={fav}
          data-testid="fav-toggle"
        >
          <Star fill={fav ? "currentColor" : "none"} aria-hidden />
        </button>
      }
    >
      <div className="stack-4">
        {c.fromSnapshot && (
          <p className="small dim" style={{ margin: 0 }} data-testid="from-snapshot">
            <AlertTriangle aria-hidden style={{ width: 12, height: 12, verticalAlign: "-1px" }} /> Det här visas från
            din sparade stjärna, inte från en ny sökning. Sök igen på namnet för att hämta aktuella uppgifter.
          </p>
        )}

        {c.alsoKnownAs.length > 0 && (
          <p className="small muted" style={{ margin: 0 }} data-testid="aka">
            Sökbar även som: {c.alsoKnownAs.join(", ")}
          </p>
        )}

        {/* ---- 0. photo — only when the source actually has one ---- */}
        {c.imageUrl && (
          <img
            src={commonsImageUrl(c.imageUrl)}
            alt={c.name}
            loading="lazy"
            decoding="async"
            className="player-photo"
            data-testid="player-photo"
          />
        )}

        {/* ---- 1. identity ---- */}
        <div>
          <div className="mod-label">Uppgifter</div>
          <div className="kv">
            <Stat v={c.dateOfBirth ?? null} l="Född" isText />
            <Stat v={c.heightCm ?? null} l="Längd cm" />
            <Stat v={c.position ?? null} l="Position" isText />
            <Stat v={c.gender === "male" ? "M" : c.gender === "female" ? "K" : null} l="Kön" isText />
            <Stat v={c.citizenship[0] ?? null} l="Nationalitet" isText />
          </div>
          {c.dateOfDeath && (
            <p className="small dim" style={{ margin: "6px 0 0" }} data-testid="died">
              Avled {fmtDay(c.dateOfDeath)}.
            </p>
          )}
        </div>

        {/* ---- 2. career, per stint, with the same honesty ---- */}
        <div>
          <div className="mod-label">Karriär</div>
          {c.career.length > 0 ? (
            <ul className="career" data-testid="career">
              {c.career.map((s) => (
                <li key={`${s.teamQid}-${s.startYear ?? "?"}-${s.endYear ?? "?"}`} data-testid="career-stint">
                  <span className="years">
                    {s.startYear ?? "????"}–{s.endYear ?? "????"}
                  </span>
                  <span className="team">{s.team}</span>
                  {(s.apps !== undefined || s.goals !== undefined) && (
                    <span className="nums">
                      {s.apps !== undefined ? `${s.apps} M` : ""}
                      {s.apps !== undefined && s.goals !== undefined ? " · " : ""}
                      {s.goals !== undefined ? `${s.goals} Mål` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small dim" style={{ margin: 0 }} data-testid="no-career">
              Inga klubbperioder är registrerade i Wikidata. Det betyder inte att karriären saknas — bara att
              uppgiften saknas.
            </p>
          )}
        </div>

        {/* ---- 3. national teams, kept apart from clubs ---- */}
        {c.nationalTeams.length > 0 && (
          <div>
            <div className="mod-label">Landslag</div>
            <ul className="career" data-testid="national-teams">
              {c.nationalTeams.map((s) => (
                <li key={`${s.teamQid}-${s.startYear ?? "?"}-${s.endYear ?? "?"}`} data-testid="national-stint">
                  <span className="years">
                    {s.startYear ?? "????"}–{s.endYear ?? "????"}
                  </span>
                  <span className="team">{s.team}</span>
                  {(s.caps !== undefined || s.goals !== undefined) && (
                    <span className="nums">
                      {s.caps !== undefined ? `${s.caps} L` : ""}
                      {s.caps !== undefined && s.goals !== undefined ? " · " : ""}
                      {s.goals !== undefined ? `${s.goals} Mål` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- 2. Häcken link ---- */}
        <div>
          <div className="mod-label">Häcken</div>
          {c.hackenTeam === "men" ? (
            <p className="small" style={{ margin: 0 }} data-testid="hacken-yes">
              Wikidata anger BK Häcken (herr) som klubb.
            </p>
          ) : c.hackenTeam === "women" ? (
            <p className="small" style={{ margin: 0 }} data-testid="hacken-women">
              Wikidata anger BK Häcken FF (damlag) som klubb.
            </p>
          ) : (
            <p className="small dim" style={{ margin: 0 }} data-testid="hacken-unknown">
              <AlertTriangle aria-hidden style={{ width: 12, height: 12, verticalAlign: "-1px" }} /> Wikidata anger
              inte BK Häcken som klubb för {c.name}. Det betyder inte att hen inte spelat där — bara att uppgiften
              saknas.
            </p>
          )}
        </div>

        {/* ---- 3. clubs, with the same honesty ---- */}
        <div>
          <div className="mod-label">Klubbar</div>
          {c.clubs.length > 0 ? (
            <p className="small" style={{ margin: 0 }} data-testid="clubs">
              {c.clubs.join(" · ")}
            </p>
          ) : (
            <p className="small dim" style={{ margin: 0 }} data-testid="no-clubs">
              Inga klubbuppgifter finns registrerade i Wikidata.
            </p>
          )}
        </div>

        {/* ---- status: only ever stated, never inferred ---- */}
        <div>
          <div className="mod-label">Status</div>
          <p className="small dim" style={{ margin: 0 }} data-testid="status-unknown">
            Wikidata registrerar inte om {c.name} är aktiv eller pensionerad. Appen gissar inte.
          </p>
        </div>

        {/* ---- provenance ---- */}
        <div>
          <div className="mod-label">Källa</div>
          <p className="small dim prov" style={{ margin: 0 }} data-testid="provenance">
            Alla uppgifter kommer från Wikidata och kan vara ofullständiga.{" "}
            <a className="link" href={c.pageUrl} target="_blank" rel="noopener noreferrer">
              Öppna posten ({c.qid})
            </a>
          </p>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * One value in the identity grid. `.kv .k .v` is sized and weighted for
 * NUMBERS (19px bold, tabular figures), so a text value like "Sverige" would
 * either overflow the tile or shout louder than the numbers it sits beside.
 * `isText` drops it to a size that fits, because a country name is not more
 * important than a birth date.
 */
function Stat({ v, l, isText }: { v: number | string | null; l: string; isText?: boolean }) {
  return (
    <div className="k">
      <div className="v" style={isText && typeof v === "string" ? { fontSize: 14, fontWeight: 600 } : undefined}>
        {v ?? "–"}
      </div>
      <div className="l">{l}</div>
    </div>
  );
}
