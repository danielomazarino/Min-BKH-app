/**
 * Sheet — the single detail surface in the app.
 *
 * Behaviour contract (all of it verified by sheet.test.tsx):
 *  - Focus moves INTO the sheet when it opens, and is RESTORED to the element
 *    that opened it when it closes. (The old implementation had neither,
 *    despite `aria-modal="true"` — a keyboard user could tab straight out.)
 *  - Tab cycles within the sheet only (focus trap).
 *  - Escape closes.
 *  - The backdrop is a real <button> with an accessible name, so dismissal is
 *    keyboard-reachable. (The old one was a clickable <div role="presentation">
 *    — invisible to a keyboard user.)
 *  - Dragging the grabber down dismisses, but this is NEVER the only way out.
 *
 * Dismissal paths: grabber drag, backdrop click, backdrop keyboard activation,
 * Escape, and the iOS back gesture (the caller keeps hash state).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Drag past this many px downward and the sheet dismisses on release. */
const DISMISS_PX = 96;
/** Downward movement needed before we claim the gesture as a drag, not a scroll. */
const DRAG_GUARD = 8;

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  headExtra,
  labelledBy,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  headExtra?: ReactNode;
  labelledBy?: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [dragY, setDragY] = useState(0);
  // `mode` is null until the first significant movement:
  //  - "drag"   the sheet owns the gesture and follows the finger
  //  - "scroll" we claimed the gesture, so we must scroll the body ourselves
  const dragRef = useRef<{
    startY: number;
    pointerId: number;
    mode: null | "drag" | "scroll";
    fromScrollTop: number;
  }>({ startY: 0, pointerId: -1, mode: null, fromScrollTop: 0 });

  const bodyRef = useRef<HTMLDivElement>(null);

  /**
   * `touch-action` decides whether the BROWSER may claim a vertical pan, and it
   * is evaluated once, when the finger lands — before any of our handlers run.
   * So a static `pan-y` on the body means a downward drag on the body is
   * always eaten by the scroller and the sheet never moves, which is exactly
   * the reported bug.
   *
   * The rule instead follows the platform convention: while the body is
   * scrolled to the top the sheet claims the gesture, and once there is
   * content to scroll the body takes it back. `data-at-top` is kept in sync on
   * every scroll, so the two never disagree.
   */
  const syncAtTop = useCallback(() => {
    const body = bodyRef.current;
    if (body) body.dataset.atTop = String(body.scrollTop <= 0);
  }, []);

  useEffect(() => {
    syncAtTop();
    const body = bodyRef.current;
    if (!body) return;
    body.addEventListener("scroll", syncAtTop, { passive: true });
    return () => body.removeEventListener("scroll", syncAtTop);
  }, [syncAtTop]);

  // Remember what had focus BEFORE we move focus into the sheet.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const first = sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? sheetRef.current)?.focus();
    return () => {
      // Prefer the exact control that opened the sheet.
      //
      // Two cases make that impossible, and both are normal here:
      //   1. The opener has been unmounted. Opening a match detail from
      //      Brief navigates, so Brief — and the button — are gone before
      //      the sheet ever closes.
      //   2. The recorded element is <body>, which happens when the previous
      //      route was already torn down. body.focus() is a silent no-op, so
      //      calling it achieves nothing and leaves focus nowhere.
      // Falling back to <main> (focusable by design) gives screen-reader
      // users a real, meaningful stopping point instead of the document root.
      const el = restoreRef.current;
      const usable =
        el && el !== document.body && el !== document.documentElement && document.contains(el);
      if (usable) {
        el.focus();
        return;
      }
      const main = document.getElementById("main");
      if (main && document.contains(main)) main.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const list = Array.from(nodes).filter((n) => n.offsetParent !== null);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !sheetRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  /**
   * Drag-to-dismiss. Purely additive — never the only dismissal path.
   *
   * The gesture is owned by the WHOLE SHEET, not the 22px grabber. Human
   * testing showed the grabber-only version did nothing: a finger naturally
   * lands on the title or the body, and `touch-action: pan-y` let the browser
   * start a scroll instead, so the sheet stayed put and the page behind it
   * appeared to move. Because the whole sheet is now draggable, the sheet has
   * to decide between dragging itself and scrolling its own content.
   *
   * The rule matches the platform convention: once the body is scrolled away
   * from the top, a downward drag scrolls the content back first; only at the
   * top does it start pulling the sheet down. Upward drags always scroll.
   */
  const onDragStart = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const body = bodyRef.current;
    dragRef.current = {
      startY: e.clientY,
      pointerId: e.pointerId,
      mode: null,
      fromScrollTop: body?.scrollTop ?? 0,
    };
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.pointerId !== e.pointerId) return;
    const dy = e.clientY - d.startY;

    if (d.mode === null) {
      if (Math.abs(dy) < DRAG_GUARD) return;
      // The body only lets us own the gesture while it is at the top (see
      // `data-at-top`), so this branch is only reached for such a gesture.
      // Downward at the top moves the SHEET; anything else scrolls the body,
      // and since the browser will not scroll for us here we must do it.
      d.mode = dy > 0 ? "drag" : "scroll";
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }

    if (e.cancelable) e.preventDefault();

    if (d.mode === "scroll") {
      const body = bodyRef.current;
      if (body) {
        body.scrollTop = d.fromScrollTop - dy;
        syncAtTop();
      }
      return;
    }
    setDragY(dy > 0 ? dy : dy * 0.2); // resist upward drag
  };

  const endDrag = (commitIt: boolean) => {
    const d = dragRef.current;
    if (commitIt && d.mode === "drag" && dragY >= DISMISS_PX) onClose();
    d.mode = null;
    d.pointerId = -1;
    setDragY(0);
  };

  const headingId = labelledBy ?? "sheet-title";

  return (
    <div className="sheet-backdrop" data-testid="sheet-backdrop">
      {/* A real button: dismissal is keyboard-reachable and has a name. */}
      <button
        type="button"
        className="sr-only"
        aria-label="Stäng"
        onClick={onClose}
        data-testid="sheet-dismiss"
      />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        data-testid="sheet"
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      >
        {/* The grabber stays as an affordance — it is the conventional place a
            user looks for the handle — but it no longer owns the gesture. */}
        <div className="sheet-grab" aria-hidden="true" data-testid="sheet-grab" />
        <div className="sheet-head">
          <h2 id={headingId}>
            {title}
            {subtitle ? <span className="sub"> · {subtitle}</span> : null}
          </h2>
          {headExtra}
          {/* Explicit close: dismissal must not depend on a gesture. */}
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={`Stäng ${title}`}
            data-testid="sheet-close"
          >
            <X aria-hidden />
          </button>
        </div>
        <div className="sheet-body" ref={bodyRef} data-at-top="true">
          {children}
        </div>
      </div>
    </div>
  );
}
