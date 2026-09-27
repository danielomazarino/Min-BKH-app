/**
 * ONE-REQUEST recheck: is the 503 gone?
 *
 * WHY THIS EXISTS
 *   Run 36319711479 (2026-09-27) — tiny probe, maxOutputTokens=32, one
 *     sentence -> HTTP 200.
 *   Run 36319955524 (2026-09-27), ~5 min later — the 8-article regression
 *     batch, ~19K chars -> HTTP 503 "high demand" three times.
 *
 *   The tiny probe CANNOT detect this problem. It passed WHILE the 503 was
 *   happening. So a budget check is the wrong instrument here.
 *
 *   This sends ONE request built by the REAL production payload builder, at
 *   the REAL article size, so the result is directly comparable to the runs
 *   that failed. That is the only way one request can answer the question.
 *
 * COST: exactly ONE generation request. Not one per article, not one per
 * retry. `fetch` is called exactly once, and this file deliberately does NOT
 * use `synthesizeWithGemini`, which retries across models.
 *
 * It also does NOT judge the output. A 200 here proves the API accepted a
 * full-size payload today; it does NOT prove the output is usable. That is
 * what `geminiRegression.ts` is for.
 *
 * DEV-ONLY diagnostic. Not imported by `npm run pipeline`.
 */
import { prefilterNews } from "./newsPrefilter";
import { fetchArticleTexts } from "./articleText";
import { buildGeminiRequestPayload, type GeminiArticleInput } from "./gemini";
import type { NewsItem } from "./types";

