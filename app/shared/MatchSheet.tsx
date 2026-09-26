/**
 * MatchSheet — the event timeline for a finished match.
 *
 * Goals (with assists), yellow cards, red cards and substitutions, merged into
 * one chronological list with a half-time divider, Häcken's items visually
 * distinct from the opponent's. This data already existed in app.json and was
 * never rendered by the old UI.
 *
 * Only the most recent match carries event data, so only that match opens a
 * timeline. The other archive rows stay inert rather than becoming dead ends.
 */
import type { MatchDetail } from "../../pipeline/src/types";
import { Sheet } from "./Sheet";
import { buildTimeline, competitionLabel, fmtDay, scoreFor, type TlItem } from "./format";

export function MatchSheet({ detail, onClose }: { detail: MatchDetail; onClose: () => void }) {
  const items = buildTimeline(detail.events);
  const score = scoreFor(detail);
  return (
    <Sheet title={detail.opponent} subtitle={`${score ?? ""} · ${fmtDay(detail.date)}`} onClose={onClose}>
      <div className="stack-3">
        <p className="small dim" style={{ margin: 0 }}>
          {competitionLabel(detail.competition)} · {detail.homeAway === "home" ? "Hemma" : "Borta"}
          {detail.venue ? ` · ${detail.venue}` : ""}
        </p>
        {items.length === 0 ? (
          <p className="empty" data-testid="no-events">
            <strong>Inga händelser</strong>
            Händelsedata saknas för den här matchen.
          </p>
        ) : (
          <div className="tl" data-testid="match-timeline">
            {items.map((it, i) => (
              <TimelineRow key={i} item={it} />
            ))}
          </div>
        )}
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
