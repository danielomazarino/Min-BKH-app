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
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AppDataState } from "../data";
import type { MatchRef } from "../../pipeline/src/types";
import { MatchSheet } from "../shared/MatchSheet";
import { NextMatchBanner } from "../shared/NextMatchBanner";
import { TeamSheet } from "../shared/TeamSheet";
import { UpcomingMatchSheet } from "../shared/UpcomingMatchSheet";
import {
  competitionLabel,
  fmtDateTime,
  fmtDay,
  matchTeams,
  resultOf,
  scoreForHomeAway,
} from "../shared/format";
import { idFromSearch } from "../shared/nav";

export default function Matches({ state }: { state: AppDataState }) {
  const [tab, setTab] = useState<"spelade" | "kommande" | "tabell">("spelade");
  const { search } = useLocation();
  const navigate = useNavigate();

  // ?section=tabellen — Brief's "Hela tabellen" link. Select the table tab
  // directly, then remove the one-shot parameter so reloads open normally.
  //
  // THESE HOOKS MUST STAY ABOVE THE EARLY RETURNS. They were originally placed
  // after the loading/error returns, so the loading render registered 3 hooks
  // and the ready render registered 5 — React error #310, "rendered more hooks
  // than during the previous render". That blanked the whole /matcher page the
  // moment data arrived, and with it every e2e test that visited /matcher.
  // A hook may never sit behind a conditional return.
  // Team sheet: tapping a league-table row opens that team's position, arena
  // and fixtures against Häcken (tester request, 2026-10-13). Local state is
  // enough — the sheet is derived from data already in memory, so there is no
  // deep link to preserve and nothing to restore on reload.
  // THIS HOOK SITS WITH THE OTHERS ABOVE THE EARLY RETURNS — see the #310
  // warning below: a hook may never sit behind a conditional return.
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  // Upcoming-match sheet state — ALSO above the early returns (see #310).
  const [openUpcomingId, setOpenUpcomingId] = useState<number | null>(null);
  // Played-match sheet state for matches OTHER than the last one (which keeps
  // its deep link). ALSO above the early returns — see #310.
  const [openPlayedId, setOpenPlayedId] = useState<number | null>(null);
  const wantsTable = new URLSearchParams(search).get("section") === "tabellen";
  useEffect(() => {
    if (!wantsTable || state.status !== "ready") return;
    setTab("tabell");
    navigate("/matcher", { replace: true });
  }, [wantsTable, state.status, navigate]);

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

  // B-021 round 4 (user, 2026-10-14): EVERY finished match now carries its
  // events in `matchDetails`, so every played row opens the same timeline
  // sheet the last game has. The last match keeps its deep link
  // (?id=<match-id>); the others open from local state.
  const openId = idFromSearch(search);
  const openMatch =
    openId != null
      ? detailId != null && String(detailId) === openId
        ? detail
        : data.matchDetails?.[openId] ?? null
      : null;
  const closeMatch = () => navigate("/matcher");
  const openPlayed = openPlayedId != null ? data.matchDetails?.[String(openPlayedId)] ?? null : null;

  const openTeamRow = openTeam ? data.table.find((t) => t.team === openTeam) ?? null : null;

  // Upcoming matches open a sheet too (tester, 2026-10-14: "the upcoming game
  // is not a button, and there is no info about how to know that the start
  // lineup is to be shown"). The sheet shows the fixture and the on-demand
  // lineup section — the discoverable path to the eleven. Local state: the
  // sheet is derived from the MatchRef already in memory, no deep link needed.
  const openUpcoming = openUpcomingId != null ? data.upcoming.find((m) => m.id === openUpcomingId) ?? null : null;

  return (
    <>
      <div className="layer" data-testid="matches-page">
        <h1 className="sr-only">Matcher — BK Häcken</h1>

        {/* Next match is repeated here deliberately: "when do we play" is the
            first question this destination must answer. Same shared banner as
            Brief (B-021 round 3) — one component, one layout, and the tap
            opens the upcoming-match sheet with the lineup section. */}
        {data.nextMatch && (
          <section className="matches-next-match">
            <NextMatchBanner
              next={data.nextMatch}
              onOpen={() => setOpenUpcomingId(data.nextMatch!.id)}
            />
          </section>
        )}

        <div className="match-tabs" style={{ paddingTop: 12 }}>
          <div className="seg" role="tablist" aria-label="Matchtyp">
            <button role="tab" aria-selected={tab === "spelade"} onClick={() => setTab("spelade")} data-testid="tab-played">
              Spelade
            </button>
            <button role="tab" aria-selected={tab === "kommande"} onClick={() => setTab("kommande")} data-testid="tab-upcoming">
              Kommande
            </button>
            <button role="tab" aria-selected={tab === "tabell"} onClick={() => setTab("tabell")} data-testid="tab-table">
              Tabell
            </button>
          </div>
        </div>

        <div className="module" style={{ paddingTop: 12 }}>
          {tab === "tabell" ? (
            <section aria-labelledby="table-h" data-testid="league-table">
              <h2 className="mod-label" id="table-h">
                Tabell
              </h2>
              {data.table.length === 0 ? (
                <p className="empty">Tabellen är inte tillgänglig just nu.</p>
              ) : (
                data.table.map((t) => {
                  const self = t.team === "BK Häcken";
                  return (
                    <button
                      type="button"
                      className="mrow"
                      key={t.team}
                      style={self ? { color: "var(--text)" } : undefined}
                      data-testid="table-row"
                      onClick={() => setOpenTeam(t.team)}
                      aria-label={`${t.team}, ${t.rank}. plats, ${t.points} poäng. Visa lagets uppgifter.`}
                    >
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
                    </button>
                  );
                })
              )}
            </section>
          ) : list.length === 0 ? (
            <p className="empty">
              <strong>{tab === "spelade" ? "Inga spelade matcher" : "Inga kommande matcher"}</strong>
              {tab === "spelade" ? "Säsongen har inte börjat om." : "Inget schema är inlagt just nu."}
            </p>
          ) : (
            list.map((m) => (
              <MatchRow
                key={m.id}
                m={m}
                onOpen={
                  tab === "spelade"
                    ? m.id === detailId && detail
                      ? () => navigate(`/matcher?id=${m.id}`)
                      : data.matchDetails?.[String(m.id)]
                        ? () => setOpenPlayedId(m.id)
                        : undefined
                    : () => setOpenUpcomingId(m.id)
                }
              />
            ))
          )}
        </div>

      </div>
      {openMatch && <MatchSheet detail={openMatch} onClose={closeMatch} />}
      {openPlayed && <MatchSheet detail={openPlayed} onClose={() => setOpenPlayedId(null)} />}
      {openUpcoming && <UpcomingMatchSheet match={openUpcoming} onClose={() => setOpenUpcomingId(null)} />}
      {openTeamRow && <TeamSheet team={openTeamRow} data={data} onClose={() => setOpenTeam(null)} />}
    </>
  );
}

