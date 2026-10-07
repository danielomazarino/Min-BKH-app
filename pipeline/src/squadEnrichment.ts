/**
 * Squad enrichment — resolve every current squad player to Wikidata/Wikipedia
 * ONCE, in the pipeline, so the app never has to.
 *
 * WHY THIS EXISTS (user, 2026-10-07)
 * ----------------------------------
 * "users get the player cards for the squad updated for all players in the tab
 * Trupp". The squad card resolves its Wikidata candidate from the player's
 * NAME at open time, which means:
 *   - the first open of each player costs 2-4 live requests and shows a
 *     "Söker i Wikidata…" spinner,
 *   - a name the prefix index misses (measured: "Adam Lundkvist" returns ZERO
 *     index hits) needs the cirrus fallback to rescue it,
 *   - and every supporter pays that cost again on their own device.
 *
 * Resolving the 27 players here, once per nightly, turns all of that into a
 * static lookup: the card opens instantly with data already present, and the
 * client-side search becomes a fallback for players the pipeline could not
 * resolve rather than the primary path.
 *
 * WHAT IS STORED
 * --------------
 * The full `PlayerCandidate` (career, national teams, photo, sitelinks) plus
 * the merged career from the Wikipedia infobox — the same union the card
 * renders. The infobox is fetched in the player's home-country language when
 * sv/en have nothing (measured: Brice Wembangomo's whole career is on nowiki).
 *
 * FAILURE IS PER-PLAYER, NEVER FATAL
 * ----------------------------------
 * A player the pipeline cannot resolve is simply absent from the map; the app
 * falls back to its live search for that player. One bad name must never fail
 * the nightly, and a Wikidata outage must never empty the squad.
 */
import type { SeasonPlayerStat } from "./types";
import { searchPlayersOnline, type PlayerCandidate } from "../../app/players/wikidata";
import { fetchInfobox, type InfoboxData } from "../../app/players/infobox";
import { candidateLangs, fetchWikipediaSummary } from "../../app/players/wikipedia";
import { translateText } from "../../app/players/translate";
import { mergeCareerStints, type DisplayStint } from "../../app/players/careerMerge";

/** The narrative layer, resolved and (when needed) translated to Swedish. */
export interface SquadWiki {
  /** The article language actually used. */
  lang: string;
  /** The lead paragraph, in its original language. */
  extract: string;
  /** The Swedish machine translation, when the article was not Swedish. */
  translated?: string;
  pageUrl: string;
  imageUrl?: string;
}

/** One squad player's resolved enrichment, as stored in app.json. */
export interface SquadEnrichment {
  /** The squad player this belongs to (canonical id). */
  playerId: string;
  /** The name the pipeline searched with (the squad's spelling). */
  queryName: string;
  /** The Wikidata Q-ID, when one was found. */
  qid: string;
  /** The Wikidata label — may differ from the squad spelling. */
  name: string;
  description?: string;
  dateOfBirth?: string;
  citizenship: string[];
  position?: string;
  heightCm?: number;
  imageUrl?: string;
  pageUrl: string;
  /** Merged club career (infobox ∪ Wikidata), newest first. */
  career: DisplayStint[];
  /** Merged national-team periods. */
  nationalTeams: DisplayStint[];
  /** The language the infobox came from, when one did. */
  infoboxLang?: string;
  /** True when the infobox contributed rows to the career. */
  usedInfobox: boolean;
  /** The Wikipedia narrative, resolved and translated. */
  wiki?: SquadWiki;
  /** The full candidate, so the card can render everything without a search. */
  candidate: PlayerCandidate;
}

/** How many players to resolve concurrently. Wikidata allows ~10 req/min. */
const CONCURRENCY = 2;

/**
 * Delay between batches, in ms.
 *
 * Each player costs ~3 Wikidata requests (search, hydrate, label resolution)
 * plus Wikipedia and translation calls on other hosts. Wikidata's documented
 * limit is ~10 requests/minute, so 2 players per 12s keeps us at the ceiling
 * without tripping it. The nightly is not latency-sensitive; a slow, complete
 * enrichment beats a fast, rate-limited one that silently drops players.
 */
const BATCH_DELAY_MS = 12_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve ONE squad player. Returns null when Wikidata has nothing
 * trustworthy — the honest answer, not an error.
 */
