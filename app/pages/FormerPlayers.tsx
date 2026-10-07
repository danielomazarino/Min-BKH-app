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
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, Star, X, AlertTriangle, RefreshCw } from "lucide-react";
import { Sheet } from "../shared/Sheet";
import {
  loadFavorites,
  toggleFavorite,
  updateFavoriteSnapshot,
  type StarredPlayer,
} from "../data";
import { idFromSearch } from "../shared/nav";
import {
  searchPlayersOnline,
  readCache,
  writeCache,
  clearCache,
  commonsImageUrl,
  type PlayerCandidate,
  type SearchState,
  type SearchPhase,
  type CareerStint,
  type NationalTeamStint,
} from "../players/wikidata";
import {
  fetchWikipediaSummary,
  readWikiCache,
  writeWikiCache,
  clearWikiCache,
  type WikipediaSummary,
} from "../players/wikipedia";
import {
  fetchInfobox,
  readInfoboxCache,
  writeInfoboxCache,
  clearInfoboxCache,
  type InfoboxData,
  type InfoboxStint,
} from "../players/infobox";
import { fmtDay } from "../shared/format";

const RECENT_KEY = "minbkh.recentSearches";
const MAX_RECENT = 6;
const MIN_QUERY = 2;
/**
 * Debounce for type-ahead. Wikidata allows ~10 requests/minute; a normal
 * name typed at speed produces 2-3 fires with a 400ms settle, and the session
 * cache absorbs the repeats. The old submit-only rule made the user spell
 * every foreign name exactly right — the complaint that drove this change.
 */
