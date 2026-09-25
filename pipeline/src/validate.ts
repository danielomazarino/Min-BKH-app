import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const Verification = z.enum(["confirmed", "reported", "unverified", "unknown"]);

const Provenance = z.object({
  sourceName: z.string(),
  sourceUrl: z.string().optional(),
  publishedAt: z.string().optional(),
  retrievedAt: z.string(),
  discoveredVia: z.string(),
  verificationStatus: Verification,
  confidence: z.number().optional(),
});

const MatchRef = z.object({
  id: z.number(),
  competition: z.enum(["allsvenskan", "svenska-cupen", "europa", "other"]),
  season: z.string(),
  date: z.string(),
  homeAway: z.enum(["home", "away"]),
  opponent: z.string(),
  status: z.enum(["scheduled", "finished", "postponed", "other"]),
  scoreHome: z.number().optional(),
  scoreAway: z.number().optional(),
  venue: z.string().optional(),
});

const PlayerWarning = z.object({
  playerId: z.number(),
  playerName: z.string(),
  competition: z.string(),
  season: z.string(),
  warningCount: z.number(),
  relevantWarnings: z.array(z.object({ matchId: z.number(), date: z.string() })),
  suspendedForNextMatch: z.boolean(),
  oneWarningFromSuspension: z.boolean(),
  ruleApplied: z.string(),
});

const WarningsReport = z.object({
  competition: z.string(),
  season: z.string(),
  rule: z.string(),
  ruleSource: z.string(),
  suspended: z.array(PlayerWarning),
  atRisk: z.array(PlayerWarning),
  generatedAt: z.string(),
});

const NewsItem = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  summary: z.string().optional(),
  publishedAt: z.string(),
  publisher: z.string(),
  category: z.enum(["men", "women", "youth", "club", "unknown"]),
  imageUrl: z.string().optional(),
  discoveredVia: z.string(),
  dedupeKey: z.string().optional(),
  sourceRole: z.enum(["primary", "secondary", "discovery", "unknown"]).optional(),
});

const NewsEvent = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  publishedAt: z.string(),
  category: z.enum(["men", "women", "youth", "club", "unknown"]),
  latestPublishedAt: z.string(),
  sources: z.array(
    z.object({
      publisher: z.string(),
      url: z.string().url(),
      publishedAt: z.string(),
      role: z.enum(["primary", "secondary", "discovery", "unknown"]),
      discoveredVia: z.string(),
    }),
  ),
  summaryMethod: z.enum(["rss-description", "extracted", "excerpt"]),
});

const MatchEvents = z.object({
  goals: z.array(
    z.object({
      minute: z.string().nullable(),
      playerName: z.string(),
      teamName: z.string().nullable(),
      assistPlayerName: z.string().nullable(),
      forHäcken: z.boolean(),
    }),
  ),
  yellowCards: z.array(z.object({ minute: z.string().nullable(), playerName: z.string(), teamName: z.string().nullable() })),
  redCards: z.array(z.object({ minute: z.string().nullable(), playerName: z.string(), teamName: z.string().nullable() })),
  substitutions: z.array(
    z.object({
      minute: z.string().nullable(),
      inPlayer: z.string().nullable(),
      outPlayer: z.string().nullable(),
      teamName: z.string().nullable(),
    }),
  ),
});

const FootballSourceMeta = z.object({
  provider: z.string(),
  publicSite: z.string(),
  provenance: z.string(),
  sourceUrl: z.string(),
  retrievedAt: z.string(),
  season: z.string(),
  competition: z.string(),
  dataStatus: z.enum(["current", "historical", "unavailable"]),
  queryVersion: z.string(),
});

