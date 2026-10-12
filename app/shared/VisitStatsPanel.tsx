/**
 * The visit-statistics section of the settings sheet.
 *
 * HONESTY FIRST (decision, 2026-10-12)
 * ------------------------------------
 * These numbers are counted ON THIS DEVICE ONLY. There is no analytics
 * backend, nothing leaves the phone, and the section says so in its first
 * line — a per-device count presented as site statistics would be an
 * invented fact. The user can clear their own data with one tap.
 *
 * WHAT IS SHOWN
 *   - Totals per destination over the retained window (90 days)
 *   - The last 7 days, day by day, so a change in habit is visible
 *   - Sheets are not counted: they are overlays, not visits.
 */
import { useState } from "react";
import {
  readVisitStats,
  totalsFor,
  activeDays,
  clearVisitStats,
  dayLabel,
  type VisitStats,
} from "./visitStats";

/** The five destinations, in tab-bar order, so the list matches the app. */
const DESTINATION_ORDER = ["Hem", "Nyheter", "Matcher", "Trupp", "Spelare"] as const;

/** How many recent days the day-by-day list shows. */
const RECENT_DAYS = 7;

export function VisitStatsPanel() {
  const [stats, setStats] = useState<VisitStats>(() => readVisitStats());
  const totals = totalsFor(stats);
  const days = activeDays(stats);
  const totalVisits = Object.values(totals).reduce((a, b) => a + b, 0);
  const recent = stats.days.slice(-RECENT_DAYS).reverse();
  const hasData = totalVisits > 0;

  return (
    <div className="stack-3" data-testid="visit-stats">
      <p className="small dim">
        Räknas <strong>på den här enheten bara</strong> — appen skickar ingenting
        någonstans, så det här är din egen användning, inte sajtens besöksstatistik.
        {hasData
          ? ` ${totalVisits} öppningar på ${days} ${days === 1 ? "dag" : "dagar"}.`
          : ""}
      </p>

      {!hasData ? (
        <p className="small dim" data-testid="visit-stats-empty">
          Inga besök registrerade ännu.
        </p>
      ) : (
        <>
          <div className="srcrow" role="group" aria-label="Besök per sida">
            <span className="nm">Sida</span>
            <span className="rl">Besök</span>
          </div>
          {DESTINATION_ORDER.map((name) => (
            <div className="srcrow" key={name} data-testid={`visit-row-${name.toLowerCase()}`}>
              <span className="nm">{name}</span>
              <span className="rl">{totals[name] ?? 0}</span>
            </div>
          ))}

          {recent.length > 0 && (
            <>
              <div className="mod-label">Senaste {recent.length} dagarna</div>
              {recent.map((d) => {
                const dayTotal = Object.values(d.counts).reduce((a, b) => a + b, 0);
                const parts = DESTINATION_ORDER.filter((n) => (d.counts[n] ?? 0) > 0)
                  .map((n) => `${d.counts[n]} ${n}`)
                  .join(" · ");
                return (
                  <div className="srcrow" key={d.day}>
                    <span className="nm">
                      {dayLabel(d.day)}
                      <span className="msub">{parts || "—"}</span>
                    </span>
                    <span className="rl">{dayTotal}</span>
                  </div>
                );
              })}
            </>
          )}

          <div>
            <button
              type="button"
              className="btn-quiet"
              data-testid="visit-stats-clear"
              onClick={() => {
                clearVisitStats();
                setStats({ days: [] });
              }}
            >
              Rensa min besöksstatistik
            </button>
          </div>
        </>
      )}
    </div>
  );
}
