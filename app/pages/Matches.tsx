/**
 * Matches — a compact archive, reached contextually from the brief rather than
 * holding a permanent tab slot.
 *
 * Rows carry W/D/L as a coloured edge AND a letter, so the result never depends
 * on colour alone. Only the last match has event data, so only the last match
 * opens a timeline sheet — the archive rows for other matches are not
 * clickable dead ends.
 */
import { useState } from "react";
import type { AppDataState } from "../data";
import type { MatchDetail, MatchRef } from "../../pipeline/src/types";
import { MatchSheet } from "./Home";
import { competitionLabel, fmtDateTime, fmtDay, RESULT_WORD, resultOf, scoreFor } from "../shared/format";

export default function Matches({ state }: { state: AppDataState }) {
  const [tab, setTab] = useState<"spelade" | "kommande">("spelade");
  const [open, setOpen] = useState<MatchDetail | null>(null);

  if (state.status === "loading") {
    return (
      <div className="layer" aria-busy="true" aria-label="Laddar">
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="layer">
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

  return (
    <>
      <div className="layer" data-testid="matches-page">
        <div style={{ paddingTop: 16, position: "sticky", top: 0, zIndex: 10, background: "var(--bg)" }}>
          <h1 className="mod-label" style={{ marginBottom: 12 }}>
            Matcher
          </h1>
          <div className="seg" role="tablist" aria-label="Matchtyp">
            <button role="tab" aria-selected={tab === "spelade"} onClick={() => setTab("spelade")} data-testid="tab-played">
              Spelade
            </button>
            <button role="tab" aria-selected={tab === "kommande"} onClick={() => setTab("kommande")} data-testid="tab-upcoming">
              Kommande
            </button>
          </div>
        </div>

        <div style={{ paddingTop: 12 }}>
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
                onOpen={tab === "spelade" && m.id === detailId && detail ? () => setOpen(detail) : undefined}
              />
            ))
          )}
        </div>

        {data.table.length > 0 && (
          <section className="module" aria-labelledby="table-h" style={{ marginTop: 20 }}>
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
      {open && <MatchSheet detail={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function MatchRow({ m, onOpen }: { m: MatchRef; onOpen?: () => void }) {
  const score = scoreFor(m);
  const res = resultOf(m);
  const isHome = m.homeAway === "home";
  const cls = res ?? "";
  const inner = (
    <>
      <span className="score">{score ?? (isHome ? "–" : "–")}</span>
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