const AppData = z.object({
  freshness: z.object({
    generatedAt: z.string(),
    sourceStatus: z.record(z.string()),
  }),
  footballSource: FootballSourceMeta.optional(),
  nextMatch: MatchRef.nullable(),
  lastResult: MatchRef.nullable(),
  upcoming: z.array(MatchRef),
  recent: z.array(MatchRef),
  lastMatchDetail: MatchRef.extend({
    playerStats: z
      .array(
        z.object({
          playerId: z.number(),
          playerName: z.string(),
          minutes: z.number().nullable(),
          goals: z.number(),
          assists: z.number(),
          yellowCards: z.number(),
          redCards: z.number(),
          starter: z.boolean(),
        }),
      )
      .optional(),
    events: MatchEvents.optional(),
  }).nullable(),
  table: z.array(
    z.object({
      rank: z.number(),
      team: z.string(),
      played: z.number(),
      points: z.number(),
      goalDiff: z.number(),
    }),
  ),
  tablePosition: z
    .object({ rank: z.number(), team: z.string(), played: z.number(), points: z.number(), goalDiff: z.number() })
    .nullable(),
  warnings: WarningsReport.nullable(),
  news: z.array(NewsItem),
  newsEvents: z.array(NewsEvent),
  formerPlayers: z.array(z.unknown()),
  squadStats: z
    .array(
      z.object({
        playerId: z.number(),
        playerName: z.string(),
        positionGroup: z.enum(["goalkeepers", "defenders", "midfields", "forwards"]),
        matchesPlayed: z.number(),
        matchesStarted: z.number(),
        goals: z.number(),
        assists: z.number(),
        yellowCards: z.number(),
        redCards: z.number(),
        competition: z.string().nullable(),
      }),
    )
    .optional(),
  currentDataUnavailable: z
    .object({
      reason: z.string(),
      checkedAt: z.string(),
    })
    .optional(),
});

const FormerPlayersData = z.object({
  generatedAt: z.string(),
  sourceStatus: z.record(z.string()),
  players: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      aliases: z.array(z.string()).optional(),
      apiFootballId: z.number().optional(),
      currentClub: z.string().nullable(),
      currentLeague: z.string().nullable(),
      currentCountry: z.string().nullable(),
      clubVerified: z.boolean(),
      stats: z
        .object({
          competition: z.string().optional(),
          season: z.string().optional(),
          appearances: z.number().nullable(),
          starts: z.number().nullable(),
          minutes: z.number().nullable(),
          goals: z.number().nullable(),
          assists: z.number().nullable(),
          yellowCards: z.number().nullable(),
          redCards: z.number().nullable(),
        })
        .nullable(),
      contract: Provenance.extend({ contractStatus: z.string(), contractExpiry: z.string().optional() }).nullable(),
      latestEvent: Provenance.extend({
        playerId: z.string(),
        playerName: z.string(),
        topic: z.string(),
        claim: z.string(),
      }).nullable(),
      retrievedAt: z.string().optional(),
    }),
  ),
});

function validate(file: string, schema: z.ZodTypeAny): boolean {
  const path = resolve(import.meta.dirname, "../../public/data", file);
  if (!existsSync(path)) {
    console.error(`MISSING: ${file}`);
    return false;
  }
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const res = schema.safeParse(json);
    if (!res.success) {
      console.error(`INVALID: ${file}`);
      console.error(res.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
      return false;
    }
    console.log(`OK: ${file}`);
    return true;
  } catch (e) {
    console.error(`PARSE ERROR: ${file}: ${e}`);
    return false;
  }
}

const ok1 = validate("app.json", AppData);
const ok2 = validate("former-players.json", FormerPlayersData);

// Guard: no API keys must ever leak into generated data.
const raw = existsSync(resolve(import.meta.dirname, "../../public/data/app.json"))
  ? readFileSync(resolve(import.meta.dirname, "../../public/data/app.json"), "utf8")
  : "";
const keyLeak = /API_FOOTBALL_KEY|apisports-key|fc-[a-zA-Z0-9]{20,}/.test(raw);
if (keyLeak) {
  console.error("SECRET LEAK DETECTED in generated data!");
  process.exit(1);
}

process.exit(ok1 && ok2 ? 0 : 1);
