/**
 * Home — the supporter brief.
 *
 * Layer 1 (Översikt): the one hero, the latest result, form, and only the
 * discipline cases that actually matter. Target: ~1.2–1.5 phone screens, down
 * from the previous 2.6-screen card stack.
 *
 * Layer 2 (Nyheter): a snap rail of story cards, so news reads as part of the
 * brief rather than as a separate news website.
 *
 * Layer 3 (Mer): squad-in-context, table position, archive links.
 *
 * Horizontal swipe moves between layers; the dot indicator and Arrow keys are
 * the always-available equivalents. The current 2026 squad is NOT a list here —
 * it appears in match context, per the product's information model.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AppDataState } from "../data";
import type { AppData, MatchDetail, MatchEvents, MatchRef, NewsEvent, PlayerDiscipline } from "../../pipeline/src/types";
import { Sheet } from "../shared/Sheet";
import { LayerPager } from "../shared/LayerPager";
import {
  buildTimeline,
  competitionLabel,
  cstatFor,
  daysUntil,
  fmtDateTime,
  fmtDay,
  fmtTime,
  formGuide,
  RESULT_WORD,
  resultOf,
  scoreFor,
  scorerLine,
  urgentDiscipline,
  type TlItem,
} from "../shared/format";

export default function Home({
  state,
  onGoMatches,
  onGoNews,
}: {
  state: AppDataState;
  onOpenSettings: () => void;
  onGoMatches: () => void;
  onGoNews: () => void;
}) {
  const [layer, setLayer] = useState(0);
  const [resultSheet, setResultSheet] = useState<MatchDetail | null>(null);

  // Deep links: #/nyheter opens the news layer, #/ goes back to the overview.
  // This must be able to set the layer back to 0 as well, otherwise returning
  // to the brief leaves the news layer selected while the URL says otherwise.
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash;
      if (h.startsWith("#/nyheter")) setLayer(1);
      else if (h.startsWith("#/matcher")) onGoMatches();
      else setLayer(0);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [onGoMatches]);

  // ALL hooks must run before any early return, or the hook count changes
  // between the loading and ready renders and React throws (#310).
  const discipline = state.status === "ready" ? state.data.discipline : undefined;
  const urgent = useMemo(() => urgentDiscipline(discipline ?? []), [discipline]);

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

  const layers = [
    {
      id: "oversikt",
      label: "Översikt",
      render: () => (
        <OverviewLayer
          data={data}
          urgent={urgent}
          threshold={threshold}
          onOpenResult={() => data.lastMatchDetail && setResultSheet(data.lastMatchDetail)}
          onGoMatches={onGoMatches}
        />
      ),
    },
    {
      id: "nyheter",
      label: "Nyheter",
      render: () => <NewsLayer events={data.newsEvents ?? []} onGoNews={onGoNews} />,
    },
    {
      id: "mer",
      label: "Mer",
      render: () => <MoreLayer data={data} onGoMatches={onGoMatches} />,
    },
  ];

  return (
    <>
      <h1 id="brief-title" className="sr-only">
        Supporterbrief — BK Häcken
      </h1>
      <LayerPager layers={layers} index={layer} onChange={setLayer} />
      {resultSheet && (
        <MatchSheet detail={resultSheet} onClose={() => setResultSheet(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Layer 1 — Översikt
// ---------------------------------------------------------------------------

function OverviewLayer({
  data,
  urgent,
  threshold,
  onOpenResult,
  onGoMatches,
}: {
  data: AppData;
  urgent: PlayerDiscipline[];
  threshold: number;
  onOpenResult: () => void;
  onGoMatches: () => void;
}) {
  const form = formGuide(data.recent, 5);
  const suspended = urgent.filter((d) => d.status === "suspended_next" || d.status === "red_suspended");
  const atRisk = urgent.filter((d) => d.status === "at_risk");

  return (
    <div className="layer" data-testid="layer-oversikt">
      {data.currentDataUnavailable && (
        <p className="small muted" role="status" data-testid="current-data-unavailable" style={{ paddingTop: 12 }}>
          Aktuell matchdata saknas just nu. Senaste kända data visas.
        </p>
      )}

      {/* 1 — the hero. Exactly one per screen. */}
      <section className="module" style={{ paddingTop: 16 }}>
        <NextMatchHero next={data.nextMatch} form={form} />
      </section>

      {/* 2 — latest result, with the scorers the old UI never showed */}
      <section className="module" aria-labelledby="last-h">
        <h2 className="mod-label" id="last-h">
          Senast
        </h2>
        {data.lastResult ? (
          <ResultRow match={data.lastResult} events={data.lastMatchDetail?.events} onOpen={onOpenResult} />
        ) : (
          <p className="empty" style={{ padding: "8px 0" }}>
            Inget spelat resultat i den här säsongen ännu.
          </p>
        )}
      </section>

      {/* 3 — discipline, but ONLY the cases that matter */}
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
          <div data-testid="discipline">
            {suspended.slice(0, 2).map((d) => (
              <CstatRow key={d.playerId} d={d} threshold={threshold} />
            ))}
            {atRisk.slice(0, 3).map((d) => (
              <CstatRow key={d.playerId} d={d} threshold={threshold} />
            ))}
            <button type="button" className="mod-label" style={{ marginTop: 12 }} onClick={onGoMatches} data-testid="discipline-more">
              Alla matcher och kort
              <ChevronRight aria-hidden />
            </button>
          </div>
        )}
      </section>

      {/* 4 — table position, one line */}
      {data.tablePosition && (
        <section className="module" aria-labelledby="table-h">
          <h2 className="mod-label" id="table-h">
            Tabellen
          </h2>
          <p className="small muted" data-testid="table-position">
            <b style={{ color: "var(--text)", fontSize: 15 }}>{data.tablePosition.rank}:e</b> ·{" "}
            {data.tablePosition.points} poäng på {data.tablePosition.played} matcher ({" "}
            {data.tablePosition.goalDiff > 0 ? "+" : ""}
            {data.tablePosition.goalDiff})
          </p>
        </section>
      )}
    </div>
  );
}

