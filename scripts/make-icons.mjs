// Generates the Min BKH PWA icons: black/yellow crest with a Gothenburg crane,
// a hedge (häck) and a football. Run: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a0a0a"/>
  <!-- yellow ring -->
  <circle cx="256" cy="256" r="216" fill="none" stroke="#ffd200" stroke-width="20"/>
  <!-- gothenburg crane (left) -->
  <g stroke="#ffd200" stroke-width="18" stroke-linecap="round" fill="none">
    <path d="M120 340 L120 180"/>
    <path d="M120 180 L250 130"/>
    <path d="M120 180 L96 150"/>
    <path d="M250 130 L250 165"/>
  </g>
  <!-- hedge (häck) at bottom -->
  <g fill="#ffd200">
    <rect x="96" y="352" width="320" height="26" rx="8"/>
    <g>
      ${Array.from({ length: 9 }, (_, i) => `<path d="M${112 + i * 36} 352 l14 -34 l14 34 z"/>`).join("")}
    </g>
  </g>
  <!-- football (right) -->
  <g transform="translate(330 210)">
    <circle r="72" fill="#ffd200"/>
    <path d="M0 -30 L28 -9 L17 24 L-17 24 L-28 -9 Z" fill="#0a0a0a"/>
    <g stroke="#0a0a0a" stroke-width="8" fill="none">
      <path d="M0 -30 L0 -72"/>
      <path d="M28 -9 L66 -22"/>
      <path d="M-28 -9 L-66 -22"/>
      <path d="M17 24 L34 60"/>
      <path d="M-17 24 L-34 60"/>
    </g>
  </g>
  <!-- BKH wordmark -->
  <text x="256" y="470" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="64" fill="#ffd200">BKH</text>
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
