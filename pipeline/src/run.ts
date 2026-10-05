import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AppData,
  Freshness,
  FootballSourceMeta,
  LeagueTableRow,
  MatchDetail,
  MatchRef,
  NewsItem,
  SeasonPlayerStat,
  SourceStatus,
} from "./types";
import { fetchRss } from "./rss";
import { classifyNews, menRelevantNews } from "./classify";
import { dedupeNews } from "./dedupe";
import { buildNewsEvents, publisherRole } from "./newsEvents";
import type { WarningEvent } from "./warnings";
import { readLastKnownGood } from "./stale";
import { prefilterNews, DEFAULT_WINDOW_DAYS } from "./newsPrefilter";
import { buildSourceBreakdown, formatSourceBreakdown } from "./ingestDiagnostics";
import { fetchArticleTexts } from "./articleText";
import {
  buildEventsFromGemini,
  synthesizeWithGemini,
  type GeminiArticleInput,
} from "./gemini";
import { pickNextAndLast } from "./normalize";
import { normalizeSearch } from "./search";
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
import { beginRun, readMetrics, writeMetrics, noteCost, noteSkippedCall, noteSourceArticles } from "./apiMetrics";
import { synthesizeWithOpenRouter } from "./openrouter";

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
  // Club-specific feed found via the href="/rss/klubbar/27" link the club page
  // declares. It carries transfer and contract news that none of the general
  // sports feeds cover — e.g. "LISTA: Kontraktsläget i BK Häcken".
  //
  // NOTE the soft-404 hazard on this site: /rss and /nyheter/feed both return
  // HTTP 200 with a full HTML page and zero RSS markers. Only /rss/klubbar/27
  // is a real feed. fetchRss checks res.ok AND parses for rss/feed, so a 200
  // alone would not be trusted here.
  { url: "https://fotbolltransfers.com/rss/klubbar/27", publisher: "Fotbolltransfers" },

  // Göteborgs-Posten — regional newspaper, home city of BK Häcken.
  //
  // Verified 2026-09-30: HTTP 200, content-type text/xml, 45 items, freshest
  // pubDate 2026-09-30 19:22 GMT. NOTE the site serves this GZIP-COMPRESSED
  // even though content-type is text/xml — a plain fetch without --compressed
  // yields binary and a naive marker check reports zero RSS markers. That is a
  // soft-404 false negative; this feed is real.
  //
  // YIELD IS LOW BY DESIGN: this is the general front-page feed, not a sport
  // section. Measured 2026-09-30: 3 of 45 items mention Häcken. No sport feed
  // exists (`/sport.rss` 404, `/sport/feed` 410, `/arkiv/sport.rss` 404), so
  // the front page is the only option. It contributes local/coach-press angle
  // (e.g. "Häckens plan – så ska storkubbarna vältas") that the national
  // sports feeds do not carry, but do not expect a high article rate.
  { url: "https://www.gp.se/rss", publisher: "Göteborgs-Posten" },
];

const STATUS: Record<string, SourceStatus> = {};

/**
 * Per-source article counts for THIS run, keyed by publisher.
 *
 * Populated once the ingest has run and read by `freshness()`. Kept module
 * level rather than threaded through because `freshness()` is called from the
 * app-data assembly far from the ingest code, and an explicit parameter would
 * have to be carried through three call sites for no benefit.
 */
const SOURCE_COUNTS: Record<string, { fetched: number; kept: number; dropped: number }> = {};

function generatedAt(): string {
  return new Date().toISOString();
}

function freshness(): Freshness {
  return {
    generatedAt: generatedAt(),
    sourceStatus: { ...STATUS },
    // Omitted entirely when empty, so an older pipeline run that does not
    // populate it does not write `"sourceCounts": {}` and imply that every
    // source genuinely found nothing. Absent means "not measured".
    ...(Object.keys(SOURCE_COUNTS).length > 0 ? { sourceCounts: { ...SOURCE_COUNTS } } : {}),
  };
}

// ---------- news ----------

