import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AppData,
  Freshness,
  FormerPlayer,
  FormerPlayerCareerEvent,
  FormerPlayersData,
  FootballSourceMeta,
  LeagueTableRow,
  MatchDetail,
  MatchRef,
  NewsItem,
  SeasonPlayerStat,
  SourceStatus,
} from "./types";
import { fetchRss } from "./rss";
import { classifyNews } from "./classify";
import { dedupeNews } from "./dedupe";
import { buildNewsEvents, publisherRole } from "./newsEvents";
import type { WarningEvent } from "./warnings";
import { loadRegistry } from "./registry";
import { firecrawlSearch, playerQuery } from "./firecrawl";
import { readLastKnownGood } from "./stale";
import { prefilterNews, DEFAULT_WINDOW_DAYS } from "./newsPrefilter";
import { fetchArticleTexts } from "./articleText";
import {
  buildEventsFromGemini,
  synthesizeWithGemini,
  type GeminiArticleInput,
} from "./gemini";
import { pickNextAndLast } from "./normalize";
import { normalizeSearch } from "./search";
import {
  ALLSVENSKAN_LEAGUE_ID,
  API_FOOTBALL_MAX_SEASON,
  fetchPlayerStatistics,
} from "./apifootball";
import {
  BKH_ABBRV,
  CURRENT_SEASON,
  fetchMatchDetailSm,
  fetchMatchesSm,
  fetchSquadSm,
  fetchStandingsSm,
} from "./sportomedia";
import {
  assertNotHammarby,
  normalizeSmEvents,
  normalizeSmMatch,
  normalizeSmSquad,
  normalizeSmStandings,
} from "./smNormalize";
import { matchesSquadPlayer, resolveCanonicalId } from "./playerIdentity";
import { buildLedger, computeSeasonDiscipline, type CardEvent } from "./discipline";
import { classifyRelevance, type KnownPersons } from "./newsRelevance";
import { getRule } from "./rules";

const DATA_DIR = resolve(import.meta.dirname, "../../public/data");

/**
 * News sources (all verified 2026-09-25, see docs/SOURCES.md for the audit).
 * Roles per publication are in newsEvents.ts.
 */
/**
 * Known BK Häcken women's-team players — used as women's-context evidence in
 * news classification. Sourced from bkhacken.se/lag/dam/trupp (verified
 * 2026-09-25). A secondary-source article mentioning any of these players is
 * treated as women's-team coverage, never men's.
 */
const KNOWN_WOMEN_PLAYERS = [
  "Jennifer Falk",
  "Hanna Karlsson",
  "Disa Hellwig",
  "Ella McBride",
  "Tabby Tindell",
  "Josefine Rybrink",
  "Lisa Löwing",
  "Alva Selerud",
  "Stine Sandbech",
  "Emma Östlund",
  "Aivi Luik",
  "Halimatu Ayinde",
  "Helena Sampaio",
  "Elin Rubensson",
  "Nathalie Staaf",
  "Faith Chinzimu",
  "Josefin Baudou",
  "Pernille Sanvig",
  "Laney Egbuka",
  "Julie Steen",
  "Tilde Karlsson",
  "Tuva Ölvestad",
  "Anna Anvegård",
  "Maja Bodin",
  "Joy Omewa",
];

const RSS_SOURCES = [
  { url: "https://bkhacken.se/feed", publisher: "BK Häcken" },
  { url: "https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/", publisher: "Sportbladet" },
  { url: "https://feeds.expressen.se/sport/fotboll/", publisher: "Expressen" },
  { url: "https://www.svt.se/sport/rss.xml", publisher: "SVT Sport" },
  { url: "https://www.bollsvenskan.se/feed/", publisher: "Bollsvenskan" },
  { url: "https://allsvenskan.se/feed/", publisher: "Allsvenskan" },
];

const STATUS: Record<string, SourceStatus> = {};

function generatedAt(): string {
  return new Date().toISOString();
}

function freshness(): Freshness {
  return { generatedAt: generatedAt(), sourceStatus: { ...STATUS } };
}

// ---------- news ----------

