/**
 * Lists the hardest sentences on pages that fail readability, word complexity or sentence length,
 * in their ORIGINAL wording (so they can be rewritten through content/seo/copy-edits.json).
 *
 *   node tools/rewrite-candidates.mjs [/path/ ...] [--max 12]      (after npm run build)
 *   node tools/rewrite-candidates.mjs --apply file.json             merge [[old, new]] rewrites into copy-edits.json
 *
 * Only sentences with no HTML inside are listed, so the exact text can be replaced safely.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixRecord, RULES as FIXRULES } from "./seo-fix.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CE = path.join(ROOT, "content", "seo", "copy-edits.json");
const args = process.argv.slice(2);
const byPath = new Map(fs.readdirSync(path.join(ROOT, "content", "pages")).filter((n) => n.endsWith(".json"))
  .map((n) => { const r = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "pages", n), "utf8")); return [r.path, r]; }));
const sourceHtml = (rec) => { const A = FIXRULES.autofix, keep = { ...A }; for (const k of ["summaries", "faqAdditions", "simpleWords", "shortSentences", "longParagraphs", "realHeadings"]) A[k] = false; const h = fixRecord(JSON.parse(JSON.stringify(rec))).content_html; Object.assign(A, keep); return h; };

if (args[0] === "--apply") {
  const add = JSON.parse(fs.readFileSync(args[1], "utf8")), edits = JSON.parse(fs.readFileSync(CE, "utf8"));
  let ok = 0, miss = 0;
  for (const [p, list] of Object.entries(add)) {
    const rec = byPath.get(p); if (!rec) { console.log("no page", p); continue; }
    let html = sourceHtml(rec);
    const dest = (edits[p] ||= []);
    for (const [a, b] of list) {
      if (!html.includes(a)) { miss++; console.log(`  miss ${p}: "${a.slice(0, 60)}"`); continue; }
      if (dest.some(([x]) => x === a)) continue;
      dest.push([a, b]); html = html.split(a).join(b); ok++;
    }
  }
  fs.writeFileSync(CE, JSON.stringify(edits, null, 2) + "\n");
  console.log(`applied ${ok}, missed ${miss}`);
  process.exit(0);
}

const SYL = { business: 2, businesses: 3, every: 2, everything: 3, everyone: 3, several: 2, different: 2, interest: 2, actually: 3, usually: 3, really: 2, finally: 3, especially: 3 };
const syl = (w) => { w = w.toLowerCase().replace(/[^a-z]/g, ""); if (SYL[w]) return SYL[w]; if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e|[aeiou]le|[aeiou]les)$/, (m) => (/le?s?$/.test(m) && /^[aeiou]/.test(m) ? m[0] + "l" : "")).replace(/^y/, ""); return Math.max(1, (w.match(/[aeiouy]{1,2}/g) || []).length); };
const words = (t) => t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
const max = +(args[args.indexOf("--max") + 1] || 12) || 12;
const REPORT = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "admin", "report.json"), "utf8"));
const wanted = args.filter((a) => a.startsWith("/"));
const pages = REPORT.results.filter((p) => (wanted.length ? wanted.includes(p.path) : true) &&
  ["readability_score", "word_complexity", "sentence_length"].some((k) => p.checks[k]?.status === "warn"));
for (const p of pages) {
  const rec = byPath.get(p.path); if (!rec || rec.type === "home") { console.log(`\n# ${p.path} (home: edit content/home.json)`); continue; }
  const html = sourceHtml(rec);
  const sents = [...html.matchAll(/<(p|li)>([^<]+)<\/\1>/g)].flatMap((m) => m[2].split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((s) => s.trim()).filter((s) => words(s).length >= 8 && html.includes(s));
  const score = (s) => { const w = words(s); const sy = w.reduce((a, x) => a + syl(x), 0); return (sy / w.length - 1.45) * w.length + Math.max(0, w.length - 18) * 0.6; };
  const ranked = [...new Set(sents)].sort((a, b) => score(b) - score(a)).slice(0, max);
  console.log(`\n# ${p.path}  ${p.checks.readability_score.value} · ${p.checks.word_complexity.value} · ${p.checks.sentence_length.value}`);
  for (const s of ranked) console.log("  - " + s);
}