async function collectNews(): Promise<NewsItem[]> {
  const all: NewsItem[] = [];
  for (const src of RSS_SOURCES) {
    const feed = await fetchRss(src.url, src.publisher);
    STATUS[`rss:${src.publisher}`] = feed.ok ? "ok" : "failed";
    if (feed.ok) {
      for (const item of feed.items) {
        item.sourceRole = publisherRole(src.publisher);
      }
      all.push(...feed.items);
    }
  }
  const deduped = dedupeNews(all);
  await attachSourceTags(deduped);
  for (const item of deduped) {
    item.category = classifyNews(item.title, item.summary ?? "", item.sourceTags);
  }
  return deduped;
}

/** Hosts whose articles carry the source's own team/category labels. */
function isTaggedSource(url: string): boolean {
  try {
    return new URL(url).hostname === "bkhacken.se";
  } catch {
    return false;
  }
}

/**
 * Fetch the source's own category labels (BK Häcken: "Herr" / "Dam" /
 * "Hållbarhet" / "Föreningen") for articles published on a source that uses
 * them. Only these hosts are crawled, because only there is a team label
 * authoritative. Everything else stays untagged and keeps the existing
 * text-based relevance behaviour.
 */
async function attachSourceTags(items: NewsItem[]): Promise<void> {
  const tagged = items.filter((i) => isTaggedSource(i.url));
  if (tagged.length === 0) return;
  const pages = await fetchArticleTexts(
    tagged.map((i) => i.url),
    4,
  );
  let found = 0;
  for (const item of tagged) {
    const tags = pages.get(item.url)?.sourceTags;
    if (tags?.length) {
      item.sourceTags = tags;
      found++;
    }
  }
  console.log(
    `news: source category labels ${found}/${tagged.length} from ` +
      `${[...new Set(tagged.map((i) => new URL(i.url).hostname))].join(", ")}`,
  );
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
    // E-005: scope the ledger to the current squad. `known` is false when the
    // squad query failed, so the engine skips demotion rather than treating
    // an empty result as "nobody plays here" and wiping every status.
    { players: squadStats, known: sq.status.ok && Boolean(sq.squad) },
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

// ---------- main ----------

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  beginRun();

  const news = await collectNews();
  const foot = await collectCurrentFootballData();
  const { next, last, upcoming, recent } = pickNextAndLast(foot.matches);

  // Entity/relation-based news relevance (replaces generic keyword matching).
  // Women's-team identity evidence: known women's squad players + Damallsvenskan
  // opponents. Sourced from bkhacken.se dam trupp (verified 2026-09-25).
  const known: KnownPersons = {
    currentPlayers: foot.squadStats.map((p) => p.playerName),
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
  const { candidates: prefiltered, dropped } = prefilterNews(news, { windowDays, known });
  // The men's news section is a POSITIVE set: anything the source labelled
  // "Dam", or that we classified as women's, is removed here so neither the
  // Gemini stage nor the deterministic fallback can reintroduce it.
  const candidates = menRelevantNews(prefiltered);
  const menExcluded = prefiltered.length - candidates.length;
  console.log(
    `news: ${candidates.length} candidates, ${dropped.length} dropped before Gemini` +
      (menExcluded ? `, ${menExcluded} excluded as not men's-team news` : ""),
  );

  // Per-source ingest attribution. Observability ONLY — `news`, `dropped`,
  // `prefiltered` and `candidates` are all used exactly as above, so no article
  // is kept or dropped differently because of this block.
  //
  // Why it exists: `freshness.sourceStatus` says a source is "ok" whether it
  // contributed 20 articles or none, and the total drop count above cannot be
  // attributed. A source that fetched successfully and contributed nothing was
  // therefore indistinguishable from one that failed. Diagnosing B-006 took
  // hours for exactly that reason.
  const menExcludedUrls = prefiltered
    .filter((n) => !candidates.some((c) => c.url === n.url))
    .map((n) => n.url);
  const sourceBreakdown = buildSourceBreakdown(
    news,
    new Set(candidates.map((c) => c.url)),
    dropped,
    menExcludedUrls,
  );
  for (const line of formatSourceBreakdown(sourceBreakdown)) {
    console.log(line);
  }

  // Per-source news counts, persisted so the app can SHOW them.
  //
  // These numbers existed only in the nightly's console output, which is
  // invisible to a supporter and gone by morning. The diagnostics panel could
  // say a feed was "ok" but never how many articles it contributed — so a
  // source that quietly returned 40 articles, and one that returned none, were
  // indistinguishable in the app. This is B-006's lesson applied to the UI
  // rather than the log.
  const sourceCounts: Record<string, { fetched: number; kept: number; dropped: number }> = {};
  for (const row of sourceBreakdown) {
    sourceCounts[row.publisher] = {
      fetched: row.fetched,
      kept: row.kept,
      dropped: row.dropped,
    };
  }
  for (const [k, v] of Object.entries(sourceCounts)) SOURCE_COUNTS[k] = v;
  // Same numbers, into the metrics history, so the app can chart them over
  // time. One recorder call; the copy in SOURCE_COUNTS feeds app.json.
  noteSourceArticles(sourceCounts);

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
      // Authoritative team labels, so Gemini sees the same evidence we do.
      ...(c.sourceTags?.length ? { sourceTags: c.sourceTags } : {}),
    };
  });

  const gem = await synthesizeWithGemini(geminiInput);
  STATUS.gemini = gem.status.ok ? "ok" : gem.result === null ? "failed" : "ok";

  // Quota visibility for the metered LLM call.
  //
  // `calls` is what actually left the machine. The Gemini REST API reports no
  // credit figure, so cost stays null — recorded as "unreported" rather than
  // as 0, because 0 would falsely claim the call was free.
  if (gem.status.calls > 0) {
    noteSkippedCall("gemini", `no-key-or-blocked (${gem.status.error ?? "unknown"})`, true);
    noteCost("gemini", null);
    const today = new Date().toISOString().slice(0, 10);
    console.log(
      `   quota: gemini used ${gem.status.calls} request(s) today (${today}); ` +
        `free tier is capped at 20/UTC day`,
    );
  } else {
    // Not attempted at all. Recorded explicitly so the metrics log shows a
    // zero-quota night instead of a silent absence.
    noteSkippedCall("gemini", "not attempted — no key injected", true);
    console.log("   quota: gemini not attempted (no key injected) — 0 requests spent");
  }

  console.log(
    `news: gemini ok=${gem.status.ok} model=${gem.status.model ?? "none"} calls=${gem.status.calls} events=${gem.result?.events.length ?? 0} articleTextUnavailable=${textFailures}` +
      (gem.status.error ? ` error="${gem.status.error}"` : ""),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // OPENROUTER — MEASUREMENT ONLY. NOT A PRODUCTION PATH.
  //
  // This sends the SAME articles, with the SAME instruction and the SAME output
  // schema, and asks the model to do the same job Gemini used to do. Its answer
  // is deliberately DISCARDED: `newsEvents` below is built from the
  // deterministic path either way. Nothing a supporter sees can change here.
  //
  // What it buys: real numbers, on real news, on a real schedule — availability
  // at 03:30, latency, and whether the answer actually holds up. Those are the
  // three things that decide whether this provider can ever be switched on, and
  // none of them can be learned from a one-off manual test.
  //
  // Cost: one request per night, hard-capped, never retried. See openrouter.ts.
  // ─────────────────────────────────────────────────────────────────────────
  const orKeyPresent = Boolean(process.env.OPENROUTER_API_KEY);
  if (!orKeyPresent) {
    // No key injected: record it so the log shows the true state rather than a
    // row that silently disappears.
    noteSkippedCall("openrouter", "no key injected — measurement disabled", true);
  } else {
    const or = await synthesizeWithOpenRouter(geminiInput);
    const today = new Date().toISOString().slice(0, 10);
    if (or.ok && or.answer) {
      // Measured, then discarded on purpose. The event count is logged so a
      // regression like B-004 (over-merging into fewer, wrong events) would be
      // visible in the nightly log without ever reaching a supporter.
      console.log(
        `openrouter: MEASUREMENT ONLY — answer discarded. ` +
          `ok model=${or.model} events=${or.answer.events.length} calls=${or.calls} ` +
          `unknownIds=${or.unknownIds.length}`,
      );
      console.log(
        `   quota: openrouter used ${or.calls} request(s) today (${today}); ` +
          `free tier reports limit=1000/day`,
      );
    } else {
      // A failed or unavailable call is itself the measurement. Log it plainly
      // and carry on: the deterministic path is unaffected.
      noteCost("openrouter", null);
      console.log(
        `openrouter: MEASUREMENT ONLY — no usable answer. ok=${or.ok} calls=${or.calls} ` +
          `error="${or.error ?? "unknown"}"`,
      );
      console.log(
        `   quota: openrouter spent ${or.calls} request(s) today (${today}) — answer discarded, app unaffected`,
      );
    }
  }

  let newsEvents: ReturnType<typeof buildNewsEvents> | ReturnType<typeof buildEventsFromGemini>;
  if (gem.result) {
    // Trust but verify: every event must be men's-scoped, and URLs come from us.
    newsEvents = buildEventsFromGemini(candidates, gem.result);
    if (newsEvents.length === 0) {
      console.error("Gemini produced no men's events — falling back to deterministic events");
      newsEvents = buildNewsEvents(
        menRelevantNews(
          candidates.filter((n) => classifyRelevance(n, known).relevance === "CURRENT_HACKEN"),
        ),
      );
    }
  } else {
    // Gemini unavailable: keep the previous deterministic behaviour unchanged.
    newsEvents = buildNewsEvents(
      menRelevantNews(
        candidates.filter((n) => classifyRelevance(n, known).relevance === "CURRENT_HACKEN"),
      ),
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
    squadStats: foot.squadStats,
    ...(foot.unavailableReason
      ? { currentDataUnavailable: { reason: foot.unavailableReason, checkedAt: generatedAt() } }
      : {}),
  };

  // Last-known-good protection: never overwrite valid data with empty data.
  const appEmpty = (d: AppData) =>
    !d.nextMatch && !d.lastResult && d.news.length === 0 && !d.lastMatchDetail;

  writeAppIfBetter(resolve(DATA_DIR, "app.json"), appData, appEmpty);

  // API measurement log. Written LAST so it captures every call, and it can
  // never fail the pipeline: writeMetrics swallows its own errors.
  //
  // Gemini is recorded as a METERED call when it was actually attempted. When
  // the key is absent the pipeline never calls out at all — that is recorded
  // as a skipped call with attempts: 0, because "did not run" and "ran and was
  // rejected" are completely different facts and the quota view depends on
  // telling them apart.
  const metricsPath = resolve(DATA_DIR, "api-metrics.json");
  const metrics = writeMetrics(metricsPath, readMetrics(metricsPath));
  if (metrics) {
    const svc = metrics.latestRun?.services ?? [];
    console.log(
      `api-metrics: ${metrics.totals.calls} calls, ${metrics.totals.failures} failed, ` +
        `${metrics.totals.meteredRequests} metered, cost ${metrics.totals.costCredits} credits`,
    );
    for (const s of svc.slice(0, 4)) {
      console.log(
        `   ${s.service.padEnd(26)} ${String(s.calls).padStart(2)} calls  ` +
          `${s.totalDurationMs}ms total  ${s.maxDurationMs}ms max  ` +
          `${s.responseBytes}B out  cost ${s.costCredits}` +
          (s.costReported === 0 ? " (unreported)" : ""),
      );
    }
    const sc = metrics.latestRun?.sourceArticles;
    if (sc) {
      const kept = Object.values(sc).reduce((n, v) => n + v.kept, 0);
      const fetched = Object.values(sc).reduce((n, v) => n + v.fetched, 0);
      console.log(
        `   source articles: ${kept} kept of ${fetched} fetched across ${Object.keys(sc).length} publishers`,
      );
    }
  }

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
    squadStats: next.squadStats?.length ? next.squadStats : prev.squadStats,
    disciplineRule: next.disciplineRule ?? prev.disciplineRule,
    currentDataUnavailable: next.currentDataUnavailable ?? prev.currentDataUnavailable,
  };
  writeFileSync(path, JSON.stringify(merged, null, 2));
}

main().catch((e) => {
  console.error("Pipeline failed:", e);
  // Do not destroy last known good data on unexpected failure.
  process.exit(1);
});