async function collectNews(): Promise<NewsItem[]> {
  const all: NewsItem[] = [];
  for (const src of RSS_SOURCES) {
    const feed = await fetchRss(src.url, src.publisher);
    STATUS[`rss:${src.publisher}`] = feed.ok ? "ok" : "failed";
    if (feed.ok) {
      for (const item of feed.items) {
        item.category = classifyNews(item.title, item.summary ?? "");
        item.sourceRole = publisherRole(src.publisher);
      }
      all.push(...feed.items);
    }
  }
  return dedupeNews(all);
}

// ---------- football data ----------

interface FootballData {
  matches: MatchRef[];
  table: LeagueTableRow[];
  lastMatchDetail: MatchDetail | null;
  warningEvents: WarningEvent[];
  /** Provenance metadata for the football dataset. */
  source: FootballSourceMeta | null;
  /** Set when current data could not be retrieved. */
  unavailableReason: string | null;
  squadStats: SeasonPlayerStat[];
  /** Season-level disciplinary ledger (chronological, rule-applied). */
  discipline: ReturnType<typeof computeSeasonDiscipline>;
  /** How many finished matches contributed card events. */
  cardMatchesInspected: number;
  /** The disciplinary rule applied. */
  disciplineRule?: AppData["disciplineRule"];
}

const SM_QUERY_VERSION = "sm-2026-09-25";

function footballSourceMeta(retrievedAt: string, dataStatus: FootballSourceMeta["dataStatus"]): FootballSourceMeta {
  return {
    provider: "SportoMedia",
    publicSite: "allsvenskan.se",
    provenance: "SportoMedia data service used by allsvenskan.se (Svensk Elitfotboll)",
    sourceUrl: "https://gql.sportomedia.se/graphql",
    retrievedAt,
    season: String(CURRENT_SEASON),
    competition: "Allsvenskan",
    dataStatus,
    queryVersion: SM_QUERY_VERSION,
  };
}

/**
 * Current football data via SportoMedia GraphQL (the service behind
 * allsvenskan.se). Season 2026 only — NO historical fallback. If retrieval
 * fails, the dataset is marked unavailable and the UI must say so.
 */
