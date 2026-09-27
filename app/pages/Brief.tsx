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
import type { AppData, MatchRef, PlayerDiscipline } from "../../pipeline/src/types";
import {
  competitionLabel,
  cstatFor,
  currentSquadDiscipline,
  daysUntil,
  fmtDateTime,
  fmtDay,
  formGuide,
  groupDiscipline,
  matchTeams,
  RESULT_WORD,
  resultOf,
  scoreForHomeAway,
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
  // E-002: grouped by SEVERITY so the status label appears once per group
  // instead of once per player. Never group by the `state` string — it is
  // per-player text ("En varning kvar" vs "2 varningar kvar") and would
  // produce one group per player.
  const urgent = useMemo(
    () => urgentDiscipline(currentSquadDiscipline(data.discipline, data.squadStats)),
    [data.discipline, data.squadStats],
  );
  const groups = useMemo(() => groupDiscipline(urgent, threshold), [urgent, threshold]);

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
            {groups.map((g) => (
              <div className="cstat-group" key={g.severity} data-testid="discipline-group" data-severity={g.severity}>
                {/* E-002: the status label appears ONCE per group, not once
                    per player. Neutral wording — it never claims a count. */}
                <h3 className="cstat-group-h" data-testid="discipline-group-label">
                  {g.label}
                </h3>
                {g.players.map((d: PlayerDiscipline) => (
                  <CstatRow
                    key={d.playerId}
                    d={d}
                    threshold={threshold}
                    onOpen={() => navigate(`/trupp?id=${encodeURIComponent(d.playerId)}`)}
                  />
                ))}
              </div>
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

/**
 * The last result, as a compact supporter-facing row.
 *
 * Section J: the goal scorers used to be printed here, which turned the
 * dashboard's most important line into an event list. They now live in the
 * match sheet, where there is room for the whole timeline (goals, assists,
 * cards, substitutions) instead of a truncated one-line summary. Hem stays
 * a dashboard; the detail belongs one tap away.
 *
 * Section I: the score is HOME–AWAY, so Kalmar 0–5 Häcken reads "0–5" and
 * Häcken's own result is carried by the row's colour and the explicit
 * "Borta"/"Hemma" label rather than by silently reversing the numbers.
 */
function ResultRow({ match, onOpen }: { match: MatchRef; onOpen?: () => void }) {
  const score = scoreForHomeAway(match);
  const res = resultOf(match);
  const teams = matchTeams(match);
  const label = `${teams.left} ${score ?? "resultat"} ${teams.right}, ${fmtDateTime(match.date)}.`;
  const inner = (
    <>
      <span className={`score ${res ?? ""}`} data-testid="last-score">
        {score ?? "–"}
      </span>
      <span className="body">
        <span className="teams">
          <span className="opponent">{teams.left}</span>
          <span className="vs" aria-hidden="true">
            –
          </span>
          <span className="opponent right">{teams.right}</span>
        </span>
        <span className="meta">
          {fmtDay(match.date)} · {match.homeAway === "home" ? "Hemma" : "Borta"} ·{" "}
          {competitionLabel(match.competition)}
        </span>
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
 * One player's card situation.
 *
 * E-002: the status TEXT moved up to the group header, so this row no
 * longer prints it. What remains is strictly per-player data: the name, the
 * card meter (how full, i.e. how close to the threshold) and the real season
 * total. The state string is still computed, but only for the row's
 * accessible name — a screen reader user otherwise loses the one sentence
 * that says whether this player is out or one warning away.
 *
 * Section L: the row is a BUTTON and opens that player's sheet, and the
 * actual season card total is printed. The number comes from
 * `warningCount` in the data — it is never hard-coded per player, because a
 * hard-coded count is a fact that silently rots.
 */
function CstatRow({
  d,
  threshold,
  onOpen,
}: {
  d: PlayerDiscipline;
  threshold: number;
  onOpen?: () => void;
}) {
  const { state, severity } = cstatFor(d, threshold);
  const pending = d.warningsUntilSuspension ?? d.warningCount;
  const on = Math.min(threshold, pending);
  const total = d.warningCount;
  const inner = (
    <>
      <span className={`mark ${severity}`} aria-hidden="true" />
      <span className="body">
        <span className="who">{d.playerName}</span>
        {/* Per-player position is still shown visually by the meter below. */}
        <span className={`meter${severity === "suspended" ? " served" : ""}`} aria-hidden="true">
          {Array.from({ length: threshold }, (_, i) => (
            <span key={i} className={`notch${i < on ? " on" : ""}`} />
          ))}
        </span>
      </span>
      {/* The real season total, straight from the data. */}
      <span className="tally" data-testid="discipline-count">
        {total}
        <span className="tally-l" aria-hidden="true">
          kort
        </span>
      </span>
    </>
  );
  const label = `${d.playerName}, ${state}. ${total} gula kort den här säsongen.`;
  if (!onOpen) {
    return (
      <div className={`cstat ${severity}`} aria-label={label} data-testid={severity === "suspended" ? "suspended-player" : "at-risk-player"}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`cstat ${severity} cstat-tap`}
      onClick={onOpen}
      aria-label={`${label} Visa uppgifter.`}
      data-testid={severity === "suspended" ? "suspended-player" : "at-risk-player"}
    >
      {inner}
    </button>
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
