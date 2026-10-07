/**
 * The shared player card — ONE card for former players AND the current squad.
 *
 * WHY IT EXISTS (user, 2026-10-07): the redesigned card (photo top-right,
 * facts left, records below) shipped for the Spelare search, but Trupp still
 * opened its own minimal sheet with only season numbers. The user asked for
 * the SAME card view for squad players, enriched with what only the squad
 * data has (season stats, kortläge) in the top area.
 *
 * HOW IDENTITY WORKS FOR SQUAD PLAYERS
 * ------------------------------------
 * Squad ids are `fogis:N` / `name:NORMALIZED` — NOT Wikidata Q-IDs. The card
 * therefore accepts a `candidate` (a full Wikidata PlayerCandidate, the
 * former-player path) OR a `squadName` (a display name, the squad path).
 * With a squad name, the card looks the player up on Wikidata by name and
 * uses the best footballer hit; if nothing trustworthy is found, the card
 * still renders with the squad data alone — the Wikidata/Wikipedia layers
 * simply stay absent, exactly like a former player with no sitelinks.
 *
 * A name match is a HINT, not an identity proof: the lookup requires the
 * hit to be a person AND a footballer, and the card shows the Wikidata
 * description so a wrong namesake is visible at a glance. It never merges
 * stats into the wrong person silently — the squad block is labelled with
 * the squad name, the wiki block with the Wikidata name.
 */
import { useEffect, useState } from "react";
import { Sheet } from "./Sheet";
import { fmtDay } from "./format";
import {
  searchPlayersOnline,
  commonsImageUrl,
  type PlayerCandidate,
  type CareerStint,
  type NationalTeamStint,
} from "../players/wikidata";
import {
  fetchWikipediaSummary,
  readWikiCache,
  writeWikiCache,
  type WikipediaSummary,
} from "../players/wikipedia";
import {
  fetchInfobox,
  readInfoboxCache,
  writeInfoboxCache,
  type InfoboxData,
  type InfoboxStint,
} from "../players/infobox";

/** Squad-only data the Wikidata layer never has. */
export interface SquadFacts {
  /** Position group label, e.g. "Målvakt". */
  positionLabel?: string;
  competition?: string | null;
  matchesPlayed: number;
  matchesStarted: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  /** Kortläge text, already computed by the caller's discipline helpers. */
  cardState?: string | null;
}

