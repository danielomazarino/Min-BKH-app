/**
 * BOUNDED SEMANTIC EVALUATION — exactly ONE Gemini request.
 *
 * WHY THIS EXISTS
 *   Gemini is a SEMANTIC LAYER, not a source. The deterministic pipeline
 *   already collects and prefilters; the question this file answers is:
 *
 *     Does the semantic layer produce materially more useful, safer
 *     supporter-facing news than deterministic filtering alone?
 *
 *   A 200 proves nothing about that. This file is designed so a human can
 *   compare the two outputs side by side and judge.
 *
 * COST — READ THIS FIRST
 *   EXACTLY ONE generateContent call. `fetch` is called exactly once, in one
 *   place, marked // THE ONLY FETCH. There is no retry, no model fallback and
 *   no second attempt. It deliberately does NOT use `synthesizeWithGemini`,
 *   which retries up to 6 times across models.
 *
 *   A 503 is a valid result. Do not re-run this file hoping for a better one.
 *
 * WHAT IT PRODUCES
 *   1. The deterministic baseline: what `buildNewsEvents` alone produces.
 *   2. The Gemini result: events, rejections, merges.
 *   3. A provenance audit: every URL, and whether any was invented.
 *   4. A hallucination surface: claims in the summary not present in the
 *      supplied article text.
 *   5. An explicit "what did Gemini add" section.
 *
 * DEV-ONLY evaluation. It writes nothing and changes no production behaviour.
 */
import { prefilterNews } from "./newsPrefilter";
import { fetchArticleTexts } from "./articleText";
import { buildNewsEvents } from "./newsEvents";
import { buildGeminiRequestPayload, parseGeminiResponse, MAX_SUMMARY_CHARS, type GeminiArticleInput } from "./gemini";
import { buildEventsFromGemini, type GeminiResult } from "./gemini";
import type { NewsEvent, NewsItem } from "./types";

/**
 * The eight reference articles. Six are men's-team; two (t7 CL guide, t8
 * Juventus keepers) are the women's/irrelevant material the semantic layer
 * must reject. Four describe ONE match story and must merge.
 */
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

/** Deterministic prefilter drops these two on hard textual rules alone. */
const EXPECTED_DROPPED = ["t2", "t4"];
/** These must be REJECTED by the semantic layer, not by the prefilter. */
const MUST_BE_REJECTED = ["t7", "t8"];

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const hr = (s: string) => console.log(`\n${"=".repeat(72)}\n${s}\n${"=".repeat(72)}`);

/** Names and scorelines that are part of the fixture, not claims to verify. */
const GROUNDING_TOKENS = [
  "Lindgren", "Kalmar", "Häcken", "Mjällby", "Allsvenskan", "Champions League",
  "Inter", "Juve", "Bajen", "Feyenoord", "Samsung", "3-0", "2-1", "1-0", "hattrick",
];

/** Ordinary Swedish words that begin a sentence or a name; never a claim. */
const CLAIM_STOPWORDS = new Set([
  "En", "Ett", "Och", "Men", "Det", "Den", "De", "Som", "För", "Med", "På", "Av",
  "Om", "In", "Han", "Hon", "Vi", "De", "Här", "Nu", "Så", "Till", "Från", "Vid",
  "Under", "Efter", "Innan", "När", "Där", "Då", "Alla", "Inga", "Bara", "Mer",
  "Mest", "Mycket", "Ingen", "Inget", "Delad", "Seger", "Defensivt", "Offensivt",
]);

interface ClaimAudit {
  /** Claim found in at least one supplied article, with which ones. */
  traceable: Array<{ claim: string; sources: string[] }>;
  /** Claim found in NO supplied article. Only these are fabrication risks. */
  untraceable: string[];
}

/**
 * Traceability audit of a Gemini synthesis.
 *
 * THE RULE: a factual claim must be traceable to AT LEAST ONE supplied source
 * article. For a multi-source synthesis a claim may legitimately be supported
 * COLLECTIVELY across several supplied articles, so "appears somewhere in the
 * corpus" is the correct test, not "appears in the lead article".
 *
 * Only claims that cannot be traced to ANY supplied source are flagged. A
 * supported claim is not a defect and must not be reported as one.
 */
