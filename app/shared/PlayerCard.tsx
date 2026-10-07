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
} from "../players/wikidata";
import {
  fetchWikipediaSummary,
  candidateLangs,
  readWikiCache,
  writeWikiCache,
  type WikipediaSummary,
} from "../players/wikipedia";
import {
  fetchInfobox,
  readInfoboxCache,
  writeInfoboxCache,
  type InfoboxData,
} from "../players/infobox";
import { mergeCareerStints } from "../players/careerMerge";
import { translateText, readTranslationCache, writeTranslationCache } from "../players/translate";
import type { SquadEnrichment } from "../../pipeline/src/squadEnrichment";

/** Swedish names for the Wikipedia languages we may show, for provenance. */
const LANG_NAME: Record<string, string> = {
  sv: "svenska",
  en: "engelska",
  nb: "norska",
  nn: "nynorska",
  no: "norska",
  da: "danska",
  fi: "finska",
  is: "isländska",
  de: "tyska",
  fr: "franska",
  es: "spanska",
  it: "italienska",
  pt: "portugisiska",
  nl: "nederländska",
  pl: "polska",
  tr: "turkiska",
  ru: "ryska",
  uk: "ukrainska",
  hr: "kroatiska",
  sr: "serbiska",
  bs: "bosniska",
  sl: "slovenska",
  mk: "makedonska",
  bg: "bulgariska",
  cs: "tjeckiska",
  sk: "slovakiska",
  hu: "ungerska",
  ro: "rumänska",
  el: "grekiska",
  sq: "albanska",
  ar: "arabiska",
  fa: "persiska",
  he: "hebreiska",
  ka: "georgiska",
  hy: "armeniska",
  az: "azerbajdzjanska",
  kk: "kazakiska",
  uz: "uzbekiska",
  ja: "japanska",
  ko: "koreanska",
  zh: "kinesiska",
  id: "indonesiska",
  ms: "malajiska",
  vi: "vietnamesiska",
  th: "thailändska",
  ca: "katalanska",
  gl: "galiciska",
  eu: "baskiska",
  et: "estniska",
  lv: "lettiska",
  lt: "litauiska",
  af: "afrikaans",
  sw: "swahili",
};

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
  enrichment,
  squadFacts,
  onClose,
  headExtra,
}: {
  /** The display name the card opens under — squad name or Wikidata label. */
  name: string;
  /** A full Wikidata candidate, when one is already known (search path). */
  candidate?: PlayerCandidate | null;
  /**
   * Pre-resolved enrichment from the pipeline (squad path). When present the
   * card renders instantly with no live request — the whole point of
   * resolving the squad once per nightly instead of per device.
   */
  enrichment?: SquadEnrichment | null;
  /** Squad-season facts, when the player is a current squad member. */
  squadFacts?: SquadFacts | null;
  onClose: () => void;
  /** Extra header controls (star, refresh) owned by the caller. */
  headExtra?: React.ReactNode;
}) {
  /**
   * The Wikidata candidate. Priority: an explicit candidate (search path),
   * then the pipeline's pre-resolved enrichment (squad path), then a live
   * search by name as the fallback for a player the pipeline could not
   * resolve.
   */
  const [resolved, setResolved] = useState<PlayerCandidate | null | undefined>(() => {
    if (candidate !== undefined) return candidate;
    if (enrichment) return enrichment.candidate;
    return undefined;
  });
  useEffect(() => {
    if (candidate !== undefined) {
      setResolved(candidate);
      return;
    }
    if (enrichment) {
      setResolved(enrichment.candidate);
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
  }, [candidate, enrichment, name]);

  const c = resolved;
  return (
    <PlayerCardInner
      name={name}
      c={c}
      enrichment={enrichment}
      squadFacts={squadFacts}
      onClose={onClose}
      headExtra={headExtra}
    />
  );
}

function PlayerCardInner({
  name,
  c,
  enrichment,
  squadFacts,
  onClose,
  headExtra,
}: {
  name: string;
  c: PlayerCandidate | null | undefined;
  enrichment?: SquadEnrichment | null;
  squadFacts?: SquadFacts | null;
  onClose: () => void;
  headExtra?: React.ReactNode;
}) {
  // ---- Wikipedia narrative (only when a verified candidate exists) ----
  //
  // When the pipeline pre-resolved this player, the narrative is already in
  // `enrichment.wiki` — no request, no spinner. The live path below is the
  // fallback for a player the pipeline could not resolve.
  const [wiki, setWiki] = useState<WikipediaSummary | null | undefined>(undefined);
  useEffect(() => {
    if (!c) return;
    if (enrichment?.wiki) {
      setWiki({
        lang: enrichment.wiki.lang,
        extract: enrichment.wiki.extract,
        imageUrl: enrichment.wiki.imageUrl,
        pageUrl: enrichment.wiki.pageUrl,
        wikibaseItem: c.qid,
      });
      return;
    }
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
  //
  // Tries the preferred languages FIRST, then the player's home-country
  // languages, and keeps the first infobox that yields data. Measured
  // 2026-10-07: Brice Wembangomo has NO sv infobox but a full Norwegian one
  // (seven clubs with years and apps), so stopping at sv/en lost his career.
  const [infobox, setInfobox] = useState<InfoboxData | null | undefined>(undefined);
  useEffect(() => {
    if (!c) return;
    // The pipeline already merged the infobox into `enrichment.career`, so
    // there is nothing to fetch — the merge section below uses it directly.
    if (enrichment) {
      setInfobox(null);
      return;
    }
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
      const langs = candidateLangs(c.sitelinks);
      for (const lang of langs) {
        const title = c.sitelinks[`${lang}wiki`]?.title;
        if (!title) continue;
        const data = await fetchInfobox(lang, title, { fetch: window.fetch.bind(window) });
        if (cancelled) return;
        if (data) {
          writeInfoboxCache(key, data, Date.now());
          setInfobox(data);
          return;
        }
      }
      if (!cancelled) {
        writeInfoboxCache(key, null, Date.now());
        setInfobox(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wiki, c?.qid, c?.sitelinks]);

  // ---- translation of a non-Swedish narrative ----
  //
  // The app's audience reads Swedish. A Norwegian or German paragraph shown
  // raw is not enrichment, so it is machine-translated and LABELLED as such.
  // A failed translation falls back to the original text with a note — never
  // a fabricated Swedish sentence.
  const [translated, setTranslated] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!wiki || wiki.lang === "sv") {
      setTranslated(undefined);
      return;
    }
    // The pipeline already translated this narrative.
    if (enrichment?.wiki?.translated) {
      setTranslated(enrichment.wiki.translated);
      return;
    }
    let cancelled = false;
    setTranslated(undefined);
    const cached = readTranslationCache(wiki.extract, wiki.lang, "sv", Date.now());
    if (cached !== undefined) {
      setTranslated(cached);
      return;
    }
    void (async () => {
      const out = await translateText(wiki.extract, wiki.lang, "sv", { fetch: window.fetch.bind(window) });
      if (cancelled) return;
      writeTranslationCache(wiki.extract, wiki.lang, "sv", out, Date.now());
      setTranslated(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [wiki?.extract, wiki?.lang, enrichment?.wiki?.translated]);

  // ---- merge: the UNION of both sources, never a choice ----
  //
  // Picking one source silently dropped real clubs (measured 2026-10-07):
  // Berisha's Häcken stint is unqualified in Wikidata but dated in the
  // infobox, and the old "more rows wins" rule chose Wikidata and lost it.
  // The union keeps every club either source knows, preferring the infobox's
  // row when both describe the same club (its years are the current ones).
  //
  // When the pipeline pre-resolved the player, the union is ALREADY in
  // `enrichment.career` — use it directly rather than re-merging.
  const heightCm = c?.heightCm ?? infobox?.heightCm ?? enrichment?.heightCm;
  const position = c?.position ?? infobox?.position ?? enrichment?.position;
  const careerMerge = enrichment
    ? { stints: enrichment.career, usedInfobox: enrichment.usedInfobox }
    : mergeCareerStints(c?.career ?? [], infobox?.career ?? []);
  const career = careerMerge.stints;
  const careerIsInfobox = careerMerge.usedInfobox;
  const nationalMerge = enrichment
    ? { stints: enrichment.nationalTeams }
    : mergeCareerStints(c?.nationalTeams ?? [], infobox?.national ?? []);
  const nationalTeams = nationalMerge.stints;

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

            {/* ---- no Wikidata/Wikipedia match: say so, never render silently ---- */}
            {c === null && (
              <p className="small dim" style={{ margin: "0 0 4px" }} data-testid="no-wiki-data">
                Ingen data hittades i Wikidata eller Wikipedia för det här namnet.
                {squadFacts ? " Säsongssiffrorna ovan kommer från den egna truppdatan." : ""}
              </p>
            )}
            {c === undefined && (
              <p className="small dim" style={{ margin: "0 0 4px" }} data-testid="wiki-loading">
                Söker i Wikidata och Wikipedia…
              </p>
            )}

            {/* ---- Wikipedia narrative, when a verified article exists ---- */}
            {wiki ? (
              <div>
                <p className="small" style={{ margin: "0 0 4px" }} data-testid="wiki-extract">
                  {translated ?? wiki.extract}
                </p>
                {wiki.lang !== "sv" && (
                  <p className="small dim" style={{ margin: "0 0 4px" }} data-testid="wiki-translation-note">
                    {translated
                      ? `Maskinöversatt från ${LANG_NAME[wiki.lang] ?? wiki.lang}.`
                      : `Texten är på ${LANG_NAME[wiki.lang] ?? wiki.lang} — översättning kunde inte hämtas.`}
                  </p>
                )}
                <p className="small dim" style={{ margin: 0 }} data-testid="wiki-source">
                  <a className="link" href={wiki.pageUrl} target="_blank" rel="noopener noreferrer">
                    Läs hela artikeln ({LANG_NAME[wiki.lang] ?? wiki.lang} Wikipedia)
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
                    År och matcher kommer från Wikipedia där Wikidata saknar dem.
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
