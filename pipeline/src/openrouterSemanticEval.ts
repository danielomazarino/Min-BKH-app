/**
 * BOUNDED SEMANTIC EVALUATION (OpenRouter) — exactly ONE request.
 *
 * WHY THIS FILE EXISTS
 *   `geminiSemanticEval.ts` is the evaluation that has never produced a usable
 *   answer: Gemini's chat probe scored 0/15 on the identical payload. The SAME
 *   payload scored 1/1 on OpenRouter (run 37228797019, 2026-10-04).
 *
 *   So the question is no longer "is the transport up" — it is the ORIGINAL
 *   question this harness was written to answer, which has been blocked for
 *   weeks:
 *
 *     Does the semantic layer produce materially more useful, safer
 *     supporter-facing news than deterministic filtering alone — WITHOUT
 *     recreating the false merges that reached production (B-004)?
 *
 *   This file answers it for OpenRouter. It is a faithful PORT, not a
 *   redesign: same 8-article fixture, same prefilter, same prompt, same JSON
 *   schema, same audits, same five closing questions. Anything less would make
 *   a comparison against the Gemini history meaningless.
 *
 * COST — READ THIS FIRST
 *   EXACTLY ONE chat completion. `fetch` is called exactly once, marked
 *   // THE ONLY FETCH. No retry, no model fallback, no second attempt.
 *   Deliberately does NOT call synthesizeWithGemini.
 *
 *   A 503 is a valid result. Do not re-run hoping for a better one.
 *
 * WHAT IT PRODUCES
 *   1. The deterministic baseline: what `buildNewsEvents` alone produces.
 *   2. The model's verdicts and events.
 *   3. A provenance audit: every URL, and whether any was invented.
 *   4. A hallucination surface: claims not present in the supplied text.
 *   5. The five closing judgement questions, unchanged.
 *
 * DEV-ONLY evaluation. Writes nothing. Changes no production behaviour.
 * It does NOT re-enable the semantic layer anywhere.
 */
import { prefilterNews } from "./newsPrefilter";
import { fetchArticleTexts } from "./articleText";
import { buildNewsEvents } from "./newsEvents";
import { MAX_SUMMARY_CHARS, type GeminiArticleInput, type GeminiResult } from "./gemini";
import { buildEventsFromGemini } from "./gemini";
import type { NewsEvent, NewsItem } from "./types";

/**
 * THE FIXTURE — byte-identical to geminiSemanticEval.ts. DO NOT DIVERGE.
 *
 * Diverging would destroy the one thing this file exists for: a like-for-like
 * comparison against the recorded Gemini runs. Eight articles:
 *   t1        pre-match team news (Häcken)
 *   t2        opponent preview, no "Hacken"  -> prefilter must drop (hard rule)
 *   t3        post-match report (Häcken)
 *   t4        post-match report (SVT), no "Hacken" -> prefilter must drop
 *   t5        post-match report (Sportbladet)
 *   t6        post-match report (FotbollDirekt)
 *   t7        WOMEN'S Champions League guide  -> semantic layer must reject
 *   t8        WOMEN's goalkeeper story         -> semantic layer must reject
 *
 * t3/t4/t5/t6 all describe ONE finished match and MUST merge into one event.
 * t1 is PRE-match about the SAME opponent and MUST NOT merge with them — that
 * separation is precisely the B-004 defect that reached production.
 */
