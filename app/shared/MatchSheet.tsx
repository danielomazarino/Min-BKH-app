/**
 * MatchSheet — one match, properly.
 *
 * Purpose (2026-09-26): Hem used to print a truncated one-line scorer list
 * inline, which made the dashboard's most important row an event log. The
 * detail moved here, where there is room for the whole picture:
 *
 *   1. WHO / WHAT / WHEN — the two teams in Swedish order (home left, away
 *      right), the final score in that same order, competition, date, venue.
 *   2. GOALSCORERS — the explicit answer to "who scored", with assists.
 *   3. THE TIMELINE — goals, cards and substitutions, chronologically.
 *   4. STATISTICS — only if the provider actually recorded them.
 *
 * NOTHING HERE IS INVENTED. `playerStats` is empty for this competition;
 * when it is empty the sheet says so rather than deriving a substitute from
 * the event list. Presenting "events per minute" as a football statistic
 * would be exactly that kind of invention, so it is done nowhere in this app.
 */
import { useEffect, useRef, useState } from "react";
import type { MatchDetail } from "../../pipeline/src/types";
import { Sheet } from "./Sheet";
import { fetchLineupOnDemand, type LineupOutcome } from "../players/lineupLookup";
import {
  buildTimeline,
  competitionLabel,
  fmtDateTime,
  matchTeams,
  resultOf,
  scoreForHomeAway,
  type TimelineRowItem,
  type TlItem,
} from "./format";

const RESULT_TEXT = { w: "Häcken segrade", d: "Oavgjort", l: "Häcken förlorade" } as const;

