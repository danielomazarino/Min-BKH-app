/**
 * Nyheter — the men's-team news destination.
 *
 * Design intent: SCAN, not browse. The old brief-layer news rail forced a
 * supporter to swipe horizontally through 296px cards to see six headlines.
 * Here the four most recent stories are a 2x2 grid of small cards, and
 * everything older is a dense chronological list — so a whole week of news is
 * visible in roughly one and a half screens without any horizontal gesture.
 *
 * Data contract is unchanged: these are pipeline NewsEvents (already
 * deduplicated, men's-team only, with publisher + role + original URL per
 * source). Nothing about classification or provenance is decided here.
 */
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AppDataState } from "../data";
import type { NewsEvent } from "../../pipeline/src/types";
import { Sheet } from "../shared/Sheet";
import { fmtDay, groupLabel } from "../shared/format";
import { idFromSearch } from "../shared/nav";

/** How many stories get the visual grid at the top. 4 = one 2x2 block. */
const GRID_COUNT = 4;

export default function News({ state }: { state: AppDataState }) {
  const { search } = useLocation();
  const navigate = useNavigate();

  if (state.status === "loading") {
    return (
      <div className="layer" aria-busy="true" aria-label="Laddar" data-testid="news-page">
        <div className="module">
          <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="layer" data-testid="news-page">
        <div className="empty" role="status">
          <strong>Kunde inte läsa nyheterna</strong>
          Försök igen om en stund.
        </div>
      </div>
    );
  }

  const events = state.data.newsEvents ?? [];
  const grid = events.slice(0, GRID_COUNT);
  const rest = events.slice(GRID_COUNT);

  // The detail is a CHILD of /nyheter, so the back gesture closes the story
  // and leaves the reader exactly where they were in the list.
  const openId = idFromSearch(search);
  const open = openId ? (events.find((e) => e.id === openId) ?? null) : null;
  const openEvent = (e: NewsEvent) => navigate(`/nyheter?id=${encodeURIComponent(e.id)}`);
  const closeEvent = () => navigate("/nyheter");

  return (
    <div className="layer" data-testid="news-page">
      <h1 className="sr-only">Nyheter — BK Häcken herrar</h1>

      {events.length === 0 ? (
        <div className="module">
          <div className="mod-label">Nyheter</div>
          <p className="empty" data-testid="news-empty">
            <strong>Inga nyheter just nu</strong>
            De dyker upp så snart klubbens och pressens flöden uppdaterats.
          </p>
        </div>
      ) : (
        <>
          <section className="module" aria-labelledby="latest-h">
            <h2 className="mod-label" id="latest-h">
              Senast
              <span className="count"> · {events.length} nyheter</span>
            </h2>
            <div className="news-grid" data-testid="news-grid">
              {grid.map((e) => (
                <GridCard key={e.id} e={e} onOpen={() => openEvent(e)} />
              ))}
            </div>
          </section>

          {rest.length > 0 && (
            <section className="module" aria-labelledby="older-h">
              <h2 className="mod-label" id="older-h">
                Tidigare
              </h2>
              <ChronologicalList events={rest} onOpen={openEvent} />
            </section>
          )}
        </>
      )}

      {open && <NewsSheet event={open} onClose={closeEvent} />}
    </div>
  );
}

/** One small grid card: thumbnail, date, two-line headline, source. */
function GridCard({ e, onOpen }: { e: NewsEvent; onOpen: () => void }) {
  const publisher = e.sources.length === 1 ? e.sources[0].publisher : `${e.sources.length} källor`;
  return (
    <button
      type="button"
      className="ncard"
      onClick={onOpen}
      data-testid="news-card"
      aria-label={`${e.title}. ${publisher}`}
    >
      <span className="ncard-thumb">
        {e.imageUrl ? <img src={e.imageUrl} alt="" loading="lazy" decoding="async" /> : null}
      </span>
      <span className="ncard-body">
        <span className="ncard-meta">
          {fmtDay(e.latestPublishedAt || e.publishedAt)}
          {e.category === "women" ? " · Dam" : ""}
        </span>
        <span className="ncard-title">{e.title}</span>
        <span className="ncard-src">
          <SourceDots sources={e.sources} />
          {publisher}
        </span>
      </span>
    </button>
  );
}

/** Grouped by day so a long list is skimmable, not a wall of rows. */
function ChronologicalList({ events, onOpen }: { events: NewsEvent[]; onOpen: (e: NewsEvent) => void }) {
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: NewsEvent[] }> = [];
    for (const e of events) {
      const iso = e.latestPublishedAt || e.publishedAt;
      const key = iso.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, label: groupLabel(iso), items: [e] });
    }
    return out;
  }, [events]);

  return (
    <div data-testid="news-archive">
      {groups.map((g) => (
        <div key={g.key}>
          {g.label && <div className="group-label">{g.label}</div>}
          {g.items.map((e) => (
            <button type="button" className="news-row" key={e.id} onClick={() => onOpen(e)} data-testid="news-row">
              <span className="when">{fmtDay(e.latestPublishedAt || e.publishedAt)}</span>
              <span className="head">{e.title}</span>
              <span className="pub" aria-hidden="true">
                <SourceDots sources={e.sources} />
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Solid = primary, hollow = secondary. Spatial, so no legend is needed. */
export function SourceDots({ sources }: { sources: NewsEvent["sources"] }) {
  return (
    <>
      {sources.slice(0, 4).map((s, i) => (
        <i
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
function NewsSheet({ event, onClose }: { event: NewsEvent; onClose: () => void }) {
  const multi = event.sources.length > 1;
  return (
    <Sheet title={event.title} subtitle={fmtDay(event.latestPublishedAt || event.publishedAt)} onClose={onClose}>
      <div className="stack-3">
        {event.imageUrl && (
          <div className="news-thumb" style={{ borderRadius: 12 }}>
            <img src={event.imageUrl} alt="" />
          </div>
        )}
        {event.summary && (
          <p className="muted" data-testid="news-summary" style={{ margin: 0 }}>
            {event.summary}
          </p>
        )}
        <div>
          <div className="mod-label">{multi ? `${event.sources.length} källor` : event.sources[0]?.publisher}</div>
          <div data-testid="source-list">
            {event.sources.map((s) => (
              <a key={s.url} className="src" href={s.url} target="_blank" rel="noopener noreferrer" data-testid="source-link">
                <i className={`sdot ${s.role === "primary" ? "primary" : s.role === "secondary" ? "secondary" : ""}`} aria-hidden="true" />
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
