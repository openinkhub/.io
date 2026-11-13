/**
 * Verify dist/ against the URL inventory captured from the live WordPress site (content/urls.csv).
 * For every URL: the page exists at the identical path, and its <title>, meta description, canonical,
 * robots, og:title, og:image, JSON-LD block count match, with exactly one <h1>.
 * Exits non-zero on any problem (CI gate before deploy).
 *
 *   npm run verify
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const unescapeHtml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) =>
  g[0] === "#" ? String.fromCodePoint(g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : +g.slice(1))
    : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[g.toLowerCase()]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const meta = (doc, key) => {
  const m = new RegExp(`<meta (?:name|property)="${esc(key)}" content="([^"]*)"`).exec(doc);
  return m ? unescapeHtml(m[1]) : "";
};

const rows = parseCsv(fs.readFileSync(path.join(ROOT, "content", "urls.csv"), "utf8").replace(/^﻿/, ""));
const errors = [];
for (const r of rows) {
  const p = new URL(r.url).pathname || "/";
  const f = path.join(DIST, ...p.split("/").filter(Boolean), "index.html");
  if (!fs.existsSync(f)) { errors.push(`MISSING  ${r.url}`); continue; }
  const doc = fs.readFileSync(f, "utf8");
  const canon = /<link rel="canonical" href="([^"]*)"/.exec(doc);
  const checks = {
    title: [unescapeHtml(/<title>([\s\S]*?)<\/title>/.exec(doc)?.[1] ?? ""), r.title],
    description: [meta(doc, "description"), r.meta_description],
    canonical: [canon ? unescapeHtml(canon[1]) : "", r.canonical],
    robots: [meta(doc, "robots"), r.robots],
    "og:title": [meta(doc, "og:title"), r.og_title],
    "og:image": [meta(doc, "og:image"), r.og_image],
    "json-ld blocks": [String(doc.split('type="application/ld+json"').length - 1), r.jsonld_blocks],
  };
  for (const [k, [got, want]] of Object.entries(checks)) {
    if (got.trim() !== want.trim()) errors.push(`MISMATCH ${r.url}  ${k}: got ${JSON.stringify(got.slice(0, 80))} want ${JSON.stringify(want.slice(0, 80))}`);
  }
  const h1s = doc.split("<h1").length - 1;
  if (h1s !== 1) errors.push(`H1 COUNT ${r.url}  ${h1s}`);
}
for (const extra of ["sitemap.xml", "robots.txt", "CNAME", "404.html"]) {
  if (!fs.existsSync(path.join(DIST, extra))) errors.push(`MISSING  /${extra}`);
}
console.log(`checked ${rows.length} URLs: ${errors.length} problem(s)`);
for (const e of errors.slice(0, 60)) console.log("  " + e);
process.exit(errors.length ? 1 : 0);