async function collectCurrentFootballData(): Promise<FootballData> {
  const empty: FootballData = { matches: [], table: [], lastMatchDetail: null, warningEvents: [], source: null, unavailableReason: null, squadStats: [], discipline: [], cardMatchesInspected: 0 };
  const retrievedAt = generatedAt();

  // Identity guard: we query BKH and must never receive Hammarby data.
  assertNotHammarby(BKH_ABBRV, "current-data query");

  // 1) Fixtures/results (season window covers the whole 2026 calendar year).
  const seasonStart = `${CURRENT_SEASON}-01-01`;
  const seasonEnd = `${CURRENT_SEASON}-12-31`;
  const fx = await fetchMatchesSm(seasonStart, seasonEnd);  if (!fx.status.ok || !fx.matches) {
    STATUS.sportomedia = "failed";
    console.error("SportoMedia fixtures error:", fx.status.error);
    return { ...empty, unavailableReason: `Fixtures ej tillgängliga: ${fx.status.error ?? "okänt fel"}` };
  }

  // 2) Standings.
  const st = await fetchStandingsSm();
  if (!st.status.ok || !st.rows) {
    STATUS.sportomedia = "failed";
    console.error("SportoMedia standings error:", st.status.error);
    return { ...empty, unavailableReason: `Tabell ej tillgänglig: ${st.status.error ?? "okänt fel"}` };
  }

  // 3) Squad + season player stats.
  const sq = await fetchSquadSm();
  STATUS.sportomedia = "ok";
  const squadStats = sq.status.ok && sq.squad ? normalizeSmSquad(sq.squad) : [];
  if (!sq.status.ok) console.error("SportoMedia squad error:", sq.status.error);

  const matches = fx.matches.map(normalizeSmMatch);
  const table = normalizeSmStandings(st.rows);
  const { last, upcoming } = pickNextAndLast(matches);

  // Canonical identity map: squad players get fogisId-based canonical ids.
  // Event player names are mapped to canonical ids via normalized name match
  // at ingestion time (stored, not re-matched at runtime).
  const squadNameToId = new Map<string, string>();
  for (const p of squadStats) {
    squadNameToId.set(p.playerName, p.playerId);
  }
  const idResolver = (eventName: string): string => {
    for (const [squadName, id] of squadNameToId) {
      if (matchesSquadPlayer(eventName, squadName)) return id;
    }
    // Player not in current squad (departed mid-season or opponent misattribution):
    // deterministic name-based canonical id.
    return resolveCanonicalId({ name: eventName });
  };

  // 4) Match detail (events) for the most recent finished match + season-wide
  //    card events for the disciplinary ledger.
  let lastMatchDetail: MatchDetail | null = null;
  const warningEvents: WarningEvent[] = [];
  const finished = matches.filter((m) => m.status === "finished").sort((a, b) => a.date.localeCompare(b.date));
  const perMatchCards: Array<{ matchId: number; matchDate: string; häckenYellows: string[]; häckenReds: string[] }> = [];
  let cardMatchesInspected = 0;

  for (const m of finished) {
    const det = await fetchMatchDetailSm(m.id);
    if (!det.status.ok || !det.match) {
      console.error(`SportoMedia match detail error (${m.id}):`, det.status.error);
      continue;
    }
    const ev = normalizeSmEvents(det.match.matchEvents);
    cardMatchesInspected++;
    perMatchCards.push({
      matchId: m.id,
      matchDate: m.date,
      häckenYellows: ev.yellowCards.filter((c) => c.teamName?.includes("Häcken")).map((c) => c.playerName),
      häckenReds: ev.redCards.filter((c) => c.teamName?.includes("Häcken")).map((c) => c.playerName),
    });
    if (last && m.id === last.id) {
      lastMatchDetail = {
        ...m,
        events: { goals: ev.goals, yellowCards: ev.yellowCards, redCards: ev.redCards, substitutions: ev.substitutions },
      };
    }
    // Small delay to stay well under any rate limits (22 requests total).
    await new Promise((r) => setTimeout(r, 300));
  }

  // 5) Season disciplinary ledger (chronological, rule-applied).
  const cardEvents: CardEvent[] = buildLedger(
    perMatchCards,
    idResolver,
    "allsvenskan",
    String(CURRENT_SEASON),
  );
  const rule = getRule("allsvenskan", String(CURRENT_SEASON));
  const discipline = computeSeasonDiscipline(
    cardEvents,
    { threshold: rule?.threshold ?? 3, suspensionMatches: rule?.suspensionMatches ?? 1 },
    finished.map((m) => m.date),
    upcoming.length ? { matchId: upcoming[0].id, date: upcoming[0].date } : null,
  );

  // Legacy warningEvents shape for computeWarnings compatibility (not used for UI anymore).
  for (const ce of cardEvents.filter((e) => e.kind === "yellow")) {
    warningEvents.push({
      playerId: 0,
      playerName: ce.playerName,
      competition: ce.competition,
      matchId: ce.matchId,
      matchDate: ce.matchDate,
      season: ce.season,
    });
  }
  void warningEvents;

  return {
    matches,
    table,
    lastMatchDetail,
    warningEvents,
    source: footballSourceMeta(retrievedAt, "current"),
    unavailableReason: null,
    squadStats,
    discipline,
    cardMatchesInspected,
    disciplineRule: rule
      ? { rule: rule.rule, ruleSource: rule.ruleSource, ruleSourceUrl: rule.ruleSourceUrl, threshold: rule.threshold, suspensionMatches: rule.suspensionMatches }
      : undefined,
  };
}

// ---------- former players ----------

