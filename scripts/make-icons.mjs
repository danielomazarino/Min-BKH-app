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
 * One plant stalk: a dense column of stacked leaf rows narrowing to a tip.
 * The user asked for MORE stalks that OVERLAP, so the stalks are drawn wider
 * and closer together than in the first attempt — neighbouring foliage
 * interlocks, reading as one hedge rather than four separate trees.
 */
const stalk = (x, base, h, w) => {
  const row = (yy, ww) =>
    `<path d="M${x} ${yy} q${-ww * 0.5} ${-h * 0.05} ${-ww} ${h * 0.1} q${ww * 0.45} ${h * 0.05} ${ww} ${-h * 0.1} Z" fill="${YELLOW}"/>` +
    `<path d="M${x} ${yy} q${ww * 0.5} ${-h * 0.05} ${ww} ${h * 0.1} q${-ww * 0.45} ${h * 0.05} ${-ww} ${-h * 0.1} Z" fill="${YELLOW}"/>`;
  const rows = 6;
  let out = `<rect x="${x - w * 0.07}" y="${base - h * 0.3}" width="${w * 0.14}" height="${h * 0.3}" fill="${YELLOW}"/>`;
  for (let i = 0; i < rows; i += 1) {
    const f = i / (rows - 1);
    out += row(base - h * (0.26 + f * 0.56), w * (0.62 - f * 0.28));
  }
  out += `<path d="M${x} ${base - h} l${w * 0.13} ${h * 0.14} l${-w * 0.13} ${h * 0.05} l${-w * 0.13} ${-h * 0.14} Z" fill="${YELLOW}"/>`;
  return out;
};

/**
 * Shared art, drawn in a 512 box. `s` scales the whole composition about
 * the centre: 1 = full bleed, <1 = inset for the maskable safe area.
 *
 * ENHANCED (user, 2026-10-07): a more detailed crane (lattice tower, jib
 * with tie lines, counter-jib, trolley and a real hook), a football that
 * actually reads as one (pentagon + curved seams) and sits ON the ground
 * line, the BKH wordmark centred in the open space between crane and ball,
 * and seven overlapping hedge stalks.
 */
