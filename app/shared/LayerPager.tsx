/**
 * LayerPager — horizontal swipe between the Home layers.
 *
 * Design contract:
 *  - Every layer is reachable by TAPPING a dot, by keyboard (Arrow keys), and by
 *    the iOS back gesture when the caller syncs to hash state. The swipe is an
 *    accelerator, never the only route.
 *  - `aria-current` on the dot conveys position to assistive tech, so reducing
 *    motion (which removes the slide animation) loses no information.
 *  - Only a clearly-dominant horizontal drag starts a swipe, so a vertical
 *    finger scroll is never hijacked.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const SWIPE_RATIO = 0.5; // must travel half the layer width to commit
const AXIS_GUARD = 12; // px of ambiguity before we decide the axis

export function LayerPager({
  layers,
  index,
  onChange,
}: {
  layers: Array<{ id: string; label: string; render: () => ReactNode }>;
  index: number;
  onChange: (i: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [free, setFree] = useState(false);
  const drag = useRef<{ startX: number; startY: number; axis: "none" | "x" | "y"; width: number }>({
    startX: 0,
    startY: 0,
    axis: "none",
    width: 0,
  });

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(layers.length - 1, next));
      if (clamped !== index) onChange(clamped);
    },
    [index, layers.length, onChange],
  );

  const onDown = (e: React.PointerEvent) => {
    // Ignore drags that start on a rail — those scroll horizontally already.
    const t = e.target as HTMLElement;
    if (t.closest(".rail")) return;
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      axis: "none",
      width: trackRef.current?.offsetWidth ?? window.innerWidth,
    };
    setFree(true);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.width) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.axis === "none") {
      if (Math.abs(dx) < AXIS_GUARD && Math.abs(dy) < AXIS_GUARD) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (d.axis !== "x") return; // let the page scroll vertically
    // Rubber-band at the ends so the pager feels bounded, not broken.
    const atStart = index === 0 && dx > 0;
    const atEnd = index === layers.length - 1 && dx < 0;
    setDragX(atStart || atEnd ? dx * 0.25 : dx);
  };

  const onUp = () => {
    const d = drag.current;
    if (d.axis === "x" && Math.abs(dragX) > d.width * SWIPE_RATIO) {
      go(index + (dragX < 0 ? 1 : -1));
    }
    drag.current.axis = "none";
    setDragX(0);
    setFree(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(layers.length - 1);
    }
  };

  // Keep the track aligned when the viewport changes (rotation, desktop resize).
  useEffect(() => {
    const onResize = () => setDragX(0);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const offset = `calc(${-index * 100}% + ${dragX}px)`;

  return (
    // The key handler lives on the pager WRAPPER, not the track: the dot
    // tablist is a sibling of the track, so focusing a dot (the keyboard
    // entry point) would otherwise never reach the handler.
    <div className="pager" onKeyDown={onKeyDown} data-testid="pager">
      <div
        ref={trackRef}
        className={`pager-track${free ? " free" : ""}`}
        style={{ transform: `translateX(${offset})` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        data-testid="pager-track"
      >
        {layers.map((l, i) => (
          <div
            key={l.id}
            ref={(el) => {
              // React 18 does not support the `inert` prop (it is silently
              // dropped), so it must be set as a DOM property. Without this,
              // off-screen layers stay in the tab order while being
              // aria-hidden — a WCAG 2.4.3 failure and a screen-reader trap.
              if (el) el.inert = i !== index;
            }}
            className="pager-layer"
            data-testid={`pager-layer-${l.id}`}
            role="tabpanel"
            // A tabpanel is named by its tab, not by an inline label.
            aria-labelledby={`pager-tab-${l.id}`}
            aria-hidden={i !== index}
          >
            {l.render()}
          </div>
        ))}
      </div>
      <div className="pager-dots" role="tablist" aria-label="Välj vy">
        {layers.map((l, i) => (
          <button
            key={l.id}
            id={`pager-tab-${l.id}`}
            type="button"
            role="tab"
            aria-current={i === index}
            aria-selected={i === index}
            aria-label={l.label}
            onClick={() => go(i)}
            data-testid={`pager-dot-${l.id}`}
          />
        ))}
      </div>
    </div>
  );
}