async function collectFormerPlayers(currentSquadNames: string[]): Promise<FormerPlayer[]> {
  const registry = loadRegistry();
  const out: FormerPlayer[] = [];

  // B5 registry correction: a registry entry whose name matches a player in
  // the CURRENT SportoMedia squad is not a former player — exclude them
  // (e.g. Julius Lindberg, Filip Helander returned to the club). Uses the
  // same ingestion-time matcher as card events so "Mikkel Rygaard" (registry)
  // matches "Mikkel Rygaard Jensen" (squad).
  for (const entry of registry) {
    const isCurrent = currentSquadNames.some(
      (squadName) => matchesSquadPlayer(entry.name, squadName) ||
        (entry.aliases ?? []).some((a) => matchesSquadPlayer(a, squadName)),
    );
    if (isCurrent) continue;
    const base: FormerPlayer = {
      id: entry.id,
      name: entry.name,
      aliases: entry.aliases,
      apiFootballId: entry.apiFootballId,
      currentClub: null,
      currentLeague: null,
      currentCountry: null,
      clubVerified: false,
      stats: null,
      contract: null,
      latestEvent: null,
    };

    // Structured stats via API-Football when we know the id and have a key.
    // API-Football Free is HISTORICAL ONLY (seasons 2022-2024, team ID 367).
    if (entry.apiFootballId && process.env.API_FOOTBALL_KEY && STATUS.apiFootball === "ok") {
      const res = await fetchPlayerStatistics(entry.apiFootballId, API_FOOTBALL_MAX_SEASON, ALLSVENSKAN_LEAGUE_ID);
      if (res.status.ok && res.data) {
        // Only fill what the API verifiably returns for a Häcken-connected league;
        // former players mostly play abroad, so this stays conservative.
      }
    }

    // Career news discovery via Firecrawl Keyless (only if it works; failure is silent).
    const fc = await firecrawlSearch(playerQuery(entry.name), 3);
    if (fc.status.ok && fc.results.length > 0) {
      const first = fc.results[0];
      const ev: FormerPlayerCareerEvent = {
        playerId: entry.id,
        playerName: entry.name,
        topic: "other",
        claim: first.description?.slice(0, 200) ?? first.title,
        sourceName: new URL(first.url).hostname,
        sourceUrl: first.url,
        retrievedAt: generatedAt(),
        discoveredVia: "firecrawl",
        verificationStatus: "unverified",
      };
      base.latestEvent = ev;
    }

    out.push(base);
  }
  return out;
}

async function collectFormerPlayersData(currentSquadNames: string[]): Promise<FormerPlayersData> {
  const players = await collectFormerPlayers(currentSquadNames);
  return { ...freshness(), players };
}

