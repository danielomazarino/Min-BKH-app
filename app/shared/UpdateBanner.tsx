/**
 * The update banner — a small, non-blocking prompt that a new version is
 * ready, with a one-tap update.
 *
 * WHY A BANNER AND NOT A FORCED RELOAD
 * ------------------------------------
 * A forced reload can interrupt a supporter mid-read, and on a slow connection
 * it can drop them into a blank screen. The banner lets them choose. It sits
 * above the tab bar so it never covers navigation, and it is dismissible so it
 * is never nagging — but it returns on the next check, because a stale app is
 * the thing the user explicitly does not want to be called about.
 */
export function UpdateBanner({
  show,
  onUpdate,
  onDismiss,
}: {
  show: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  if (!show) return null;
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <span className="update-banner-text">En ny version finns.</span>
      <button type="button" className="update-banner-btn" onClick={onUpdate} data-testid="update-now">
        Uppdatera
      </button>
      <button
        type="button"
        className="update-banner-dismiss"
        onClick={onDismiss}
        aria-label="Stäng"
        data-testid="update-dismiss"
      >
        ×
      </button>
    </div>
  );
}
