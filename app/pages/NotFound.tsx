/**
 * NotFound — an explicit dead end.
 *
 * The old shell had a catch-all route that silently rendered Brief for any
 * unrecognised hash. That was the source of the "both tabs unhighlighted and
 * the URL lies" defect. An unknown route is now stated plainly, and the five
 * destinations stay reachable, so the user is never stranded.
 */
import { Link } from "react-router-dom";
import { DESTINATIONS } from "../shared/nav";

export default function NotFound() {
  return (
    <div className="layer" data-testid="not-found">
      <div className="module" style={{ paddingTop: 24 }}>
        <h1 className="mod-label">Sidan finns inte</h1>
        <p className="empty" style={{ padding: "0 0 8px" }}>
          <strong>Här finns ingen vy</strong>
          Länken pekade på något som inte längre finns i appen.
        </p>
        <nav aria-label="Genvägar" className="stack-2" data-testid="not-found-links">
          {DESTINATIONS.map((d) => (
            <Link key={d.path} to={d.path} className="mrow" data-testid={`notfound-${d.testId}`}>
              <span className="body">
                <span className="opponent">{d.label}</span>
              </span>
              <span className="ven" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
