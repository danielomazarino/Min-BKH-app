/**
 * Brief — the supporter dashboard.
 *
 * Purpose: "give me the important BK Häcken men's-team situation at a glance".
 * A single vertically scrolling surface. There is no horizontal pager any
 * more: navigation between sections is the floating bar's job, and swiping
 * must never be ambiguous about whether it means "next section" or "scroll".
 *
 * Concise by construction: next match, last result, the discipline cases that
 * actually matter, a one-line table position and a small news preview. The
 * full lists live in their own destinations.
 */
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { AppDataState } from "../data";
import type { AppData, MatchEvents, MatchRef, PlayerDiscipline } from "../../pipeline/src/types";
import {
  competitionLabel,
  cstatFor,
  currentSquadDiscipline,
  daysUntil,
  fmtDateTime,
  fmtDay,
  formGuide,
  RESULT_WORD,
  resultOf,
  scoreFor,
  scorerLine,
  urgentDiscipline,
} from "../shared/format";

export default function Brief({ state }: { state: AppDataState }) {
  if (state.status === "loading") return <BriefSkeleton />;
  if (state.status === "error") {
    return (
      <div className="layer">
        <div className="empty" role="status" data-testid="load-error">
          <strong>Kunde inte läsa data</strong>
          Appen visar cachad data när den finns. Försök igen om en stund.
        </div>
      </div>
    );
  }

  const { data } = state;
  const threshold = data.disciplineRule?.threshold ?? 3;

  return (
    <div className="layer" data-testid="brief-page">
      <h1 className="sr-only">Supporterbrief — BK Häcken</h1>
      <BriefBody data={data} threshold={threshold} />
    </div>
  );
}

