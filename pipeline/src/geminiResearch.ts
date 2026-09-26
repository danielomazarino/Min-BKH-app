/**
 * Gemini as a RESEARCH layer for former BK Häcken players.
 *
 * This module is deliberately separate from `gemini.ts` (news synthesis):
 * news summarisation and player research have different contracts, different
 * failure modes and different risk profiles. Nothing here writes to
 * `registry.json` and nothing here replaces API-Football.
 *
 * Core data principle
 * -------------------
 * Gemini is NOT treated as a database. Every returned fact keeps its source
 * URL, verification date and confidence. When the model cannot establish a
 * fact it MUST answer "unknown" — and `unknown` is a SUCCESSFUL result, not
 * a failure. Guessing a contract expiry from a transfer date, a normal
 * contract length or a player's age is exactly the behaviour this module
 * exists to prevent, so the schema below makes those answers unrepresentable
 * without an explicit status and source.
 *
 * Grounding
 * ---------
 * Requests use the `google_search` tool so answers are grounded in retrieved
 * web pages rather than parametric memory. Grounding metadata is preserved
 * (`grounded: true`) so a caller can always tell researched-from-web apart
 * from model recall, and never present the latter as web-verified.
 *
 * Cost model: ONE request per player, whole answer in a single structured
 * response. No per-field calls, no follow-up questions.
 */
import { z } from "zod";
import type { FormerPlayerResearch, ResearchSource, ResearchedFact } from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 120_000;

/**
 * Same bounded model selection as the news path: a free-tier key may only
 * be able to see a subset of models, so try in order and use the first that
 * answers. GEMINI_MODEL pins a single model.
 */
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
export function candidateModels(): string[] {
  const pinned = process.env.GEMINI_MODEL;
  return pinned ? [pinned] : DEFAULT_MODELS;
}

/** HTTP statuses worth retrying: capacity / rate limits only. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
export const MAX_RETRIES_PER_MODEL = 2;
const RETRY_DELAY_MS = [5_000, 20_000];

function retryDelay(attempt: number): number {
  const override = Number(process.env.GEMINI_RETRY_DELAY_MS);
  return Number.isFinite(override) && override >= 0 ? override : RETRY_DELAY_MS[attempt];
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class GeminiHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Gemini HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

// ---------- schema ----------

const FactStatus = z.enum(["verified", "reported", "conflicting", "unknown"]);
const Confidence = z.enum(["high", "medium", "low"]);

/**
 * A fact is either a real value WITH a source, or an explicit unknown.
 *
 * `sourceUrl` is REQUIRED whenever a value is present: a claim without a
 * citation is structurally invalid, so an uncited assertion cannot be stored
 * even if the model tries. `status: "unknown"` must carry no value.
 *
 * Built via `z.object().extend().superRefine()` (not a bare refine) so the
 * result still supports `.extend()` for the fields that extend a fact.
 */
function fact(extra: z.ZodRawShape = {}) {
  return z
    .object({
      value: z.string().nullable(),
      status: FactStatus,
      confidence: Confidence,
      sourceUrl: z.string().url().optional(),
      sourceName: z.string().optional(),
      sourcePublishedAt: z.string().optional(),
      note: z.string().optional(),
      ...extra,
    })
    .superRefine((v, ctx) => {
      if (v.value !== null && v.status !== "unknown" && !v.sourceUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceUrl"],
          message: "a stated value requires a sourceUrl — uncited claims are not storable",
        });
      }
      if (v.value === null && v.status !== "unknown") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: 'value=null is only valid with status "unknown"',
        });
      }
    });
}

const Aliases = z.array(z.string()).optional();
const Team = z.enum(["Herr", "Dam", "Okänd"]).optional();
const ActivityValue = z.enum(["ACTIVE_AT_CLUB", "FREE_AGENT", "RETIRED", "UNKNOWN"]).optional();
const ContractNatureValue = z.enum(["signing", "extension", "loan", "unknown"]).optional();

export const PlayerResearchSchema = z.object({
  identity: fact({ aliases: Aliases }),
  bkhackenRelationship: fact({ team: Team, period: z.string().optional() }),
  activityStatus: fact({ value: ActivityValue }),
  currentClub: fact(),
  currentLeague: fact(),
  currentCountry: fact(),
  contractExpiry: fact(),
  contractNature: fact({ value: ContractNatureValue }),
  careerNotes: fact(),
});

export type PlayerResearchResponse = z.infer<typeof PlayerResearchSchema>;

/** Raw OpenAPI schema sent to Gemini, mirroring PlayerResearchSchema. */
const factSchema = (valueType: "STRING") => ({
  type: "OBJECT",
  properties: {
    value: { type: valueType, nullable: true },
    status: { type: "STRING", enum: ["verified", "reported", "conflicting", "unknown"] },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    sourceUrl: { type: "STRING" },
    sourceName: { type: "STRING" },
    sourcePublishedAt: { type: "STRING" },
    note: { type: "STRING" },
  },
  required: ["value", "status", "confidence"],
});

