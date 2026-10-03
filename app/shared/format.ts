/**
 * Domain formatting shared across screens.
 *
 * These are pure functions and are unit-tested directly, because the Home
 * screen's correctness depends on them: the old implementation rendered the
 * last result as "BK Häcken Kalmar FF 5–0" (no separator, score reordered) and
 * labelled 2-warning players "one warning from suspension".
 */
import type { MatchEvents, MatchRef, PlayerDiscipline, SeasonPlayerStat } from "../../pipeline/src/types";
import { nameKeyOf } from "../../pipeline/src/playerIdentity";

export function competitionLabel(c: string): string {
  switch (c) {
    case "allsvenskan":
      return "Allsvenskan";
    case "svenska-cupen":
      return "Svenska Cupen";
    case "europa":
      return "Europa";
    default:
      return "Tävling";
  }
}

const dt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dOnly = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" });
const timeOnly = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" });

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso: string): string {
  const d = parse(iso);
  return d ? dt.format(d) : iso;
}

export function fmtDay(iso: string): string {
  const d = parse(iso);
  return d ? dOnly.format(d) : iso;
}

export function fmtTime(iso: string): string {
  const d = parse(iso);
  return d ? timeOnly.format(d) : "";
}

export function fmtDateTime(iso: string): string {
  const d = parse(iso);
  if (!d) return iso;
  return `${dt.format(d)} ${timeOnly.format(d)}`;
}

/** "3 min sedan" / "5 h sedan" / "22 sep." */
export function fmtWhen(iso: string, now = Date.now()): string {
  const d = parse(iso);
  if (!d) return "";
  const mins = Math.round((now - d.getTime()) / 60000);
  if (mins >= 0 && mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  return dOnly.format(d);
}

/** Whole days until a future date; null when in the past. */
export function daysUntil(iso: string, now = Date.now()): number | null {
  const d = parse(iso);
  if (!d) return null;
  const diff = d.getTime() - now;
  if (diff <= 0) return null;
  return Math.ceil(diff / 86400000);
}

/**
 * Group heading for a day of news, or "" when the day is self-describing.
 *
 * Returns a RELATIVE label only — "I dag", "I går", "För N dagar sedan",
 * "Förra veckan". Past two weeks it returns "" and the caller shows the
 * absolute date on the rows instead.
 *
 * WHY: for anything older than two weeks this used to return the same
 * `dOnly` string the row already printed, so the list read
 *
 *     2 SEP.
 *     2 sep.   Officiellt: BK Häcken lånar ut Sanders Ngabo
 *
 * — the date twice, in two different casings, which reads as a rendering bug.
 * Verified across 60 days: the two collided on 47 of them.
 *
 * The relative labels carry real information the absolute date does not (how
 * recent this is), so grouping is kept for the recent window and dropped only
 * where it would be pure repetition. The caller still renders ONE date per
 * day, never zero.
 */
export function groupLabel(iso: string, now = Date.now()): string {
  const d = parse(iso);
  if (!d) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date(now)) - startOf(d)) / 86400000);
  if (days <= 0) return "I dag";
  if (days === 1) return "I går";
  if (days < 7) return `För ${days} dagar sedan`;
  if (days < 14) return "Förra veckan";
  // Older than two weeks: no heading. The row's own date is the heading.
  return "";
}

// ---------------------------------------------------------------------------
// Match results
// ---------------------------------------------------------------------------

export type Result = "w" | "d" | "l";

/** Häcken's goals-first score, e.g. "5–0" for an away 0-5. */
/**
 * The two teams of a match, in the order a Swedish supporter expects to read
 * them: HOME on the left, AWAY on the right. This is a presentational
 * ordering only — it says nothing about which side Häcken was on, which is
 * carried separately as `hackenSide`.
 *
 * This exists because the data is stored in provider order (`scoreHome` /
 * `scoreAway`), while the UI used to render "Häcken first". For the away leg
 * at Kalmar that produced "5–0" when the Swedish reading of
 * Kalmar 0–5 Häcken is "0–5". A supporter glancing at the fixture should
 * never have to remember which way round the provider happened to store it.
 */
export function matchTeams(m: { opponent: string; homeAway: "home" | "away" }): {
  left: string;
  right: string;
  hackenSide: "left" | "right";
} {
  return m.homeAway === "home"
    ? { left: "Häcken", right: m.opponent, hackenSide: "left" }
    : { left: m.opponent, right: "Häcken", hackenSide: "right" };
}

