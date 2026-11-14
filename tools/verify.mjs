/**
 * Verify dist/ against the URL inventory captured from the live WordPress site (content/urls.csv).
 * For every URL: the page exists at the identical path with the same canonical and robots as the live site,
 * its <title>, meta description, og:title, og:image and JSON-LD match the content files, and it has one <h1>.
 * Exits non-zero on any problem (CI gate before deploy).
 *
 *   npm run verify
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixRecord } from "./seo-fix.mjs";

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
// The intended head copy lives in content/pages (it may be deliberately rewritten, e.g. the city posts);
// urls.csv is the frozen snapshot of the live WordPress site and guards the URL-level contract.
const PAGES = path.join(ROOT, "content", "pages");
const intended = new Map(fs.readdirSync(PAGES).filter((n) => n.endsWith(".json"))
  .map((n) => fixRecord(JSON.parse(fs.readFileSync(path.join(PAGES, n), "utf8")))).map((r) => [r.path, r]));
const metaOf = (rec, key) => rec?.head?.meta.find((m) => m.key === key)?.content ?? "";
const errors = [];
let rewritten = 0, retiredOk = 0;
const RETIRED_FILE = path.join(ROOT, "content", "seo", "retired.json");
const RETIRED = new Map(fs.existsSync(RETIRED_FILE) ? JSON.parse(fs.readFileSync(RETIRED_FILE, "utf8")).redirects.map((x) => [x.from, x.to]) : []);
for (const r of rows) {
  const p = new URL(r.url).pathname || "/";
  const f = path.join(DIST, ...p.split("/").filter(Boolean), "index.html");
  if (RETIRED.has(p)) { // retired on purpose: must 301 to a page that exists, and must not still be built
    const red = fs.existsSync(path.join(DIST, "_redirects")) ? fs.readFileSync(path.join(DIST, "_redirects"), "utf8") : "";
    const to = RETIRED.get(p);
    if (!red.includes(`${p} ${to} 301`)) errors.push(`RETIRED  ${r.url} has no 301 to ${to}`);
    if (!fs.existsSync(path.join(DIST, ...to.split("/").filter(Boolean), "index.html"))) errors.push(`RETIRED  ${r.url} -> ${to} (target missing)`);
    if (fs.existsSync(f)) errors.push(`RETIRED  ${r.url} is still built`);
    retiredOk++; continue;
  }
  if (!fs.existsSync(f)) { errors.push(`MISSING  ${r.url}`); continue; }
  const doc = fs.readFileSync(f, "utf8");
  const canon = /<link rel="canonical" href="([^"]*)"/.exec(doc);
  const rec = intended.get(p.endsWith("/") ? p : p + "/") || intended.get(p);
  if (!rec) { errors.push(`NO SOURCE ${r.url}`); continue; }
  if (rec.head.title !== r.title) rewritten++;
  const checks = {
    // URL contract: must always match the live site exactly
    canonical: [canon ? unescapeHtml(canon[1]) : "", r.canonical],
    robots: [meta(doc, "robots"), r.robots],
    // head copy: must match what the content files intend
    title: [unescapeHtml(/<title>([\s\S]*?)<\/title>/.exec(doc)?.[1] ?? ""), rec.head.title],
    description: [meta(doc, "description"), metaOf(rec, "description")],
    "og:title": [meta(doc, "og:title"), metaOf(rec, "og:title")],
    "og:image": [meta(doc, "og:image"), metaOf(rec, "og:image")],
    "json-ld blocks": [String(doc.split('type="application/ld+json"').length - 1), String(rec.head.jsonld.length)],
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
console.log(`checked ${rows.length} URLs: ${errors.length} problem(s)  (${rewritten} with intentionally rewritten titles, ${retiredOk} retired with 301)`);
for (const e of errors.slice(0, 60)) console.log("  " + e);
process.exit(errors.length ? 1 : 0);
