import type { AppDataState } from "../data";

export default function News({ state }: { state: AppDataState }) {
  if (state.status === "loading") return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />;
  if (state.status === "error") return <div className="empty">Kunde inte läsa data. Försök igen senare.</div>;

  const news = state.data.news;
  return (
    <div>
      <h1>Nyheter</h1>
      <p className="meta">Herrlagets nyheter från BK Häcken och svensk fotbollspress.</p>
      {news.length === 0 ? (
        <div className="card empty">Inga nyheter just nu — de dyker upp så snart källorna uppdateras.</div>
      ) : (
        news.map((n) => (
          <article className="card" key={n.id} data-testid="news-item">
            <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
              {n.title}
            </a>
            {n.summary && <p style={{ margin: "6px 0 0", color: "var(--bkh-text-dim)", fontSize: "0.9rem" }}>{n.summary}</p>}
            <p className="meta" style={{ margin: "6px 0 0" }}>
              {new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric" }).format(
                new Date(n.publishedAt),
              )}{" "}
              · {n.publisher}
            </p>
          </article>
        ))
      )}
    </div>
  );
}