function BriefBody({ data, threshold }: { data: AppData; threshold: number }) {
  const navigate = useNavigate();
  const form = formGuide(data.recent, 5);

  // Discipline is scoped to the current squad AND sorted by urgency. Every
  // qualifying player is rendered — the old UI capped at 2 suspended + 3
  // at-risk, so the heading said "5 att hålla koll på" while showing 4 rows.
  const urgent = useMemo(
    () => urgentDiscipline(currentSquadDiscipline(data.discipline, data.squadStats)),
    [data.discipline, data.squadStats],
  );

  const goMatch = (id: number) => navigate(`/matcher?id=${id}`);
  const lastId = data.lastResult?.id ?? null;
  const detailId = data.lastMatchDetail?.id ?? null;
  // Only the most recent match carries event data, so only that row opens.
  const canOpenDetail = detailId != null && detailId === lastId;

  const preview = (data.newsEvents ?? []).slice(0, 3);

  return (
    <>
      {data.currentDataUnavailable && (
        <p className="small muted" role="status" data-testid="current-data-unavailable">
          Aktuell matchdata saknas just nu. Senaste kända data visas.
        </p>
      )}

      {/* 1 — next match. The single most important thing on the screen. */}
      <section className="module">
        <NextMatchHero
          next={data.nextMatch}
          form={form}
          onOpen={() => data.nextMatch && navigate("/matcher")}
        />
      </section>

      {/* 2 — last result, with the scorers the old UI never showed */}
      <section className="module" aria-labelledby="last-h">
        <h2 className="mod-label" id="last-h">
          Senast
          <Link className="mod-more" to="/matcher">
            Alla matcher <ChevronRight aria-hidden />
          </Link>
        </h2>
        {data.lastResult ? (
          <ResultRow
            match={data.lastResult}
            events={data.lastMatchDetail?.events}
            onOpen={canOpenDetail ? () => goMatch(data.lastResult!.id) : undefined}
          />
        ) : (
          <p className="empty" style={{ padding: "8px 0" }}>
            Inget spelat resultat i den här säsongen ännu.
          </p>
        )}
      </section>

      {/* 3 — discipline: EVERY qualifying current-squad player, uncapped */}
      <section className="module" aria-labelledby="card-h">
        <h2 className="mod-label" id="card-h">
          Kortläget
          {urgent.length > 0 && <span className="count"> · {urgent.length} att hålla koll på</span>}
        </h2>
        {urgent.length === 0 ? (
          <p className="empty" style={{ padding: "8px 0" }} data-testid="discipline-clear">
            {data.discipline?.length
              ? "Ingen är avstängd och ingen är en varning från nästa avstängning."
              : "Kortdata saknas för säsongen just nu."}
          </p>
        ) : (
          <div data-testid="discipline" data-count={urgent.length}>
            {urgent.map((d: PlayerDiscipline) => (
              <CstatRow key={d.playerId} d={d} threshold={threshold} />
            ))}
            <Link className="mod-label mod-link" to="/matcher" data-testid="discipline-more">
              Alla matcher och kort <ChevronRight aria-hidden />
            </Link>
          </div>
        )}
      </section>

      {/* 4 — table position, one line, tappable into the full table */}
      {data.tablePosition && (
        <section className="module" aria-labelledby="table-h">
          <h2 className="mod-label" id="table-h">
            Tabellen
            <Link className="mod-more" to="/matcher">
              Hela tabellen <ChevronRight aria-hidden />
            </Link>
          </h2>
          <p className="small muted" data-testid="table-position">
            <b className="t-rank">{data.tablePosition.rank}:e</b> · {data.tablePosition.points} poäng på{" "}
            {data.tablePosition.played} matcher (
            {data.tablePosition.goalDiff > 0 ? "+" : ""}
            {data.tablePosition.goalDiff})
          </p>
        </section>
      )}

      {/* 5 — a SMALL news preview. The full feed is the Nyheter destination. */}
      {preview.length > 0 && (
        <section className="module" aria-labelledby="news-h">
          <h2 className="mod-label" id="news-h">
            Senaste nytt
            <Link className="mod-more" to="/nyheter">
              Alla nyheter <ChevronRight aria-hidden />
            </Link>
          </h2>
          <div>
            {preview.map((e) => (
              <Link className="news-row" key={e.id} to={`/nyheter?id=${encodeURIComponent(e.id)}`} data-testid="brief-news-row">
                <span className="when">{fmtDay(e.latestPublishedAt || e.publishedAt)}</span>
                <span className="head">{e.title}</span>
                <span className="pub" aria-hidden="true">
                  {e.sources.slice(0, 4).map((s) => (
                    <i key={s.url} className={`sdot ${s.role === "primary" ? "primary" : s.role === "secondary" ? "secondary" : ""}`} />
                  ))}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function NextMatchHero({
  next,
  form,
  onOpen,
}: {
  next: MatchRef | null;
  form: Array<"w" | "d" | "l">;
  onOpen: () => void;
}) {
  if (!next) {
    return (
      <div className="hero" data-testid="next-match">
        <div className="hero-top">
          <span className="hero-comp">Nästa match</span>
        </div>
        <p className="muted small">Ingen kommande match är inlagd just nu.</p>
      </div>
    );
  }
  const days = daysUntil(next.date);
  const isHome = next.homeAway === "home";
  return (
    <button type="button" className="hero hero-tap" onClick={onOpen} data-testid="next-match" aria-label={`Nästa match mot ${next.opponent}. Visa matcher.`}>
      <div className="hero-top">
        <span className="hero-comp">{competitionLabel(next.competition)}</span>
        <span className="hero-countdown" data-testid="countdown">
          {days != null ? (days === 0 ? "Idag" : days === 1 ? "Imorgon" : `Om ${days} dagar`) : "—"}
        </span>
      </div>
      <div className="hero-teams">
        <div className={`hero-team${isHome ? "" : " opponent"}`}>
          <div className="name">{isHome ? "Häcken" : next.opponent}</div>
        </div>
        <div className="hero-score" aria-hidden="true">
          <span className="v">–</span>
        </div>
        <div className={`hero-team${isHome ? " opponent" : " hacken"}`}>
          <div className="name">{isHome ? next.opponent : "Häcken"}</div>
        </div>
      </div>
      <div className="hero-when">
        {fmtDateTime(next.date)} · {isHome ? "Hemma" : "Borta"}
        {next.venue ? ` · ${next.venue}` : ""}
      </div>
      {form.length > 0 && (
        // role="img" gives the bar an accessible name; a bare div with
        // aria-label is an aria-prohibited-attr violation.
        <div className="form" role="img" aria-label={`Senaste ${form.length} matcher: ${form.map((f) => RESULT_WORD[f]).join(", ")}`}>
          {form.map((f, i) => (
            <span key={i} className={`r ${f}`} />
          ))}
        </div>
      )}
    </button>
  );
}

function ResultRow({ match, events, onOpen }: { match: MatchRef; events?: MatchEvents; onOpen?: () => void }) {
  const score = scoreFor(match);
  const res = resultOf(match);
  const scorers = scorerLine(events);
  const label = `${match.opponent}, ${score ?? "resultat"}, ${fmtDateTime(match.date)}.`;
  const inner = (
    <>
      <span className={`score ${res ?? ""}`} data-testid="last-score">
        {score ?? "–"}
      </span>
      <span className="body">
        <span className="opponent">{match.opponent}</span>
        <span className="meta">
          {fmtDay(match.date)} · {match.homeAway === "home" ? "Hemma" : "Borta"} · {competitionLabel(match.competition)}
        </span>
        {scorers && (
          <span className="scorers" data-testid="last-scorers">
            {scorers}
          </span>
        )}
      </span>
      {onOpen ? (
        <span className="ven" aria-hidden="true">
          <ChevronRight />
        </span>
      ) : null}
    </>
  );
  if (!onOpen) {
    return (
      <div className="result" aria-label={label} data-testid="last-result">
        {inner}
      </div>
    );
  }
  return (
    <button type="button" className="result" onClick={onOpen} data-testid="last-result" aria-label={`${label} Visa matchen.`}>
      {inner}
    </button>
  );
}

/**
 * One player's card situation. The state text is derived from the PENDING
 * warning count, so it can never contradict the season total the way the old
 * fixed label did ("En varning från avstängning" next to "5 varningar").
 */
function CstatRow({ d, threshold }: { d: PlayerDiscipline; threshold: number }) {
  const { state, severity } = cstatFor(d, threshold);
  const pending = d.warningsUntilSuspension ?? d.warningCount;
  const on = Math.min(threshold, pending);
  return (
    <div className={`cstat ${severity}`} data-testid={severity === "suspended" ? "suspended-player" : "at-risk-player"}>
      <span className={`mark ${severity}`} aria-hidden="true" />
      <span className="body">
        <span className="who">{d.playerName}</span>
        <span className="state">{state}</span>
        <span className={`meter${severity === "suspended" ? " served" : ""}`} aria-hidden="true">
          {Array.from({ length: threshold }, (_, i) => (
            <span key={i} className={`notch${i < on ? " on" : ""}`} />
          ))}
        </span>
      </span>
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="layer" aria-busy="true" aria-label="Laddar" data-testid="brief-skeleton">
      <div className="module">
        <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
      </div>
      <div className="module">
        <div className="skeleton" style={{ width: 70, height: 11 }} />
        <div className="skeleton" style={{ height: 44, marginTop: 10 }} />
      </div>
      <div className="module">
        <div className="skeleton" style={{ width: 90, height: 11 }} />
        <div className="skeleton" style={{ height: 44, marginTop: 10 }} />
      </div>
    </div>
  );
}
