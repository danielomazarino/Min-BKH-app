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
import type { MatchDetail } from "../../pipeline/src/types";
import { Sheet } from "./Sheet";
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

        {/* ---- 4. real statistics, or an honest gap ---- */}
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
