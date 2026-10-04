---
name: liquid-glass-tab-bar
description: Build and debug a Liquid Glass-style floating bottom tab bar for a PWA — a fixed translucent bar with a glass indicator that tracks a finger and springs to the nearest tab. Use when adding or fixing a floating bottom navigation, a sliding/swiping tab indicator, a glassmorphic nav bar, thumb-reachable mobile tab bars, or when a tab indicator jumps, protrudes past the bar, clips, feels blurry, or when a swipe is swallowed by touch-action, link callouts or pointer capture. Covers CSS custom-property tokens, concentric indicator geometry, CDP touch e2e, and the traps that are invisible in desktop Chromium.
argument-hint: "Describe the destination list, the active-state source, and whether the indicator drags or the bar itself moves."
---

# Liquid Glass floating tab bar for PWAs

A fixed, translucent bottom bar with a glass "pill" indicator that follows the
thumb and springs to the nearest destination. Validated on a real iPhone in the
Min BKH-app PWA; every trap below was found by hardware testing, not by
reasoning, and each one is invisible in desktop Chromium.

## Interaction model (decide this first — it changes the geometry)

Two designs get confused constantly. They are not interchangeable.

| | **A. Indicator travels** | **B. The bar itself moves** |
|---|---|---|
| Gesture | tap, or horizontal swipe | long-press then drag anywhere |
| Moving thing | the indicator, inside a stationary bar | the whole bar |
| Anchor | the pill's last **rendered** position | the bar's stored position |
| Persistence | none needed | must survive reload |
| Finger must start on the bar | no | yes, or it conflicts with scroll |

Prefer **A** unless the bar is genuinely meant to float. B needs a persisted
position, a hold timer, an axis discriminator and a clamp to screen edges — four
extra mechanisms, each a defect surface (see *Traps*). A needs one.

## The tokens

Put every number in `:root` so the whole bar is retunable from one place.

```css
:root {
  --tabbar-h: 58px;        /* bar height; also feeds scroll clearance */
  --tabbar-gap: 16px;      /* distance from viewport edge to the bar */
  --tabbar-w: 330px;       /* WIDTH CEILING, see below */
  --tabbar-radius: 32px;   /* the bar's corner radius */

  /* Indicator inset from the bar's edges. This IS the visible gap. */
  --tabbar-pill-inset: 3px;

  /* Concentric: bar radius MINUS (inset + border). Not bar-minus-inset. */
  --tabbar-pill-radius: 28px;   /* 32 - (3 + 1) with a 1px border */

  /* Glass */
  --tabbar-surface: rgba(42, 44, 48, 0.62);
  --tabbar-surface-opaque: rgba(38, 40, 44, 0.95);  /* no-backdrop-filter */
  --tabbar-pill: rgba(255, 255, 255, 0.16);
  --tabbar-pill-edge: rgba(255, 255, 255, 0.34);
  --tabbar-blur: blur(20px) saturate(1.5);
  --tabbar-pill-blur: blur(8px) saturate(1.8);
}
```

**`--tabbar-w` is a CEILING, not a preference.** Use
`width: min(var(--tabbar-w), calc(100% - var(--tabbar-gap) * 2))`. An earlier
version set it to the full band between margins, which left *zero* horizontal
travel for a movable bar. Any token described as a travel budget must go if the
bar stops travelling — dead tokens hide bugs.

**Scale the bar as one unit.** Height, width, icon size and label size are one
decision. Scaling only some reads as a mistake. But see *Blurry upscaling* —
there is a ceiling on how far you scale rasterised assets.

**Derive scroll clearance from the height.** `--chrome-bottom: calc(var(--tabbar-h) + var(--tabbar-gap) * 2 + env(safe-area-inset-bottom, 0px))`,
and apply it once, to the scroll container's content padding. Never to both the
scroller and the content — that leaves a dead strip and makes the bar read as an
opaque full-width tab bar.

## Indicator geometry: measure the PADDING box, inset the stops

This is where the visual bugs live.

```js
// Correct: clientWidth is the padding box — inside the border.
trackW = nav.clientWidth;

// WRONG: offsetWidth is the BORDER box. The last stop overshoots by 2x the
// border width and the pill's corners reach outside the bar's rounded corner.
trackW = nav.offsetWidth;

// Inset from the CSS so there is one source of truth.
const inset = parseFloat(getComputedStyle(pill).top) || 0;

// One tab wide, NARROWED by the inset each side (not shifted) so it stays
// centred on its tab's icon.
pillW = item.offsetWidth - inset * 2;
pill.style.width = `${pillW}px`;

// `left` stays at its CSS default of 0. Applying the inset in BOTH `left` and
// the stops double-counts it and knocks the pill off-centre by the inset.
pill.style.left = "0";

stops = tabStops(count, trackW, pillW, inset);
```