function MatchRow({ m, onOpen }: { m: MatchRef; onOpen?: () => void }) {
  // Swedish presentation rule (user, 2026-10-07): HOME team first, then the
  // away team, with the score in that same order — for played and coming
  // games alike. This is the same fix Brief's result row already had; the
  // archive rows still rendered Häcken-first, which read "5–0 Häcken –
  // Kalmar" for an away win and silently reversed the numbers.
  const teams = matchTeams(m);
  const score = scoreForHomeAway(m);
  const res = resultOf(m);
  const isHome = m.homeAway === "home";
  const cls = res ?? "";
  const inner = (
    <>
      <span className="score">{score ?? "–"}</span>
      <span className="body">
        <span className="opponent">
          {teams.left} – {teams.right}
        </span>
        <span className="meta">
          {fmtDateTime(m.date)} · {competitionLabel(m.competition)}
        </span>
      </span>
    </>
  );

  // Tester feedback (2026-10-13/14), three rounds:
  //   1. The row used to end with TWO adjacent single-letter badges — the
  //      result letter (S/O/F) and a venue badge (H/B) — which read as
  //      cryptic pairs ("S/H", "O/B", "F/H") crowding the right edge.
  //   2. The result letter was removed: the coloured edge (::before, w/d/l)
  //      and the score already state the result.
  //   3. The "Hemma"/"Borta" word was removed from the meta line too: the
  //      team ORDER already conveys the venue (home team listed first, the
  //      same Swedish presentation rule that orders the score). The venue
  //      REMAINS in the row's accessible name, so screen-reader users keep
  //      the explicit cue; sighted readers read it off the team order.

  const label = `${isHome ? "Hemma" : "Borta"}: ${teams.left} mot ${teams.right}, ${
    score ?? "inget resultat"
  } ${fmtDay(m.date)}${
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
