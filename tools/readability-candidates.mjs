/**
 * List the hardest blocks (paragraphs / list items) on pages whose readability fails, so they can be
 * rewritten in plain language. Read-only helper.
 *
 *   node tools/readability-candidates.mjs [/path/ ...]  > candidates.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "admin", "report.json"), "utf8"));
const want = process.argv.slice(2);
const targets = want.length ? want : report.results.filter((x) => x.checks.readability_score?.status === "fail").map((x) => x.path);

const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#039;/g, "'").replace(/\s+/g, " ").trim();
const words = (t) => t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
const syl = (w) => { w = w.toLowerCase().replace(/[^a-z]/g, ""); if (w.length <= 3) return 1; w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, ""); return Math.max(1, (w.match(/[aeiouy]{1,2}/g) || []).length); };
const flesch = (t) => { const w = words(t); const s = Math.max(1, t.split(/[.!?]+\s/).filter((x) => words(x).length).length); return 206.835 - 1.015 * (w.length / s) - 84.6 * (w.reduce((a, x) => a + syl(x), 0) / Math.max(1, w.length)); };

const pagesDir = path.join(ROOT, "content", "pages");
const byPath = new Map(fs.readdirSync(pagesDir).filter((n) => n.endsWith(".json")).map((n) => [JSON.parse(fs.readFileSync(path.join(pagesDir, n), "utf8")).path, n]));
const out = {};
for (const p of targets) {
  const file = byPath.get(p);
  const rec = JSON.parse(fs.readFileSync(path.join(pagesDir, file), "utf8"));
  const blocks = [...rec.content_html.matchAll(/<(p|li)>([\s\S]*?)<\/\1>/g)].map((m) => ({ tag: m[1], html: m[2], t: text(m[2]) }))
    .filter((b) => words(b.t).length >= 14)
    .map((b) => ({ ...b, f: Math.round(flesch(b.t)) }))
    .filter((b) => b.f < 40);
  out[p] = { file, blocks: blocks.map((b) => ({ f: b.f, html: b.html })) };
}
console.log(JSON.stringify(out, null, 1));
