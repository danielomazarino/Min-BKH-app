/**
 * Matcher — fixtures, results, table and match detail.
 *
 * A compact archive, reached from the floating bar as its own destination.
 * Rows carry W/D/L as a coloured edge AND a letter, so the result never
 * depends on colour alone. Only the last match has event data, so only the
 * last match opens a timeline sheet — the other rows are not clickable dead
 * ends.
 *
 * Match detail is a URL-addressable CHILD state (`#/matcher?id=<match-id>`),
 * so the browser/iOS back gesture closes the detail rather than leaving the
 * page.
 */
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AppDataState } from "../data";
import type { MatchRef } from "../../pipeline/src/types";
import { MatchSheet } from "../shared/MatchSheet";
import { competitionLabel, daysUntil, fmtDateTime, fmtDay, RESULT_WORD, resultOf, scoreFor } from "../shared/format";
import { idFromSearch } from "../shared/nav";

export default function Matches({ state }: { state: AppDataState }) {
  const [tab, setTab] = useState<"spelade" | "kommande">("spelade");
  const { search } = useLocation();
  const navigate = useNavigate();

  if (state.status === "loading") {
    return (
      <div className="layer" aria-busy="true" aria-label="Laddar" data-testid="matches-page">
        <div className="module">
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="layer" data-testid="matches-page">
        <div className="empty" role="status">
          <strong>Kunde inte läsa matchdata</strong>
          Försök igen om en stund.
        </div>
      </div>
    );
  }

  const { data } = state;
  const list = tab === "spelade" ? data.recent : data.upcoming;
  const detail = data.lastMatchDetail;
  const detailId = detail?.id;

  // Deep link: only the match that actually has events can open a sheet.
  const openId = idFromSearch(search);
  const openMatch = openId && detailId != null && String(detailId) === openId ? detail : null;
  const closeMatch = () => navigate("/matcher");

  return (
    <>
      <div className="layer" data-testid="matches-page">
        <h1 className="sr-only">Matcher — BK Häcken</h1>

        {/* Next match is repeated here deliberately: "when do we play" is the
            first question this destination must answer. It is the only piece
            of information duplicated from Brief, and it is one line. */}
        {data.nextMatch && <NextMatchStrip next={data.nextMatch} />}

        <div className="match-tabs" style={{ paddingTop: 12 }}>
          <div className="seg" role="tablist" aria-label="Matchtyp">
            <button role="tab" aria-selected={tab === "spelade"} onClick={() => setTab("spelade")} data-testid="tab-played">
              Spelade
            </button>
            <button role="tab" aria-selected={tab === "kommande"} onClick={() => setTab("kommande")} data-testid="tab-upcoming">
              Kommande
            </button>
          </div>
        </div>

        <div className="module" style={{ paddingTop: 12 }}>
          {list.length === 0 ? (
            <p className="empty">
              <strong>{tab === "spelade" ? "Inga spelade matcher" : "Inga kommande matcher"}</strong>
              {tab === "spelade" ? "Säsongen har inte börjat om." : "Inget schema är inlagt just nu."}
            </p>
          ) : (
            list.map((m) => (
              <MatchRow
                key={m.id}
                m={m}
                onOpen={tab === "spelade" && m.id === detailId && detail ? () => navigate(`/matcher?id=${m.id}`) : undefined}
              />
            ))
          )}
        </div>

        {data.table.length > 0 && (
          <section className="module" aria-labelledby="table-h" data-testid="league-table">
            <h2 className="mod-label" id="table-h">
              Tabellen
            </h2>
            {data.table.map((t) => {
              const self = t.team === "BK Häcken";
              return (
                <div className="mrow" key={t.team} style={self ? { color: "var(--text)" } : undefined} data-testid="table-row">
                  <span className="score" style={{ fontSize: 13, color: self ? "var(--yellow)" : "var(--text-3)" }}>
                    {t.rank}
                  </span>
                  <span className="body">
                    <span className="opponent" style={self ? { color: "var(--yellow)" } : undefined}>
                      {t.team}
                    </span>
                    <span className="meta">
                      {t.played} matcher · {t.goalDiff > 0 ? "+" : ""}
                      {t.goalDiff}
                    </span>
                  </span>
                  <span className="res">{t.points} p</span>
                </div>
              );
            })}
          </section>
        )}
      </div>
      {openMatch && <MatchSheet detail={openMatch} onClose={closeMatch} />}
    </>
  );
}

function NextMatchStrip({ next }: { next: MatchRef }) {
  const days = daysUntil(next.date);
  const isHome = next.homeAway === "home";
  return (
    <section className="module" data-testid="matcher-next">
      <h2 className="mod-label">Nästa match</h2>
      <div className="strip">
        <span className="strip-when">
          <b>{days != null ? (days === 0 ? "Idag" : days === 1 ? "Imorgon" : `Om ${days} dagar`) : "—"}</b>
          <span>
            {fmtDay(next.date)} · {isHome ? "Hemma" : "Borta"}
          </span>
        </span>
        <span className="strip-teams">
          <span className="dim">{competitionLabel(next.competition)}</span>
          <b>
            {isHome ? "Häcken" : next.opponent} – {isHome ? next.opponent : "Häcken"}
          </b>
        </span>
      </div>
    </section>
  );
}

function MatchRow({ m, onOpen }: { m: MatchRef; onOpen?: () => void }) {
  const score = scoreFor(m);
  const res = resultOf(m);
  const isHome = m.homeAway === "home";
  const cls = res ?? "";
  const inner = (
    <>
      <span className="score">{score ?? "–"}</span>
      <span className="body">
        <span className="opponent">{m.opponent}</span>
        <span className="meta">
          {fmtDateTime(m.date)} · {competitionLabel(m.competition)}
        </span>
      </span>
      {res ? (
        <span className="res" aria-hidden="true">
          {RESULT_WORD[res]}
        </span>
      ) : null}
      <span className="ven" aria-hidden="true">
        {isHome ? "H" : "B"}
      </span>
    </>
  );

  const label = `${isHome ? "Hemma" : "Borta"} mot ${m.opponent}, ${score ?? "inget resultat"} ${fmtDay(m.date)}${
    res ? `, ${res === "w" ? "seger" : res === "d" ? "oavgjort" : "förlust"}` : ""
  }`;

  return onOpen ? (
    <button type="button" className={`mrow ${cls}`} onClick={onOpen} aria-label={`${label}. Visa matchen.`} data-testid="match-row">
      {inner}
    </button>
  ) : (
    <div className={`mrow ${cls}`} aria-label={label} data-testid="match-row">
      {inner}
    </div>
  );
}
