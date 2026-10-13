/**
 * TeamSheet — one league-table opponent, on tap.
 *
 * Tester request (2026-10-13): "trycker på laget [i tabellen] … med typ
 * matcharena, senaste matcherna och lite historik" — like the player cards.
 *
 * WHAT THIS SHEET CAN HONESTLY SHOW, from data the pipeline already serves:
 *   1. TABLE POSITION — rank, played, points, goal difference and the season
 *      W/D/L record (the row the user tapped).
 *   2. ARENA — the venue of Häcken's away fixture at this team. SportoMedia
 *      records `arenaName` per match, so once Häcken has played there the
 *      arena is a measured fact, not a lookup.
 *   3. MATCHER MOT HÄCKEN — every fixture against this team this season
 *      (played with score, upcoming with date), from `seasonMatches` — the
 *      FULL fixture list. The first version filtered `recent` + `upcoming`,
 *      but `recent` is a 10-match window, so an early-season away meeting
 *      (Örgryte, tester report 2026-10-14) silently vanished from the sheet.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW:
 *   - The opponent's last-5 form. We only ingest Häcken's fixtures; the
 *     opponent's results against OTHER teams are not in our data, and
 *     deriving a form strip from Häcken's matches alone would be an
 *     invention. The season W/D/L record from the standings is the closest
 *     honest form context, and it is shown instead. Nothing here is invented
 *     (the MatchSheet rule).
 *   - Squad/roster of the opponent — no source serves it in this pipeline.
 *
 * The sheet is derived entirely from `AppData` at render time: no new fetch,
 * no polling, no new data source. If a fact is missing (e.g. Häcken has not
 * yet played away at them) it says so in words.
 */
import type { AppData, LeagueTableRow, MatchRef } from "../../pipeline/src/types";
import { Sheet } from "./Sheet";
import { competitionLabel, fmtDateTime, matchTeams, scoreForHomeAway } from "./format";

export function TeamSheet({
  team,
  data,
  onClose,
}: {
  team: LeagueTableRow;
  data: AppData;
  onClose: () => void;
}) {
  // Every Häcken fixture against this team, this season, chronological —
  // from the FULL season list, not the 10-match `recent` window.
  const against = (data.seasonMatches ?? [...data.recent, ...data.upcoming])
    .filter((m) => m.opponent === team.team)
    .sort((a, b) => a.date.localeCompare(b.date));

  // The arena: the venue of the away fixture at this team (their home
  // ground). Prefer a played match (a real observed venue); fall back to an
  // upcoming one (the scheduled venue).
  const awayVenue =
    against.find((m) => m.homeAway === "away" && m.status === "finished")?.venue ??
    against.find((m) => m.homeAway === "away")?.venue ??
    null;

  return (
    <Sheet
      title={team.team}
      subtitle={`${team.rank}. plats · ${team.points} p`}
      onClose={onClose}
      testId="team-sheet"
    >
      <div className="stack-3">
        {/* ---- 1. table position + season record ---- */}
        <div>
          <div className="mod-label">Tabelläge</div>
          <p className="small" style={{ margin: "4px 0 0" }} data-testid="team-position">
            {team.rank}. plats efter {team.played} matcher · {team.points} poäng ·
            målskillnad {team.goalDiff > 0 ? "+" : ""}
            {team.goalDiff}
          </p>
          {team.wins != null && (
            <p className="small dim" style={{ margin: "2px 0 0" }} data-testid="team-record">
              Säsong: {team.wins} vinster · {team.draws} oavgjort · {team.losses} förluster
            </p>
          )}
        </div>

        {/* ---- 2. arena ---- */}
        <div>
          <div className="mod-label">Arena</div>
          {awayVenue ? (
            <p className="small" style={{ margin: "4px 0 0" }} data-testid="team-arena">
              {awayVenue.trim()}
            </p>
          ) : (
            <p className="small dim" style={{ margin: "4px 0 0" }} data-testid="team-arena-unknown">
              Ingen bortamatch mot laget är inlagd — arenan är inte känd.
            </p>
          )}
        </div>

        {/* ---- 3. matches against Häcken ---- */}
        <div>
          <div className="mod-label">Matcher mot Häcken</div>
          {against.length === 0 ? (
            <p className="small dim" style={{ margin: "4px 0 0" }} data-testid="no-team-matches">
              Inga matcher mot laget denna säsong.
            </p>
          ) : (
            <ul className="plain-list" data-testid="team-matches">
              {against.map((m) => (
                <MatchAgainstRow key={m.id} m={m} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function MatchAgainstRow({ m }: { m: MatchRef }) {
  const teams = matchTeams(m);
  const score = scoreForHomeAway(m);
  return (
    <li data-testid="team-match-row">
      <b>{score ?? "–"}</b> {teams.left} – {teams.right}
      <span className="dim xsmall" style={{ display: "block" }}>
        {fmtDateTime(m.date)} · {competitionLabel(m.competition)}
        {m.venue ? ` · ${m.venue.trim()}` : ""}
      </span>
    </li>
  );
}
