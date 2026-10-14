/**
 * UpcomingMatchSheet — a match that has not been played yet, on tap.
 *
 * Tester follow-up (2026-10-14): the upcoming match was not a button, and
 * nothing told you that a starting eleven exists (or is coming). Played
 * matches open a MatchSheet with the full timeline; upcoming matches have
 * no events to show — but they DO have an id, and the on-demand lineup
 * lookup needs exactly that.
 *
 * So an upcoming row now opens this sheet:
 *   1. THE FIXTURE — teams in Swedish order (home first), date, competition,
 *      venue. Same presentation as the match sheet.
 *   2. UPPSTÄLLNING — the same on-demand section the played sheet uses, with
 *      the hint in words: the eleven is released close to kickoff, the app
 *      never asks for it by itself. This is the discoverability the tester
 *      asked for; before this, the lineup feature existed but had no visible
 *      path from the next match.
 *
 * No polling, no notifications — one GraphQL query per tap, state lives in
 * the component only.
 */
import type { MatchRef } from "../../pipeline/src/types";
import { Sheet } from "./Sheet";
import { LineupSection } from "./MatchSheet";
import { competitionLabel, fmtDateTime, matchTeams } from "./format";

export function UpcomingMatchSheet({
  match,
  onClose,
}: {
  match: MatchRef;
  onClose: () => void;
}) {
  const teams = matchTeams(match);
  return (
    <Sheet
      title={`${teams.left} – ${teams.right}`}
      subtitle={competitionLabel(match.competition)}
      onClose={onClose}
      testId="upcoming-sheet"
    >
      <div className="stack-3">
        {/* ---- 1. the fixture ---- */}
        <div className="stack-2">
          <div className="fixture" data-testid="fixture">
            <span className={`ft${teams.hackenSide === "left" ? " hacken" : ""}`} data-testid="fixture-home">
              {teams.left}
            </span>
            <span className="fs" aria-hidden="true">
              –
            </span>
            <span className={`ft${teams.hackenSide === "right" ? " hacken" : ""}`} data-testid="fixture-away">
              {teams.right}
            </span>
          </div>
          <p className="small dim" style={{ margin: 0 }} data-testid="fixture-meta">
            {competitionLabel(match.competition)} · {fmtDateTime(match.date)}
            {match.venue ? ` · ${match.venue.trim()}` : ""}
          </p>
        </div>

        {/* ---- 2. the eleven, on demand ---- */}
        <LineupSection matchId={match.id} />
      </div>
    </Sheet>
  );
}