function NextMatchHero({ next, form }: { next: MatchRef | null; form: Array<"w" | "d" | "l"> }) {
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
    <div className="hero" data-testid="next-match">
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
        <div
          className="form"
          role="img"
          aria-label={`Senaste ${form.length} matcher: ${form.map((f) => RESULT_WORD[f]).join(", ")}`}
        >
          {form.map((f, i) => (
            <span key={i} className={`r ${f}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  match,
  events,
  onOpen,
}: {
  match: MatchRef;
  events?: MatchEvents;
  onOpen: () => void;
}) {
  const score = scoreFor(match);
  const res = resultOf(match);
  const scorers = scorerLine(events);
  return (
    <button type="button" className="result" onClick={onOpen} data-testid="last-result" aria-label={`${match.opponent}, ${score ?? "resultat"}, ${fmtDateTime(match.date)}. Visa matchen.`}>
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

// ---------------------------------------------------------------------------
// Layer 2 — Nyheter
// ---------------------------------------------------------------------------

function NewsLayer({ events, onGoNews }: { events: NewsEvent[]; onGoNews: () => void }) {
  const [open, setOpen] = useState<NewsEvent | null>(null);
  // imageUrl now comes from the pipeline on NewsEvent itself.
  const images = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (e.imageUrl) m.set(e.id, e.imageUrl);
    return m;
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="layer" data-testid="layer-nyheter">
        <div className="module" style={{ paddingTop: 16 }}>
          <p className="empty">
            <strong>Inga nyheter just nu</strong>
            De dyker upp så snart klubbens och pressens flöden uppdaterats.
          </p>
        </div>
      </div>
    );
  }

  // Rail shows the LEAD stories; "Tidigare" must start AFTER the rail ends,
  // otherwise the same article appears twice on one layer.
  const RAIL_COUNT = 4;
  const railEvents = events.slice(0, RAIL_COUNT);
  const ordinary = events.slice(RAIL_COUNT, RAIL_COUNT + 10);

  return (
    <div className="layer" data-testid="layer-nyheter">
      <section className="module" style={{ paddingTop: 16 }}>
        <h2 className="mod-label">
          Nyheter
          <span className="count"> · {events.length}</span>
        </h2>
        <div className="rail" data-testid="news-rail">
          {railEvents.map((e, i) => (
            <button
              type="button"
              key={e.id}
              className={`news-card${i === 0 ? " wide" : ""}`}
              onClick={() => setOpen(e)}
              data-testid="news-card"
              aria-label={`${e.title}. ${e.sources.length === 1 ? e.sources[0].publisher : `${e.sources.length} källor`}`}
            >
              <span className="news-thumb">
                {images.get(e.id) && (
                  <img src={images.get(e.id)} alt="" loading="lazy" decoding="async" />
                )}
              </span>
              <span className="news-body">
                <span className="news-kicker">
                  {fmtDay(e.latestPublishedAt || e.publishedAt)}
                  {e.category === "women" ? " · Dam" : ""}
                </span>
                <span className="news-title">{e.title}</span>
                {e.summary && <span className="news-sum">{e.summary}</span>}
                <span className="news-src">
                  <SourceDots sources={e.sources} />
                  {e.sources.length === 1 ? e.sources[0].publisher : `${e.sources.length} källor`}
                  <svg className="go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M7 17 17 7M9 7h8v8" />
                  </svg>
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Ordinary stories collapse to one line each — 12 × 150px becomes ~44px. */}
      {ordinary.length > 0 && (
        <section className="module" aria-labelledby="more-news-h">
          <h2 className="mod-label" id="more-news-h">
            Tidigare
          </h2>
          <div>
            {ordinary.map((e) => (
              <button type="button" className="news-row" key={e.id} onClick={() => setOpen(e)} data-testid="news-row">
                <span className="when">{fmtDay(e.latestPublishedAt || e.publishedAt)}</span>
                <span className="head">{e.title}</span>
                <span className="pub" aria-hidden="true">
                  <SourceDots sources={e.sources} />
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="mod-label" style={{ marginTop: 12 }} onClick={onGoNews} data-testid="news-see-all">
            Alla nyheter
            <ChevronRight aria-hidden />
          </button>
        </section>
      )}

      {open && <NewsSheet event={open} image={images.get(open.id)} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Solid = primary, hollow = secondary. Spatial, so no legend is needed. */
function SourceDots({ sources }: { sources: NewsEvent["sources"] }) {
  return (
    <>
      {sources.slice(0, 4).map((s, i) => (
        <span
          key={s.url}
          className={`sdot ${s.role === "primary" ? "primary" : s.role === "secondary" ? "secondary" : ""}`}
          aria-hidden="true"
          data-testid={i === 0 ? "source-dot" : undefined}
        />
      ))}
    </>
  );
}

/**
 * Story detail. One event, one summary, the original articles underneath.
 * The "flera källor" claim is only made when the data actually has multiple
 * sources — Firecrawl is never shown as a source, only as discovery metadata.
 */
function NewsSheet({ event, image, onClose }: { event: NewsEvent; image?: string; onClose: () => void }) {
  const multi = event.sources.length > 1;
  return (
    <Sheet title={event.title} subtitle={fmtDay(event.latestPublishedAt || event.publishedAt)} onClose={onClose}>
      <div className="stack-3">
        {image && (
          <div className="news-thumb" style={{ borderRadius: 12 }}>
            <img src={image} alt="" />
          </div>
        )}
        {event.summary && (
          <p className="muted" data-testid="news-summary" style={{ margin: 0 }}>
            {event.summary}
          </p>
        )}
        <div>
          <div className="mod-label">
            {multi ? `${event.sources.length} källor` : event.sources[0]?.publisher}
          </div>
          <div data-testid="source-list">
            {event.sources.map((s) => (
              <a
                key={s.url}
                className="src"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="source-link"
              >
                <span className={`sdot ${s.role === "primary" ? "primary" : s.role === "secondary" ? "secondary" : ""}`} aria-hidden="true" />
                <span className="name">{s.publisher}</span>
                <span className="when">{fmtDay(s.publishedAt)}</span>
                <svg className="ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Layer 3 — Mer
// ---------------------------------------------------------------------------

function MoreLayer({ data, onGoMatches }: { data: AppData; onGoMatches: () => void }) {
  return (
    <div className="layer" data-testid="layer-mer">
      <section className="module" style={{ paddingTop: 16 }}>
        <h2 className="mod-label">Säsongen</h2>
        <button type="button" className="mod-label" style={{ width: "100%", textAlign: "left" }} onClick={onGoMatches} data-testid="goto-matches">
          Matcher &amp; tabell
          <ChevronRight aria-hidden />
        </button>
        {data.upcoming.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {data.upcoming.slice(0, 3).map((m) => (
              <UpcomingRow key={m.id} m={m} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function UpcomingRow({ m }: { m: MatchRef }) {
  return (
    <div className="mrow" data-testid="upcoming-row">
      <span className="score" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-3)" }}>
        {fmtDay(m.date)}
      </span>
      <span className="body">
        <span className="opponent">{m.opponent}</span>
        <span className="meta">
          {fmtTime(m.date)} · {m.homeAway === "home" ? "Hemma" : "Borta"}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match sheet — the event timeline the old UI never rendered
// ---------------------------------------------------------------------------

export function MatchSheet({ detail, onClose }: { detail: MatchDetail; onClose: () => void }) {
  const items = buildTimeline(detail.events);
  const score = scoreFor(detail);
  return (
    <Sheet
      title={`${detail.opponent}`}
      subtitle={`${score ?? ""} · ${fmtDay(detail.date)}`}
      onClose={onClose}
    >
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
        <span className="who">{item.who}</span>{" "}
        <span className="dim xsmall">{label}</span>
        {item.assist && <span className="assist">assist {item.assist}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function BriefSkeleton() {
  return (
    <div className="layer" aria-busy="true" aria-label="Laddar">
      <div className="module" style={{ paddingTop: 16 }}>
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