// ---------- main ----------

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const news = await collectNews();
  const foot = await collectCurrentFootballData();
  const formerPlayers = await collectFormerPlayersData(foot.squadStats.map((p) => p.playerName));

  const { next, last, upcoming, recent } = pickNextAndLast(foot.matches);

  // Entity/relation-based news relevance (replaces generic keyword matching).
  // Women's-team identity evidence: known women's squad players + Damallsvenskan
  // opponents. Sourced from bkhacken.se dam trupp (verified 2026-09-25).
  const known: KnownPersons = {
    currentPlayers: foot.squadStats.map((p) => p.playerName),
    formerPlayers: formerPlayers.players.map((p) => p.name),
    womenPlayers: KNOWN_WOMEN_PLAYERS,
    womenContextTerms: [
      "damallsvenskan", "svenska cupen dam", "champions league dam", "europa cup dam",
      // Damallsvenskan opponents — a Häcken article about these teams is women's coverage
      "vittsjö gik", "eskilstuna united", "vittsjö", "bk häcken dam", "häcken dam",
    ],
  };
  // ---------- news: deterministic pre-filter → Gemini synthesis ----------
  //
  // Gemini is the semantic authority on men's vs women's team and on which
  // articles describe the same underlying event. The pre-filter only removes
  // cheap, unambiguous noise (date window, ads, non-Häcken league coverage).
  const windowDays = Number(process.env.NEWS_WINDOW_DAYS ?? DEFAULT_WINDOW_DAYS);
  const { candidates, dropped } = prefilterNews(news, { windowDays });
  console.log(`news: ${candidates.length} candidates, ${dropped.length} dropped before Gemini`);

  // Server-side article text (the browser never fetches article bodies).
  const texts = await fetchArticleTexts(candidates.map((c) => c.url));
  let textFailures = 0;
  const geminiInput: GeminiArticleInput[] = candidates.map((c) => {
    const t = texts.get(c.url);
    if (!t?.ok) textFailures++;
    return {
      id: c.id,
      publisher: c.publisher,
      title: c.title,
      url: c.url,
      publishedAt: c.publishedAt,
      text: t?.ok ? t.text : undefined,
      categoryHint: c.category,
    };
  });

  const gem = await synthesizeWithGemini(geminiInput);
  STATUS.gemini = gem.status.ok ? "ok" : gem.result === null ? "failed" : "ok";
  console.log(
    `news: gemini ok=${gem.status.ok} calls=${gem.status.calls} events=${gem.result?.events.length ?? 0} articleTextUnavailable=${textFailures}` +
      (gem.status.error ? ` error="${gem.status.error}"` : ""),
  );

  let newsEvents: ReturnType<typeof buildNewsEvents> | ReturnType<typeof buildEventsFromGemini>;
  if (gem.result) {
    // Trust but verify: every event must be men's-scoped, and URLs come from us.
    newsEvents = buildEventsFromGemini(candidates, gem.result);
    if (newsEvents.length === 0) {
      console.error("Gemini produced no men's events — falling back to deterministic events");
      newsEvents = buildNewsEvents(
        candidates.filter((n) => classifyRelevance(n, known).relevance === "CURRENT_HACKEN"),
      );
    }
  } else {
    // Gemini unavailable: keep the previous deterministic behaviour unchanged.
    newsEvents = buildNewsEvents(
      candidates.filter((n) => classifyRelevance(n, known).relevance === "CURRENT_HACKEN"),
    );
  }
  const relevantNews = newsEvents.flatMap((ev) =>
    ev.sources.map((s) => {
      const match = candidates.find((c) => c.url === s.url);
      return match ?? {
        id: s.url,
        title: s.title ?? ev.title,
        url: s.url,
        publishedAt: s.publishedAt,
        publisher: s.publisher,
        category: ev.category,
        discoveredVia: s.discoveredVia,
      };
    }),
  ).slice(0, 40);

  const appData: AppData = {
    freshness: freshness(),
    footballSource: foot.source ?? undefined,
    nextMatch: next,
    lastResult: last,
    upcoming,
    recent,
    lastMatchDetail: foot.lastMatchDetail,
    table: foot.table,
    tablePosition:
      foot.table.find((r) => normalizeSearch(r.team).includes(normalizeSearch("Häcken"))) ?? null,
    warnings: null,
    discipline: foot.discipline,
    cardMatchesInspected: foot.cardMatchesInspected,
    disciplineRule: foot.disciplineRule,
    news: relevantNews,
    newsEvents,
    formerPlayers: [],
    squadStats: foot.squadStats,
    ...(foot.unavailableReason
      ? { currentDataUnavailable: { reason: foot.unavailableReason, checkedAt: generatedAt() } }
      : {}),
  };

  const formerData: FormerPlayersData = {
    ...formerPlayers,
    players: formerPlayers.players,
  };

  // Last-known-good protection: never overwrite valid data with empty data.
  const appEmpty = (d: AppData) =>
    !d.nextMatch && !d.lastResult && d.news.length === 0 && !d.lastMatchDetail;
  const formerEmpty = (d: FormerPlayersData) => d.players.every((p) => !p.currentClub && !p.latestEvent && !p.contract);

  writeAppIfBetter(resolve(DATA_DIR, "app.json"), appData, appEmpty);
  writeFormerIfBetter(resolve(DATA_DIR, "former-players.json"), formerData, formerEmpty, foot.squadStats.map((p) => p.playerName));

  console.log("Pipeline complete:", JSON.stringify(appData.freshness.sourceStatus));
}

/**
 * Merge strategy: new data wins per-field, but empty new fields fall back to
 * last known good so a failed source never blanks the app.
 */
