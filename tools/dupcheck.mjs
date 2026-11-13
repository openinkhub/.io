/**
 * Duplicate-content check for the city posts: 8-word shingle overlap between every pair,
 * computed on the article body only (site header/footer excluded).
 *
 *   npm run dupcheck            report
 *   npm run dupcheck -- 0.25    exit 1 if any pair overlaps more than 25%
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = path.join(ROOT, "content", "pages");
const limit = Number(process.argv[2]) || 0;
const recs = fs.readdirSync(PAGES).filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(fs.readFileSync(path.join(PAGES, n), "utf8")))
  .filter((r) => r.content_source === "city-posts");

const words = (h) => h.replace(/<[^>]+>/g, " ").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const shingles = (w) => { const s = new Set(); for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(" ")); return s; };
// remove the city's own name so "SEO in Pune" vs "SEO in Agra" boilerplate isn't hidden
const items = recs.map((r) => {
  const w = words(r.content_html.replaceAll(r.citylabel || "", " CITY "));
  return { path: r.path, n: w.length, s: shingles(w) };
});
const pairs = [];
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
  let x = 0; for (const a of items[i].s) if (items[j].s.has(a)) x++;
  pairs.push([x / Math.min(items[i].s.size, items[j].s.size), items[i].path, items[j].path]);
}
pairs.sort((a, b) => b[0] - a[0]);
const avg = pairs.reduce((t, p) => t + p[0], 0) / (pairs.length || 1);
const counts = new Map();
for (const it of items) for (const s of it.s) counts.set(s, (counts.get(s) || 0) + 1);
const common = [...counts].filter(([, c]) => c >= Math.max(3, items.length * 0.1)).sort((a, b) => b[1] - a[1]);
console.log(`${items.length} city posts, avg ${Math.round(items.reduce((t, i) => t + i.n, 0) / items.length)} words`);
console.log(`pairwise overlap: avg ${(avg * 100).toFixed(1)}%, max ${(pairs[0]?.[0] * 100 || 0).toFixed(1)}%`);
for (const [v, a, b] of pairs.slice(0, 8)) console.log(`  ${(v * 100).toFixed(1)}%  ${a}  ~  ${b}`);
console.log(`phrases shared by >=10% of posts: ${common.length}`);
for (const [s, c] of common.slice(0, 15)) console.log(`  ${c}x  "${s}"`);
if (limit && pairs[0]?.[0] > limit) process.exit(1);
