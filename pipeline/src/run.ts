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
  WarningsReport,
} from "./types";
import { fetchRss } from "./rss";
import { classifyNews, menRelevantNews } from "./classify";
import { dedupeNews } from "./dedupe";
import { buildNewsEvents, publisherRole } from "./newsEvents";
import { computeWarnings, type WarningEvent } from "./warnings";
import { loadRegistry } from "./registry";
import { firecrawlSearch, playerQuery } from "./firecrawl";
import { readLastKnownGood } from "./stale";
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
  hashId,
  normalizeSmEvents,
  normalizeSmMatch,
  normalizeSmSquad,
  normalizeSmStandings,
} from "./smNormalize";

const DATA_DIR = resolve(import.meta.dirname, "../../public/data");

/**
 * News sources (all verified 2026-09-25, see docs/SOURCES.md for the audit).
 * Roles per publication are in newsEvents.ts.
 */
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
  const empty: FootballData = { matches: [], table: [], lastMatchDetail: null, warningEvents: [], source: null, unavailableReason: null, squadStats: [] };
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
  const { last } = pickNextAndLast(matches);

  // 4) Match detail (events) for the most recent finished match only.
  let lastMatchDetail: MatchDetail | null = null;
  const warningEvents: WarningEvent[] = [];
  if (last) {
    const det = await fetchMatchDetailSm(last.id);
    if (det.status.ok && det.match) {
      const ev = normalizeSmEvents(det.match.matchEvents);
      lastMatchDetail = {
        ...last,
        events: {
          goals: ev.goals,
          yellowCards: ev.yellowCards,
          redCards: ev.redCards,
          substitutions: ev.substitutions,
        },
      };
      // Warning events from the match's yellow cards (per-player).
      for (const yc of ev.yellowCards) {
        if (yc.teamName?.includes("Häcken")) {
          warningEvents.push({
            playerId: hashId(yc.playerName),
            playerName: yc.playerName,
            competition: "allsvenskan",
            matchId: last.id,
            matchDate: last.date,
            season: last.season,
          });
        }
      }
    } else {
      console.error("SportoMedia match detail error:", det.status.error);
    }
  }

  return {
    matches,
    table,
    lastMatchDetail,
    warningEvents,
    source: footballSourceMeta(retrievedAt, "current"),
    unavailableReason: null,
    squadStats,
  };
}

// ---------- former players ----------

async function collectFormerPlayers(): Promise<FormerPlayer[]> {
  const registry = loadRegistry();
  const out: FormerPlayer[] = [];

  for (const entry of registry) {
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

async function collectFormerPlayersData(): Promise<FormerPlayersData> {
  const players = await collectFormerPlayers();
  return { ...freshness(), players };
}

// ---------- main ----------

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const news = await collectNews();
  const foot = await collectCurrentFootballData();
  const formerPlayers = await collectFormerPlayersData();

  const { next, last, upcoming, recent } = pickNextAndLast(foot.matches);

  const warnings: WarningsReport | null = next
    ? computeWarnings(foot.warningEvents, "allsvenskan", String(CURRENT_SEASON), next)
    : null;

  const relevantNews = menRelevantNews(news).slice(0, 40);

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
    warnings,
    news: relevantNews,
    newsEvents: buildNewsEvents(relevantNews),
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
  writeFormerIfBetter(resolve(DATA_DIR, "former-players.json"), formerData, formerEmpty);

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
    news: next.news.length ? next.news : prev.news,
    newsEvents: next.newsEvents.length ? next.newsEvents : (prev.newsEvents ?? []),
    formerPlayers: [],
    squadStats: next.squadStats?.length ? next.squadStats : prev.squadStats,
    currentDataUnavailable: next.currentDataUnavailable ?? prev.currentDataUnavailable,
  };
  writeFileSync(path, JSON.stringify(merged, null, 2));
}

function writeFormerIfBetter(path: string, next: FormerPlayersData, isEmpty: (d: FormerPlayersData) => boolean): void {
  const prev = readLastKnownGood<FormerPlayersData>(path);
  if (!prev) {
    writeFileSync(path, JSON.stringify(next, null, 2));
    return;
  }
  if (isEmpty(next)) {
    const merged: FormerPlayersData = { generatedAt: next.generatedAt, sourceStatus: next.sourceStatus, players: prev.players };
    writeFileSync(path, JSON.stringify(merged, null, 2));
    return;
  }
  const prevById = new Map(prev.players.map((p) => [p.id, p]));
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
