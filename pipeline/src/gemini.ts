/**
 * Gemini-assisted news SYNTHESIS.
 *
 * Gemini's only job is semantic interpretation of articles the deterministic
 * pipeline has already collected:
 *   - is this BK Häcken MEN's first team, women's, youth, or club/general?
 *   - which supplied articles describe the SAME underlying event?
 *   - what is the logical headline and a short factual Swedish summary?
 *
 * Gemini is NOT a discovery mechanism and NOT the source. It never receives
 * URLs it did not get from us, and any URL it returns that we did not supply is
 * discarded during validation.
 *
 * Cost model: ONE request per pipeline run, containing the whole candidate
 * batch (section 20 of the task). No per-article calls.
 *
 * No SDK is used: the REST endpoint with responseMimeType/responseSchema
 * returns validated JSON, which keeps the dependency surface at zero.
 */
import { z } from "zod";
import type { NewsCategory, NewsEvent, NewsItem } from "./types";
import { buildNewsEvents, publisherRole } from "./newsEvents";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const TIMEOUT_MS = 120000;

export const MAX_SUMMARY_CHARS = 200;

/** One article as presented to Gemini. */
export interface GeminiArticleInput {
  id: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string;
  /** Article body text, or undefined when extraction failed. */
  text?: string;
  /** Deterministic hint from our own keyword classifier (advisory only). */
  categoryHint: NewsCategory;
  /** Official source tag evidence, e.g. "Herr" / "Dam", when present. */
  sourceTags?: string[];
}

export interface GeminiEvent {
  title: string;
  summary: string;
  /** Article ids (as supplied) that belong to this event. */
  articleIds: string[];
}

export interface GeminiVerdict {
  articleId: string;
  scope: "men" | "women" | "youth" | "club" | "unknown";
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface GeminiResult {
  verdicts: GeminiVerdict[];
  events: GeminiEvent[];
}

const RawSchema = {
  type: "OBJECT",
  properties: {
    verdicts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          articleId: { type: "STRING" },
          scope: { type: "STRING", enum: ["men", "women", "youth", "club", "unknown"] },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          reason: { type: "STRING" },
        },
        required: ["articleId", "scope", "confidence", "reason"],
      },
    },
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          summary: { type: "STRING" },
          articleIds: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["title", "summary", "articleIds"],
      },
    },
  },
  required: ["verdicts", "events"],
} as const;

const SYSTEM_INSTRUCTION = `Du redigerar nyhetsflödet för en PWA om BK HÄCKENS HERRLAG.

För varje artikel bestämmer du:
1. Om den gäller herrlaget, damlaget, ungdom/academi eller klubb generellt.
2. Vilka andra av de levererade artiklarna som beskriver Samma underliggande händelse.

REGLER
- En artikel räknas som herrlag endast om det finns stöd i texten: herrlagsspelare, herrlagsmatch, Allsvenskan/herr, eller ett officiellt källtagg som "Herr".
- Ett omnämnande av "Häcken", ett bkhacken.se-länk eller ett kvinnligt spelarnamn är INTE i sig herrlag.
- Oklart underlag => scope "unknown". Gissa inte.
- Artiklar om samma match, samma resultat, samma transfer eller samma skada hör till samma händelse, ÄVEN om rubrikerna skiljer sig helt.
- Artiklar om olika saker (t.ex. matchresultat och kontraktsförlängning) är separata händelser, även samma dag.
- Rubrik: en logisk svensk rubrik för hela händelsen.
- Sammanfattning: Svensk, faktisk, högst 200 tecken, inga åsikter, ingen clickbait, ingen uppfinngad information. Endast utifrån det material du fått.
- Hitta på inga fakta, inga urls, inga datum som inte framgår av materialet.`;

export interface GeminiStatus {
  ok: boolean;
  error?: string;
  calls: number;
}

/** Build the single batched request payload. Exported for tests. */
export function buildGeminiRequestPayload(articles: GeminiArticleInput[]) {
  const articleBlocks = articles.map((a) =>
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

  return {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Analysera dessa ${articles.length} artiklar och returnera JSON enligt schemat.

${articleBlocks.join("\n\n")}

Svara för VARJE artikel med en verdict (scope/confidence/reason).
Svara med ett event per underliggande händelse, och lista de articleId som hör till den.
Endast artiklar med scope "men" ska ingå i events.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: RawSchema,
    },
  };
}

interface GeminiCallResult {
  text: string;
  calls: number;
}

/** One HTTP call. Throws on failure so the caller can fall back safely. */
async function callGemini(articles: GeminiArticleInput[]): Promise<GeminiCallResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(buildGeminiRequestPayload(articles)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini returned an empty response");
  return { text, calls: 1 };
}

const Parsed = z.object({
  verdicts: z.array(
    z.object({
      articleId: z.string(),
      scope: z.enum(["men", "women", "youth", "club", "unknown"]),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      articleIds: z.array(z.string()),
    }),
  ),
});

export interface ParsedGemini {
  result: GeminiResult;
  /** Article ids Gemini referenced that we never supplied. */
  unknownIds: string[];
}

