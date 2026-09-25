/**
 * DEV-ONLY regression harness for the Gemini synthesis stage.
 *
 * NOT part of the production pipeline. `npm run pipeline` never imports this.
 * It runs the eight supplied test articles through the real code path
 * (pre-filter → server-side article fetch → Gemini → event build) and prints
 * the result, so the semantic quality of Gemini can be judged honestly.
 *
 * Requires GEMINI_API_KEY in the environment. Prints a clear report and exits
 * non-zero if the expected two-event structure is not produced.
 *
 *   GEMINI_API_KEY=... npx tsx pipeline/src/geminiRegression.ts
 */
import { prefilterNews } from "./newsPrefilter";
import { fetchArticleTexts } from "./articleText";
import { synthesizeWithGemini, buildEventsFromGemini, MAX_SUMMARY_CHARS } from "./gemini";
import type { NewsItem } from "./types";

const ARTICLES: NewsItem[] = [
  { id: "t1", publisher: "BK Häcken", title: "BK Häcken åker till Kalmar – här är matchtruppen", url: "https://bkhacken.se/nyhet/bk-hacken-aker-till-kalmar-har-ar-matchtruppen", publishedAt: "2026-09-19T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t2", publisher: "Kalmar FF", title: "Inför KFF-BKH: Tillsammans ska vi göra allt vi kan för att ta tre poäng", url: "https://kalmarff.se/infor-kff-bkh-tillsammans-ska-vi-gora-allt-vi-kan-for-att-ta-tre-poang/", publishedAt: "2026-09-19T09:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t3", publisher: "BK Häcken", title: "Gustav Lindgren: Det kändes väldigt bra från den första minuten", url: "https://bkhacken.se/nyhet/gustav-lindgren-det-kandes-valdigt-bra-fran-den-forsta-minuten", publishedAt: "2026-09-20T10:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t4", publisher: "SVT Sport", title: "Gustav Lindgren gör hattrick mot Kalmar", url: "https://www.svt.se/sport/fotboll/gustav-lindgren-gor-hattrick-mot-kalmar", publishedAt: "2026-09-20T12:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t5", publisher: "Sportbladet", title: "Häcken krossar Kalmar – hattrick av Lindgren", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/Ex8Q0P/hacken-krossar-kalmar-hattrick-av-gustav-lindgren", publishedAt: "2026-09-20T13:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t6", publisher: "FotbollDirekt", title: "Hattrick från Lindgren – Häcken krossade Kalmar", url: "https://fotbolldirekt.se/allsvenskan/hattrick-fran-lindgren-hacken-krossade-kalmar/", publishedAt: "2026-09-20T14:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t7", publisher: "BK Häcken", title: "Matchguide: Champions League-premiär borta mot FC Inter", url: "https://bkhacken.se/nyhet/matchguide-champions-league-premiar-borta-mot-fc-inter", publishedAt: "2026-09-22T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t8", publisher: "Sportbladet", title: "Häckens målvakter mot Juventus – två tonåringar", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/6qaWy8/hacken-kan-sta-infor-en-malvaktskris", publishedAt: "2026-09-23T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
];

const MUST_EXCLUDE = ["t7", "t8"];

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set. Nothing to test.");
    process.exit(2);
  }

  const { candidates, dropped } = prefilterNews(ARTICLES, { now: new Date("2026-09-25T12:00:00Z") });
  console.log(`candidates: ${candidates.map((c) => c.id).join(", ")}`);
  console.log(`dropped:    ${dropped.map((d) => `${d.url} (${d.reason})`).join("\n            ") || "none"}`);

  const texts = await fetchArticleTexts(candidates.map((c) => c.url));
  const geminiInput = candidates.map((c) => ({
    id: c.id,
    publisher: c.publisher,
    title: c.title,
    url: c.url,
    publishedAt: c.publishedAt,
    text: texts.get(c.url)?.ok ? texts.get(c.url)!.text : undefined,
    categoryHint: c.category,
  }));
  for (const a of geminiInput) {
    console.log(`  ${a.id}: text ${a.text ? `${a.text.length} chars` : `UNAVAILABLE (${texts.get(a.url)?.error})`}`);
  }

  const { result, status, raw } = await synthesizeWithGemini(geminiInput);
  console.log(`\ngemini: ok=${status.ok} calls=${status.calls} ${status.error ?? ""}`);
  if (raw) console.log(`\n--- raw response ---\n${raw}\n--- end raw ---`);
  if (!result) process.exit(3);

  const events = buildEventsFromGemini(candidates, result);
  console.log(`\nEVENTS: ${events.length}`);
  for (const ev of events) {
    console.log(`\n* ${ev.title}`);
    console.log(`  summary (${ev.summary.length}/${MAX_SUMMARY_CHARS}): ${ev.summary}`);
    for (const s of ev.sources) console.log(`  - ${s.publisher}: ${s.title} [${s.publishedAt.slice(0, 10)}] ${s.url}`);
  }

  const shownIds = new Set(events.flatMap((e) => e.sources.map((s) => ARTICLES.find((a) => a.url === s.url)?.id)));
  const problems: string[] = [];
  for (const id of MUST_EXCLUDE) if (shownIds.has(id)) problems.push(`women's article ${id} was NOT excluded`);
  if (events.length !== 2) problems.push(`expected 2 events, got ${events.length}`);
  for (const ev of events) {
    if (ev.summary.length > MAX_SUMMARY_CHARS) problems.push(`summary too long in "${ev.title}"`);
  }
  const knownUrls = new Set(ARTICLES.map((a) => a.url));
  for (const ev of events) {
    for (const s of ev.sources) if (!knownUrls.has(s.url)) problems.push(`invented url: ${s.url}`);
  }

  if (problems.length) {
    console.error(`\nFAILED:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nPASS: two men's events, women's articles excluded, all URLs original, summaries within limit.");
}

main();
