/**
 * Branded 1200x630 SVG title cards, written to static/images/<dir>/<slug>.svg.
 * Used by brief-posts.mjs, city-posts.mjs and covers-pages.mjs so every page has a relevant image.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://openinkhub.io";
const E = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const wrap = (t, n) => t.split(" ").reduce((ls, w) => {
  const l = ls[ls.length - 1];
  if (l && (l + " " + w).length <= n) ls[ls.length - 1] = l + " " + w; else ls.push(w);
  return ls;
}, []);

/** Write the card and return a featured_image record ({src, alt, width, height}). */
export function makeCover({ dir, slug, title, label }) {
  const lines = wrap(title, 30).slice(0, 4), y0 = 315 - (lines.length - 1) * 38;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${E(title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1424"/><stop offset="1" stop-color="#0352a3"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/><circle cx="1080" cy="110" r="180" fill="#046bd2" opacity=".25"/><circle cx="1130" cy="560" r="120" fill="#eef5fd" opacity=".08"/>
<text x="80" y="110" fill="#9cc6f5" font-family="Segoe UI,Arial,sans-serif" font-size="26" font-weight="600" letter-spacing="2">${E(label.toUpperCase())}</text>
${lines.map((l, i) => `<text x="80" y="${y0 + i * 76}" fill="#fff" font-family="Segoe UI,Arial,sans-serif" font-size="60" font-weight="700">${E(l)}</text>`).join("\n")}
<text x="80" y="560" fill="#cfe3fa" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="600">openink Hub</text></svg>\n`;
  const out = path.join(ROOT, "static", "images", dir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${slug}.svg`), svg);
  return { src: `${BASE}/images/${dir}/${slug}.svg`, alt: title, width: 1200, height: 630 };
}

/** <figure> markup for placing the cover inside the content (so it counts as a content image). */
export const coverFigure = (img) => `<figure><img src="${img.src}" alt="${E(img.alt)}" width="${img.width}" height="${img.height}"></figure>`;
