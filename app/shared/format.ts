/**
 * Domain formatting shared across screens.
 *
 * These are pure functions and are unit-tested directly, because the Home
 * screen's correctness depends on them: the old implementation rendered the
 * last result as "BK Häcken Kalmar FF 5–0" (no separator, score reordered) and
 * labelled 2-warning players "one warning from suspension".
 */
import type { MatchEvents, MatchRef, PlayerDiscipline, SeasonPlayerStat } from "../../pipeline/src/types";

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

/** "I DAG" / "3 DAGAR SEDAN" / "VECKAN" for date grouping. */
export function groupLabel(iso: string, now = Date.now()): string {
  const d = parse(iso);
  if (!d) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date(now)) - startOf(d)) / 86400000);
  if (days <= 0) return "I dag";
  if (days === 1) return "I går";
  if (days < 7) return `För ${days} dagar sedan`;
  if (days < 14) return "Förra veckan";
  return dOnly.format(d);
}

// ---------------------------------------------------------------------------
// Match results
// ---------------------------------------------------------------------------

export type Result = "w" | "d" | "l";

/** Häcken's goals-first score, e.g. "5–0" for an away 0-5. */
export function scoreFor(m: { scoreHome?: number; scoreAway?: number; homeAway: "home" | "away" }): string | null {
  if (m.scoreHome == null || m.scoreAway == null) return null;
  return m.homeAway === "home" ? `${m.scoreHome}–${m.scoreAway}` : `${m.scoreAway}–${m.scoreHome}`;
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
// Squad helpers — current players are shown in MATCH context, never as a
// directory. These exist for contextual use (lineup, cards), not for a list.
// ---------------------------------------------------------------------------

export function squadByPosition(squad: SeasonPlayerStat[]): Record<string, SeasonPlayerStat[]> {
  const groups: Record<string, SeasonPlayerStat[]> = { goalkeepers: [], defenders: [], midfields: [], forwards: [] };
  for (const p of squad) groups[p.positionGroup]?.push(p);
  return groups;
}

export const POSITION_LABEL: Record<string, string> = {
  goalkeepers: "Målvakter",
  defenders: "Försvar",
  midfields: "Mittfält",
  forwards: "Anfall",
};
