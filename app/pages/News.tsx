import type { AppDataState } from "../data";
import type { NewsEvent } from "../../pipeline/src/types";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMin = Math.round((now - d.getTime()) / 60000);
  if (diffMin >= 0 && diffMin < 60) return `${diffMin} min sedan`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h sedan`;
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(d);
}

export default function News({ state }: { state: AppDataState }) {
  if (state.status === "loading") return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;
  if (state.status === "error") return <div className="empty">Kunde inte läsa data. Försök igen senare.</div>;

  const events: NewsEvent[] = state.data.newsEvents ?? [];
  return (
    <div>
      <h1>Nyheter</h1>
      <p className="meta">Händelser kring Häckens herrlag — flera källor, en story.</p>
      {events.length === 0 ? (
        <div className="card empty">Inga nyheter just nu — de dyker upp så snart källorna uppdateras.</div>
      ) : (
        events.map((ev) => (
          <article className="card" key={ev.id} data-testid="news-event">
            <h3 style={{ margin: "0 0 6px", fontSize: "1.02rem" }}>{ev.title}</h3>
            {ev.summary && (
              <p style={{ margin: "0 0 6px", color: "var(--bkh-text)", fontSize: "0.92rem" }} data-testid="news-summary">
                {ev.summary}
              </p>
            )}
            <p className="meta" style={{ margin: 0 }}>
              {fmtWhen(ev.publishedAt)}
              {ev.sources.length > 1 ? ` · ${ev.sources.length} källor` : ""}
            </p>
            <div className="pills" data-testid="source-pills">
              {ev.sources.map((s) => (
                <a
                  key={s.url}
                  className={`pill${s.role === "primary" ? " pill-primary" : ""}`}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${s.publisher} — öppna originalartikel`}
                  title={`${s.publisher} (${s.role === "primary" ? "primär källa" : s.role === "secondary" ? "sekundär bevakning" : "källa"})`}
                >
                  {s.publisher}
                </a>
              ))}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
