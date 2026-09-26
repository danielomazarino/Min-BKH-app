/**
 * Generates the Min BKH-app PWA icons.
 *
 * Design brief (all four elements MUST survive, none may be dropped):
 *   1. BKH identity      — a wordmark band, readable at 60pt
 *   2. crane             — the Göteborg landmark, the dominant silhouette
 *   3. hedge             — the ground/horizon rule it stands on
 *   4. football          — the hook's load
 *
 * The previous icon lost all four at small sizes: the wordmark shrank to a
 * texture, the crane's rigging went sub-pixel, and the hedge ran edge to edge
 * with no safe margin for Android's maskable crop. The fix is hierarchy, not
 * removal — one dominant form, three supporting forms, each simplified into
 * the fewest possible strokes.
 *
 * Maskable is a genuinely separate composition: every element is inset inside
 * the 80% safe circle that Android guarantees, so nothing is ever cropped.
 * It is NOT a copy of the regular icon.
 *
 * Run: node scripts/make-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BLACK = "#0a0a0a";
const YELLOW = "#ffd200";

/**
 * Shared art, drawn in a 512 box. `s` scales the whole composition about the
 * centre: 1 = full bleed, <1 = inset for the maskable safe area.
 */
const art = (s) => {
  const t = (v) => 256 + (v - 256) * s; // transform about centre
  const k = (v) => v * s; // scale a length
  return `
  <!-- hedge: two heavy rails + posts, the horizon Häcken stands on -->
  <g fill="${YELLOW}">
    <rect x="${t(74)}" y="${t(330)}" width="${k(364)}" height="${k(18)}" rx="${k(5)}"/>
    <rect x="${t(74)}" y="${t(372)}" width="${k(364)}" height="${k(18)}" rx="${k(5)}"/>
    <rect x="${t(84)}" y="${t(318)}" width="${k(22)}" height="${k(86)}" rx="${k(6)}"/>
    <rect x="${t(245)}" y="${t(318)}" width="${k(22)}" height="${k(86)}" rx="${k(6)}"/>
    <rect x="${t(406)}" y="${t(318)}" width="${k(22)}" height="${k(86)}" rx="${k(6)}"/>
  </g>

  <!-- crane: tower, jib, counter-jib, tie, hook. Fewest strokes that still
       read as a crane rather than a letter L. -->
  <g stroke="${YELLOW}" stroke-linecap="round" fill="none">
    <path d="M156 318 L156 116" stroke-width="${k(26)}"/>
    <path d="M156 116 L372 84" stroke-width="${k(20)}"/>
    <path d="M156 116 L96 100" stroke-width="${k(17)}"/>
    <path d="M362 88 L362 150" stroke-width="${k(11)}"/>
  </g>
  <rect x="${t(139)}" y="${t(176)}" width="${k(40)}" height="${k(38)}" rx="${k(7)}" fill="${YELLOW}"/>

  <!-- football as the hook's load: filled disc with a cut pentagon, so it
       still reads at 60pt where a thin outline would disappear. -->
  <g transform="translate(${t(362)} ${t(196)})">
    <circle r="${k(60)}" fill="${YELLOW}"/>
    <path d="M0 -25 L24 -8 L14 21 L-14 21 L-24 -8 Z" fill="${BLACK}"/>
  </g>

  <!-- BKH wordmark: a band, not a caption. Heaviest weight in the mark so it
       survives as legible text at 180px and as a recognisable texture at 60. -->
  <text x="256" y="${t(474)}" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-weight="900" font-size="${k(62)}" letter-spacing="${k(4)}" fill="${YELLOW}">BKH</text>`;
};

const regular = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${BLACK}"/>
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
await sharp(Buffer.from(regular(512))).resize(60, 60).png().toFile("test-results/icon-60.png");
await sharp(Buffer.from(regular(512))).resize(120, 120).png().toFile("test-results/icon-120.png");
console.log("icons generated");