/**
 * Score in HOME–AWAY order, matching `matchTeams`.
 *
 * `scoreForHacken` is kept for the places that genuinely want the result
 * from Häcken's point of view (result colouring, the form guide); this one
 * is for anything that puts the two teams side by side.
 */
export function scoreForHomeAway(m: {
  scoreHome?: number;
  scoreAway?: number;
}): string | null {
  if (m.scoreHome == null || m.scoreAway == null) return null;
  return `${m.scoreHome}–${m.scoreAway}`;
}

export function scoreForHacken(m: {
  scoreHome?: number;
  scoreAway?: number;
  homeAway: "home" | "away";
}): string | null {
  if (m.scoreHome == null || m.scoreAway == null) return null;
  return m.homeAway === "home" ? `${m.scoreHome}–${m.scoreAway}` : `${m.scoreAway}–${m.scoreHome}`;
}

/** @deprecated Use scoreForHomeAway (home left) or scoreForHacken (Häcken first) explicitly. */
export function scoreFor(m: {
  scoreHome?: number;
  scoreAway?: number;
  homeAway: "home" | "away";
}): string | null {
  return scoreForHacken(m);
}

export function resultOf(m: { scoreHome?: number; scoreAway?: number; homeAway: "home" | "away" }): Result | null {
  if (m.scoreHome == null || m.scoreAway == null) return null;
  const gf = m.homeAway === "home" ? m.scoreHome : m.scoreAway;
  const ga = m.homeAway === "home" ? m.scoreAway : m.scoreHome;
  if (gf > ga) return "w";
  if (gf === ga) return "d";
  return "l";
}

export const RESULT_WORD: Record<Result, string> = { w: "S", d: "O", l: "F" };

/** Last `n` finished results, newest first — powers the form guide. */
export function formGuide(matches: MatchRef[], n = 5): Result[] {
  return matches
    .filter((m) => m.status === "finished")
    .map(resultOf)
    .filter((r): r is Result => r !== null)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Discipline — the correct statement of "how close to a suspension"
//
// The old UI showed a fixed label "En varning från avstängning" beside the
// season total, which produced "En varning från avstängning / 5 varningar
// denna säsong" for a player who had already served a suspension. The engine
// now exposes `warningsUntilSuspension`; these helpers state it honestly.
// ---------------------------------------------------------------------------

export type Cstat = { d: PlayerDiscipline; state: string; severity: "suspended" | "at-risk" | "other" };

/**
 * Short, factual state text for one player. Uses the PENDING warning count, so
 * a player with 5 season warnings who served a suspension is described by what
 * remains, not by what he has already served.
 */
export function cstatFor(d: PlayerDiscipline, threshold = 3): Cstat {  const pending = d.warningsUntilSuspension ?? d.warningCount;
  const away = Math.max(0, threshold - pending);

  if (d.departed || d.status === "departed") {
    // E-005. A departed player keeps their card history but carries no live
    // risk. Must be checked BEFORE `pending > 0` below, which would otherwise
    // describe a sold player's 2 season cards as "1 warning left" — exactly the
    // misleading claim E-005 exists to remove.
    //
    // The `departed` FLAG is the authoritative signal, not the status string.
    // The engine only OVERWRITES status to "departed" when it computed a
    // forward-looking status (at_risk / suspended_next). For a departed player
    // whose status is a preserved historical fact — `served`, `red_suspended` —
    // the status is deliberately left intact so the record is not corrupted,
    // yet such a row can still carry pending warnings. Keying on status alone
    // let those rows fall through to `pending > 0` and render "1 varning
    // kvar" for a player the club can no longer suspend. Both signals are
    // accepted so the row is safe whichever way it arrives.
    return { d, severity: "other", state: "Spelade under säsongen" };
  }
  if (d.status === "suspended_next") {
    return { d, severity: "suspended", state: "Avstängd nästa match" };
  }
  if (d.status === "red_suspended") {
    return { d, severity: "suspended", state: "Rött kort — avstängningsläget okänt" };
  }
  if (d.status === "unknown") {
    return { d, severity: "at-risk", state: "Varningsstatus okänd" };
  }
  if (d.status === "at_risk") {
    return { d, severity: "at-risk", state: away === 1 ? "En varning kvar" : `${away} varningar kvar` };
  }
  if (pending > 0) {
    return { d, severity: "other", state: `${away} ${away === 1 ? "varning" : "varningar"} kvar` };
  }
  return { d, severity: "other", state: "Ingen aktiv varning" };
}

/**
 * Only what a supporter needs at a glance: out, or one warning away.
 *
 * Sorting puts suspensions first, then by how close the player is to the next
 * suspension — NOT by season total. Sorting on `warningCount` put a player
 * with 5 served warnings above someone genuinely one away from being out.
 */
export function urgentDiscipline(all: PlayerDiscipline[]): PlayerDiscipline[] {
  const rank = (x: PlayerDiscipline) =>
    x.status === "suspended_next" || x.status === "red_suspended" ? 0 : 1;
  const pending = (x: PlayerDiscipline) => x.warningsUntilSuspension ?? x.warningCount;
  return all
    .filter((d) => d.status === "suspended_next" || d.status === "red_suspended" || d.status === "at_risk")
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        // Fewest pending warnings first = closest to the next suspension.
        pending(a) - pending(b) ||
        b.warningCount - a.warningCount ||
        a.playerName.localeCompare(b.playerName),
    );
}

