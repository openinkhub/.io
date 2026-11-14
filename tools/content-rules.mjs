/**
 * Content rules applied to every page at build time (called from fixRecord in seo-fix.mjs).
 *
 *  simpleWords     "optimization", "generative", "artificial intelligence" -> plain words or SEO/AEO/GEO/AIO/AI,
 *                  except inside the page's own keyphrases (rules.json -> simpleWords)
 *  longParagraphs  paragraphs over the word limit are split at the sentence nearest the middle
 *  titleYear       adds the current year to <title> (and og/twitter titles) when it has none and still fits
 */

const ACR = new Set(["SEO", "AEO", "GEO", "AIO", "AI", "CRO", "LLM"]);
// order matters: longer phrases first
const SIMPLE = [
  [/\bsearch engine optimi[sz]ation\s*\(SEO\)/gi, "SEO"],
  [/\banswer engine optimi[sz]ation\s*\(AEO\)/gi, "AEO"],
  [/\bgenerative engine optimi[sz]ation\s*\(GEO\)/gi, "GEO"],
  [/\b(?:artificial intelligence|AI) optimi[sz]ation\s*\(AIO\)/gi, "AIO"],
  [/\bsearch engine optimi[sz]ation\b/gi, "SEO"],
  [/\banswer engine optimi[sz]ation\b/gi, "AEO"],
  [/\bgenerative engine optimi[sz]ation\b/gi, "GEO"],
  [/\b(?:artificial intelligence|AI) optimi[sz]ation\b/gi, "AIO"],
  [/\bknowledge graph optimi[sz]ation\b/gi, "knowledge graph work"],
  [/\bconversion (?:rate )?optimi[sz]ation\b/gi, "conversion improvement"],
  [/\b(?:LLM|large language model) optimi[sz]ation\b/gi, "LLM visibility work"],
  [/\bartificial intelligence\b/gi, "AI"],
  [/\bgenerative AI\b/gi, "AI"],
  [/\bgeneratively\b/gi, "automatically"],
  [/\bgenerative\b/gi, "AI"],
  [/\bSEO-optimi[sz]ed\b/gi, "SEO-ready"],
  [/\boptimi[sz]ed for\b/gi, "built for"],
  [/\boptimi[sz]ations\b/gi, "improvements"],
  [/\boptimi[sz]ation\b/gi, "improvement"],
  [/\boptimi[sz]ing\b/gi, "improving"],
  [/\boptimi[sz]es\b/gi, "improves"],
  [/\boptimi[sz]ed\b/gi, "tuned"],
  [/\boptimi[sz]er\b/gi, "tool"],
  [/\boptimi[sz]e\b/gi, "improve"],
];
const TARGET = /optimi[sz]|generativ|artificial intelligence/i;
const caseLike = (src, rep) => (ACR.has(rep.split(/[\s-]/)[0]) || !/^[A-Z]/.test(src) ? rep : rep.charAt(0).toUpperCase() + rep.slice(1));

/** Simplify one plain-text string, keeping protected phrases (keyphrases) unchanged. */
export function simplifyText(text, protect = []) {
  if (!TARGET.test(text)) return text;
  const keep = [];
  let t = text;
  for (const ph of protect) {
    if (!ph || !TARGET.test(ph)) continue;
    const re = new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    t = t.replace(re, (m) => { keep.push(m); return `\u0001${keep.length - 1}\u0001`; });
  }
  for (const [re, rep] of SIMPLE) t = t.replace(re, (m) => caseLike(m, rep));
  t = t.replace(/\b([A-Z]{2,4})\s*\(\1\)/g, "$1")          // "AEO (AEO)"
    .replace(/\bAI(?:\s+AI)+\b/g, "AI")                     // "AI AI"
    .replace(/\ban (AI|AEO|AIO)\b/g, "an $1").replace(/\ba (AEO|AIO)\b/g, "an $1");
  return t.replace(/\u0001(\d+)\u0001/g, (_, i) => keep[+i]);
}

/** Apply simplifyText to the text nodes of an HTML string (tags, attributes and URLs untouched). */
export function simplifyHtml(html, protect = []) {
  if (!html || !TARGET.test(html)) return html;
  return html.replace(/>([^<]+)</g, (m, txt) => `>${simplifyText(txt, protect)}<`)
    .replace(/^([^<]+)/, (m, txt) => simplifyText(txt, protect));
}

export function simpleWords(rec, fixes, cfg = {}) {
  if (cfg.enabled === false) return;
  const protect = [rec.keyphrase, ...(rec.keyphrase_secondary || []), ...(cfg.keep || [])].filter(Boolean);
  const before = rec.content_html;
  rec.content_html = simplifyHtml(rec.content_html, protect);
  if (rec.h1) rec.h1 = simplifyHtml(rec.h1, protect);
  for (const f of rec.faqs || []) { f.q = simplifyText(f.q, protect); f.a = simplifyHtml(f.a, protect); }
  // keep FAQ schema in step with the visible text
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const qa = n["@type"] === "Question" || n["@type"] === "Answer";
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === "string" && qa && (k === "name" || k === "text")) n[k] = simplifyText(v, protect);
      else if (typeof v === "object") walk(v);
    }
  };
  walk(rec.head?.jsonld);
  if (rec.content_html !== before) fixes.push("simple-words");
}

