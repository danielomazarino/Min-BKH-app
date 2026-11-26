/**
 * AboutSheet — "Om appen", opened by tapping the app icon.
 *
 * WHY IT EXISTS (user, 2026-11-26): the icon was a decorative <img>. Making it
 * a button needs somewhere to go, and "what is this app?" is the only honest
 * answer. It is also the right home for the build id, which used to sit in the
 * header where every supporter had to read past it.
 *
 * WHAT BELONGS HERE, AND WHAT DOES NOT
 * This is the identity card, not the diagnostics page. Data freshness, source
 * status and the measurement log already live in Settings → Data & källor, and
 * duplicating them here would recreate the "same numbers in two places" defect
 * that the settings rebuild removed. So: what the app is, who it is for, where
 * the data comes from, and which build is running.
 */
import { Sheet } from "./Sheet";

export function AboutSheet({
  buildId,
  onClose,
  onOpenSettings,
}: {
  buildId: string;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <Sheet title="Om appen" onClose={onClose} testId="about-sheet">
      <div className="stack-4">
        <section>
          <p className="small muted" style={{ marginTop: 0 }}>
            En supporterapp för BK Häckens herrlag. Nästa match, senaste resultatet,
            kortläget, tabellen och herrnyheter — samlat på ett ställe.
          </p>
          <p className="small dim">
            Appen är byggd för att läsas i handen: allt viktigt ska gå att nå med
            tummen, och inget ska kräva inloggning eller ett konto.
          </p>
        </section>

        <section>
          <div className="mod-label">Varifrån kommer datan?</div>
          <p className="small dim">
            Matchdata, trupp och tabell kommer från SportoMedia, som ligger bakom
            allsvenskan.se. Nyheterna hämtas från källornas egna RSS-flöden och
            filtreras så att bara Häcken-nyheter för herrlaget visas.
          </p>
          <p className="small dim">
            Inga API-nycklar finns i appen. Datan uppdateras en gång per natt.
          </p>
        </section>

        <section>
          <div className="mod-label">Om den här versionen</div>
          {/* The build id lives HERE now, not in the header. It is a
              diagnostic: it tells a maintainer whether the phone is running
              the build that was just deployed, or a cached older one. */}
          <p className="small dim" data-testid="about-build">
            Version <code className="build-id-inline">{buildId}</code>
          </p>
          <p className="small dim">
            Om appen ser ut att sakna en uppdatering är det oftast en cachad
            version. Stäng appen helt och öppna den igen.
          </p>
        </section>

        <p className="small dim">
          <button type="button" className="link" onClick={onOpenSettings} data-testid="about-to-settings">
            Inställningar och datakällor →
          </button>
        </p>
      </div>
    </Sheet>
  );
}