// ---------------------------------------------------------------------------
// Discipline grouping — one label per STATUS, not per player
//
// The old UI printed `state` inside every row, so five qualifying players
// restated the same idea five times. The status is a property of the group,
// not of the individual, so it belongs in a group header.
//
// CRITICAL: group by `severity`, NEVER by the `state` string. `cstatFor`
// renders "En varning kvar" and "2 varningar kvar" for two players of the
// same severity, so grouping by `state` would produce N groups for N
// players and defeat the whole change.
// ---------------------------------------------------------------------------

export type DisciplineGroup = {
  severity: Cstat["severity"];
  /** One label for the whole group. Neutral: it never asserts a count. */
  label: string;
  players: PlayerDiscipline[];
};

/**
 * Neutral group labels, deliberately count-free.
 *
 * "En varning kvar" as a group heading would be a false claim for any
 * at-risk player who is two warnings away, and "Avstängd nästa match"
 * would contradict a red_suspended player whose suspension state is
 * unknown. The exact position is still conveyed per player, by the
 * notches in the card meter and the season tally.
 */
const DISCIPLINE_GROUP_LABEL: Record<Cstat["severity"], string> = {
  suspended: "Avstängd",
  "at-risk": "Varningar kvar",
  other: "Övrigt kortläge",
};

/** Suspended first — being out matters more than being close. */
const DISCIPLINE_GROUP_ORDER: Cstat["severity"][] = ["suspended", "at-risk", "other"];

/**
 * Group already-filtered discipline rows by severity, suspended first.
 *
 * Input order is preserved WITHIN each group, so the caller's sort (closest
 * to suspension first) survives. Groups with no players are omitted, which
 * is what makes the empty state reachable.
 */
export function groupDiscipline(all: PlayerDiscipline[], threshold = 3): DisciplineGroup[] {
  const buckets = new Map<Cstat["severity"], PlayerDiscipline[]>();
  for (const d of all) {
    const { severity } = cstatFor(d, threshold);
    const list = buckets.get(severity) ?? [];
    list.push(d);
    buckets.set(severity, list);
  }
  return DISCIPLINE_GROUP_ORDER.filter((s) => (buckets.get(s)?.length ?? 0) > 0).map((severity) => ({
    severity,
    label: DISCIPLINE_GROUP_LABEL[severity],
    players: buckets.get(severity)!,
  }));
}

// ---------------------------------------------------------------------------
// Match timeline — turns MatchEvents into one ordered, readable list
// ---------------------------------------------------------------------------

export type TlItem =
  | { kind: "break"; label: string }
  | TimelineRowItem;

export type TimelineRowItem = {
  kind: "goal" | "yellow" | "red" | "sub";
  minute: number | null;
  minuteLabel: string;
  who: string;
  assist?: string | null;
  forHäcken: boolean;
};