/** The same eight reference articles used by geminiRegression.ts. */
const ARTICLES: NewsItem[] = [
  { id: "t1", publisher: "BK Häcken", title: "BK Häcken åker till Kalmar – här är matchtruppen", url: "https://bkhacken.se/nyhet/bk-hacken-aker-till-kalmar-har-ar-matchtruppen", publishedAt: "2026-09-19T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t2", publisher: "Kalmar FF", title: "Inför KFF-BKH: Tillsammans ska vi göra allt vi kan för att ta tre poäng", url: "https://kalmarff.se/infor-kff-bkh-tillsammans-ska-vi-gora-allt-vi-kan-for-att-ta-tre-poang/", publishedAt: "2026-09-19T09:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t3", publisher: "BK Häcken", title: "Gustav Lindgren: Det kändes väldigt bra från den första minuten", url: "https://bkhacken.se/nyhet/gustav-lindgren-det-kandes-valdigt-bra-fran-den-forsta-minuten", publishedAt: "2026-09-20T10:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t4", publisher: "SVT Sport", title: "Gustav Lindgren gör hattrick mot Kalmar", url: "https://www.svt.se/sport/fotboll/gustav-lindgren-gor-hattrick-mot-kalmar", publishedAt: "2026-09-20T12:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t5", publisher: "Sportbladet", title: "Häcken krossar Kalmar – hattrick av Lindgren", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/Ex8Q0P/hacken-krossar-kalmar-hattrick-av-gustav-lindgren", publishedAt: "2026-09-20T13:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t6", publisher: "FotbollDirekt", title: "Hattrick från Lindgren – Häcken krossade Kalmar", url: "https://fotbolldirekt.se/allsvenskan/hattrick-fran-lindgren-hacken-krossade-kalmar/", publishedAt: "2026-09-20T14:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t7", publisher: "BK Häcken", title: "Matchguide: Champions League-premiär bota mot FC Inter", url: "https://bkhacken.se/nyhet/matchguide-champions-league-premiar-bota-mot-fc-inter", publishedAt: "2026-09-22T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t8", publisher: "Sportbladet", title: "Häckens målvakter mot Juventus – två tonåringar", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/6qaWy8/hacken-kan-sta-infor-en-malvaktskris", publishedAt: "2026-09-23T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
];

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("RESULT: no-key");
    console.error("GEMINI_API_KEY is not set.");
    process.exit(2);
  }

  const { candidates, dropped } = prefilterNews(ARTICLES, { now: new Date("2026-09-25T12:00:00Z") });
  console.log(`candidates: ${candidates.length} (dropped ${dropped.length})`);
  console.log(`model    : ${MODEL}`);

  // Article fetch is plain HTTP to publishers. It costs NO Gemini quota.
  const texts = await fetchArticleTexts(candidates.map((c) => c.url));

  const geminiInput: GeminiArticleInput[] = candidates.map((c) => ({
    id: c.id,
    publisher: c.publisher,
    title: c.title,
    url: c.url,
    publishedAt: c.publishedAt,
    text: texts.get(c.url)?.ok ? texts.get(c.url)!.text : undefined,
    categoryHint: c.category,
  }));

  const bodyChars = geminiInput.reduce((n, a) => n + (a.text?.length ?? 0), 0);
  const requestBody = JSON.stringify(buildGeminiRequestPayload(geminiInput));
  console.log(`article text chars : ${bodyChars}`);
  console.log(`request bytes      : ${requestBody.length}`);
  console.log(`text unavailable   : ${geminiInput.filter((a) => !a.text).map((a) => a.id).join(", ") || "none"}`);

  console.log("");
  console.log("=== ONE request, no retry, no fallback model ===");

  // THE ONLY FETCH IN THIS FILE. One call, whatever comes back is the answer.
  let status = 0;
  let raw = "";
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: requestBody,
      signal: AbortSignal.timeout(120000),
    });
    status = res.status;
    raw = await res.text();
  } catch (e) {
    console.log(`RESULT: network-blocked`);
    console.log(`Spend: 1 request.`);
    console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(0);
  }

  console.log(`HTTP ${status}`);

  if (status === 200) {
    // Prove it is not merely a 200 with an empty body — that was the
    // undiagnosable failure in run 36215617435.
    let text = "";
    try {
      const json = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    } catch {
      /* reported below */
    }
    console.log("");
    console.log(`response chars     : ${text.length}`);
    if (!text.trim()) {
      console.log("RESULT: reachable-empty");
      console.log("Spend: 1 request.");
      console.log("HTTP 200 but the model returned no text. Capacity is fine; the");
      console.log("model declined or returned nothing. This is a prompt/contract");
      console.log("problem, NOT a 503 and NOT a quota problem.");
      process.exit(0);
    }
    let events: unknown[] = [];
    let verdicts: unknown[] = [];
    try {
      const parsed = JSON.parse(text) as { events?: unknown[]; verdicts?: unknown[] };
      events = parsed.events ?? [];
      verdicts = parsed.verdicts ?? [];
    } catch {
      /* reported below */
    }
    console.log(`verdicts           : ${verdicts.length}`);
    console.log(`events             : ${events.length}`);
    console.log("");
    console.log("RESULT: full-size-payload-accepted");
    console.log("Spend: 1 request.");
    console.log("");
    console.log("The 503 is GONE for a payload this size. Capacity is not the");
    console.log("blocker right now.");
    console.log("");
    console.log("IMPORTANT — this does NOT prove the output is usable. A 200 only");
    console.log("means the API accepted the request. Run geminiRegression.ts (or");
    console.log("gemini:status --full) to judge the events themselves.");
    process.exit(0);
  }

  // Failure: print the body VERBATIM. Google's 503 text names the reason, and
  // that reason is the most valuable thing this check produces.
  console.log("");
  console.log("=== verbatim response body ===");
  console.log(raw.slice(0, 1200));
  console.log("=== end body ===");
  console.log("");

  let result = "unexpected-status";
  if (status === 429) result = "quota-exhausted";
  else if (status === 503) result = "capacity-blocked-503";
  else if (status === 404) result = "model-unavailable";
  else if (status === 401 || status === 403) result = "auth-blocked";

  console.log(`RESULT: ${result}`);
  console.log("Spend: 1 request.");
  if (status === 503) {
    console.log("");
    console.log("The 503 PERSISTS at full article size. Do not retry this file");
    console.log("repeatedly. The tiny budget probe still passes, so the failure");
    console.log("is specific to larger payloads — that is the size hypothesis,");
    console.log("now with a direct same-size comparison.");
  }
  process.exit(0);
}

main();