export function MatchSheet({ detail, onClose }: { detail: MatchDetail; onClose: () => void }) {
  const items = buildTimeline(detail.events);
  const score = scoreForHomeAway(detail);
  const teams = matchTeams(detail);
  const res = resultOf(detail);
  // `buildTimeline` also emits half-time dividers, which are not events.
  const scorers = items.filter((i): i is TimelineRowItem => i.kind === "goal");
  const stats = detail.playerStats ?? [];
  return (
    <Sheet
      title={`${teams.left} – ${teams.right}`}
      subtitle={score ? `${score}${res ? ` · ${RESULT_TEXT[res]}` : ""}` : undefined}
      onClose={onClose}
    >
      <div className="stack-3">
        {/* ---- 1. the fixture itself, home on the left ---- */}
        <div className="stack-2">
          <div className="fixture" data-testid="fixture">
            <span className={`ft${teams.hackenSide === "left" ? " hacken" : ""}`} data-testid="fixture-home">
              {teams.left}
            </span>
            <span className="fs" data-testid="fixture-score">
              {score ?? "–"}
            </span>
            <span className={`ft${teams.hackenSide === "right" ? " hacken" : ""}`} data-testid="fixture-away">
              {teams.right}
            </span>
          </div>
          <p className="small dim" style={{ margin: 0 }} data-testid="fixture-meta">
            {competitionLabel(detail.competition)} · {fmtDateTime(detail.date)} ·{" "}
            {detail.homeAway === "home" ? "Hemma" : "Borta"}
            {detail.venue ? ` · ${detail.venue}` : ""}
          </p>
        </div>

        {/* ---- 2. goalscorers, the question supporters actually ask ---- */}
        {scorers.length > 0 && (
          <div>
            <div className="mod-label">Målskyttar</div>
            <ul className="plain-list" data-testid="sheet-scorers">
              {scorers.map((g, i) => (
                <li key={i}>
                  <b>{g.minuteLabel}</b> {g.who}
                  {g.assist ? <span className="dim xsmall"> (assist {g.assist})</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- 3. the full timeline ---- */}
        {items.length === 0 ? (
          <p className="empty" data-testid="no-events">
            <strong>Inga händelser</strong>
            Händelsedata saknas för den här matchen.
          </p>
        ) : (
          <div>
            <div className="mod-label">Händelser</div>
            <div className="tl" data-testid="match-timeline">
              {items.map((it, i) => (
                <TimelineRow key={i} item={it} />
              ))}
            </div>
          </div>
        )}

        {/* ---- 4. the starting eleven, ON DEMAND ---- */}
        <LineupSection matchId={detail.id} />

        {/* ---- 5. real statistics, or an honest gap ---- */}
        <div>
          <div className="mod-label">Statistik</div>
          {stats.length > 0 ? (
            <div className="kv" data-testid="match-stats">
              {stats.slice(0, 12).map((s) => (
                <div className="k" key={s.playerId}>
                  <div className="v" style={{ fontSize: 14, fontWeight: 600 }}>
                    {s.playerName}
                  </div>
                  <div className="l">
                    {[
                      s.minutes != null ? `${s.minutes} min` : null,
                      s.goals ? `${s.goals} mål` : null,
                      s.assists ? `${s.assists} assist` : null,
                      s.yellowCards ? `${s.yellowCards} gul` : null,
                      s.redCards ? `${s.redCards} röd` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="small dim" style={{ margin: 0 }} data-testid="no-stats">
              Leverantören registrerar inga spelarmatchstatistik för den här matchen. Appen räknar inte ut egna
              siffror från händelselistan — antaganden skulle bara se ut som fakta.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function TimelineRow({ item }: { item: TlItem }) {
  if (item.kind === "break") {
    return (
      <div className="tl-break" data-testid="timeline-break">
        {item.label}
      </div>
    );
  }
  const label =
    item.kind === "goal" ? "Mål" : item.kind === "yellow" ? "Gult kort" : item.kind === "red" ? "Rött kort" : "Byte";
  return (
    <div className={`tl-item ${item.kind}${item.forHäcken ? "" : " opponent"}`} data-testid={`timeline-${item.kind}`}>
      <span className="min">{item.minuteLabel}</span>
      <span className="what">
        <span className="who">{item.who}</span> <span className="dim xsmall">{label}</span>
        {item.assist && <span className="assist">assist {item.assist}</span>}
      </span>
    </div>
  );
}

/**
 * The starting eleven — checked once when the match card opens, never polled.
 *
 * Tester request (2026-10-13): an indicator when the eleven is released
 * ("preliminär och sen slutlig elva", "det kan ske släpps på häckens
 * hemsida"). The user's constraint is explicit: a lookup when the user taps
 * is fine (the same pattern as the player Wikipedia lookup), but constant
 * polling and notifications are NOT worth it.
 *
 * One GraphQL query fires when the sheet mounts. The result lives in
 * component state only, and nothing runs in the background.
 *
 * Takes the match ID only — it works for BOTH played matches (the match
 * sheet) and upcoming ones (the upcoming-match sheet), which have no
 * MatchDetail yet but do have an id.
 */
export function LineupSection({ matchId }: { matchId: number }) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "done"; outcome: LineupOutcome }
  >({ phase: "loading" });
  const requestRef = useRef<{ matchId: number; promise: Promise<LineupOutcome> } | null>(null);

  useEffect(() => {
    let active = true;
    setState({ phase: "loading" });
    if (requestRef.current?.matchId !== matchId) {
      requestRef.current = { matchId, promise: fetchLineupOnDemand(matchId) };
    }
    void requestRef.current.promise.then((outcome) => {
      if (active) setState({ phase: "done", outcome });
    });
    return () => {
      active = false;
    };
  }, [matchId]);

  if (state.phase === "loading") {
    return (
      <div>
        <div className="mod-label">Uppställning</div>
        <p className="small dim" style={{ margin: "4px 0 0" }} aria-busy="true" data-testid="lineup-loading">
          Hämtar…
        </p>
      </div>
    );
  }

  const { outcome } = state;
  if (outcome.kind === "error") {
    return (
      <div>
        <div className="mod-label">Uppställning</div>
        <p className="small dim" style={{ margin: "4px 0 0" }} data-testid="lineup-error">
          Kunde inte hämta uppställningen ({outcome.message}). Försök igen senare.
        </p>
      </div>
    );
  }
  if (outcome.kind === "not-published") {
    return (
      <div>
        <div className="mod-label">Uppställning</div>
        <p className="small dim" style={{ margin: "4px 0 0" }} data-testid="lineup-not-published">
          Startelva ej tillgänglig
        </p>
      </div>
    );
  }

  const l = outcome.lineups;
  const sides: Array<{ side: string; team: typeof l.homeTeam }> = [
    { side: "Hemmalag", team: l.homeTeam },
    { side: "Bortalag", team: l.visitingTeam },
  ];
  return (
    <div>
      <div className="mod-label">Uppställning</div>
      <div className="stack-2" data-testid="lineup-content">
        {sides.map(({ side, team }) => {
          if (!team || (team.starting.length === 0 && team.substitutes.length === 0)) {
            return (
              <p className="small dim" style={{ margin: 0 }} key={side}>
                {side}: Startelva ej tillgänglig
              </p>
            );
          }
          return (
            <div key={team.abbrv}>
              <p className="small" style={{ margin: "4px 0 2px", fontWeight: 600 }}>
                {team.abbrv}{team.formation ? ` · ${team.formation}` : ""}
              </p>
              <p className="small dim" style={{ margin: "0 0 2px" }}>Startelva</p>
              <ul className="plain-list" style={{ margin: 0 }}>
                {team.starting.map((p, i) => (
                  <li key={i}>
                    {p.shirtNumber != null ? <b>{p.shirtNumber}</b> : null} {p.givenName} {p.surName}
                    {p.position ? <span className="dim xsmall"> ({p.position})</span> : null}
                  </li>
                ))}
              </ul>
              {team.substitutes.length > 0 && (
                <>
                  <p className="small dim" style={{ margin: "6px 0 2px" }}>Avbytare</p>
                  <p className="small" style={{ margin: 0 }}>
                    {team.substitutes.map((p) => `${p.givenName} ${p.surName}`).join(", ")}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
