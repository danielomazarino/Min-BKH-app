import type { AppDataState } from "../data";
import { competitionLabel, fmtDateTime } from "../data";

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
  const w = data.warnings;

  return (
    <div>
      <h1>Hem</h1>

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
        {w ? (
          <div data-testid="warnings">
            {w.suspended.length === 0 && w.atRisk.length === 0 ? (
              <div className="card empty">Inga spelare är avstängda eller nära avstängning.</div>
            ) : (
              <>
                {w.suspended.map((p) => (
                  <div key={p.playerId} className="warn-strip suspended" data-testid="suspended-player">
                    <strong>{p.playerName}</strong> <span className="badge red">Avstängd nästa match</span>
                  </div>
                ))}
                {w.atRisk.map((p) => (
                  <div key={p.playerId} className="warn-strip" data-testid="at-risk-player">
                    <strong>{p.playerName}</strong> <span className="badge yellow">En varning från avstängning</span>
                  </div>
                ))}
              </>
            )}
            <p className="meta">
              Gäller {competitionLabel(w.competition)} {w.season}. Regel: {w.rule}.
            </p>
          </div>
        ) : (
          <div className="card empty">Varningsstatus kunde inte beräknas.</div>
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
        {data.news.length === 0 ? (
          <div className="card empty">Inga nyheter just nu.</div>
        ) : (
          data.news.slice(0, 5).map((n) => (
            <div className="row" key={n.id}>
              <div>
                <a href={n.url} target="_blank" rel="noopener noreferrer">
                  {n.title}
                </a>
                <div className="meta">
                  {new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(new Date(n.publishedAt))} · {n.publisher}
                </div>
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
