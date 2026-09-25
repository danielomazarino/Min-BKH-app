import type { AppDataState } from "../data";
import { competitionLabel, fmtDateTime } from "../data";
import type { PlayerDiscipline } from "../../pipeline/src/types";

const DISCIPLINE_BADGE: Record<PlayerDiscipline["status"], { label: string; kind: "red" | "yellow" | "" } | undefined> = {
  none: undefined,
  at_risk: { label: "En varning från avstängning", kind: "yellow" },
  suspended_next: { label: "Avstängd nästa match", kind: "red" },
  served: undefined,
  red_suspended: { label: "Rött kort — avstängningsstatus okänd", kind: "red" },
  unknown: { label: "Varningsstatus okänd", kind: "yellow" },
};

export default function Home({ state }: { state: AppDataState }) {
  if (state.status === "loading") return <Skeleton />;
  if (state.status === "error")
    return (
      <div className="empty" role="status">
        <p>Kunde inte läsa data.</p>
        <p className="meta">Försök igen senare — appen visar cachad data när den finns.</p>
      </div>
    );

  const { data } = state;
  // Disciplinary tile is derived from the season ledger (chronological card
  // history + rule). Legacy `warnings` is no longer produced.
  const discipline = data.discipline ?? [];
  const flagged = discipline.filter((d) => d.status === "suspended_next" || d.status === "at_risk" || d.status === "red_suspended" || d.status === "unknown");

  return (
    <div>
      <h1>Hem</h1>

      {/* 0. Current-data availability banner (never silently substitute history) */}
      {data.currentDataUnavailable && (
        <div className="card empty" role="status" data-testid="current-data-unavailable">
          <strong>Aktuell matchdata ej tillgänglig.</strong>
          <p className="meta">{data.currentDataUnavailable.reason}</p>
          <p className="meta">Senast kontrollerat: {new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(data.currentDataUnavailable.checkedAt))}</p>
        </div>
      )}

      {/* 1. Next match */}
      <section aria-labelledby="next-match-h">
        <h2 id="next-match-h">Nästa match</h2>
        {data.nextMatch ? (
          <div className="card next-match" data-testid="next-match">
            <div className="meta">{competitionLabel(data.nextMatch.competition)}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
              BK Häcken – {data.nextMatch.opponent}
            </div>
            <div className="meta">
              {fmtDateTime(data.nextMatch.date)} · {data.nextMatch.homeAway === "home" ? "Hemma" : "Borta"}
            </div>
          </div>
        ) : (
          <div className="card empty">Ingen kommande match hittad.</div>
        )}
      </section>

      {/* 2. Warnings */}
      <section aria-labelledby="warnings-h">
        <h2 id="warnings-h">Varningar &amp; avstängningar</h2>
        {discipline.length === 0 ? (
          <div className="card empty">Ingen varningsstatus kunde beräknas — kortdata saknas för säsongen.</div>
        ) : flagged.length === 0 ? (
          <div className="card empty">Inga spelare är avstängda eller nära avstängning.</div>
        ) : (
          <div data-testid="warnings">
            {flagged.map((d) => {
              return (
                <div key={d.playerId} className={`warn-strip${d.status === "suspended_next" || d.status === "red_suspended" ? " suspended" : ""}`} data-testid={d.status === "suspended_next" || d.status === "red_suspended" ? "suspended-player" : "at-risk-player"}>
                  <strong>{d.playerName}</strong> <span className={`badge ${DISCIPLINE_BADGE[d.status]?.kind ?? "yellow"}`}>{DISCIPLINE_BADGE[d.status]?.label}</span>
                  <div className="meta">{d.warningCount} varningar denna säsong{d.incomplete ? " · ofullständig kortdata" : ""}</div>
                </div>
              );
            })}
            {data.disciplineRule && (
              <p className="meta">
                Regel: {data.disciplineRule.threshold} varningar i olika matcher → {data.disciplineRule.suspensionMatches} match(es) avstängning. Källa: {data.disciplineRule.ruleSource}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 3. Latest result */}
      <section aria-labelledby="last-result-h">
        <h2 id="last-result-h">Senaste resultatet</h2>
        {data.lastResult ? (
          <div className="card" data-testid="last-result">
            <div className="meta">{competitionLabel(data.lastResult.competition)}</div>
            <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              BK Häcken {data.lastResult.homeAway === "home" ? "–" : null} {data.lastResult.opponent}{" "}
              {data.lastResult.scoreHome != null && data.lastResult.scoreAway != null
                ? `${data.lastResult.homeAway === "home" ? data.lastResult.scoreHome : data.lastResult.scoreAway}–${data.lastResult.homeAway === "home" ? data.lastResult.scoreAway : data.lastResult.scoreHome}`
                : ""}
            </div>
            <div className="meta">{fmtDateTime(data.lastResult.date)}</div>
          </div>
        ) : (
          <div className="card empty">Inget spelat resultat ännu.</div>
        )}
      </section>

      {/* 4. News */}
      <section aria-labelledby="news-h">
        <h2 id="news-h">Senaste nyheterna</h2>
        {(data.newsEvents ?? []).length === 0 ? (
          <div className="card empty">Inga nyheter just nu.</div>
        ) : (
          (data.newsEvents ?? []).slice(0, 4).map((ev) => (
            <div className="card" key={ev.id} data-testid="home-news-event">
              <div style={{ fontWeight: 600 }}>{ev.title}</div>
              {ev.summary && <div style={{ fontSize: "0.9rem", margin: "4px 0" }}>{ev.summary}</div>}
              <div className="meta">
                {new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(new Date(ev.publishedAt))}
                {ev.sources.length > 1 ? ` · ${ev.sources.length} källor` : ` · ${ev.sources[0]?.publisher ?? ""}`}
              </div>
              <div className="pills">
                {ev.sources.slice(0, 3).map((s) => (
                  <a
                    key={s.url}
                    className={`pill${s.role === "primary" ? " pill-primary" : ""}`}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${s.publisher} — öppna originalartikel`}
                  >
                    {s.publisher}
                  </a>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* 5. Table position */}
      {data.tablePosition && (
        <section aria-labelledby="table-h">
          <h2 id="table-h">Tabellen</h2>
          <div className="card" data-testid="table-position">
            <strong>{data.tablePosition.rank}:e plats</strong> · {data.tablePosition.points} poäng på{" "}
            {data.tablePosition.played} matcher ({data.tablePosition.goalDiff > 0 ? "+" : ""}
            {data.tablePosition.goalDiff} målskillnad)
          </div>
        </section>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Laddar">
      <h1>Hem</h1>
      <div className="skeleton" style={{ height: 90 }} />
      <div className="skeleton" style={{ height: 60 }} />
      <div className="skeleton" style={{ height: 60 }} />
    </div>
  );
}
