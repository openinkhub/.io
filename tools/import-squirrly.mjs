/**
 * Import a Squirrly SEO backup (squirrly-export-*.jsonl.gz) into content/seo/squirrly.json.
 * One-time / occasional: the result is committed and used by the build, fixer and audit.
 *
 *   node tools/import-squirrly.mjs path/to/squirrly-export.jsonl.gz
 *
 * Imports: per-URL SEO settings (title, description, focus keyphrase + keywords, noindex/nofollow/
 * nositemap, canonical, OG/Twitter overrides, JSON-LD types), tracked keywords, redirects and a
 * subset of plugin settings. Redirects whose source is a live page are skipped (live URLs win).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) { console.error("usage: node tools/import-squirrly.mjs <export.jsonl.gz>"); process.exit(1); }

const raw = fs.readFileSync(src);
const text = (src.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("utf8");
const rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

/** Minimal PHP unserialize (strings, ints, floats, bools, null, arrays). String lengths are UTF-8 byte counts. */
function phpUnserialize(str) {
  const b = Buffer.from(str, "utf8");
  let p = 0;
  const until = (ch) => { const j = b.indexOf(ch, p); const r = b.toString("utf8", p, j); p = j + 1; return r; };
  function v() {
    const t = String.fromCharCode(b[p]);
    if (t === "N") { p += 2; return null; }            // N;
    p += 2;                                             // "x:"
    if (t === "b") return until(";") === "1";
    if (t === "i") return parseInt(until(";"), 10);
    if (t === "d") return parseFloat(until(";"));
    if (t === "s") { const len = parseInt(until(":"), 10); p += 1; const r = b.toString("utf8", p, p + len); p += len + 2; return r; }
    if (t === "a") { const n = parseInt(until(":"), 10); p += 1; const o = {}; for (let k = 0; k < n; k++) { const key = v(); o[key] = v(); } p += 1; return o; }
    throw new Error(`unsupported PHP type ${t} at byte ${p}`);
  }
  return v();
}

const decode = (s) => String(s ?? "").replace(/&#124;/g, "|").replace(/&amp;/g, "&").replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
const pathOf = (u) => { try { const p = new URL(u, "https://openinkhub.io").pathname; return p.endsWith("/") || p.includes(".") ? p : p + "/"; } catch { return u; } };

// live URLs (redirect sources must not shadow them)
const PAGES = path.join(ROOT, "content", "pages");
const live = new Set(fs.readdirSync(PAGES).filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(fs.readFileSync(path.join(PAGES, n), "utf8")).path));

const meta = rows.find((r) => r.t === "meta")?.d || {};
const settings = rows.find((r) => r.t === "settings")?.d || {};
const pages = {};
for (const r of rows.filter((r) => r.t === "seo")) {
  const d = r.d;
  let seo = {}, post = {};
  try { seo = phpUnserialize(d.seo) || {}; } catch (e) { console.warn("  could not parse seo for", d.URL, e.message); }
  try { post = phpUnserialize(d.post) || {}; } catch { /* optional */ }
  const keywords = decode(seo.keywords).split(",").map((k) => k.trim()).filter(Boolean);
  pages[pathOf(d.URL)] = {
    url: d.URL, wp_id: post.ID ?? null, post_type: post.post_type ?? null,
    title: decode(seo.title), description: decode(seo.description),
    keyphrase: keywords[0] || "", keywords,
    noindex: !!seo.noindex, nofollow: !!seo.nofollow, nositemap: !!seo.nositemap,
    canonical: decode(seo.canonical),
    og: { title: decode(seo.og_title), description: decode(seo.og_description), media: decode(seo.og_media), type: decode(seo.og_type) },
    twitter: { title: decode(seo.tw_title), description: decode(seo.tw_description), media: decode(seo.tw_media), type: decode(seo.tw_type) },
    jsonld_types: seo.jsonld_types ? Object.values(seo.jsonld_types) : [],
  };
}

const redirects = [], skipped = [];
for (const r of rows.filter((r) => r.t === "qss_redirects")) {
  const d = r.d;
  const from = d.url.replace(/\/+$/, "") || "/";
  const to = d.action_data;
  const item = { from, to, code: Number(d.action_code) || 301, hits: Number(d.last_count) || 0 };
  if (d.status !== "enabled") { skipped.push({ ...item, reason: "disabled in Squirrly" }); continue; }
  if (live.has(from + "/") || live.has(from)) { skipped.push({ ...item, reason: "source is a live page (live URLs are never redirected)" }); continue; }
  if (!live.has(pathOf(to))) { skipped.push({ ...item, reason: "target is not a live page" }); continue; }
  redirects.push(item);
}

const out = {
  _note: "Imported from a Squirrly SEO backup by tools/import-squirrly.mjs. Re-run the importer to refresh.",
  source: { file: path.basename(src), site: meta.site, created: meta.created, plugin_version: meta.plugin_version },
  tracked_keywords: rows.filter((r) => r.t === "keyword").map((r) => r.d.keyword),
  settings: Object.fromEntries(Object.entries(settings).filter(([k]) => /^sq_(auto_|jsonld|sla|og|tw|sitemap|metas|robots|redirects|audit_email|local)/.test(k))),
  pages, redirects, skipped_redirects: skipped,
};
fs.mkdirSync(path.join(ROOT, "content", "seo"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "content", "seo", "squirrly.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`imported ${Object.keys(pages).length} URL settings, ${redirects.length} redirects (${skipped.length} skipped), ${out.tracked_keywords.length} tracked keywords`);
for (const s of skipped) console.log(`  skipped ${s.from} -> ${s.to}: ${s.reason}`);
