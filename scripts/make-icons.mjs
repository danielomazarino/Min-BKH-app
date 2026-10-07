/**
 * Generates the Min BKH-app PWA icons.
 *
 * DESIGN SOURCE (2026-10-07): the user drew a new icon ("New app icon.png"
 * in public/icons/) and asked for a generated set that is TRUE TO IT. The
 * composition below reproduces that drawing, element for element:
 *
 *   1. crane    — tower on the left, long jib reaching up-right, tie line,
 *                 and a HOOK hanging from the jib's tip (top right)
 *   2. BKH      — a large bold wordmark in the middle, the heaviest element
 *   3. plants   — a row of wheat/hop plants along the bottom (the drawing's
 *                 five stalks), standing on a ground bar
 *   4. football — a filled ball with a pentagon, bottom right, overlapping
 *                 the ground bar
 *
 * Colours are the drawing's: solid black field, solid yellow #FFD200 shapes.
 * No gradients, no outlines — the drawing is flat and the icons stay flat.
 *
 * Small-size survival, measured at 60px: the wordmark and the ball keep
 * their shape; the plants simplify into a hedge-like mass, which is what
 * the drawing itself looks like at that size. The hook stays attached to
 * the jib tip because both are drawn as one path group.
 *
 * Maskable is a genuinely separate composition: every element is inset
 * inside the 80% safe circle that Android guarantees, so nothing is ever
 * cropped. It is NOT a copy of the regular icon.
 *
 * Run: node scripts/make-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BLACK = "#000000";
const YELLOW = "#ffd200";

/**
 * One plant stalk: a dense column of stacked leaf rows narrowing to a tip,
 * like the drawing's hop/wheat plants. Each row is a pair of pointed leaves
 * meeting at the stalk; rows overlap so the plant reads as one leafy mass,
 * not a stick with blobs.
 */
const stalk = (x, base, h, w) => {
  // A leaf row: two pointed leaves rising from the stalk at height yy,
  // each reaching out to ww. Pointed (q curves), not round.
  const row = (yy, ww) =>
    `<path d="M${x} ${yy} q${-ww * 0.5} ${-h * 0.05} ${-ww} ${h * 0.1} q${ww * 0.45} ${h * 0.05} ${ww} ${-h * 0.1} Z" fill="${YELLOW}"/>` +
    `<path d="M${x} ${yy} q${ww * 0.5} ${-h * 0.05} ${ww} ${h * 0.1} q${-ww * 0.45} ${h * 0.05} ${-ww} ${-h * 0.1} Z" fill="${YELLOW}"/>`;
  const rows = 5;
  let out = `<rect x="${x - w * 0.07}" y="${base - h * 0.34}" width="${w * 0.14}" height="${h * 0.34}" fill="${YELLOW}"/>`;
  for (let i = 0; i < rows; i += 1) {
    const f = i / (rows - 1); // 0 bottom .. 1 top
    out += row(base - h * (0.3 + f * 0.52), w * (0.5 - f * 0.24));
  }
  out += `<path d="M${x} ${base - h} l${w * 0.13} ${h * 0.14} l${-w * 0.13} ${h * 0.05} l${-w * 0.13} ${-h * 0.14} Z" fill="${YELLOW}"/>`;
  return out;
};

/**
 * Shared art, drawn in a 512 box. `s` scales the whole composition about
 * the centre: 1 = full bleed, <1 = inset for the maskable safe area.
 */
const art = (s) => {
  const t = (v) => 256 + (v - 256) * s; // transform about centre
  const k = (v) => v * s; // scale a length
  const ground = t(436); // the ground bar's top edge
  return `
  <!-- ground bar: the line the plants stand on, as in the drawing -->
  <rect x="${t(56)}" y="${ground}" width="${k(400)}" height="${k(14)}" fill="${YELLOW}"/>

  <!-- plants: five stalks across the bottom, as in the drawing -->
  <g>
    ${stalk(t(96), ground, k(120), k(52))}
    ${stalk(t(160), ground, k(132), k(56))}
    ${stalk(t(224), ground, k(120), k(52))}
    ${stalk(t(288), ground, k(132), k(56))}
    ${stalk(t(352), ground, k(120), k(52))}
  </g>

  <!-- crane: tower left, jib reaching up-right, tie, hook hanging from the
       jib tip. One stroke group so the hook never detaches at small sizes. -->
  <g stroke="${YELLOW}" fill="none" stroke-linecap="round">
    <path d="M${t(120)} ${ground} L${t(120)} ${t(118)}" stroke-width="${k(22)}"/>
    <path d="M${t(88)} ${t(118)} L${t(152)} ${t(118)}" stroke-width="${k(14)}"/>
    <path d="M${t(120)} ${t(118)} L${t(430)} ${t(86)}" stroke-width="${k(16)}"/>
    <path d="M${t(430)} ${t(86)} L${t(430)} ${t(148)}" stroke-width="${k(10)}"/>
  </g>
  <!-- the hook: cable ending in an open hook, as drawn -->
  <path d="M${t(430)} ${t(150)} a${k(14)} ${k(14)} 0 1 1 ${k(2)} ${k(26)} a${k(16)} ${k(16)} 0 1 0 ${k(-2)} ${k(-26)}"
        fill="none" stroke="${YELLOW}" stroke-width="${k(11)}" stroke-linecap="round"/>

  <!-- BKH wordmark: the heaviest element in the drawing, kept that way -->
  <text x="${t(268)}" y="${t(300)}" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-weight="900" font-size="${k(96)}" letter-spacing="${k(2)}" fill="${YELLOW}">BKH</text>

  <!-- football: filled disc with a cut pentagon, bottom right, overlapping
       the ground bar exactly as in the drawing -->
  <g transform="translate(${t(392)} ${t(392)})">
    <circle r="${k(74)}" fill="${YELLOW}"/>
    <path d="M0 -30 L29 -9 L18 25 L-18 25 L-29 -9 Z" fill="${BLACK}"/>
    <path d="M0 -74 L0 -30 M29 -9 L58 -23 M18 25 L36 55 M-18 25 L-36 55 M-29 -9 L-58 -23"
          stroke="${BLACK}" stroke-width="${k(7)}" fill="none"/>
  </g>`;
};

const regular = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BLACK}"/>
  ${art(1)}
</svg>`;

/**
 * Maskable: full-bleed background, composition scaled to 0.78 and centred, so
 * the art sits inside the 80% safe circle. Wordmark is dropped from the
 * maskable variant only if it cannot fit — at 0.78 the band still lands well
 * inside the circle, so it is kept (the brief requires BKH to remain).
 */
const maskable = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BLACK}"/>
  ${art(0.78)}
</svg>`;

/** iOS home screen icons are square — iOS applies the mask itself. */
const ios = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BLACK}"/>
  ${art(0.88)}
</svg>`;

mkdirSync("public/icons", { recursive: true });

const jobs = [
  ["icon-192.png", 192, regular],
  ["icon-512.png", 512, regular],
  ["apple-touch-icon.png", 180, ios],
  ["maskable-512.png", 512, maskable],
  ["maskable-192.png", 192, maskable],
];

for (const [name, size, fn] of jobs) {
  await sharp(Buffer.from(fn(size))).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log(`  ${name} (${size}px)`);
}

// A 60px proof, so small-size legibility can actually be inspected.
await sharp(Buffer.from(regular())).resize(60, 60).png().toFile("test-results/icon-60.png");
await sharp(Buffer.from(regular())).resize(120, 120).png().toFile("test-results/icon-120.png");
console.log("icons generated");