```js
function tabStops(count, trackWidth, indicatorWidth, inset = 0) {
  if (count <= 0) return [inset];
  const usable = Math.max(0, trackWidth - indicatorWidth - inset * 2);
  if (count === 1 || usable === 0) return new Array(count).fill(inset);
  const step = usable / (count - 1);
  return new Array(count).fill(0).map((_, i) => inset + i * step);
}
```

`inset` must be non-zero **and** smaller than the bar's radius, or the indicator
protrudes through the corner. Clamping a drag must use the same bounds.

## Concentric indicator: radius − (inset + border)

For the indicator to look like a band cut from the bar rather than a lozenge
floating inside it, both curves must share a centre:

```
bar radius  R
inset       I   (CSS top/bottom)
border      B
indicator radius = R − (I + B)
```

Getting this wrong by 1px is invisible in a screenshot and exactly the
"it doesn't quite follow the border" complaint. **Never use
`border-radius: 999px`** — that is a stadium, fully rounded ends, which pulls in
from the bar's curve at the corners.

Verify by measurement, not by eye:

```js
const nr = parseFloat(getComputedStyle(nav).borderTopLeftRadius);
const pr = parseFloat(getComputedStyle(pill).borderTopLeftRadius);
const gap = Math.abs(nav.getBoundingClientRect().top - pill.getBoundingClientRect().top);
assert(Math.abs((nr - pr) - gap) < 1.5);   // curves share a centre
```

**Only measure the edges the indicator actually touches.** An interior tab is
nowhere near the bar's left or right wall, so reading those there reports the
distance to the far side of the bar and looks like a catastrophic failure.

## Glass, and reading "too grey"

The problem is rarely the alpha. It is the **surface tone**. Over a `#000` page a
dark translucent layer resolves to near-black and reads as a solid plate.

Measure mean luminance and spread *inside* the bar with real content behind it:

```
variant                        mean lum   spread   reads as
A  rgba(38,40,44,0.50)            23.0       6.0    black plate
B  rgba(35,35,38,0.82)            30.0       2.0    grey plate, content lost
C  rgba(42,44,48,0.62)            29.1       4.0    lifted surface  <-- use this
```

Low spread means the content behind is no longer modulating the surface — the
opposite of the intent. B separates best from the page but is nearly opaque.

Declare the opaque colour **first**, then the blur as a progressive enhancement:

```css
.tabbar { background: var(--tabbar-surface-opaque); }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tabbar { background: var(--tabbar-surface); backdrop-filter: var(--tabbar-blur); }
}
```

Skip SVG displacement filters (`backdrop-filter: url(...)`). Safari does not
support them, so Chromium and iOS would look different, and it forces a
full-screen filter repaint on every frame of a drag.

## Touch-action: `pan-y`, declared on every hit target

`touch-action: none` on a bottom bar **swallows vertical page scrolling** for
any drag starting on it. Use `pan-y` everywhere.

`touch-action` is not an inherited property, but for panning the browser
intersects the hit-tested element with each ancestor up to the nearest scroll
container. So a value on the container does constrain descendant touches — but
the element a thumb *visually* lands on may be something else entirely.

**Log what the finger actually hits.** This was the whole bug:

```
pointerdown  target = [object SVGAnimatedString]  touch-action = auto
```

The `<svg>` inside the icon computed to `auto`, so a vertical drag on the bar
scrolled the content 0px while the same drag in the content area scrolled 225px.
Fixes, both worth applying: declare `pan-y` on the icon span, **and**
`pointer-events: none` on the decorative SVG so it is never a hit target.

## Traps that are invisible in desktop Chromium

Each of these shipped to a real iPhone while passing every desktop test.

1. **The iOS link callout eats the gesture.** The bar is real `<a href>` links,
   so press-and-hold raises "Open in New Tab". WebKit then fires `pointercancel`
   and the gesture dies before it starts. `user-select: none` does **not** stop
   it — `-webkit-touch-callout: none` does, and it is **not inherited**, so it
   must be on the `<a>`, not just the container.
2. **Never call `setPointerCapture`.** Capturing to an ancestor makes the browser
   dispatch the synthesised `click` on the container instead of the link under
   the finger, killing every tap. Keep the native link-drag suppressed instead
   (`draggable={false}` + `onDragStart` → `preventDefault`): a real link starts a
   native drag the moment the pointer moves, which fires `dragstart` and removes
   the element from the pointer stream so `pointerup` never arrives.
3. **Bind move/up on `window`, not the element.** The finger can leave the bar
   entirely before release; an element-bound handler misses the end of the
   gesture.
4. **Swallow the click a swipe synthesises.** Capture phase +
   `stopPropagation`. Tear down on a **timer**, never `once: true` — a gesture
   often ends off the link it started on, so no click is dispatched at all and an
   `once` listener survives to eat the next real tap.
5. **A fixed bar outside the scroll container may not scroll.** It is a sibling
   of the scroller, so a touch on it has no scrollable ancestor. `pan-y` grants
   permission to something that may not exist. This is a layout question — record
   it, do not paper over it by hand-rolling a scroller.