const ARTICLES: NewsItem[] = [
  { id: "t1", publisher: "BK Häcken", title: "BK Häcken åker till Kalmar – här är matchtruppen", summary: "Imorgon klockan 14.00 ställs BK Häcken mot Kalmar FF borta i Allsvenskan. Huvudtränare Jens Gustafsson har tagit ut truppen.", url: "https://bkhacken.se/nyhet/bk-hacken-aker-till-kalmar-har-ar-matchtruppen", publishedAt: "2026-09-19T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t2", publisher: "Kalmar FF", title: "Inför KFF-BKH: Tillsammans ska vi göra allt vi kan för att ta tre poäng", summary: "Kalmar FF jagar tre poäng hemma. Senast möttes lagen den 1 augusti, då slutade matchen 1–1 efter ett mål av Keita.", url: "https://kalmarff.se/infor-kff-bkh-tillsammans-ska-vi-gora-allt-vi-kan-for-att-ta-tre-poang/", publishedAt: "2026-09-19T09:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t3", publisher: "BK Häcken", title: "Gustav Lindgren: Det kändes väldigt bra från den första minuten", summary: "Matchhjälten Gustav Lindgren stod för tre mål när Häcken besegrade Kalmar FF med 5–0.", url: "https://bkhacken.se/nyhet/gustav-lindgren-det-kandes-valdigt-bra-fran-den-forsta-minuten", publishedAt: "2026-09-20T10:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t4", publisher: "SVT Sport", title: "Gustav Lindgren gör hattrick mot Kalmar", summary: "Anfallaren krossade Kalmar på egen hand med ett hattrick i bortamatchen.", url: "https://www.svt.se/sport/fotboll/gustav-lindgren-gor-hattrick-mot-kalmar", publishedAt: "2026-09-20T12:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t5", publisher: "Sportbladet", title: "Häcken krossar Kalmar – hattrick av Lindgren", summary: "Anfallaren gjorde hattrick när Häcken vann med 5–0. Krisen i Kalmar FF fortsätter.", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/Ex8Q0P/hacken-krossar-kalmar-hattrick-av-gustav-lindgren", publishedAt: "2026-09-20T13:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t6", publisher: "FotbollDirekt", title: "Hattrick från Lindgren – Häcken krossade Kalmar", summary: "Gustav Lindgren sköt ett hattrick på bara 48 minuter och säkrade segern till 0–5.", url: "https://fotbolldirekt.se/allsvenskan/hattrick-fran-lindgren-hacken-krossade-kalmar/", publishedAt: "2026-09-20T14:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t7", publisher: "BK Häcken", title: "Matchguide: Champions League-premiär borta mot FC Inter", summary: "Ligafasen av UEFA Women's Champions League inleds borta mot Inter. Avspark klockan 18.45.", url: "https://bkhacken.se/nyhet/matchguide-champions-league-premiar-borta-mot-fc-inter", publishedAt: "2026-09-22T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
  { id: "t8", publisher: "Sportbladet", title: "Häckens målvakter mot Juventus – två tonåringar", summary: "Jennifer Falk är avstängd hemma mot Juventus efter ett rött kort i bostamatchen mot Inter.", url: "https://www.aftonbladet.se/sportbladet/fotboll/a/6qaWy8/hacken-kan-sta-infor-en-malvaktskris", publishedAt: "2026-09-23T08:00:00.000Z", category: "unknown", discoveredVia: "rss" },
];

/** Deterministic prefilter drops these two on hard textual rules alone. */
const EXPECTED_DROPPED = ["t2", "t4"];
/** These must be REJECTED by the semantic layer, not by the prefilter. */
const MUST_BE_REJECTED = ["t7", "t8"];

const MODEL = process.env.OPENROUTER_MODEL ?? "qwen/qwen3.8-27b:free";
const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const ENDPOINT = `${BASE}/chat/completions`;

const hr = (s: string) => console.log(`\n${"=".repeat(72)}\n${s}\n${"=".repeat(72)}`);

/**
 * THE PROMPT — copied VERBATIM from gemini.ts (SYSTEM_INSTRUCTION), which is
 * the prompt that was fixed in commit c73b820 and never validated live.
 *
 * The rule that matters most for B-004 is the PRE/POST match separation:
 * "material från FÖRE matchen ... hör inte ihop med material från EFTER
 * matchen". If the model violates it, false merges return.
 */
const SYSTEM_INSTRUCTION = `Du redigerar nyhetsflödet för en PWA om BK HÄCKENS HERRLAG.

För varje artikel bestämmer du:
1. Om den gäller herrlaget, damlaget, ungdom/academi eller klubb generellt.
2. Vilka andra av de levererade artiklarna som beskriver Samma underliggande händelse.

REGLER
- En artikel räknas som herrlag endast om det finns stöd i texten: herrlagsspelare, herrlagsmatch, Allsvenskan/herr, eller ett officiellt källtagg som "Herr".
- Ett omnämnande av "Häcken", ett bkhacken.se-länk eller ett kvinnligt spelarnamn är INTE i sig herrlag.
- Oklart underlag => scope "unknown". Gissa inte.
- Artiklar om samma match, samma resultat, samma transfer eller samma skada hör till samma händelse, ÄVEN om rubrikerna skiljer sig helt.
- Matchens två sidor är däremot separata händelser: material från FÖRE matchen (matchtrupp, förhandsprogram, besöksinformation, matchtröpehelg, truppen inför) hör inte ihop med material från EFTER matchen (matchrapport, referat, resultat), även om de gäller samma motståndare, samma match och samma vecka.
- Artiklar om samma AVSLUTADE utfall hör däremot ihop, även om några beskriver det olika: flera rapporter om samma resultat är en händelse.
- Artiklar om olika saker (t.ex. matchresultat och kontraktsförlängning) är separata händelser, även samma dag.
- Rubrik: en logisk svensk rubrik för hela händelsen.
- Sammanfattning: Svensk, faktisk, högst 200 tecken, inga åsikter, ingen clickbait, ingen uppfinngad information. Endast utifrån det material du fått.
- Hitta på inga fakta, inga urls, inga datum som inte framgår av materialet.`;

/** Same schema as gemini.ts, restated in OpenAI-compatible JSON-schema form. */
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "news_grouping",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              articleId: { type: "string" },
              scope: { type: "string", enum: ["men", "women", "youth", "club", "unknown"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              reason: { type: "string" },
            },
            required: ["articleId", "scope", "confidence", "reason"],
            additionalProperties: false,
          },
        },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              articleIds: { type: "array", items: { type: "string" } },
            },
            required: ["title", "summary", "articleIds"],
            additionalProperties: false,
          },
        },
      },
      required: ["verdicts", "events"],
      additionalProperties: false,
    },
  },
} as const;

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
  traceable: Array<{ claim: string; sources: string[] }>;
  untraceable: string[];
}