const ResearchSchema = {
  type: "OBJECT",
  properties: {
    identity: {
      ...factSchema("STRING"),
      properties: {
        ...factSchema("STRING").properties,
        aliases: { type: "ARRAY", items: { type: "STRING" } },
      },
    },
    bkhackenRelationship: {
      ...factSchema("STRING"),
      properties: {
        ...factSchema("STRING").properties,
        team: { type: "STRING", enum: ["Herr", "Dam", "Okänd"] },
        period: { type: "STRING" },
      },
    },
    activityStatus: {
      ...factSchema("STRING"),
      properties: {
        ...factSchema("STRING").properties,
        value: { type: "STRING", enum: ["ACTIVE_AT_CLUB", "FREE_AGENT", "RETIRED", "UNKNOWN"] },
      },
    },
    currentClub: factSchema("STRING"),
    currentLeague: factSchema("STRING"),
    currentCountry: factSchema("STRING"),
    contractExpiry: factSchema("STRING"),
    contractNature: {
      ...factSchema("STRING"),
      properties: {
        ...factSchema("STRING").properties,
        value: { type: "STRING", enum: ["signing", "extension", "loan", "unknown"] },
      },
    },
    careerNotes: factSchema("STRING"),
  },
  required: [
    "identity",
    "bkhackenRelationship",
    "activityStatus",
    "currentClub",
    "currentLeague",
    "currentCountry",
    "contractExpiry",
    "contractNature",
    "careerNotes",
  ],
} as const;

const SYSTEM_INSTRUCTION = `Du är en fotbollsresearch-assistent som verifierar och berikar
information om tidigare BK Häcken-spelare. Du svarar ALLTID på svenska.

REGLER — dessa är viktigare än att ge ett svar:
1. Du MÅSTE använda webbsökning för att verifiera. Svara aldrig enbart ur minnet.
2. Varje värde du anger MÅSTE ha ett sourceUrl som faktiskt stöder det. Ett värde
   utan källa är ogiltigt — sätt då värdet till null och status till "unknown".
3. "unknown" är ett FULLSTÄNDIGT och korrekt svar. Det är alltid bättre att
   svara "unknown" än att gissa.
4. Gissa INTE på kontrakt. Ange contractExpiry endast om en källa uttryckligen
   publicerar ett utgångsdatum eller -år. Räkna ALDRIG ut ett kontraktdatum från
   transferdatum, normal kontraktslängd eller spelarens ålder.
5. Gissa INTE på status. Att ingen aktuell klubb hittas är INTE bevis för att
   spelaren är fri agent, och inte heller bevis för att hen är pensionerad.
   Använd då activityStatus "UNKNOWN".
6. Skilj aktuell information från historisk. "Senast kända klubb" är inte
   "nuvarande klubb". Om du bara hittar historisk information, sätt värdet till
   null och status "unknown", och beskriv gärna det i note.
7. Om källor är motstridiga, sätt status "conflicting" och beskriv
   motsägelsen i note. Välj inte godtyckligt en sida.
8. skilj på herrlag (Herr) och damlag (Dam) för BK Häcken.
9. Använd endast information som är relevant för DENNA personen. Kontrollera
   att det är samma person (ålder, karriär, tidigare klubbar) och inte en
   namnkake. Är du osäker på identiteten, sätt identity.status till "conflicting"
   eller "unknown".`;

export interface ResearchInput {
  id: string;
  name: string;
  aliases?: string[];
  bkhSeasons: string;
}

export interface ResearchResult {
  research: FormerPlayerResearch | null;
  model: string | null;
  calls: number;
  grounded: boolean;
  error?: string;
  raw?: string;
}

