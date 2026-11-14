/**
 * Debug helper: show which sentences trigger the "consecutive sentences" and "transition words" checks.
 * Uses the same sentence splitting as tools/seo-audit.mjs.
 *
 *   node tools/readability-runs.mjs <path-prefix> [--first]     e.g.  node tools/readability-runs.mjs /best-seo-agency-in-
 *
 * Prints the repeated first words (run of 3+) per page, then the most common repeated words overall.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const prefix = process.argv[2] || "/";
const un = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&#x27;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = (h) => un(String(h || "").replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const words = (t) => (t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []);
const sentencesOf = (t) => t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/).map((s) => s.trim()).filter((s) => words(s).length >= 3);

const tally = {};
for (const dir of fs.readdirSync(DIST)) {
  const p = `/${dir}/`;
  if (!p.startsWith(prefix)) continue;
  const f = path.join(DIST, dir, "index.html");
  if (!fs.existsSync(f)) continue;
  const html = fs.readFileSync(f, "utf8");
  const content = [...html.matchAll(/<!--seo:content-->([\s\S]*?)<!--\/seo:content-->/g)].map((m) => m[1]).join("\n");
  const blocks = content.replace(/<\/(h[1-6]|p|li|td|th|dt|dd|summary|blockquote|figcaption|button|a|span|strong|div|section|article|header|footer|figure|ul|ol|tr)>/gi, " ¶ ").replace(/<br\s*\/?>/gi, " ¶ ");
  const sents = text(blocks).split("¶").flatMap((b) => sentencesOf(b.trim())).filter((s) => words(s).length >= (JSON.parse(fs.readFileSync(path.join(ROOT, "content", "seo", "rules.json"), "utf8")).thresholds.transitionWords.minSentenceWords || 1));
  let run = 1, prev = "";
  sents.forEach((s, i) => {
    const w = (words(s)[0] || "").toLowerCase();
    run = w && w === prev ? run + 1 : 1; prev = w;
    if (run === 3) { tally[w] = (tally[w] || 0) + 1; console.log(p, "→", sents.slice(i - 2, i + 1).map((x) => x.slice(0, 60)).join("  |  ")); }
  });
}
console.log("\nmost repeated first words:", Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10));