const art = (s) => {
  const t = (v) => 256 + (v - 256) * s; // transform about centre
  const k = (v) => v * s; // scale a length
  const ground = t(438); // the ground bar's top edge
  const towerX = t(118);
  const jibTipX = t(436);
  const jibY = t(96);
  return `
  <!-- ground bar: the line everything stands on -->
  <rect x="${t(48)}" y="${ground}" width="${k(416)}" height="${k(14)}" fill="${YELLOW}"/>

  <!-- hedge: seven stalks, wide enough to overlap into one hedge -->
  <g>
    ${stalk(t(84), ground, k(104), k(58))}
    ${stalk(t(128), ground, k(122), k(64))}
    ${stalk(t(174), ground, k(108), k(60))}
    ${stalk(t(220), ground, k(128), k(66))}
    ${stalk(t(266), ground, k(110), k(60))}
    ${stalk(t(312), ground, k(124), k(64))}
    ${stalk(t(356), ground, k(104), k(58))}
  </g>

  <!-- crane: lattice tower, slewing unit, jib with tie lines, counter-jib,
       trolley cable and hook. Built from strokes so it stays crisp small. -->
  <g stroke="${YELLOW}" fill="none" stroke-linecap="round">
    <!-- tower: two rails + zigzag lattice -->
    <path d="M${towerX - k(13)} ${ground} L${towerX - k(9)} ${jibY}" stroke-width="${k(7)}"/>
    <path d="M${towerX + k(13)} ${ground} L${towerX + k(9)} ${jibY}" stroke-width="${k(7)}"/>
    <path d="M${towerX - k(12)} ${t(400)} L${towerX + k(12)} ${t(372)} M${towerX + k(12)} ${t(372)} L${towerX - k(12)} ${t(344)} M${towerX - k(12)} ${t(344)} L${towerX + k(12)} ${t(316)} M${towerX + k(12)} ${t(316)} L${towerX - k(12)} ${t(288)} M${towerX - k(12)} ${t(288)} L${towerX + k(12)} ${t(260)} M${towerX + k(12)} ${t(260)} L${towerX - k(12)} ${t(232)} M${towerX - k(12)} ${t(232)} L${towerX + k(12)} ${t(204)} M${towerX + k(12)} ${t(204)} L${towerX - k(12)} ${t(176)} M${towerX - k(12)} ${t(176)} L${towerX + k(12)} ${t(148)}" stroke-width="${k(5)}"/>
    <!-- slewing unit -->
    <path d="M${towerX - k(20)} ${jibY} L${towerX + k(20)} ${jibY}" stroke-width="${k(12)}"/>
    <!-- jib (long, to the right) and counter-jib (short, left) -->
    <path d="M${towerX} ${jibY} L${jibTipX} ${jibY + k(10)}" stroke-width="${k(9)}"/>
    <path d="M${towerX} ${jibY} L${towerX - k(52)} ${jibY + k(14)}" stroke-width="${k(8)}"/>
    <!-- jib under-bracing -->
    <path d="M${towerX + k(60)} ${jibY + k(2)} L${towerX + k(80)} ${jibY + k(26)} M${towerX + k(80)} ${jibY + k(26)} L${towerX + k(160)} ${jibY + k(6)} M${towerX + k(160)} ${jibY + k(6)} L${towerX + k(180)} ${jibY + k(28)} M${towerX + k(180)} ${jibY + k(28)} L${towerX + k(250)} ${jibY + k(9)}" stroke-width="${k(4)}"/>
    <!-- tie lines from an apex mast down to both jibs -->
    <path d="M${towerX} ${jibY - k(34)} L${jibTipX} ${jibY + k(10)} M${towerX} ${jibY - k(34)} L${towerX - k(52)} ${jibY + k(14)} M${towerX} ${jibY - k(34)} L${towerX} ${jibY}" stroke-width="${k(5)}"/>
    <!-- trolley cable down from the jib tip -->
    <path d="M${jibTipX} ${jibY + k(10)} L${jibTipX} ${t(150)}" stroke-width="${k(6)}"/>
  </g>
  <!-- the hook: an open crane hook on the cable -->
  <path d="M${jibTipX} ${t(150)} a${k(11)} ${k(11)} 0 1 1 ${k(1)} ${k(20)} a${k(13)} ${k(13)} 0 1 0 ${k(-1)} ${k(-20)}"
        fill="none" stroke="${YELLOW}" stroke-width="${k(9)}" stroke-linecap="round"/>
  <!-- counterweight on the counter-jib -->
  <rect x="${towerX - k(58)}" y="${jibY + k(14)}" width="${k(26)}" height="${k(20)}" fill="${YELLOW}"/>

  <!-- BKH wordmark: centred in the open space between the crane tower and
       the football, above the hedge — the composition's visual centre. -->
  <text x="${t(268)}" y="${t(286)}" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-weight="900" font-size="${k(88)}" letter-spacing="${k(2)}" fill="${YELLOW}">BKH</text>

  <!-- football: ON the ground line (its bottom touches the bar), a real
       ball — centre pentagon, five curved seams to the edge. -->
  <g transform="translate(${t(404)} ${t(438 - 62)})">
    <circle r="${k(62)}" fill="${YELLOW}"/>
    <path d="M0 -25 L24 -8 L15 21 L-15 21 L-24 -8 Z" fill="${BLACK}"/>
    <path d="M0 -62 L0 -25 M24 -8 L59 -19 M15 21 L37 51 M-15 21 L-37 51 M-24 -8 L-59 -19"
          stroke="${BLACK}" stroke-width="${k(6)}" fill="none"/>
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