const wordsIn = (s) => (String(s).replace(/<[^>]+>/g, " ").match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;

/** Split <p> blocks longer than maxWords at the sentence boundary closest to the middle (repeats until all fit). */
export function longParagraphs(rec, fixes, maxWords = 150) {
  let n = 0;
  const split = (inner) => {
    if (wordsIn(inner) <= maxWords) return [inner];
    // sentence boundaries outside tags: ". Next"
    const cuts = [];
    let depth = 0;
    for (let i = 0; i < inner.length - 2; i++) {
      const ch = inner[i];
      if (ch === "<") depth++; else if (ch === ">") depth = Math.max(0, depth - 1);
      else if (!depth && /[.!?]/.test(ch) && inner[i + 1] === " " && /[A-Z0-9“"]/.test(inner[i + 2])) cuts.push(i + 1);
    }
    // only cut where no inline tag is open (count opening vs closing tags before the cut)
    const ok = cuts.filter((c) => { const s = inner.slice(0, c); return (s.match(/<(a|strong|b|em|i|span)\b/g) || []).length === (s.match(/<\/(a|strong|b|em|i|span)>/g) || []).length; });
    if (!ok.length) return [inner];
    const total = wordsIn(inner);
    const best = ok.reduce((a, c) => (Math.abs(wordsIn(inner.slice(0, c)) - total / 2) < Math.abs(wordsIn(inner.slice(0, a)) - total / 2) ? c : a));
    n++;
    return [...split(inner.slice(0, best).trim()), ...split(inner.slice(best).trim())];
  };
  rec.content_html = rec.content_html.replace(/<p>([\s\S]*?)<\/p>/g, (m, inner) => {
    if (/<(p|div|ul|ol|table|h\d)\b/.test(inner)) return m;
    // a "paragraph" that is only a run of links (e.g. 100 city links) is really a list
    const links = inner.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || [];
    if (links.length >= 8 && !inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "").replace(/[\s,·|•]+/g, "")) {
      n++; return `<ul class="chips">${links.map((a) => `<li>${a}</li>`).join("")}</ul>`;
    }
    return split(inner).map((x) => `<p>${x}</p>`).join("\n");
  });
  if (n) fixes.push(`paragraph-split:${n}`);
}

/** Add the year to the title: "Topic | openink Hub" -> "Topic (2026) | openink Hub", only if it fits maxLen. */
export function titleYear(rec, fixes, { year, maxLen = 60, skipPaths = [], skipTypes = [], overrides = {} }) {
  const title = rec.head?.title || "";
  if (!title || /\b20\d\d\b/.test(title) || skipPaths.includes(rec.path) || skipTypes.includes(rec.type)) return;
  if (overrides[rec.path]) { // hand-written title for titles that cannot be shortened cleanly
    const next = overrides[rec.path];
    for (const x of rec.head.meta || []) if (["og:title", "twitter:title"].includes(x.key) && x.content === title) x.content = next;
    rec.head.title = next; if (rec.title === title) rec.title = next; fixes.push("title-year"); return;
  }
  const m = /^(.*?)(\s+[|–-]\s+openink Hub)$/i.exec(title);
  const core = m ? m[1] : title, suffix = m ? m[2] : "";
  const tries = [`${core} (${year})${suffix}`, `${core} (${year})`];
  // "Topic: subtitle" / "Topic | subtitle" -> "Topic (2026): subtitle", trimming the subtitle's last words if needed
  const sm = /^(.*?)\s*([:|])\s+(.*)$/.exec(core);
  if (sm) {
    const [, head, sep, sub] = sm;
    const join = (s) => `${head} (${year})${sep === ":" ? ":" : " |"} ${s}`;
    tries.push(join(sub) + suffix, join(sub));
    // drop whole list items from the end: "A, B & C" -> "A & B" -> "A"
    const segs = sub.split(/\s*,\s*|\s+&\s+|\s+and\s+/).filter(Boolean);
    for (let k = segs.length - 1; k >= 1; k--) {
      const s = k === 1 ? segs[0] : `${segs.slice(0, k - 1).join(", ")} & ${segs[k - 1]}`;
      if (s.split(/\s+/).length < 2 || /\b(Local|Lead|Voice)$/i.test(s)) continue; // would read as a cut-off phrase
      tries.push(join(s));
    }
  }
  const next = tries.find((t) => t.length <= maxLen && !/[,&:|]$/.test(t));
  if (!next) return;
  for (const x of rec.head.meta || []) if (["og:title", "twitter:title"].includes(x.key) && x.content === title) x.content = next;
  rec.head.title = next;
  if (rec.title === title) rec.title = next;
  fixes.push("title-year");
}
