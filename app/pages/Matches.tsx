import { useState } from "react";
import type { AppDataState } from "../data";
import { competitionLabel, fmtDateTime } from "../data";
import type { MatchRef } from "../../pipeline/src/types";

export default function Matches({ state }: { state: AppDataState }) {
  const [tab, setTab] = useState<"kommande" | "spelade">("kommande");

  if (state.status === "loading") return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;
  if (state.status === "error") return <div className="empty">Kunde inte läsa data. Försök igen senare.</div>;

  const { data } = state;
  const list = tab === "kommande" ? data.upcoming : data.recent;
  const detail = data.lastMatchDetail;

  return (
    <div>
      <h1>Matcher</h1>

      <div role="tablist" aria-label="Matchtyp" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <TabButton active={tab === "kommande"} onClick={() => setTab("kommande")} label="Kommande" />
        <TabButton active={tab === "spelade"} onClick={() => setTab("spelade")} label="Spelade" />
      </div>

      {list.length === 0 ? (
        <div className="card empty">{tab === "kommande" ? "Inga kommande matcher inlagda." : "Inga spelade matcher ännu."}</div>
      ) : (
        list.map((m) => <MatchRow key={m.id} m={m} />)
      )}

      {tab === "spelade" && detail?.playerStats && detail.playerStats.length > 0 && (
        <section aria-labelledby="stats-h">
          <h2 id="stats-h">Senaste matchens spelare</h2>
          <div className="card" data-testid="last-match-stats">
            <div className="meta" style={{ marginBottom: 8 }}>
              {competitionLabel(detail.competition)} · {fmtDateTime(detail.date)}
            </div>
            <table className="stats">
              <thead>
                <tr>
                  <th>Spelare</th>
                  <th className="num">Min</th>
                  <th className="num">Mål</th>
                  <th className="num">Ass</th>
                  <th className="num">Gul</th>
                </tr>
              </thead>
              <tbody>
                {detail.playerStats.map((s) => (
                  <tr key={s.playerId}>
                    <td>{s.playerName}</td>
                    <td className="num">{s.minutes ?? "–"}</td>
                    <td className="num">{s.goals}</td>
                    <td className="num">{s.assists}</td>
                    <td className="num">{s.yellowCards}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        minHeight: 48,
        padding: "0 20px",
        borderRadius: 999,
        border: "1px solid var(--bkh-border)",
        background: active ? "var(--bkh-yellow)" : "var(--bkh-surface)",
        color: active ? "var(--bkh-black)" : "var(--bkh-text-dim)",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function MatchRow({ m }: { m: MatchRef }) {
  const score =
    m.status === "finished" && m.scoreHome != null && m.scoreAway != null
      ? m.homeAway === "home"
        ? `${m.scoreHome}–${m.scoreAway}`
        : `${m.scoreAway}–${m.scoreHome}`
      : null;
  return (
    <div className="row" data-testid="match-row">
      <div>
        <div>
          {m.homeAway === "home" ? "Hemma" : "Borta"} mot <strong>{m.opponent}</strong>
        </div>
        <div className="meta">
          {competitionLabel(m.competition)} · {fmtDateTime(m.date)}
        </div>
      </div>
      {score && <span className="badge yellow">{score}</span>}
    </div>
  );
}