export function PlayerCard({
  name,
  candidate,
  squadFacts,
  onClose,
  headExtra,
}: {
  /** The display name the card opens under — squad name or Wikidata label. */
  name: string;
  /** A full Wikidata candidate, when one is already known (search path). */
  candidate?: PlayerCandidate | null;
  /** Squad-season facts, when the player is a current squad member. */
  squadFacts?: SquadFacts | null;
  onClose: () => void;
  /** Extra header controls (star, refresh) owned by the caller. */
  headExtra?: React.ReactNode;
}) {
  /**
   * The Wikidata candidate. The search path passes one in; the squad path
   * resolves it from the name, once, and keeps it for the sheet's lifetime.
   */
  const [resolved, setResolved] = useState<PlayerCandidate | null | undefined>(
    candidate === undefined ? undefined : candidate,
  );
  useEffect(() => {
    if (candidate !== undefined) {
      setResolved(candidate);
      return;
    }
    let cancelled = false;
    setResolved(undefined);
    void (async () => {
      const result = await searchPlayersOnline(name, { fetch: window.fetch.bind(window) });
      if (cancelled) return;
      if (result.status === "results" && result.candidates.length > 0) {
        // Best hit only when it is genuinely this kind of person: the search
        // already filters to footballers, so the first candidate is the best
        // available evidence. The card shows the Wikidata description beside
        // the title, so a wrong namesake is visible rather than silent.
        setResolved(result.candidates[0]);
      } else {
        setResolved(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidate, name]);

  const c = resolved;
  return <PlayerCardInner name={name} c={c} squadFacts={squadFacts} onClose={onClose} headExtra={headExtra} />;
}

function PlayerCardInner({
  name,
  c,
  squadFacts,
  onClose,
  headExtra,
}: {
  name: string;
  c: PlayerCandidate | null | undefined;
  squadFacts?: SquadFacts | null;
  onClose: () => void;
  headExtra?: React.ReactNode;
}) {
  // ---- Wikipedia narrative (only when a verified candidate exists) ----
  const [wiki, setWiki] = useState<WikipediaSummary | null | undefined>(undefined);
  useEffect(() => {
    if (!c) return;
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
  }, [c?.qid, c?.sitelinks]);

  // ---- infobox layer (chained on the summary's identity guard) ----
  const [infobox, setInfobox] = useState<InfoboxData | null | undefined>(undefined);
  useEffect(() => {
    if (!c) return;
    let cancelled = false;
    setInfobox(undefined);
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
  }, [wiki, c?.qid, c?.sitelinks]);

  // ---- merge, exactly as the former-player card does ----
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

  const heightCm = c?.heightCm ?? infobox?.heightCm;
  const position = c?.position ?? infobox?.position;
  // Ties go to the infobox — Wikidata's P582 end-years are stale (Ericsson).
  const careerIsInfobox = (infobox?.career.length ?? 0) >= (c?.career.length ?? 0) && (infobox?.career.length ?? 0) > 0;
  const career: DisplayStint[] = careerIsInfobox
    ? (infobox?.career ?? []).map(fromInfobox)
    : (c?.career ?? []).map(fromWikidata);
  const nationalIsInfobox =
    (infobox?.national.length ?? 0) >= (c?.nationalTeams.length ?? 0) && (infobox?.national.length ?? 0) > 0;
  const nationalTeams: DisplayStint[] = nationalIsInfobox
    ? (infobox?.national ?? []).map(fromInfobox)
    : (c?.nationalTeams ?? []).map(fromWikidata);

  return (
    <Sheet
      title={name}
      subtitle={c?.description ?? squadFacts?.positionLabel ?? undefined}
      onClose={onClose}
      headExtra={headExtra}
    >
      <div className="stack-4">
        {c?.fromSnapshot && (
          <p className="small dim" style={{ margin: 0 }} data-testid="from-snapshot">
            Det här visas från din sparade stjärna, inte från en ny sökning. Sök igen på namnet för att hämta
            aktuella uppgifter.
          </p>
        )}

        {c && c.alsoKnownAs.length > 0 && (
          <p className="small muted" style={{ margin: 0 }} data-testid="aka">
            Sökbar även som: {c.alsoKnownAs.join(", ")}
          </p>
        )}

        <div className="player-head">
          <div className="player-head-facts">
            {/* ---- squad-season facts: the data ONLY the squad has ---- */}
            {squadFacts && (
              <div style={{ marginBottom: 8 }} data-testid="squad-facts">
                <div className="kv">
                  <Stat v={squadFacts.matchesPlayed} l="Matcher" />
                  <Stat v={squadFacts.goals} l="Mål" />
                  <Stat v={squadFacts.assists} l="Assist" />
                  <Stat v={squadFacts.yellowCards} l="Gult" />
                  <Stat v={squadFacts.redCards} l="Rött" />
                </div>
                {squadFacts.cardState && (
                  <p className="small dim" style={{ margin: "6px 0 0" }} data-testid="squad-card-state">
                    Kortläge: {squadFacts.cardState}.
                  </p>
                )}
              </div>
            )}

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
                <Stat v={c?.dateOfBirth ?? null} l="Född" isText />
                <Stat v={heightCm ?? null} l="Längd cm" />
                <Stat v={position ?? squadFacts?.positionLabel ?? null} l="Position" isText />
                <Stat v={c?.citizenship[0] ?? null} l="Nationalitet" isText />
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
              {c?.dateOfDeath && (
                <p className="small dim" style={{ margin: "6px 0 0" }} data-testid="died">
                  Avled {fmtDay(c.dateOfDeath)}.
                </p>
              )}
            </div>
          </div>

          {/* ---- photo — small, top right, only when a source has one ---- */}
          {c?.imageUrl && (
            <img
              src={commonsImageUrl(c.imageUrl)}
              alt={name}
              loading="lazy"
              decoding="async"
              className="player-photo"
              data-testid="player-photo"
            />
          )}
        </div>

        {/* ---- career ---- */}
        {c && (
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
        )}

        {/* ---- national teams ---- */}
        {c && nationalTeams.length > 0 && (
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
        {c && (
          <div>
            <div className="mod-label">Källa</div>
            <p className="small dim prov" style={{ margin: 0 }} data-testid="provenance">
              Uppgifterna kommer från Wikidata och Wikipedia och kan vara ofullständiga.{" "}
              <a className="link" href={c.pageUrl} target="_blank" rel="noopener noreferrer">
                Öppna Wikidata-posten ({c.qid})
              </a>
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * One value in the identity grid. `.kv .k .v` is sized for NUMBERS; `isText`
 * drops a text value to a size that fits.
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
