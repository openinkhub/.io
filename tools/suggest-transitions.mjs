/**
 * Suggest copy edits that add a connecting word to prose on pages below the transition-word target,
 * and write them to content/seo/copy-edits.json (existing edits are kept).
 *
 *   node tools/suggest-transitions.mjs            (after npm run build; then npm run build again)
 *
 * Rules: only the 2nd+ sentence inside a <p>, 6+ words, no transition word already, starts with a capital letter.
 * Openers rotate through neutral additive ones; common words are lower-cased after the opener, names are kept.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixRecord } from "./seo-fix.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "seo", "rules.json"), "utf8"));
const REPORT = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "admin", "report.json"), "utf8"));
const CE = path.join(ROOT, "content", "seo", "copy-edits.json");
const edits = JSON.parse(fs.readFileSync(CE, "utf8"));
const T = RULES.thresholds.transitionWords, MINW = T.minSentenceWords || 1;
const tw = new RegExp(`\\b(${RULES.words.transition.map((x) => x.replace(/ /g, "\\s+")).join("|")})\\b`, "i");
const text = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const words = (t) => t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
// ordinary words that look like names because pages use Title Case labels ("Local SEO", "Content Strategy")
const ALWAYS_LOW = new Set(["Automation", "Automated", "Use", "Search", "Content", "Small", "Choosing", "Consistent", "Local", "Share",
  "Building", "Backlinks", "Explore", "Profile", "Everything"]);
const OPENERS = ["In addition,", "Also,", "In practice,"];
const COMMON = new Set(["the", "this", "these", "that", "those", "it", "its", "our", "we", "you", "your", "every", "each", "most", "many", "a", "an",
  "they", "their", "there", "some", "all", "one", "when", "if", "with", "by", "for", "from", "in", "on", "to", "at", "as", "no", "any", "both", "more", "less"]);

const byPath = new Map(fs.readdirSync(path.join(ROOT, "content", "pages")).filter((n) => n.endsWith(".json"))
  .map((n) => { const r = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "pages", n), "utf8")); return [r.path, r]; }));

let total = 0;
for (const p of REPORT.results) {
  const c = p.checks.transition_words;
  if (!c || c.status !== "warn") continue;
  const m = /([\d.]+)% of (\d+) sentences/.exec(c.value); if (!m) continue;
  const n = +m[2], have = Math.round((+m[1] / 100) * n);
  let need = Math.ceil((T.minPercent / 100) * n) + 1 - have;
  const rec = byPath.get(p.path); if (!rec || need <= 0) continue;
  const html = fixRecord(JSON.parse(JSON.stringify(rec))).content_html; // after plain-language + existing copy edits
  const pageText = text(html);
  const list = (edits[p.path] ||= []);
  const used = new Set(list.map(([f]) => f));
  let k = 0;
  for (const pm of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    if (need <= 0) break;
    const inner = pm[1];
    let lastEnd = -1; // edits in one paragraph must not overlap
    // sentence boundaries inside the raw HTML: ". Next" (no tags at the boundary)
    for (const b of inner.matchAll(/([a-z0-9)”"%])([.!?]) ([A-Z][A-Za-z'’-]*)/g)) {
      if (need <= 0) break;
      const start = b.index + b[1].length + 2; // index of next sentence
      const rest = inner.slice(start);
      const sentence = text(rest.split(/(?<=[.!?])\s+(?=[A-Z])/)[0]);
      if (words(sentence).length < MINW || tw.test(sentence)) continue;
      if (Math.max(0, b.index - 30) < lastEnd) continue;
      const before = inner.slice(Math.max(0, b.index - 30), start);
      const firstWord = b[3];
      const find = before + rest.slice(0, firstWord.length + 20);
      if (used.has(find) || html.split(find).length !== 2) continue; // must be unique on the page
      // lower-case ordinary words (seen in lower case elsewhere on the page); keep names and acronyms (Google, WhatsApp, AEO)
      const low = firstWord.toLowerCase();
      const name = /[A-Z].*[A-Z]/.test(firstWord) || new RegExp(`[a-z,;] ${firstWord}\\b`).test(pageText); // AEO, WhatsApp, Google
      const ordinary = COMMON.has(low) || ALWAYS_LOW.has(firstWord) || !name;
      const lead = ordinary && firstWord !== "I" ? low : firstWord;
      const opener = OPENERS[k++ % OPENERS.length];
      list.push([find, before + `${opener} ${lead}` + rest.slice(firstWord.length, firstWord.length + 20)]);
      used.add(find); need--; total++; lastEnd = start + firstWord.length + 20;
    }
  }
  if (need > 0) console.log(`  ${p.path}: still short by ${need} (not enough paragraph sentences)`);
}
fs.writeFileSync(CE, JSON.stringify(edits, null, 2) + "\n");
console.log(`suggest-transitions: ${total} edits written to content/seo/copy-edits.json`);