function minuteOf(m: string | null | undefined): number | null {
  if (!m) return null;
  const n = parseInt(String(m).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Merge goals, cards and substitutions into one chronological list with a
 * half-time divider. This data already existed in app.json and was never
 * rendered by the old UI.
 */
export function buildTimeline(events: MatchEvents | null | undefined): TlItem[] {
  if (!events) return [];
  const rows: Array<TimelineRowItem & { ord: number }> = [];

  for (const g of events.goals ?? []) {
    rows.push({
      kind: "goal",
      minute: minuteOf(g.minute),
      minuteLabel: g.minute ?? "",
      who: g.playerName,
      assist: g.assistPlayerName,
      forHäcken: g.forHäcken,
      ord: 0,
    });
  }
  for (const y of events.yellowCards ?? []) {
    rows.push({
      kind: "yellow",
      minute: minuteOf(y.minute),
      minuteLabel: y.minute ?? "",
      who: y.playerName,
      forHäcken: y.teamName === "BK Häcken",
      ord: 1,
    });
  }
  for (const r of events.redCards ?? []) {
    rows.push({
      kind: "red",
      minute: minuteOf(r.minute),
      minuteLabel: r.minute ?? "",
      who: r.playerName,
      forHäcken: r.teamName === "BK Häcken",
      ord: 2,
    });
  }
  for (const s of events.substitutions ?? []) {
    if (!s.inPlayer && !s.outPlayer) continue;
    rows.push({
      kind: "sub",
      minute: minuteOf(s.minute),
      minuteLabel: s.minute ?? "",
      who: [s.inPlayer, s.outPlayer].filter(Boolean).join(" → "),
      forHäcken: s.teamName === "BK Häcken",
      ord: 3,
    });
  }

  rows.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999) || a.ord - b.ord);

  const out: TlItem[] = [];
  let halfTimeInserted = false;
  for (const r of rows) {
    if (!halfTimeInserted && r.minute != null && r.minute > 45) {
      out.push({ kind: "break", label: "Paus" });
      halfTimeInserted = true;
    }
    const { ord: _ord, ...rest } = r;
    void _ord;
    out.push(rest);
  }
  return out;
}

/** One-line scorer summary for the last result. */
export function scorerLine(events: MatchEvents | null | undefined, limit = 5): string {
  if (!events?.goals?.length) return "";
  const own = events.goals.filter((g) => g.forHäcken);
  const parts = own.map((g) => {
    const name = g.playerName.split(" ").slice(-1)[0];
    return `${name} ${g.minute ?? ""}`.trim();
  });
  if (parts.length === 0) return "";
  return parts.length > limit ? `${parts.slice(0, limit).join(" · ")} +${parts.length - limit}` : parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Squad — the current men's squad
//
// These helpers back the Trupp destination. The squad statistics were always
// in app.json and were previously unreachable from the UI.
// ---------------------------------------------------------------------------

/** Position groups in the order a supporter reads a team sheet. */
export const POSITION_ORDER: SeasonPlayerStat["positionGroup"][] = [
  "goalkeepers",
  "defenders",
  "midfields",
  "forwards",
];

/** Group the current squad by position, preserving the display order. */
export function squadByPosition(
  squad: SeasonPlayerStat[],
): Array<{ group: SeasonPlayerStat["positionGroup"]; label: string; players: SeasonPlayerStat[] }> {
  const groups = new Map<SeasonPlayerStat["positionGroup"], SeasonPlayerStat[]>();
  for (const p of squad) {
    const list = groups.get(p.positionGroup) ?? [];
    list.push(p);
    groups.set(p.positionGroup, list);
  }
  return POSITION_ORDER.filter((g) => (groups.get(g)?.length ?? 0) > 0).map((g) => ({
    group: g,
    label: POSITION_LABEL[g] ?? g,
    players: sortSquad(groups.get(g) ?? []),
  }));
}

/**
 * Squad order: most matches played first (the regulars lead the group), then
 * most starts, then surname. Deterministic, so the list never reshuffles
 * between renders.
 */
export function sortSquad(players: SeasonPlayerStat[]): SeasonPlayerStat[] {
  return [...players].sort(
    (a, b) =>
      b.matchesPlayed - a.matchesPlayed ||
      b.matchesStarted - a.matchesStarted ||
      a.playerName.split(" ").slice(-1)[0].localeCompare(b.playerName.split(" ").slice(-1)[0], "sv"),
  );
}

/**
 * Discipline restricted to the CURRENT men's squad.
 *
 * The season ledger spans the whole season, including players who have since
 * left the club. A supporter asking "who is one card from being suspended?"
 * means "who in the squad I can watch next week", so departed players are
 * excluded. Membership is decided on the canonical id the pipeline already
 * assigned, with a name fallback for entries where only the name survived.
 */
export function currentSquadDiscipline(
  discipline: PlayerDiscipline[] | undefined,
  squad: SeasonPlayerStat[] | undefined,
): PlayerDiscipline[] {
  if (!discipline) return [];
  const ids = new Set((squad ?? []).map((p) => p.playerId));
  const names = new Set((squad ?? []).map((p) => nameKeyOf(p.playerName)));
  return discipline.filter((d) => ids.has(d.playerId) || names.has(nameKeyOf(d.playerName)));
}

export const POSITION_LABEL: Record<string, string> = {
  goalkeepers: "Målvakter",
  defenders: "Försvar",
  midfields: "Mittfält",
  forwards: "Anfall",
};