function writeAppIfBetter(path: string, next: AppData, isEmpty: (d: AppData) => boolean): void {
  const prev = readLastKnownGood<AppData>(path);
  if (!prev) {
    writeFileSync(path, JSON.stringify(next, null, 2));
    return;
  }
  if (isEmpty(next)) {
    // Preserve previous data but refresh generatedAt source status.
    const merged: AppData = { ...prev, freshness: next.freshness };
    writeFileSync(path, JSON.stringify(merged, null, 2));
    return;
  }
  const merged: AppData = {
    freshness: next.freshness,
    footballSource: next.footballSource ?? prev.footballSource,
    nextMatch: next.nextMatch ?? prev.nextMatch,
    lastResult: next.lastResult ?? prev.lastResult,
    upcoming: next.upcoming.length ? next.upcoming : prev.upcoming,
    recent: next.recent.length ? next.recent : prev.recent,
    lastMatchDetail: next.lastMatchDetail ?? prev.lastMatchDetail,
    table: next.table.length ? next.table : prev.table,
    tablePosition: next.tablePosition ?? prev.tablePosition,
    warnings: next.warnings ?? prev.warnings,
    discipline: next.discipline?.length ? next.discipline : prev.discipline ?? [],
    cardMatchesInspected: next.cardMatchesInspected || prev.cardMatchesInspected || 0,
    news: next.news.length ? next.news : prev.news,
    newsEvents: next.newsEvents.length ? next.newsEvents : (prev.newsEvents ?? []),
    formerPlayers: [],
    squadStats: next.squadStats?.length ? next.squadStats : prev.squadStats,
    disciplineRule: next.disciplineRule ?? prev.disciplineRule,
    currentDataUnavailable: next.currentDataUnavailable ?? prev.currentDataUnavailable,
  };
  writeFileSync(path, JSON.stringify(merged, null, 2));
}

function writeFormerIfBetter(
  path: string,
  next: FormerPlayersData,
  isEmpty: (d: FormerPlayersData) => boolean,
  currentSquadNames: string[],
): void {
  // B5: players now in the current squad must never be resurrected from the
  // last-known-good copy (e.g. Lindberg/Helander returned to Häcken).
  const notCurrent = (p: FormerPlayer) =>
    !currentSquadNames.some(
      (s) => matchesSquadPlayer(p.name, s) || (p.aliases ?? []).some((a) => matchesSquadPlayer(a, s)),
    );
  const prev = readLastKnownGood<FormerPlayersData>(path);
  if (!prev) {
    writeFileSync(path, JSON.stringify(next, null, 2));
    return;
  }
  if (isEmpty(next)) {
    // Fresh enrichment is empty (e.g. Firecrawl 429), but the fresh LIST still
    // reflects the current registry — new/removed registry entries must apply.
    // Merge: keep prev's enriched fields for players still in the registry,
    // add brand-new registry entries, drop players no longer in the registry.
    const nextById = new Map(next.players.map((p) => [p.id, p]));
    const merged: FormerPlayersData = {
      generatedAt: next.generatedAt,
      sourceStatus: next.sourceStatus,
      players: [
        ...prev.players
          .filter(notCurrent)
          .filter((p) => nextById.has(p.id))
          .map((p) => {
            const fresh = nextById.get(p.id)!;
            return { ...p, aliases: fresh.aliases, name: fresh.name };
          }),
        ...next.players.filter((p) => !prev.players.some((o) => o.id === p.id)),
      ],
    };
    writeFileSync(path, JSON.stringify(merged, null, 2));
    return;
  }
  const prevById = new Map(prev.players.filter(notCurrent).map((p) => [p.id, p]));
  const mergedPlayers = next.players.map((p) => {
    const old = prevById.get(p.id);
    if (!old) return p;
    return {
      ...p,
      currentClub: p.currentClub ?? old.currentClub,
      currentLeague: p.currentLeague ?? old.currentLeague,
      currentCountry: p.currentCountry ?? old.currentCountry,
      clubVerified: p.clubVerified || old.clubVerified,
      stats: p.stats ?? old.stats,
      contract: p.contract ?? old.contract,
      latestEvent: p.latestEvent ?? old.latestEvent,
      retrievedAt: p.retrievedAt ?? old.retrievedAt,
    } satisfies FormerPlayer;
  });
  writeFileSync(path, JSON.stringify({ ...next, players: mergedPlayers }, null, 2));
}

main().catch((e) => {
  console.error("Pipeline failed:", e);
  // Do not destroy last known good data on unexpected failure.
  process.exit(1);
});
