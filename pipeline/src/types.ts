/** Shared data models for Min BKH. Used by both the data pipeline and the app. */

import type { SquadEnrichment } from "./squadEnrichment";

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

/** How many articles one publisher contributed, and what happened to the rest. */
export interface SourceCount {
  /** Articles the feed returned. */
  fetched: number;
  /** Articles that survived filtering and were considered for the news list. */
  kept: number;
  /** Articles discarded, with the reason recorded in the nightly log. */
  dropped: number;
}

/**
 * One fetched article, as recorded for the in-app ingest audit.
 *
 * WHY THIS EXISTS: the counts say HOW MANY articles a source contributed, but
 * a maintainer checking validity needs to see WHICH ones — the actual
 * headlines — and which of them the pipeline considered Häcken-relevant.
 * Counts alone made a "0 av 39" row unverifiable: was the filter right, or
 * did it drop real news? (B-012 was found exactly by asking that question.)
 */
export interface ArticleAuditEntry {
  /** Article headline, as the feed delivered it. */
  title: string;
  /** Article URL — the identity used everywhere else. */
  url: string;
  /** Feed publisher name. */
  publisher: string;
  /** ISO publication timestamp from the feed. */
  publishedAt: string;
  /**
   * What the pipeline did with this article:
   *  - "kept"       — survived prefilter AND the men's filter; considered Häcken-relevant
   *  - "men-excluded" — survived the prefilter but was removed as not men's-team news
   *  - otherwise the prefilter drop reason verbatim ("outside date window",
   *    "advertisement", "no Häcken relation", …)
   */
  verdict: string;
}

export interface Freshness {
  generatedAt: string;
  sourceStatus: Record<string, SourceStatus>;
  /**
   * Per-publisher article counts for this run, keyed by publisher name.
   *
   * OPTIONAL, and that matters: it is absent when a pipeline run did not
   * measure them. An absent map means "not measured"; an empty map would claim
   * every source found nothing, which is a different and wrong statement.
   *
   * Without this, a feed that quietly started returning zero articles was
   * indistinguishable from a healthy one — `sourceStatus` says "ok" either
   * way. That ambiguity is what B-006 was about.
   */
  sourceCounts?: Record<string, SourceCount>;
  /**
   * EVERY article the feeds delivered this run, with the pipeline's verdict.
   *
   * OPTIONAL for the same reason as `sourceCounts`: absent means the run
   * predates the audit, not that nothing was fetched. Capped at 250 entries
   * (a real night fetches ~170) so app.json grows by a bounded amount.
   */
  articleAudit?: ArticleAuditEntry[];
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
  /** Exactly one warning short of a suspension. */
  | "at_risk"
  | "suspended_next"
  | "served"
  | "red_suspended"
  | "unknown"
  /**
   * E-005 — not in the current squad. Card history is retained; only the
   * forward-looking risk is withheld, because a departed player cannot be
   * suspended by a club he no longer plays for.
   */
  | "departed";

export interface PlayerDiscipline {
  playerId: string;
  playerName: string;
  /** Total distinct-match yellow cards this season. */
  warningCount: number;
  /**
   * Warnings still counting toward the NEXT suspension — excludes any already
   * consumed by a served suspension. The UI must prefer this over
   * `warningCount`, otherwise a player who served a suspension appears to be
   * "one warning away" while showing a season total of 5 or 6.
   */
  warningsUntilSuspension: number;
  redCards: number;
  status: DisciplineStatus;
  relevantWarnings: Array<{ matchId: number; date: string }>;
  servedAt?: string;
  incomplete: boolean;
  /** E-005 — true when the player is not in the current squad. */
  departed?: boolean;
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
  /**
   * Authoritative team/category labels as published by the source itself
   * (BK Häcken renders one badge per article: "Herr", "Dam", "Hållbarhet",
   * "Föreningen", ...). These are evidence, never a substitute for the
   * article's own content, and they take precedence over text heuristics.
   */
  sourceTags?: string[];
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
  /**
   * Editorial image for the lead article, when a source provides one.
   * Used for compact story thumbnails — never as a hero image.
   */
  imageUrl?: string;
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

/**
 * A researched fact: the value AND why we believe it.
 *
 * `value: null` with `status: "unknown"` is a first-class, successful result
 * meaning "researched, no reliable evidence found". It must never be
 * collapsed into a bare null, and a value is never stored without its
 * source, verification date and confidence.
 */
export interface ResearchedFact {
  value: string | null;
  status: "verified" | "reported" | "conflicting" | "unknown";
  confidence: "high" | "medium" | "low";
  sourceUrl?: string;
  sourceName?: string;
  /** When the underlying fact was published, if the source says so. */
  sourcePublishedAt?: string;
  /** When WE checked. A verified value is only true as of this date. */
  verifiedAt: string;
  /** Short note on what the evidence does and does not establish. */
  note?: string;
}

/**
 * Current football status. Deliberately does NOT include a "no club found
 * therefore free agent" shortcut: absence of a club is not evidence of a
 * status, so ambiguity resolves to UNKNOWN rather than FREE_AGENT.
 */
export type PlayerActivityStatus = "ACTIVE_AT_CLUB" | "FREE_AGENT" | "RETIRED" | "UNKNOWN";

/** One piece of grounded evidence, retained so claims stay auditable. */
export interface ResearchSource {
  url: string;
  title?: string;
  publisher?: string;
  retrievedAt: string;
  /** True when the model cited this as grounding for a stored value. */
  supportsClaim: boolean;
}

export interface FormerPlayerResearch {
  researchId: string;
  researchModel: string;
  researchedAt: string;
  grounded: boolean;

  /** Identity resolution: is this the same person as our registry entry? */
  identity: ResearchedFact & { aliases?: string[] };
  /** Did this person actually play for BK Häcken, and for which team? */
  bkhackenRelationship: ResearchedFact & { team?: "Herr" | "Dam" | "Okänd"; period?: string };
  activityStatus: ResearchedFact & { value?: PlayerActivityStatus };
  currentClub: ResearchedFact;
  currentLeague: ResearchedFact;
  currentCountry: ResearchedFact;
  /** Contract expiry. UNKNOWN unless explicitly published. Never estimated. */
  contractExpiry: ResearchedFact;
  contractNature: ResearchedFact & { value?: "signing" | "extension" | "loan" | "unknown" };
  /** Free-text career moves, each already carrying its own source. */
  careerNotes: ResearchedFact;
  sources: ResearchSource[];
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
  /** Current-season squad statistics (SportoMedia). */
  squadStats?: SeasonPlayerStat[];
  /**
   * Pre-resolved Wikidata/Wikipedia enrichment for the squad, keyed by
   * canonical player id. Resolved ONCE per nightly so the Trupp cards open
   * with data already present instead of each device searching live.
   * A player the pipeline could not resolve is simply absent — the app falls
   * back to its own search for that player.
   */
  squadEnrichment?: Record<string, SquadEnrichment>;
  /** Season-level disciplinary ledger (chronological, rule-applied). */
  discipline?: PlayerDiscipline[];
  /** Number of finished matches whose card events were inspected. */
  cardMatchesInspected?: number;
  /** The disciplinary rule applied (for UI provenance). */
  disciplineRule?: { rule: string; ruleSource: string; ruleSourceUrl: string; threshold: number; suspensionMatches: number };
  /** Set when current data could not be retrieved — UI must show this. */
  currentDataUnavailable?: CurrentDataUnavailable;
}
