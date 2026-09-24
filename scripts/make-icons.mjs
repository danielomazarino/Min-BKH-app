// Generates the Min BKH-app PWA icons: black/yellow crest with a Gothenburg
// crane, a hedge (hack) and a football - coherent composition, legible at
// small sizes. Run: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="100" fill="#0a0a0a"/>

  <!-- ground -->
  <rect x="70" y="396" width="372" height="12" rx="6" fill="#ffd200"/>

  <!-- hedge: clear horizontal slat fence with vertical posts -->
  <g fill="#ffd200">
    <rect x="80" y="336" width="352" height="16" rx="5"/>
    <rect x="80" y="364" width="352" height="16" rx="5"/>
    <rect x="80" y="322" width="14" height="74" rx="4"/>
    <rect x="196" y="322" width="14" height="74" rx="4"/>
    <rect x="262" y="322" width="14" height="74" rx="4"/>
    <rect x="418" y="322" width="14" height="74" rx="4"/>
  </g>

  <!-- crane: tower + jib + counterweight + hook, clearly recognizable -->
  <g stroke="#ffd200" stroke-linecap="round" fill="none">
    <path d="M150 396 L150 140" stroke-width="22"/>
    <path d="M150 140 L340 100" stroke-width="16"/>
    <path d="M150 140 L92 118" stroke-width="14"/>
    <path d="M150 100 L340 100" stroke-width="5" opacity="0.8"/>
    <path d="M150 100 L92 118" stroke-width="5" opacity="0.8"/>
    <path d="M330 104 L330 160" stroke-width="8"/>
    <path d="M322 160 a8 8 0 0 0 16 0" stroke-width="8"/>
  </g>
  <rect x="134" y="188" width="36" height="32" rx="6" fill="#ffd200"/>

  <!-- football: right side, above hedge line -->
  <g transform="translate(388 216)">
    <circle r="62" fill="#ffd200"/>
    <path d="M0 -26 L25 -8 L15 22 L-15 22 L-25 -8 Z" fill="#0a0a0a"/>
    <g stroke="#0a0a0a" stroke-width="7" fill="none">
      <path d="M0 -26 L0 -62"/>
      <path d="M25 -8 L58 -19"/>
      <path d="M-25 -8 L-58 -19"/>
      <path d="M15 22 L29 54"/>
      <path d="M-15 22 L-29 54"/>
    </g>
  </g>

  <!-- wordmark -->
  <text x="256" y="474" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="56" letter-spacing="6" fill="#ffd200">BKH</text>
</svg>`;

mkdirSync("public/icons", { recursive: true });

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  await sharp(Buffer.from(svg(512))).resize(size, size).png().toFile(`public/icons/${name}`);
}
console.log("icons generated");