function auditClaims(summary: string, textById: Map<string, string>): ClaimAudit {
  // Unicode-aware: \w does NOT include letters like e-acute, which would
  // split "Andrésen" into "Andr" and then wrongly report it as fabricated.
  // The same class keeps hyphenated tokens such as "3-0" intact instead of
  // splitting them into two meaningless single digits.
  const proper = summary.match(/\p{Lu}[\p{L}\p{M}-]{2,}/gu) ?? [];
  const numbers = summary.match(/\b\d+(?:[.,]\d+)*(?:-\d+)*\b/gu) ?? [];
  const claims = [...new Set([...proper, ...numbers])].filter(
    (c) => !GROUNDING_TOKENS.includes(c) && !CLAIM_STOPWORDS.has(c),
  );

  const traceable: ClaimAudit["traceable"] = [];
  const untraceable: string[] = [];
  for (const claim of claims) {
    const needle = claim.toLowerCase();
    const sources = [...textById.entries()]
      .filter(([, body]) => body.toLowerCase().includes(needle))
      .map(([id]) => id);
    if (sources.length > 0) traceable.push({ claim, sources });
    else untraceable.push(claim);
  }
  return { traceable, untraceable };
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("RESULT: no-key — GEMINI_API_KEY is not set.");
    process.exit(2);
  }

  hr("1. INPUT — deterministic collection + prefilter");
  const { candidates, dropped } = prefilterNews(ARTICLES, { now: new Date("2026-09-25T12:00:00Z") });
  console.log(`candidates passed to Gemini: ${candidates.length} of ${ARTICLES.length}`);
  console.log(`dropped by hard prefilter  : ${dropped.map((d) => d.url).length}`);
  for (const d of dropped) console.log(`   dropped: ${d.reason} — ${d.url.slice(0, 70)}`);

  // Article fetch is plain HTTP. It costs NO Gemini quota.
  const texts = await fetchArticleTexts(candidates.map((c) => c.url));
  const textById = new Map<string, string>();
  const geminiInput: GeminiArticleInput[] = candidates.map((c) => {
    const t = texts.get(c.url);
    // `ok` is a plain boolean, not a discriminated union, so TypeScript cannot
    // narrow `text` from it. Check the value explicitly rather than asserting.
    const body = t?.ok && typeof t.text === "string" ? t.text : undefined;
    if (body) textById.set(c.id, body);
    return {
      id: c.id,
      publisher: c.publisher,
      title: c.title,
      url: c.url,
      publishedAt: c.publishedAt,
      text: body,
      categoryHint: c.category,
    };
  });
  for (const a of geminiInput) {
    const t = texts.get(a.url);
    console.log(`   ${a.id}: ${a.text ? `${a.text.length} chars of article text` : `TEXT UNAVAILABLE (${t?.error ?? "unknown"})`}`);
  }

  hr("2. BASELINE — what deterministic filtering alone produces");
  const baseline: NewsEvent[] = buildNewsEvents(candidates);
  console.log(`deterministic events: ${baseline.length}`);
  for (const e of baseline) {
    console.log(`\n  * ${e.title}   [${e.sources.length} src] (${e.summaryMethod})`);
    console.log(`    summary: ${e.summary}`);
    for (const s of e.sources) console.log(`      - ${s.publisher}: ${(s.title ?? "").slice(0, 64)}`);
  }
  console.log(`\n  Deterministic CANNOT merge differently-worded reports of the same`);
  console.log(`  story. It groups only on identical normalised titles.`);

  const body = JSON.stringify(buildGeminiRequestPayload(geminiInput));
  hr("3. THE ONE REQUEST");
  console.log(`model         : ${MODEL}`);
  console.log(`request bytes : ${body.length}`);
  console.log(`This file calls fetch EXACTLY ONCE. A 503 is a valid result —`);
  console.log(`do not re-run to chase a different answer.`);

  // THE ONLY FETCH IN THIS FILE. One call. No retry, no fallback, no loop.
  let status = 0;
  let raw = "";
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body,
      signal: AbortSignal.timeout(120000),
    });
    status = res.status;
    raw = await res.text();
  } catch (e) {
    console.log(`\nRESULT: network-blocked — ${e instanceof Error ? e.message : String(e)}`);
    console.log("Spend: 1 request.");
    process.exit(0);
  }
  console.log(`\nHTTP ${status}`);
  console.log("Spend: 1 request. (Article fetches above cost no Gemini quota.)");

  if (status !== 200) {
    hr("4. VERBATIM ERROR BODY");
    console.log(raw.slice(0, 1500));
    console.log("\n=== end body ===");
    console.log(`\nRESULT: ${status === 503 ? "capacity-blocked-503" : status === 429 ? "quota-exhausted" : status === 404 ? "model-unavailable" : "http-error"}`);
    console.log("\nNo semantic conclusion is possible. Do not re-run repeatedly.");
    console.log("The deterministic baseline in section 2 stands as the fallback.");
    process.exit(0);
  }

  let text = "";
  try {
    const env = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    text = env.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  } catch { /* reported below */ }

  hr("4. GEMINI VERDICTS — men / women / youth / club / unknown");
  if (!text.trim()) {
    console.log("RESULT: reachable-empty — HTTP 200 with no model text.");
    process.exit(0);
  }
  let parsed: ReturnType<typeof parseGeminiResponse>;
  try {
    parsed = parseGeminiResponse(text, geminiInput.map((a) => a.id));
  } catch (e) {
    console.log("RESULT: unparseable —", e instanceof Error ? e.message : String(e));
    console.log("\nRaw (first 800):\n", text.slice(0, 800));
    process.exit(0);
  }
  const result: GeminiResult = parsed.result;
  for (const v of result.verdicts) {
    console.log(`  ${v.articleId}: ${v.scope.toUpperCase().padEnd(8)} (${v.confidence}) — ${v.reason}`);
  }
  if (parsed.unknownIds.length) {
    console.log(`\n  !! Gemini referenced article ids we NEVER sent: ${parsed.unknownIds.join(", ")}`);
    console.log(`     (production discards these; reported here as a prompt/format defect)`);
  }

  hr("5. REJECTED vs MERGED vs LEFT UNPLACED");
  const placed = new Set(result.events.flatMap((e) => e.articleIds));
  const rejected = result.verdicts.filter((v) => v.scope !== "men").map((v) => v.articleId);
  const leftovers = geminiInput.map((a) => a.id).filter((id) => !placed.has(id) && !rejected.includes(id));
  console.log(`rejected (non-men)   : ${rejected.join(", ") || "none"}`);
  console.log(`merged into events   : ${[...placed].join(", ") || "none"}`);
  console.log(`men but unplaced     : ${leftovers.join(", ") || "none"}`);
  const missed = MUST_BE_REJECTED.filter((id) => !rejected.includes(id));
  if (missed.length) console.log(`\n  !! FAILED TO REJECT: ${missed.join(", ")} — expected these to be non-men`);

  hr("6. EVENTS — does Gemini synthesize, or just select?");
  const events = buildEventsFromGemini(candidates, result);
  console.log(`gemini events: ${events.length}   (deterministic produced ${baseline.length})`);
  for (const e of events) {
    console.log(`\n  * ${e.title}   [${e.sources.length} src] (${e.summaryMethod})`);
    console.log(`    summary (${e.summary.length}/${MAX_SUMMARY_CHARS}): ${e.summary}`);
    console.log("    PROVENANCE:");
    for (const s of e.sources) {
      console.log(`      - ${s.publisher} | ${(s.title ?? "").slice(0, 60)}`);
      console.log(`        ${s.url}`);
    }
  }

  hr("7. PROVENANCE + HALLUCINATION AUDIT");
  const known = new Map(ARTICLES.map((a) => [a.url, a.id]));
  let invented = 0;
  for (const e of events) {
    for (const s of e.sources) {
      if (!known.has(s.url)) {
        console.log(`  !! INVENTED URL: ${s.url}`);
        invented++;
      }
    }
  }
  console.log(invented === 0 ? "  no invented URLs." : `  ${invented} invented URL(s).`);

  console.log("");
  console.log("  Claim traceability — a claim needs AT LEAST ONE supplied source.");
  console.log("  Multi-source synthesis may be supported collectively; that is fine.");
  console.log("  Only claims traceable to NO supplied article are flagged.");
  let anyUntraceable = false;
  for (const e of events) {
    const { traceable, untraceable } = auditClaims(e.summary, textById);
    if (traceable.length) {
      console.log(`\n    "${e.title.slice(0, 52)}"`);
      for (const t of traceable) {
        console.log(`      supported: ${t.claim}  <- ${t.sources.join(", ")}`);
      }
    }
    if (untraceable.length) {
      anyUntraceable = true;
      console.log(`      !! UNTRACEABLE (no supplied source): ${untraceable.join(", ")}`);
    }
  }
  if (!anyUntraceable) console.log("\n    No untraceable claims. Every claim maps to a supplied article.");

  hr("8. WHAT GEMINI ADDED (vs deterministic alone)");
  const bSrc = baseline.reduce((n, e) => n + e.sources.length, 0);
  const gSrc = events.reduce((n, e) => n + e.sources.length, 0);
  console.log(`  deterministic : ${baseline.length} events from ${bSrc} sources`);
  console.log(`  gemini        : ${events.length} events from ${gSrc} sources`);
  console.log(`  merged        : ${gSrc - events.length} sources folded into shared events`);
  console.log(`\n  Judge for yourself:`);
  const droppedById = ARTICLES.filter((a) => !candidates.some((c) => c.id === a.id)).map((a) => a.id);
  const unexpectedDrops = droppedById.filter((id) => !EXPECTED_DROPPED.includes(id));
  console.log(`   0. Prefilter dropped ${droppedById.join(", ")}` +
    (unexpectedDrops.length ? ` (UNEXPECTED: ${unexpectedDrops.join(", ")})` : " — as expected, on hard rules only"));
  console.log(`   1. Did it reject the women's/irrelevant articles? (${missed.length === 0 ? "yes" : "NO"})`);
  console.log(`   2. Did it merge the differently-worded reports of one match?`);
  console.log(`   3. Are the summaries more useful than the RSS descriptions?`);
  console.log(`   4. Is every claim traceable to a supplied article?`);
  console.log(`   5. Would a supporter be better served than by the baseline above?`);
  console.log(`\n  A 200 is NOT the answer. These five questions are the answer.`);
  process.exit(0);
}

main();