6. **Blurry upscaling.** Scaling an SVG or text up rasterises it larger and it
   reads as a rendering fault. Scale the *container* (width, height, hit area),
   leave the glyph at its native size. Users report this as "broken", not
   "small".
7. **Re-grab anchors to the RENDERED position, never the target.** If a spring is
   mid-flight the pill is between two tabs; anchoring to the destination
   teleports it. Anchoring to `clientX` is worse — the pill jumps to the thumb on
   the first move (measured 65px). Trade-off: the pill tracks the finger's delta,
   so a swipe starting off-centre leaves a constant offset. No jump on touchdown
   beats perfect centring.

## Animation

Write the transform directly to the node via a ref. React state would re-render
every icon per frame, and a CSS transition on a property that changes every frame
restarts its easing every frame — measured at ~180ms of permanent lag behind the
thumb.

```js
const paint = (x) => { pill.style.transform = `translate3d(${x}px, 0, 0)`; };
```

Spring with fixed sub-steps and a clamped `dt`, or one stalled frame (backgrounded
tab, busy main thread) flings the indicator across the bar:

```js
const step = 1 / 120;
let remaining = Math.min(Math.max(dt, 0), 0.05);
while (remaining > 0) {
  const h = Math.min(remaining, step);
  const a = (k * (target - x) - c * velocity) / m;
  velocity += a * h; x += velocity * h; remaining -= h;
}
```

450 stiffness / 32 damping / mass 1 gives ~2.6px overshoot over 208px and ~433ms
to settle. That is a deliberate "breathe", not a bounce — assert
"no visible bounce", **not** zero overshoot; a zero-overshoot assertion forces
critical damping and a dead release.

Under `prefers-reduced-motion`, arrive immediately. The interaction is
untouched; only the travel is removed.

## Accessibility

- Real `<nav aria-label>` with real `<a href>` links — middle-click, long-press
  and keyboard then work for free.
- Active state on **three** signals, never colour alone: `aria-current="page"`,
  a heavier label weight, and a tint.
- The pill is `aria-hidden` — it conveys nothing `aria-current` does not.
- A decorative `<div class="tabbar-pill">` carries no accessible name, so a
  link's accessible name becomes "Spelare -" with a trailing separator. Do not
  nest one inside the anchor.
- Hit targets ≥44px in **both** axes. Measure, don't assume: `flex: 1 1 0` on the
  items means a narrow bar quietly shrinks every tab below the minimum.
- Unknown route → **no** icon active. Never fall back to "home"; the app would
  claim a URL it is not rendering.

## Testing

**Split the pure arithmetic out.** `tabStops`, `clampToTrack`, `nearestTab` and
the spring integrator are pure functions and deserve a real unit suite — no
browser, no synthetic touch, no flakiness. Cover: clamping at both ends, ties
resolving to the lower index, `NaN`/zero-span collapse, and stability at an
absurd `dt`.

**Geometry is read from the app, never recomputed in the test.** An early version
derived the stops from `offsetWidth`, got 103 where the app had 104, and failed
on arithmetic rather than behaviour. Navigate to each tab and read where the
pill actually rests — that *is* the stop.

**Never hardcode a pixel bound.** A literal `206` silently becomes a false pass
when the bar resizes. Derive it from the rendered DOM.

**Gesture tests need real touch.** `page.mouse` emits synthetic *mouse* pointer
events; `touch-action` is only consulted for touch, so a mouse gesture sails
straight past the arbitration you are trying to test. Use CDP:

```js
const cdp = await ctx.newCDPSession(page);   // Chromium ONLY
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
// touchMove x10, then touchEnd with touchPoints: []
```

**`newCDPSession` throws in WebKit.** A WebKit run therefore dispatches synthetic
`PointerEvent`s, which exercise your logic and CSS but bypass the **native
gesture recogniser** — the layer that decides scroll-versus-drag and raises the
link callout. A green WebKit run is evidence about your logic, not about iOS.
Only hardware settles it. Say so in the test's docstring.

Assert the *page changed*, not just that the indicator moved — plus the
destination's own content is on screen. And assert the outer bar's bounding box
is unchanged while the indicator travels, or you will "fix" correct code.

## Common symptoms → cause

| Symptom | Cause |
|---|---|
| Indicator sticks out past the bar's corner | stops measured on `offsetWidth` (border box) |
| Indicator visibly off-centre | inset applied in both `left` and the stops, **or** radius forgot the border |
| Indicator looks like a lozenge, not a band | `border-radius: 999px` |
| Swipe does nothing on iOS | link callout → `-webkit-touch-callout: none` on the `<a>` |
| Taps do nothing | `setPointerCapture` was called |
| Bar drag dead on first move | native link drag not suppressed |
| Page won't scroll from the bar | `touch-action: none` |
| Vertical drag on bar scrolls nothing | SVG is the hit target; it computed `auto` |
| Swipe also fires the link | click not swallowed, or `once: true` tore down wrongly |
| Whole sheet overlaps the bar after a resize | child `max-height` ignores the bar's height |
| Icons/labels look blurry | container scaled, glyph rasterised up |