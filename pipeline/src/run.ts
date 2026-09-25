import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AppData,
  Freshness,
  FormerPlayer,
  FormerPlayerCareerEvent,
  FormerPlayersData,
  MatchDetail,
  NewsItem,
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
import {
  ALLSVENSKAN_LEAGUE_ID,
  BKH_TEAM_ID,
  SEASON,
  fetchFixtures,
  fetchPlayerStatsForFixture,
  fetchPlayerStatistics,
  fetchStandings,
} from "./apifootball";
import { normalizeFixture, normalizePlayerStats, normalizeTable, pickNextAndLast, type ApiPlayerStat, type StandingRow } from "./normalize";

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
  matches: ReturnType<typeof normalizeFixture>[];
  table: ReturnType<typeof normalizeTable>;
  lastMatchDetail: MatchDetail | null;
  warningEvents: WarningEvent[];
  apiOk: boolean;
}

async function collectFootballData(): Promise<FootballData> {
  const empty: FootballData = { matches: [], table: [], lastMatchDetail: null, warningEvents: [], apiOk: false };
  if (!process.env.API_FOOTBALL_KEY) {
    STATUS.apiFootball = "skipped";
    return empty;
  }

  const { fixtures, status } = await fetchFixtures(BKH_TEAM_ID, SEASON);
  STATUS.apiFootball = status.ok ? "ok" : "failed";
  if (!status.ok) console.error("API-Football error:", status.error);
  if (!status.ok || !fixtures) return empty;

  const matches = fixtures.map(normalizeFixture);
  const { last } = pickNextAndLast(matches);

  // Player stats + warning events for the last finished fixture only (save quota).
  let lastMatchDetail: MatchDetail | null = null;
  const warningEvents: WarningEvent[] = [];
  if (last) {
    const statsRes = await fetchPlayerStatsForFixture(last.id);
    if (statsRes.status.ok && statsRes.data) {
      const rows = statsRes.data as ApiPlayerStat[];
      const teamRows = rows.filter((r) => {
        const t = (r as unknown as { statistics: Array<{ team?: { id: number } }> }).statistics[0]?.team;
        return t?.id === BKH_TEAM_ID;
      });
      lastMatchDetail = { ...last, playerStats: normalizePlayerStats(teamRows.length ? teamRows : rows) };
    }
  }

  // Standings (Allsvenskan)
  let table: ReturnType<typeof normalizeTable> = [];
  const standingsRes = await fetchStandings(ALLSVENSKAN_LEAGUE_ID, SEASON);
  if (standingsRes.status.ok && standingsRes.data) {
    const resp = standingsRes.data as Array<{ league: { standings: StandingRow[][] } }>;
    const rows = resp[0]?.league?.standings?.[0] ?? [];
    table = normalizeTable(rows);
  }

  // Warning events: derive from fixtures/players across played Allsvenskan
  // matches would cost many requests. Free-tier compromise: derive warning
  // events from the last fixture detail now, and let the app show the latest
  // known state. A fuller backfill can be enabled with more quota.
  if (lastMatchDetail?.playerStats && last) {
    for (const ps of lastMatchDetail.playerStats) {
      if (ps.yellowCards > 0) {
        warningEvents.push({
          playerId: ps.playerId,
          playerName: ps.playerName,
          competition: "allsvenskan",
          matchId: last.id,
          matchDate: last.date,
          season: last.season,
        });
      }
    }
  }

  return { matches, table, lastMatchDetail, warningEvents, apiOk: true };
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
    if (entry.apiFootballId && process.env.API_FOOTBALL_KEY && STATUS.apiFootball === "ok") {
      const res = await fetchPlayerStatistics(entry.apiFootballId, SEASON, ALLSVENSKAN_LEAGUE_ID);
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
  const foot = await collectFootballData();
  const formerPlayers = await collectFormerPlayersData();

  const { next, last, upcoming, recent } = pickNextAndLast(foot.matches);

  const warnings: WarningsReport | null = next
    ? computeWarnings(foot.warningEvents, "allsvenskan", String(SEASON), next)
    : null;

  const relevantNews = menRelevantNews(news).slice(0, 40);

  const appData: AppData = {
    freshness: freshness(),
    nextMatch: next,
    lastResult: last,
    upcoming,
    recent,
    lastMatchDetail: foot.lastMatchDetail,
    table: foot.table,
    tablePosition: foot.table.find((r) => r.team.includes("Häcken")) ?? null,
    warnings,
    news: relevantNews,
    newsEvents: buildNewsEvents(relevantNews),
    formerPlayers: [],
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
