/**
 * NextMatchBanner — the ONE next-match banner, shared by Brief and Matcher.
 *
 * History: Brief had a large "hero" card and Matcher a one-line "strip". The
 * tester (2026-10-14) found the two layouts divergent and the Home one too
 * big, and — critically — that nothing on either banner said the lineup is
 * available there. The user's fix: merge the two into one component with the
 * same logic in both places, sized like the Matches strip, and make the
 * lineup affordance explicit.
 *
 * Behaviour (identical in both places):
 * - Tapping the banner opens the upcoming-match sheet (fixture + the
 *   automatically checked lineup) — the same sheet the Kommande
 *   list opens. No navigation to /matcher any more: the sheet IS the
 *   destination, so the lineup affordance is one tap from the banner.
 * - The smaller lineup hint appears ONLY on match day. On other days the
 *   banner is a plain fixture line — no persistent hint, no clutter.
 * - "Hemma"/"Borta" is NOT printed: the team order (Häcken left = home,
 *   Swedish convention) already states it — same rule as the match rows.
 */
import type { MatchRef } from "../../pipeline/src/types";
import { competitionLabel, daysUntil, fmtDay, fmtTime, matchTeams } from "./format";

export function NextMatchBanner({
  next,
  onOpen,
}: {
  next: MatchRef;
  onOpen: () => void;
}) {
  const days = daysUntil(next.date);
  const teams = matchTeams(next);
  const matchDay = days === 0;
  return (
    <button
      type="button"
      className="strip strip-tap"
      onClick={onOpen}
      data-testid="next-match"
      aria-label={`Nästa match ${teams.left} mot ${teams.right}, ${fmtDay(next.date)} klockan ${fmtTime(next.date)}.${
        matchDay ? " Matchdag, klicka för startelva." : ""
      }`}
    >
      <span className="strip-when">
        <b data-testid="countdown">
          {matchDay
            ? <>
                <span className="matchday-label">Matchdag</span>
                <span className="matchday-action">Klicka för startelva</span>
              </>
            : days === 1
              ? "Imorgon"
              : days != null
                ? `Om ${days} dagar`
                : "—"}
        </b>
        <span>{fmtDay(next.date)} · {fmtTime(next.date)}</span>
      </span>
      <span className="strip-teams">
        <span className="dim">{competitionLabel(next.competition)}</span>
        <b>
          {teams.left} – {teams.right}
        </b>
      </span>
    </button>
  );
}