/** Parse + structurally validate the model response. Exported for tests. */
export function parseGeminiResponse(text: string, knownIds: string[]): ParsedGemini {
  const parsed = Parsed.parse(JSON.parse(text));
  const known = new Set(knownIds);
  const unknownIds = new Set<string>();
  const seenVerdict = new Set<string>();
  const verdicts: GeminiVerdict[] = [];
  for (const v of parsed.verdicts) {
    if (!known.has(v.articleId)) {
      unknownIds.add(v.articleId);
      continue;
    }
    if (seenVerdict.has(v.articleId)) continue;
    seenVerdict.add(v.articleId);
    verdicts.push(v);
  }
  const assigned = new Set<string>();
  const events: GeminiEvent[] = [];
  for (const e of parsed.events) {
    const ids = e.articleIds.filter((id) => known.has(id));
    for (const id of e.articleIds) if (!known.has(id)) unknownIds.add(id);
    // Drop cross-event reuse so every article appears in at most one event.
    const unique = ids.filter((id) => !assigned.has(id));
    if (unique.length === 0) continue;
    unique.forEach((id) => assigned.add(id));
    events.push({ title: e.title.trim(), summary: e.summary.trim(), articleIds: unique });
  }
  return { result: { verdicts, events }, unknownIds: [...unknownIds] };
}

/** Call Gemini once for the whole candidate batch. Never throws. */
export async function synthesizeWithGemini(
  articles: GeminiArticleInput[],
): Promise<{ result: GeminiResult | null; status: GeminiStatus; raw: string | null }> {
  if (articles.length === 0) return { result: null, status: { ok: true, calls: 0 }, raw: null };
  if (!process.env.GEMINI_API_KEY) {
    return {
      result: null,
      status: { ok: false, error: "GEMINI_API_KEY is not set — keeping deterministic events", calls: 0 },
      raw: null,
    };
  }
  try {
    const { text, calls } = await callGemini(articles);
    const ids = articles.map((a) => a.id);
    const { result, unknownIds } = parseGeminiResponse(text, ids);
    if (result.events.length === 0) {
      return { result: null, status: { ok: false, error: "Gemini returned no usable events", calls }, raw: text };
    }
    if (unknownIds.length) {
      console.warn(`gemini: ignored unknown article ids: ${unknownIds.join(", ")}`);
    }
    return { result, status: { ok: true, calls }, raw: text };
  } catch (e) {
    return {
      result: null,
      status: { ok: false, error: e instanceof Error ? e.message : String(e), calls: 0 },
      raw: null,
    };
  }
}

/** Deterministic events, used as the fallback and as the test oracle. */
function fallbackSummary(item: NewsItem): string {
  const s = (item.summary ?? "").trim();
  if (s.length > 20) return s.length > MAX_SUMMARY_CHARS ? `${s.slice(0, MAX_SUMMARY_CHARS - 1)}…` : s;
  return item.title.slice(0, MAX_SUMMARY_CHARS);
}

function eventFromItems(id: string, items: NewsItem[], summary: string, method: NewsEvent["summaryMethod"]): NewsEvent {
  const sorted = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const lead = sorted[0];
  return {
    id,
    title: lead.title,
    summary,
    publishedAt: lead.publishedAt,
    latestPublishedAt: lead.publishedAt,
    category: "men",
    sources: sorted.map((s) => ({
      publisher: s.publisher,
      title: s.title,
      url: s.url,
      publishedAt: s.publishedAt,
      role: s.sourceRole ?? publisherRole(s.publisher),
      discoveredVia: s.discoveredVia,
    })),
    summaryMethod: method,
  };
}

/**
 * Turn a validated Gemini result into NewsEvents.
 *
 * Rules enforced here (we never trust the model):
 * - only articles Gemini scoped as "men" may appear in an event;
 * - URLs, publishers, titles and dates always come from OUR items;
 * - summary is truncated to MAX_SUMMARY_CHARS and falls back to source text;
 * - a men-scoped article Gemini did not place in any event still appears, via
 *   the existing deterministic title-based grouping, so nothing vanishes.
 */
export function buildEventsFromGemini(items: NewsItem[], gemini: GeminiResult | null): NewsEvent[] {
  if (!gemini || gemini.events.length === 0) return [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const menIds = new Set(gemini.verdicts.filter((v) => v.scope === "men").map((v) => v.articleId));

  const events: NewsEvent[] = [];
  const assignedIds = new Set<string>();
  // Ids the model referenced anywhere — an id it dropped from a duplicate
  // event must not reappear as a leftover.
  const referencedIds = new Set(gemini.events.flatMap((e) => e.articleIds));
  gemini.events.forEach((e, idx) => {
    // An article may belong to at most ONE event.
    const members = e.articleIds
      .map((id) => byId.get(id))
      .filter((i): i is NewsItem => !!i && menIds.has(i.id) && !assignedIds.has(i.id));
    if (members.length === 0) return;
    members.forEach((m) => assignedIds.add(m.id));
    events.push(
      eventFromItems(
        `event-gemini-${idx}-${members[0].id}`.slice(0, 120),
        members,
        truncateSummary(e.summary) || fallbackSummary(members[0]),
        "gemini-synthesis",
      ),
    );
  });

  // Men-scoped articles Gemini left unplaced still deserve to be shown. An
  // article the model deliberately moved to a rejected (e.g. women's) event
  // must NOT sneak back in here.
  const rejectedIds = new Set(
    gemini.events.flatMap((e) => e.articleIds).filter((id) => !menIds.has(id)),
  );
  const leftovers = items.filter(
    (i) => menIds.has(i.id) && !referencedIds.has(i.id) && !rejectedIds.has(i.id),
  );
  if (leftovers.length > 0) {
    for (const ev of buildNewsEvents(leftovers)) {
      events.push({ ...ev, summaryMethod: "gemini-synthesis-fallback" });
    }
  }
  return events.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function truncateSummary(summary: string): string {
  const s = summary.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_SUMMARY_CHARS) return s;
  return `${s.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`;
}
