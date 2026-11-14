/**
 * Break runs of 3+ sentences that start with the same word (the audit's "consecutive sentences" check):
 * the middle sentence of each run gets "Also," in front. Edits go to content/seo/copy-edits.json.
 *
 *   node tools/fix-repeats.mjs        (after npm run build; then npm run build again)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixRecord } from "./seo-fix.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "seo", "rules.json"), "utf8"));
const MINW = RULES.thresholds.transitionWords.minSentenceWords || 1;
const REPORT = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "admin", "report.json"), "utf8"));
const CE = path.join(ROOT, "content", "seo", "copy-edits.json");
const edits = JSON.parse(fs.readFileSync(CE, "utf8"));
const un = (s) => String(s).replace(/&amp;/g, "&").replace(/&#x27;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
const text = (h) => un(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const words = (t) => t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
const sentencesOf = (t) => t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/).map((s) => s.trim()).filter((s) => words(s).length >= 3);
const byPath = new Map(fs.readdirSync(path.join(ROOT, "content", "pages")).filter((n) => n.endsWith(".json"))
  .map((n) => { const r = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "pages", n), "utf8")); return [r.path, r]; }));

let total = 0;
for (const p of REPORT.results.filter((x) => x.checks.consecutive_sentences?.status === "warn")) {
  const rec = byPath.get(p.path); if (!rec) continue;
  const html = fixRecord(JSON.parse(JSON.stringify(rec))).content_html;
  const blocks = html.replace(/<\/(h[1-6]|p|li|td|th|dt|dd|summary|blockquote|figcaption|button|a|span|strong|div|section|article|header|footer|figure|ul|ol|tr)>/gi, " ¶ ");
  const sents = text(blocks).split("¶").flatMap((b) => sentencesOf(b.trim())).filter((s) => words(s).length >= MINW);
  const list = (edits[p.path] ||= []);
  let run = 1, prev = "";
  for (let i = 0; i < sents.length; i++) {
    const w = (words(sents[i])[0] || "").toLowerCase();
    run = w && w === prev ? run + 1 : 1; prev = w;
    if (run !== 3) continue;
    const mid = sents[i - 1], first = words(mid)[0];
    // find the middle sentence's opening in the raw HTML (first 4 words, tags allowed between them)
    const lead = mid.split(/\s+/).slice(0, 4).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(?:\\s|<[^>]+>)+");
    const hits = [...html.matchAll(new RegExp(`(>\\s*|[.!?]\\s+)(${lead})`, "g"))];
    if (hits.length !== 1) { console.log(`  skip ${p.path}: "${mid.slice(0, 40)}" (${hits.length} matches)`); continue; }
    const find = hits[0][0];
    const isName = /[A-Z].*[A-Z]/.test(first) || /^(Openink|Google|WhatsApp|WordPress|Shopify|India|AI|SEO|AEO|GEO|AIO)$/.test(first);
    const body = hits[0][2];
    const repl = hits[0][1] + "Also, " + (isName ? body : body.charAt(0).toLowerCase() + body.slice(1));
    if (!list.some(([a]) => a === find)) { list.push([find, repl]); total++; }
    run = 1; prev = "";
  }
}
fs.writeFileSync(CE, JSON.stringify(edits, null, 2) + "\n");
console.log(`fix-repeats: ${total} edits written`);
