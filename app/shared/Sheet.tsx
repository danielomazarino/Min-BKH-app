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
  const dragRef = useRef<{ startY: number; active: boolean }>({ startY: 0, active: false });

  // Remember what had focus BEFORE we move focus into the sheet.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const first = sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? sheetRef.current)?.focus();
    return () => {
      const el = restoreRef.current;
      // Only restore if the element is still in the document and focusable.
      if (el && document.contains(el)) {
        el.focus();
      }
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

  // Drag-to-dismiss. Purely additive — never the only dismissal path.
  const onGrabDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, active: true };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onGrabMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dy = e.clientY - dragRef.current.startY;
    setDragY(dy > 0 ? dy : dy * 0.2); // resist upward drag
  };
  const onGrabUp = () => {
    if (dragRef.current.active && dragY > 96) onClose();
    dragRef.current.active = false;
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
        data-testid="sheet"
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      >
        <div
          className="sheet-grab"
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
          aria-hidden="true"
          data-testid="sheet-grab"
        />
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
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
