/**
 * Debug helper: for each built page under a path prefix, report the transition-word rate (same rules as the audit)
 * and list paragraph sentences without a transition word, with how many need one to reach the target.
 *
 *   node tools/transition-gaps.mjs /website-security/ [/other/ ...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "seo", "rules.json"), "utf8"));
const un = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&#x27;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = (h) => un(String(h || "").replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const words = (t) => (t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []);
const sentencesOf = (t) => t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/).map((s) => s.trim()).filter((s) => words(s).length >= 3);
const tw = new RegExp(`\\b(${RULES.words.transition.map((x) => x.replace(/ /g, "\\s+")).join("|")})\\b`, "i");
const target = RULES.thresholds.transitionWords.minPercent / 100;

for (const p of process.argv.slice(2)) {
  const f = path.join(ROOT, "dist", ...p.split("/").filter(Boolean), "index.html");
  const html = fs.readFileSync(f, "utf8");
  const content = [...html.matchAll(/<!--seo:content-->([\s\S]*?)<!--\/seo:content-->/g)].map((m) => m[1]).join("\n");
  const blocks = content.replace(/<\/(h[1-6]|p|li|td|th|dt|dd|summary|blockquote|figcaption|button|a|span|strong|div|section|article|header|footer|figure|ul|ol|tr)>/gi, " ¶ ").replace(/<br\s*\/?>/gi, " ¶ ");
  const MINW = RULES.thresholds.transitionWords.minSentenceWords || 1;
  const sents = text(blocks).split("¶").flatMap((b) => sentencesOf(b.trim())).filter((s) => words(s).length >= MINW);
  const have = sents.filter((s) => tw.test(s)).length;
  const need = Math.max(0, Math.ceil(target * sents.length + 0.5) - have);
  console.log(`\n${p}  ${have}/${sents.length} = ${Math.round((have / sents.length) * 1000) / 10}%  need +${need}`);
  if (!need) continue;
  // candidates: prose sentences without a transition, from paragraphs first, then list items
  const fromTag = (tag) => [...content.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g"))].flatMap((m) => sentencesOf(text(m[1])));
  const cands = [...fromTag("p"), ...fromTag("li")].filter((s) => words(s).length >= MINW && !tw.test(s));
  for (const s of cands.slice(0, need + 4)) console.log("   -", s.slice(0, 120));
}
