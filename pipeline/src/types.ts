/** Shared data models for Min BKH. Used by both the data pipeline and the app. */

export type Competition = "allsvenskan" | "svenska-cupen" | "europa" | "other";

export type NewsCategory = "men" | "women" | "youth" | "club" | "unknown";

export type VerificationStatus = "confirmed" | "reported" | "unverified" | "unknown";

export type SourceStatus = "ok" | "failed" | "skipped";

export interface Provenance {
  sourceName: string;
  sourceUrl?: string;
  publishedAt?: string;
  retrievedAt: string;
  discoveredVia: string;
  verificationStatus: VerificationStatus;
  confidence?: number;
}

export interface Freshness {
  generatedAt: string;
  sourceStatus: Record<string, SourceStatus>;
}

/** Provenance metadata for the current football dataset. */
export interface FootballSourceMeta {
  provider: string;
  publicSite: string;
  provenance: string;
  sourceUrl: string;
  retrievedAt: string;
  season: string;
  competition: string;
  /** "current" = the season in progress; "historical" = a finished season. */
  dataStatus: "current" | "historical" | "unavailable";
  queryVersion: string;
}

/** Explicit marker when current data cannot be retrieved. */
export interface CurrentDataUnavailable {
  reason: string;
  checkedAt: string;
}

/** Season-level disciplinary status for one player. */
export type DisciplineStatus =
  | "none"
  | "at_risk"
  | "suspended_next"
  | "served"
  | "red_suspended"
  | "unknown";

export interface PlayerDiscipline {
  playerId: string;
  playerName: string;
  warningCount: number;
  redCards: number;
  status: DisciplineStatus;
  relevantWarnings: Array<{ matchId: number; date: string }>;
  servedAt?: string;
  incomplete: boolean;
}

export interface TeamRef {
  id?: number;
  name: string;
}

export interface MatchRef {
  id: number;
  competition: Competition;
  season: string;
  date: string;
  homeAway: "home" | "away";
  opponent: string;
  status: "scheduled" | "finished" | "postponed" | "other";
  scoreHome?: number;
  scoreAway?: number;
  venue?: string;
}

export interface PlayerMatchStat {
  /** Canonical player id (fogis:N or name:NORMALIZED). */
  playerId: string;
  playerName: string;
  minutes: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  starter: boolean;
}

/** Structured match events (SportoMedia). */
export interface MatchEvents {
  goals: Array<{ minute: string | null; playerName: string; teamName: string | null; assistPlayerName: string | null; forHäcken: boolean }>;
  yellowCards: Array<{ minute: string | null; playerName: string; teamName: string | null }>;
  redCards: Array<{ minute: string | null; playerName: string; teamName: string | null }>;
  substitutions: Array<{ minute: string | null; inPlayer: string | null; outPlayer: string | null; teamName: string | null }>;
}

export interface MatchDetail extends MatchRef {
  playerStats?: PlayerMatchStat[];
  /** Structured events (goals/cards/subs) from SportoMedia. */
  events?: MatchEvents;
}

export interface LeagueTableRow {
  rank: number;
  team: string;
  played: number;
  points: number;
  goalDiff: number;
}

export type SourceRole = "primary" | "secondary" | "discovery" | "unknown";

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  summary?: string;
  publishedAt: string;
  publisher: string;
  category: NewsCategory;
  imageUrl?: string;
  discoveredVia: string;
  dedupeKey?: string;
  /** Provenance role of this specific article's reporting. */
  sourceRole?: SourceRole;
}

/**
 * A news EVENT: one underlying story, possibly reported by multiple sources.
 * The UI shows one card per event with source pills.
 */
export interface NewsEvent {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  category: NewsCategory;
  /** Newest publication date among sources. */
  latestPublishedAt: string;
  sources: Array<{
    publisher: string;
    /** Original article headline, preserved for provenance. */
    title?: string;
    url: string;
    publishedAt: string;
    role: SourceRole;
    discoveredVia: string;
  }>;
  /** How the event summary was produced. */
  summaryMethod: "rss-description" | "extracted" | "excerpt" | "gemini-synthesis" | "gemini-synthesis-fallback";
}

export interface PlayerWarning {
  playerId: number;
  playerName: string;
  competition: Competition;
  season: string;
  warningCount: number;
  /** Warnings that count toward the next suspension threshold. */
  relevantWarnings: Array<{ matchId: number; date: string }>;
  suspendedForNextMatch: boolean;
  oneWarningFromSuspension: boolean;
  ruleApplied: string;
}

export interface WarningsReport {
  competition: Competition;
  season: string;
  rule: string;
  ruleSource: string;
  suspended: PlayerWarning[];
  atRisk: PlayerWarning[];
  generatedAt: string;
}

export interface FormerPlayerStats {
  competition?: string;
  season?: string;
  appearances: number | null;
  starts: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
}

export interface ContractInfo extends Provenance {
  contractStatus: string;
  contractExpiry?: string;
}

export interface FormerPlayerCareerEvent extends Provenance {
  playerId: string;
  playerName: string;
  topic: "transfer" | "loan" | "contract" | "new-club" | "departure" | "return" | "injury" | "other";
  claim: string;
}

export interface FormerPlayer {
  id: string;
  name: string;
  aliases?: string[];
  apiFootballId?: number;
  currentClub: string | null;
  currentLeague: string | null;
  currentCountry: string | null;
  clubVerified: boolean;
  stats: FormerPlayerStats | null;
  contract: ContractInfo | null;
  latestEvent: FormerPlayerCareerEvent | null;
  retrievedAt?: string;
}

export interface FormerPlayersData extends Freshness {
  players: FormerPlayer[];
}

/** One player's current-season statistics (from SportoMedia squad query). */
export interface SeasonPlayerStat {
  /** Canonical player id (fogis:N or name:NORMALIZED). */
  playerId: string;
  playerName: string;
  positionGroup: "goalkeepers" | "defenders" | "midfields" | "forwards";
  matchesPlayed: number;
  matchesStarted: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  competition: string | null;
}

export interface AppData {
  freshness: Freshness;
  /** Provenance + season metadata for the football dataset. */
  footballSource?: FootballSourceMeta;
  nextMatch: MatchRef | null;
  lastResult: MatchRef | null;
  upcoming: MatchRef[];
  recent: MatchRef[];
  lastMatchDetail: MatchDetail | null;
  table: LeagueTableRow[];
  tablePosition: LeagueTableRow | null;
  warnings: WarningsReport | null;
  news: NewsItem[];
  /** Deduplicated news events (one card per underlying story). */
  newsEvents: NewsEvent[];
  formerPlayers: FormerPlayer[];
  /** Current-season squad statistics (SportoMedia). */
  squadStats?: SeasonPlayerStat[];
  /** Season-level disciplinary ledger (chronological, rule-applied). */
  discipline?: PlayerDiscipline[];
  /** Number of finished matches whose card events were inspected. */
  cardMatchesInspected?: number;
  /** The disciplinary rule applied (for UI provenance). */
  disciplineRule?: { rule: string; ruleSource: string; ruleSourceUrl: string; threshold: number; suspensionMatches: number };
  /** Set when current data could not be retrieved — UI must show this. */
  currentDataUnavailable?: CurrentDataUnavailable;
}