export async function enrichSquadPlayer(
  player: SeasonPlayerStat,
  deps: { fetch: typeof fetch },
): Promise<SquadEnrichment | null> {
  const result = await searchPlayersOnline(player.playerName, { fetch: deps.fetch });
  if (result.status !== "results" || result.candidates.length === 0) return null;
  const candidate = result.candidates[0];

  // The infobox, in the first language that yields data. sv/en first, then the
  // player's home-country languages (the entity's own sitelinks).
  let infobox: InfoboxData | null = null;
  for (const lang of candidateLangs(candidate.sitelinks)) {
    const title = candidate.sitelinks[`${lang}wiki`]?.title;
    if (!title) continue;
    const data = await fetchInfobox(lang, title, { fetch: deps.fetch });
    if (data) {
      infobox = data;
      break;
    }
  }

  const careerMerge = mergeCareerStints(candidate.career, infobox?.career ?? []);
  const nationalMerge = mergeCareerStints(candidate.nationalTeams, infobox?.national ?? []);

  // The narrative layer, resolved and translated to Swedish when needed, so
  // the card shows a readable paragraph with no live request.
  let wiki: SquadWiki | undefined;
  const summary = await fetchWikipediaSummary(candidate.qid, candidate.sitelinks, { fetch: deps.fetch });
  if (summary) {
    let translated: string | undefined;
    if (summary.lang !== "sv") {
      const out = await translateText(summary.extract, summary.lang, "sv", { fetch: deps.fetch });
      if (out) translated = out;
    }
    wiki = {
      lang: summary.lang,
      extract: summary.extract,
      translated,
      pageUrl: summary.pageUrl,
      imageUrl: summary.imageUrl,
    };
  }

  return {
    playerId: player.playerId,
    queryName: player.playerName,
    qid: candidate.qid,
    name: candidate.name,
    description: candidate.description,
    dateOfBirth: candidate.dateOfBirth,
    citizenship: candidate.citizenship,
    position: candidate.position ?? infobox?.position,
    heightCm: candidate.heightCm ?? infobox?.heightCm,
    imageUrl: candidate.imageUrl ?? wiki?.imageUrl,
    pageUrl: candidate.pageUrl,
    career: careerMerge.stints,
    nationalTeams: nationalMerge.stints,
    infoboxLang: infobox?.lang,
    usedInfobox: careerMerge.usedInfobox,
    wiki,
    candidate: trimCandidate(candidate),
  };
}

/**
 * A minimal candidate for storage.
 *
 * The full candidate is ~5.5 KB per player — 39 sitelinks alone are 2.4 KB —
 * and app.json is downloaded by every supporter. The card, when given
 * enrichment, reads only the scalar fields below plus the (already stored)
 * career and wiki; the sitelinks are kept only for the languages the card
 * would try if it ever had to fall back to a live fetch. Measured 2026-10-07:
 * this cuts the stored candidate from 5.5 KB to ~1.6 KB.
 */
function trimCandidate(c: PlayerCandidate): PlayerCandidate {
  const keepLangs = new Set([...candidateLangs(c.sitelinks), "sv", "en"]);
  const sitelinks: Record<string, { title: string }> = {};
  for (const [k, v] of Object.entries(c.sitelinks)) {
    const lang = k.endsWith("wiki") ? k.slice(0, -4) : k;
    if (keepLangs.has(lang)) sitelinks[k] = v;
  }
  return {
    qid: c.qid,
    name: c.name,
    alsoKnownAs: c.alsoKnownAs,
    description: c.description,
    dateOfBirth: c.dateOfBirth,
    dateOfDeath: c.dateOfDeath,
    citizenship: c.citizenship,
    clubs: [],
    career: [],
    nationalTeams: [],
    position: c.position,
    sitelinks,
    hackenClub: c.hackenClub,
    hackenTeam: c.hackenTeam,
    gender: c.gender,
    heightCm: c.heightCm,
    imageUrl: c.imageUrl,
    pageUrl: c.pageUrl,
    matchScore: c.matchScore,
  };
}

/**
 * Resolve the whole squad, bounded concurrency, per-player failure tolerated.
 *
 * Returns a map keyed by canonical player id. A player that fails is simply
 * missing; the caller stores what it got.
 */
export async function enrichSquad(
  squad: readonly SeasonPlayerStat[],
  deps: { fetch: typeof fetch; log?: (msg: string) => void; delayMs?: number },
): Promise<Record<string, SquadEnrichment>> {
  const out: Record<string, SquadEnrichment> = {};
  const log = deps.log ?? (() => {});
  const delayMs = deps.delayMs ?? BATCH_DELAY_MS;

  for (let i = 0; i < squad.length; i += CONCURRENCY) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const batch = squad.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (p) => {
        try {
          return { p, e: await enrichSquadPlayer(p, deps) };
        } catch (err) {
          log(`  enrichment failed for ${p.playerName}: ${err instanceof Error ? err.message : String(err)}`);
          return { p, e: null };
        }
      }),
    );
    for (const { p, e } of settled) {
      if (e) out[p.playerId] = e;
      else log(`  no Wikidata match for ${p.playerName}`);
    }
  }

  log(`  enriched ${Object.keys(out).length}/${squad.length} squad players`);
  return out;
}
