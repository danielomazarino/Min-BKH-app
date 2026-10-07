/**
 * Article audit — every headline the feeds delivered this run, and what the
 * pipeline decided about each one.
 *
 * WHY THIS EXISTS (user request, 2026-10-07)
 *   The counts ("3 av 20 behölls") say how many, never which. A maintainer
 *   checking validity needs the actual headlines per source, with the
 *   pipeline's verdict visible, so a wrong drop (B-012: the IFK Göteborg
 *   derby preview) can be spotted by eye instead of by writing probe scripts.
 *
 * DATA SOURCE
 *   `freshness.articleAudit` in app.json — written by the pipeline from the
 *   same inputs as the per-source counts, so the two can never disagree.
 *   Absent audit = the run predates the feature; that is stated, not faked.
 *
 * RELEVANCE MARKING
 *   verdict "kept" = the pipeline considered it BK Häcken herr-relevant (it
 *   survived BOTH the prefilter and the men's filter). "men-excluded" and the
 *   prefilter reasons are shown verbatim so a wrong reason is visible.
 */
import { useMemo, useState } from "react";
import type { ArticleAuditEntry } from "../../pipeline/src/types";

/** Verdict → short Swedish label + tone. */
function verdictLabel(v: string): { label: string; tone: "ok" | "warn" | "off" } {
  if (v === "kept") return { label: "Häcken herr", tone: "ok" };
  if (v === "men-excluded") return { label: "Ej herrlag", tone: "warn" };
  if (v === "outside date window") return { label: "För gammal", tone: "off" };
  if (v === "advertisement") return { label: "Reklam", tone: "off" };
  if (v === "no Häcken relation") return { label: "Ingen Häcken-koppling", tone: "off" };
  if (v === "general allsvenskan, no Häcken relation")
    return { label: "Allsvenskan i övrigt", tone: "off" };
  if (v === "over candidate cap") return { label: "Över taket", tone: "warn" };
  return { label: v, tone: "off" };
}

function AuditRow({ a }: { a: ArticleAuditEntry }) {
  const v = verdictLabel(a.verdict);
  const d = new Date(a.publishedAt);
  const day = Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(d);
  return (
    <li className={`auditrow tone-${v.tone}`}>
      <span className="audit-title">
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="link">
          {a.title}
        </a>
      </span>
      <span className="audit-meta">
        {day && <span className="audit-day">{day}</span>}
        <span className={`mpill ${v.tone === "ok" ? "mok" : v.tone === "warn" ? "mmeas" : "moff"}`}>
          {v.label}
        </span>
      </span>
    </li>
  );
}

export function ArticleAudit({ audit }: { audit: ArticleAuditEntry[] | undefined }) {
  const [filter, setFilter] = useState<"all" | "kept" | "dropped">("all");

  const bySource = useMemo(() => {
    const m = new Map<string, ArticleAuditEntry[]>();
    for (const a of audit ?? []) {
      const list = m.get(a.publisher) ?? [];
      list.push(a);
      m.set(a.publisher, list);
    }
    // Newest first within each source.
    for (const list of m.values()) {
      list.sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "sv"));
  }, [audit]);

  if (!audit || audit.length === 0) {
    return (
      <p className="small dim" data-testid="audit-unavailable">
        Artikelgranskning finns inte för den här körningen — den skrivs av
        nattjobbet från och med 2026-10-07.
      </p>
    );
  }

  const filtered = bySource.map(
    ([pub, items]) =>
      [
        pub,
        items.filter((a) =>
          filter === "all" ? true : filter === "kept" ? a.verdict === "kept" : a.verdict !== "kept",
        ),
      ] as const,
  );

  const keptTotal = audit.filter((a) => a.verdict === "kept").length;

  return (
    <div className="stack-3" data-testid="article-audit">
      <p className="small dim">
        Alla {audit.length} artiklar som flödena levererade i senaste körningen,
        per källa. <strong>Häcken herr</strong> = pipelinen bedömde den som
        relevant för herrlaget; övriga etiketter visar varför den slogs ut.
        Rubrikerna länkar till originalartikeln så att bedömningen kan
        kontrolleras.
      </p>
      <p className="small dim">
        {keptTotal} av {audit.length} bedömdes som Häcken herr.
      </p>

      <div className="auditfilter" role="group" aria-label="Filtrera artiklar">
        {(
          [
            ["all", "Alla"],
            ["kept", "Häcken herr"],
            ["dropped", "Utsektade"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "auditbtn on" : "auditbtn"}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.map(([pub, items]) =>
        items.length === 0 ? null : (
          <section key={pub} className="auditsec">
            <h3 className="mod-label">
              {pub}{" "}
              <span className="auditcount">
                {items.length}
                {filter === "all" && ` av ${bySource.find(([p]) => p === pub)![1].length}`}
              </span>
            </h3>
            <ul className="auditlist">
              {items.map((a) => (
                <AuditRow key={a.url} a={a} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}