/** Build the single-request payload for one player. Exported for tests. */
export function buildResearchPayload(player: ResearchInput) {
  return {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Researcha denna tidigare BK Häcken-spelare:

namn: ${player.name}
kända alias: ${(player.aliases ?? []).join(", ") || "(inget angivet)"}
påstådda BK Häcken-seasonger (från vårt lokala register, ej verifierat): ${player.bkhSeasons}

Verifiera med webbsökning: identitet, BK Häcken-relation (herr/dam, period),
aktuell status, nuvarande klubb/land/liga, kontrakt (bara om publicerat),
och karriärnoteringar.

Kom ihåg: ett korrekt "unknown" är bättre än en gissning.`,
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: ResearchSchema,
    },
  };
}

interface RawResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
    };
  }>;
}

async function callModel(
  model: string,
  player: ResearchInput,
  apiKey: string,
): Promise<{ text: string; grounded: boolean; sources: ResearchSource[] }> {
  const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(buildResearchPayload(player)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new GeminiHttpError(res.status, await res.text());

  const json = (await res.json()) as RawResponse;
  const cand = json.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini returned an empty response");

  const chunks = cand?.groundingMetadata?.groundingChunks ?? [];
  const cited = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (!uri || cited.has(uri)) continue;
    cited.add(uri);
    let publisher: string | undefined;
    try {
      publisher = new URL(uri).hostname.replace(/^www\./, "");
    } catch {
      publisher = undefined;
    }
    sources.push({
      url: uri,
      title: c.web?.title,
      publisher,
      retrievedAt: new Date().toISOString(),
      supportsClaim: true,
    });
  }
  return { text, grounded: chunks.length > 0, sources };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Convert a validated fact into our stored representation. */
function toFact(f: Record<string, unknown>, verifiedAt: string): ResearchedFact {
  return {
    value: (f.value as string | null) ?? null,
    status: f.status as ResearchedFact["status"],
    confidence: f.confidence as ResearchedFact["confidence"],
    sourceUrl: (f.sourceUrl as string | undefined) || undefined,
    sourceName: (f.sourceName as string | undefined) || undefined,
    sourcePublishedAt: (f.sourcePublishedAt as string | undefined) || undefined,
    note: (f.note as string | undefined) || undefined,
    verifiedAt,
  };
}

/**
 * Parse + validate one player's response. Returns null when the payload fails
 * validation, so a malformed answer can never overwrite good stored data.
 * Exported for tests.
 */
export function parseResearchResponse(
  text: string,
  player: ResearchInput,
  opts: { model: string; grounded: boolean; sources: ResearchSource[]; verifiedAt?: string },
): FormerPlayerResearch | null {
  const json: unknown = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  })();
  if (json === undefined) return null;
  const parsed = PlayerResearchSchema.safeParse(json);
  if (!parsed.success) return null;
  const d = parsed.data as unknown as Record<string, Record<string, unknown>>;
  const verifiedAt = opts.verifiedAt ?? nowIso();
  return {
    researchId: `${player.id}:${verifiedAt}`,
    researchModel: opts.model,
    researchedAt: verifiedAt,
    grounded: opts.grounded,
    identity: { ...toFact(d.identity, verifiedAt), aliases: (d.identity.aliases as string[]) ?? [] },
    bkhackenRelationship: {
      ...toFact(d.bkhackenRelationship, verifiedAt),
      team: d.bkhackenRelationship.team as "Herr" | "Dam" | "Okänd" | undefined,
      period: (d.bkhackenRelationship.period as string) || undefined,
    },
    activityStatus: {
      ...toFact(d.activityStatus, verifiedAt),
      value: (d.activityStatus.value as FormerPlayerResearch["activityStatus"]["value"]) ?? "UNKNOWN",
    },
    currentClub: toFact(d.currentClub, verifiedAt),
    currentLeague: toFact(d.currentLeague, verifiedAt),
    currentCountry: toFact(d.currentCountry, verifiedAt),
    contractExpiry: toFact(d.contractExpiry, verifiedAt),
    contractNature: {
      ...toFact(d.contractNature, verifiedAt),
      value: (d.contractNature.value as FormerPlayerResearch["contractNature"]["value"]) ?? "unknown",
    },
    careerNotes: toFact(d.careerNotes, verifiedAt),
    sources: opts.sources,
  };
}

/** Research one player. Never throws; bounded retries on transient failures. */
export async function researchPlayer(
  player: ResearchInput,
  apiKey = process.env.GEMINI_API_KEY,
): Promise<ResearchResult> {
  if (!apiKey) {
    return { research: null, model: null, calls: 0, grounded: false, error: "GEMINI_API_KEY is not set" };
  }
  let calls = 0;
  const errors: string[] = [];
  for (const model of candidateModels()) {
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      try {
        const { text, grounded, sources } = await callModel(model, player, apiKey);
        calls++;
        const research = parseResearchResponse(text, player, { model, grounded, sources });
        if (!research) {
          return {
            research: null,
            model,
            calls,
            grounded,
            error: "response failed schema validation",
            raw: text,
          };
        }
        return { research, model, calls, grounded, raw: text };
      } catch (e) {
        calls++;
        const status = e instanceof GeminiHttpError ? e.status : 0;
        const msg = e instanceof Error ? e.message : String(e);
        const canRetry = status !== 0 && RETRYABLE.has(status) && attempt < MAX_RETRIES_PER_MODEL;
        console.warn(
          `research ${player.id}: model ${model} attempt ${attempt + 1}/${MAX_RETRIES_PER_MODEL + 1} failed — ${msg}` +
            (canRetry ? ` (retrying in ${retryDelay(attempt) / 1000}s)` : ""),
        );
        if (!canRetry) {
          errors.push(`${model}: ${msg}`);
          break;
        }
        await sleep(retryDelay(attempt));
      }
    }
  }
  return {
    research: null,
    model: null,
    calls,
    grounded: false,
    error: errors.join(" | ") || "no model produced a result",
  };
}