const TYPEAHEAD_MS = 400;

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
   * The current stage of the running search, for the progress indicator.
   * Null when no search is in flight. The chain is genuinely multi-step and
   * can take ~10 s on a cold cache; naming the step is what makes that read
   * as work-in-progress rather than a hang (user, 2026-10-06).
   */
  const [searchPhase, setSearchPhase] = useState<SearchPhase | null>(null);
  /** Swedish label for the current search stage. */
  const searchPhaseLabel: string = searchPhase === null
    ? "Söker …"
    : {
        index: "Söker i spelarregistret …",
        cirrus: "Söker djupare i registret …",
        hydrate: "Hämtar spelaruppgifter …",
        labels: "Hämtar klubb- och landsuppgifter …",
      }[searchPhase];
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
    const result = await searchPlayersOnline(query, {
      fetch: window.fetch.bind(window),
      // The chain is genuinely multi-step (index → cirrus → hydration →
      // labels, measured up to ~10 s on a cold cache). Naming the step is
      // the difference between "the app is thinking" and "the app hung".
      onPhase: (p) => {
        if (id === latestId.current) setSearchPhase(p);
      },
    });
    if (id !== latestId.current) return; // superseded
    writeCache(query, result, Date.now());
    setSearchPhase(null);
    setState(result);
  }, []);

  const submit = (q: string) => {
    setDraft(q);
    if (q.trim().length >= MIN_QUERY) setRecent(pushRecent(q));
    void runSearch(q);
  };

  /**
   * Type-ahead: search fires 400ms after the user stops typing.
   *
   * Wikidata's index is prefix-based, so "jere" already finds Jeremejeff —
   * the user no longer has to spell a foreign name exactly right. The debounce
   * keeps the request count inside the rate limit (2-3 fires per name, cache
   * absorbs repeats), and the timer is cancelled on every keystroke so a fast
   * typist never fires per character.
   */
  useEffect(() => {
    const q = draft.trim();
    if (q.length < MIN_QUERY) {
      // A too-short draft clears any pending fire immediately.
      setState({ status: "idle" });
      return;
    }
    const t = setTimeout(() => void runSearch(q), TYPEAHEAD_MS);
    return () => clearTimeout(t);
  }, [draft, runSearch]);

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
        // The FULL card is stored, so a starred player opens with everything
        // instead of the name-and-dates stub that made starring useless.
        snapshot: c,
        snapshotAt: Date.now(),
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
          // The stored FULL snapshot, when there is one, IS the card — the
          // user saw exactly this data when they starred or last opened him.
          if (f.snapshot) return { ...f.snapshot, fromSnapshot: true };
          // Legacy entries (pre-snapshot) still resolve to the name-and-dates
          // stub rather than nothing.
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
            sitelinks: {},
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

  /**
   * AUTO-REFRESH on open. When a starred player is opened from his stored
   * snapshot, a fresh lookup runs in the background and replaces the card
   * when it arrives — the user sees the saved card instantly, then current
   * data. Old data is kept when the refresh fails, so a network error can
   * never blank a card the user has already seen.
   */
  useEffect(() => {
    if (!openQid) return;
    const fromSnapshot = open?.fromSnapshot;
    if (!fromSnapshot) return; // live results are already current
    let cancelled = false;
    void (async () => {
      const result = await searchPlayersOnline(openQid, { fetch: window.fetch.bind(window) });
      if (cancelled) return;
      if (result.status === "results") {
        const fresh = result.candidates.find((c) => c.qid === openQid);
        if (fresh) {
          setFavorites(updateFavoriteSnapshot(fresh.qid, fresh));
          setState((prev) =>
            prev.status === "results"
              ? prev
              : { status: "results", query: fresh.name, candidates: [fresh], discarded: 0 },
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `open` is intentionally not a dependency: the effect must fire when the
    // OPEN ID changes, not every time the card object is rebuilt. (This
    // project's ESLint config does not register react-hooks/exhaustive-deps,
    // so there is no directive to silence — the comment is the record.)
  }, [openQid]);

  /**
   * MANUAL REFRESH. The auto-refresh above fires once — when the card comes
   * from a snapshot — and after that the user had no way to pull fresh data
   * at all: the search cache, the wiki cache and the stored snapshot all
   * served what was already known (user, 2026-10-06: "no refresh possibility
   * on favorite marked players"). This clears BOTH session caches for a
   * forced re-lookup, updates the stored snapshot when it succeeds, and
   * swaps the open card in place. Old data is kept on failure, exactly like
   * the auto-refresh.
   */
  const [refreshingQid, setRefreshingQid] = useState<string | null>(null);
  const refreshPlayer = async (qid: string) => {
    if (refreshingQid) return; // a second click must not double-fire
    setRefreshingQid(qid);
    try {
      clearCache();
      clearWikiCache();
      clearInfoboxCache();
      const result = await searchPlayersOnline(qid, { fetch: window.fetch.bind(window) });
      if (result.status === "results") {
        const fresh = result.candidates.find((c) => c.qid === qid);
        if (fresh) {
          setFavorites(updateFavoriteSnapshot(fresh.qid, fresh));
          setState((prev) =>
            prev.status === "results"
              ? { ...prev, candidates: prev.candidates.some((c) => c.qid === qid) ? prev.candidates.map((c) => (c.qid === qid ? fresh : c)) : [fresh, ...prev.candidates] }
              : { status: "results", query: fresh.name, candidates: [fresh], discarded: 0 },
          );
        }
      }
      // A failed or not-found refresh keeps everything as it was — the card
      // the user is looking at stays, and the spinner just stops.
    } finally {
      setRefreshingQid(null);
    }
  };

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

      {/*
       * SEARCH RESULTS AS A DROPDOWN, directly under the search box.
       *
       * They used to render as a section BELOW the favourites list, which on a
       * phone meant the on-screen keyboard covered them: the user typed, the
       * results appeared off-screen, and the feature looked broken. Attached
       * to the field, they sit above the keyboard and above the favourites,
       * visible the moment they arrive.
       */}
      <div className="search-dropdown" data-testid="search-dropdown">
        {state.status === "searching" && (
          /* A searching indicator that says WHAT is happening, not just a
             grey box. The user's verdict on the bare skeleton: "the worst
             implementation of this kind of search I have seen" — a silent
             rectangle for up to 10 s reads as a hang. The staged chain
             (index → cirrus → hydration → labels) is genuinely multi-step,
             so the indicator names the step. */
          <div className="searching" role="status" aria-live="polite" data-testid="searching">
            <RefreshCw aria-hidden className="spin" />
            <span>{searchPhaseLabel}</span>
          </div>
        )}

        {state.status === "results" && (
          <section aria-label="Sökresultat" data-testid="results">
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
            Kontrollera stavningen, eller prova bara efternamnet — eller ett smeknamn.
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
      </div>

      {favorites.length > 0 && (
        <section className="module" style={{ paddingTop: 4 }} aria-labelledby="starred-h" data-testid="starred">
          <h2 className="mod-label" id="starred-h">
            Följda spelare
            <span className="count"> · {favorites.length}</span>
          </h2>
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
          Sök spelarinformation online och stjärnmärk dina BK Häcken-val
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
            Sök spelarinformation online och stjärnmärk dina BK Häcken-val
          </p>
        </>
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
          onRefresh={refreshPlayer}
          refreshing={refreshingQid === open.qid}
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
 * LAYOUT (user, 2026-10-07): photo small at the TOP RIGHT, general
 * information to its LEFT, club and national-team records BELOW. The card
 * leads with what a supporter checks first — who, born, how tall, where
 * they play now — and the record lists follow.
 *
 * REMOVED as duplicates or Wikidata plumbing:
 *   - "Klubbar" — the career list already names every club.
 *   - "Häcken" block — the HÄCKEN tag on the search/starred row carries it;
 *     a paragraph restating "Wikidata anger … som klubb" is source-speak.
 *   - "Status" block — "Wikidata registrerar inte om …" is plumbing, not
 *     information for a supporter.
 *   - "Kön" tile — visible from the photo/description; a tile for M/K is
 *     noise.
 *
 * Every remaining gap still states what it does not know. A confident wrong
 * answer is worse than an admitted gap, and this page is where a supporter
 * is most likely to trust us.
 */
function PlayerSheet({
  c,
  fav,
  onFav,
  onClose,
  onRefresh,
  refreshing,
}: {
  c: PlayerCandidate;
  fav: boolean;
  onFav: () => void;
  onClose: () => void;
  onRefresh: (qid: string) => Promise<void>;
  refreshing: boolean;
}) {
  /**
   * The club list, derived from the career timeline rather than the raw
   * `clubs` array. The raw array includes national teams (they are P54
   * statements too), which read as clubs once "Landslag" has its own section
   * — "Husqvarna FF · Sveriges U17-herrlandslag" was the visible
   * inconsistency, caught in live verification after deploy.
   *
   * REMOVED from the card (user, 2026-10-07): the career list already shows
   * every club, so a separate "Klubbar" paragraph repeated the same names.
   * The Häcken link lives on the search row and the starred row (the HÄCKEN
   * tag), where it is actually useful for recognition.
   */
  const [wiki, setWiki] = useState<WikipediaSummary | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setWiki(undefined);
    const cached = readWikiCache(c.qid, Date.now());
    if (cached !== undefined) {
      setWiki(cached);
      return;
    }
    void (async () => {
      const summary = await fetchWikipediaSummary(c.qid, c.sitelinks, { fetch: window.fetch.bind(window) });
      if (cancelled) return;
      writeWikiCache(c.qid, summary, Date.now());
      setWiki(summary);
    })();
    return () => {
      cancelled = true;
    };
  }, [c.qid, c.sitelinks]);

  /**
   * The infobox layer — the structured fields Wikidata lacks.
   *
   * Measured on the user's own examples: Mats Hedén has NO height, position
   * or career in Wikidata but a complete enwiki infobox; Bénie Traoré's
   * Wikidata career is one unqualified stint while the infobox has every
   * club with years and apps; Martin Ericsson's Wikidata end-year said 2012
   * where the infobox says 2012–2016.
   *
   * IDENTITY CHAIN: this fetch runs only AFTER the summary layer has
   * verified via wikibase_item that the article is about this exact entity,
   * and it uses the SAME sitelink title. The parse endpoint does not carry
   * wikibase_item, so this chaining is the identity proof — parsing the
   * infobox of an unverified title would risk the musician-for-footballer
   * swap the summary guard exists to prevent.
   */
  const [infobox, setInfobox] = useState<InfoboxData | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setInfobox(undefined);
    // The infobox is only asked for when the summary layer has a verified
    // article — without that proof there is no identity guarantee.
    if (!wiki) return;
    const key = `${wiki.lang}:${c.qid}`;
    const cached = readInfoboxCache(key, Date.now());
    if (cached !== undefined) {
      setInfobox(cached);
      return;
    }
    void (async () => {
      const title = c.sitelinks[`${wiki.lang}wiki`]?.title;
      if (!title) {
        setInfobox(null);
        return;
      }
      const data = await fetchInfobox(wiki.lang, title, { fetch: window.fetch.bind(window) });
      if (cancelled) return;
      writeInfoboxCache(key, data, Date.now());
      setInfobox(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [wiki, c.qid, c.sitelinks]);

  /**
   * MERGE: Wikidata claims and infobox fields, infobox filling the gaps.
   *
   * Precedence is per-field, not per-source: Wikidata's height wins when it
   * exists (it is the more curated source), the infobox fills when it does
   * not. The career lists are NOT merged row-by-row — they model different
   * things (Wikidata: qualified stints; infobox: the fan-maintained table
   * with loans) — so the fuller list wins whole, and the card says which.
   *
   * Both stint shapes are normalized into one display shape here, so the
   * render never has to branch on the source.
   */
  interface DisplayStint {
    years: string;
    team: string;
    loan: boolean;
    apps?: number;
    goals?: number;
  }
  const fromWikidata = (s: CareerStint | NationalTeamStint): DisplayStint => ({
    years: `${s.startYear ?? "????"}–${s.endYear ?? "????"}`,
    team: s.team,
    loan: false,
    apps: (s as CareerStint).apps ?? (s as NationalTeamStint).caps,
    goals: s.goals,
  });
  const fromInfobox = (s: InfoboxStint): DisplayStint => ({
    years: s.years || "????",
    team: s.team,
    loan: s.loan,
    apps: s.apps,
    goals: s.goals,
  });

  const heightCm = c.heightCm ?? infobox?.heightCm;
  const position = c.position ?? infobox?.position;
  // Career: the infobox wins when its list is at least as full. Ties go to
  // the infobox deliberately — Wikidata's P54 end-year qualifiers are
  // notoriously stale (Martin Ericsson Q602051: Wikidata says Häcken
  // 2012–2012, the fan-maintained infobox says 2012–2016 with 109/24, and
  // both lists have 7 rows). A tie broken toward Wikidata resurrected the
  // exact "career cut off" defect this layer exists to fix.
  const careerIsInfobox = (infobox?.career.length ?? 0) >= c.career.length && (infobox?.career.length ?? 0) > 0;
  const career: DisplayStint[] = careerIsInfobox
    ? (infobox?.career ?? []).map(fromInfobox)
    : c.career.map(fromWikidata);
  const nationalIsInfobox = (infobox?.national.length ?? 0) >= c.nationalTeams.length && (infobox?.national.length ?? 0) > 0;
  const nationalTeams: DisplayStint[] = nationalIsInfobox
    ? (infobox?.national ?? []).map(fromInfobox)
    : c.nationalTeams.map(fromWikidata);

  return (
    <Sheet
      title={c.name}
      subtitle={c.description ?? undefined}
      onClose={onClose}
      headExtra={
        <>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void onRefresh(c.qid)}
            disabled={refreshing}
            aria-label={refreshing ? `Uppdaterar ${c.name}` : `Uppdatera uppgifter om ${c.name}`}
            data-testid="refresh-player"
          >
            <RefreshCw aria-hidden className={refreshing ? "spin" : undefined} />
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
        </>
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

        {/*
         * LAYOUT (user, 2026-10-07): photo SMALL at the TOP RIGHT, general
         * information to the LEFT of it, club and national-team records BELOW.
         * The photo used to be a full-width banner that pushed every fact a
         * screen down; a supporter opening the card wants the facts first and
         * the face beside them.
         */}
        <div className="player-head">
          <div className="player-head-facts">
            {/* ---- Wikipedia narrative, when a verified article exists ---- */}
            {wiki ? (
              <div>
                <p className="small" style={{ margin: "0 0 4px" }} data-testid="wiki-extract">
                  {wiki.extract}
                </p>
                <p className="small dim" style={{ margin: 0 }} data-testid="wiki-source">
                  <a className="link" href={wiki.pageUrl} target="_blank" rel="noopener noreferrer">
                    Läs hela artikeln ({wiki.lang === "sv" ? "svenska" : "engelska"} Wikipedia)
                  </a>
                </p>
              </div>
            ) : null}

            {/* ---- general information ---- */}
            <div>
              <div className="kv">
                <Stat v={c.dateOfBirth ?? null} l="Född" isText />
                <Stat v={heightCm ?? null} l="Längd cm" />
                <Stat v={position ?? null} l="Position" isText />
                <Stat v={c.citizenship[0] ?? null} l="Nationalitet" isText />
              </div>
              {infobox?.foot && (
                <p className="small dim" style={{ margin: "6px 0 0" }} data-testid="infobox-foot">
                  Ben: {infobox.foot}.
                </p>
              )}
              {infobox?.currentClub && (
                <p className="small dim" style={{ margin: "6px 0 0" }} data-testid="infobox-current-club">
                  Nuvarande klubb: {infobox.currentClub}.
                </p>
              )}
              {c.dateOfDeath && (
                <p className="small dim" style={{ margin: "6px 0 0" }} data-testid="died">
                  Avled {fmtDay(c.dateOfDeath)}.
                </p>
              )}
            </div>
          </div>

          {/* ---- 0. photo — small, top right, only when the source has one ---- */}
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
        </div>

        {/* ---- career, per stint, with the same honesty ---- */}
        <div>
          <div className="mod-label">Karriär</div>
          {career.length > 0 ? (
            <>
              {careerIsInfobox && (
                <p className="small dim" style={{ margin: "0 0 6px" }} data-testid="career-source">
                  Från Wikipedia — Wikidata saknar år och matcher för de här perioderna.
                </p>
              )}
              <ul className="career" data-testid="career">
                {career.map((s, idx) => (
                  <li key={`${s.team}-${s.years}-${idx}`} data-testid="career-stint">
                    <span className="years">{s.years}</span>
                    <span className="team">
                      {s.team}
                      {s.loan ? " (lån)" : ""}
                    </span>
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
            </>
          ) : (
            <p className="small dim" style={{ margin: 0 }} data-testid="no-career">
              Inga klubbperioder är registrerade i Wikidata. Det betyder inte att karriären saknas — bara att
              uppgiften saknas.
            </p>
          )}
        </div>

        {/* ---- national teams, kept apart from clubs ---- */}
        {nationalTeams.length > 0 && (
          <div>
            <div className="mod-label">Landslag</div>
            <ul className="career" data-testid="national-teams">
              {nationalTeams.map((s, idx) => (
                <li key={`${s.team}-${s.years}-${idx}`} data-testid="national-stint">
                  <span className="years">{s.years}</span>
                  <span className="team">{s.team}</span>
                  {(s.apps !== undefined || s.goals !== undefined) && (
                    <span className="nums">
                      {s.apps !== undefined ? `${s.apps} L` : ""}
                      {s.apps !== undefined && s.goals !== undefined ? " · " : ""}
                      {s.goals !== undefined ? `${s.goals} Mål` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- provenance ---- */}
        <div>
          <div className="mod-label">Källa</div>
          <p className="small dim prov" style={{ margin: 0 }} data-testid="provenance">
            Uppgifterna kommer från Wikidata och Wikipedia och kan vara ofullständiga.{" "}
            <a className="link" href={c.pageUrl} target="_blank" rel="noopener noreferrer">
              Öppna Wikidata-posten ({c.qid})
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