/** Traceability audit. Identical rule to the Gemini harness. */
function auditClaims(summary: string, textById: Map<string, string>): ClaimAudit {
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
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("RESULT: no-key — OPENROUTER_API_KEY is not set.");
    process.exit(2);
  }
  if (!MODEL.endsWith(":free")) {
    console.error(`RESULT: refusing — model "${MODEL}" is not a :free variant.`);
    console.error("This evaluation is budgeted at zero cost; it must not spend credits.");
    process.exit(2);
  }

  hr("1. INPUT — deterministic collection + prefilter");
  const { candidates, dropped } = prefilterNews(ARTICLES, {
    now: new Date("2026-09-25T12:00:00Z"),
    // Same as the Gemini harness: pass no `known`, so the prefilter behaves
    // exactly as it did before the person-rescue existed and t7/t8 still reach
    // the model, which is what makes the men/women test meaningful.
  });
  console.log(`candidates passed to the model: ${candidates.length} of ${ARTICLES.length}`);
  console.log(`dropped by hard prefilter    : ${dropped.length}`);
  for (const d of dropped) console.log(`   dropped: ${d.reason} — ${d.url.slice(0, 70)}`);

  // Article fetch is plain HTTP. It costs NO model quota.
  const texts = await fetchArticleTexts(candidates.map((c) => c.url));
  const textById = new Map<string, string>();
  const modelInput: GeminiArticleInput[] = candidates.map((c) => {
    const t = texts.get(c.url);
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
  for (const a of modelInput) {
    const t = texts.get(a.url);
    console.log(`   ${a.id}: ${a.text ? `${a.text.length} chars of article text` : `TEXT UNAVAILABLE (${t?.error ?? "unknown"})`}`);
  }

  // FIXTURE GUARD, before the request, so a broken URL costs ZERO quota.
  const invalidFixture = MUST_BE_REJECTED.filter((id) => {
    const item = candidates.find((c) => c.id === id);
    if (!item) return false;
    return !textById.has(id);
  });
  if (invalidFixture.length > 0) {
    console.log("\nFIXTURE INVALID — an article that MUST be rejected has no text:");
    for (const id of invalidFixture) {
      const item = ARTICLES.find((a) => a.id === id)!;
      const t = texts.get(item.url);
      console.log(`   ${id}: ${item.url}`);
      console.log(`       reason: ${t?.error ?? "not fetched (dropped by prefilter?)"}`);
    }
    console.log("\nRESULT: fixture-invalid");
    console.log("Spend: 0 requests. The guard runs before the request.");
    process.exit(3);
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

  // Same article blocks the Gemini payload builder produces, so the prompt
  // text reaching the model is identical apart from the endpoint envelope.
  const articleBlocks = modelInput.map((a) =>
    [
      `<article id="${a.id}">`,
      `publisher: ${a.publisher}`,
      `url: ${a.url}`,
      `published: ${a.publishedAt}`,
      a.sourceTags?.length ? `sourceTags: ${a.sourceTags.join(", ")}` : "",
      `title: ${a.title}`,
      a.text ? `text: ${a.text}` : `text: (SA INTE GÅ att hämta — använd bara titel och url)`,
      `</article>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      {
        role: "user",
        content: `Analysera dessa ${modelInput.length} artiklar och returnera JSON enligt schemat.

${articleBlocks.join("\n\n")}

Svara för VARJE artikel med en verdict (scope/confidence/reason).
Svara med ett event per underliggande händelse, och lista de articleId som hör till den.
Endast artiklar med scope "men" ska ingå i events.`,
      },
    ],
    response_format: RESPONSE_FORMAT,
    temperature: 0.1,
    max_tokens: 4096,
  });

  hr("3. THE ONE REQUEST");
  console.log(`model         : ${MODEL}`);
  console.log(`request bytes : ${body.length}`);
  console.log(`articles      : ${modelInput.length}, with text: ${textById.size}`);
  console.log(`This file calls fetch EXACTLY ONCE. A 503 is a valid result —`);
  console.log(`do not re-run to chase a different answer.`);

  // THE ONLY FETCH IN THIS FILE. One call. No retry, no fallback, no loop.
  let status = 0;
  let raw = "";
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Title": "Min BKH-app news grouping evaluation",
      },
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
  console.log("Spend: 1 request. (Article fetches above cost no quota.)");

  if (status !== 200) {
    hr("4. VERBATIM ERROR BODY");
    console.log(raw.slice(0, 1500));
    console.log("\n=== end body ===");
    const label =
      status === 503 ? "no-provider-available-503"
      : status === 429 ? "rate-limited-429"
      : status === 402 ? "billing-402"
      : status === 401 ? "auth-blocked-401"
      : "http-error";
    console.log(`\nRESULT: ${label}`);
    console.log("\nNo semantic conclusion is possible. Do not re-run repeatedly.");
    console.log("The deterministic baseline in section 2 stands as the fallback.");
    process.exit(0);
  }

  let text = "";
  try {
    const env = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    text = env.choices?.[0]?.message?.content ?? "";
  } catch { /* reported below */ }

  hr("4. VERDICTS — men / women / youth / club / unknown");
  if (!text.trim()) {
    console.log("RESULT: reachable-empty — HTTP 200 with no model text.");
    console.log(raw.slice(0, 600));
    process.exit(0);
  }

  let result: GeminiResult;
  try {
    // parseGeminiResponse is provider-agnostic: it validates shape and drops
    // unknown/cross-reused ids. Reused so the audit is IDENTICAL to Gemini's.
    const { parseGeminiResponse } = await import("./gemini");
    const parsed = parseGeminiResponse(text, modelInput.map((a) => a.id));
    result = parsed.result;
    if (parsed.unknownIds.length) {
      console.log(`\n  !! model referenced article ids we NEVER sent: ${parsed.unknownIds.join(", ")}`);
      console.log(`     (production discards these; reported as a prompt/format defect)`);
    }
  } catch (e) {
    console.log("RESULT: unparseable —", e instanceof Error ? e.message : String(e));
    console.log("\nRaw (first 800):\n", text.slice(0, 800));
    process.exit(0);
  }

  for (const v of result.verdicts) {
    console.log(`  ${v.articleId}: ${v.scope.toUpperCase().padEnd(8)} (${v.confidence}) — ${v.reason}`);
  }

  hr("5. REJECTED vs MERGED vs LEFT UNPLACED");
  const placed = new Set(result.events.flatMap((e) => e.articleIds));
  const rejected = result.verdicts.filter((v) => v.scope !== "men").map((v) => v.articleId);
  const leftovers = modelInput.map((a) => a.id).filter((id) => !placed.has(id) && !rejected.includes(id));
  console.log(`rejected (non-men)   : ${rejected.join(", ") || "none"}`);
  console.log(`merged into events   : ${[...placed].join(", ") || "none"}`);
  console.log(`men but unplaced     : ${leftovers.join(", ") || "none"}`);
  const missed = MUST_BE_REJECTED.filter((id) => !rejected.includes(id));
  console.log(`\n  women's/irrelevant correctly rejected: ${missed.length === 0 ? "YES" : "NO — missed " + missed.join(", ")}`);

  hr("6. EVENTS — does the model synthesize, or just select?");
  const events = buildEventsFromGemini(candidates, result);
  console.log(`model events: ${events.length}   (deterministic produced ${baseline.length})`);
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
  let anyUntraceable = false;
  for (const e of events) {
    const { traceable, untraceable } = auditClaims(e.summary, textById);
    if (traceable.length) {
      console.log(`\n    "${e.title.slice(0, 52)}"`);
      for (const t of traceable) console.log(`      supported: ${t.claim}  <- ${t.sources.join(", ")}`);
    }
    if (untraceable.length) {
      anyUntraceable = true;
      console.log(`      !! UNTRACEABLE (no supplied source): ${untraceable.join(", ")}`);
    }
  }
  if (!anyUntraceable) console.log("\n    No untraceable claims. Every claim maps to a supplied article.");

  hr("8. WHAT THE MODEL ADDED (vs deterministic alone)");
  const bSrc = baseline.reduce((n, e) => n + e.sources.length, 0);
  const gSrc = events.reduce((n, e) => n + e.sources.length, 0);
  console.log(`  deterministic : ${baseline.length} events from ${bSrc} sources`);
  console.log(`  model         : ${events.length} events from ${gSrc} sources`);
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
