/**
 * Home-page style layout for service pages (used by build.mjs).
 *
 * Service pages came from WordPress widgets (counters, flow diagrams, comparison tables, step labels).
 * After import those widgets are flat runs of <p>/<h3>. This module reads each H2 section and rebuilds
 * the widgets as the site's standard components:
 *
 *   "24/7" + <h3>AI Voice Coverage</h3>            -> stat cards          (value, label)
 *   "Reduction in response time 74%"               -> metric cards        (label, value)
 *   <h3>A</h3><p>↓</p><h3>B</h3>…                  -> numbered step list
 *   <p>01</p> / <p>Phase 1</p> before <h3>         -> numbered card
 *   <p>Feature</p><h3>X</h3><h3>Y</h3> + triples   -> comparison table
 *   <p> <a>…</a> <a>…</a></p> (links only)         -> CTA button row
 *   short label at the end of a section            -> eyebrow of the next section
 *   remaining <h3> groups                          -> card grid; text without <h3> -> one card
 */
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => strip(s).split(/\s+/).filter(Boolean).length;
const esc = (s) => String(s).replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// one top-level block per item (content is flat after import; nested lists/tables are kept whole)
export function blocksOf(html) {
  const out = [];
  const re = /<(p|h[2-6]|ul|ol|table|figure|blockquote|div|section)\b[^>]*>[\s\S]*?<\/\1>|<img\b[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    // keep nested same-tag elements whole (e.g. <div><div></div></div>)
    let s = m[0]; const tag = m[1];
    if (tag) {
      let open = (s.match(new RegExp(`<${tag}\\b`, "g")) || []).length, close = (s.match(new RegExp(`</${tag}>`, "g")) || []).length;
      while (open > close) {
        const next = html.indexOf(`</${tag}>`, re.lastIndex); if (next < 0) break;
        s = html.slice(m.index, next + tag.length + 3); re.lastIndex = next + tag.length + 3;
        open = (s.match(new RegExp(`<${tag}\\b`, "g")) || []).length; close = (s.match(new RegExp(`</${tag}>`, "g")) || []).length;
      }
    }
    const t = (tag || "img").toLowerCase();
    out.push({ tag: t, html: s, text: strip(s) });
  }
  return out;
}

const isValue = (t) => t.length <= 14 && words(t) <= 2 && (/\d/.test(t) || /^(multi|unified|infinite|all|every|one|zero|free|live|ai)$/i.test(t));
const metricOf = (t) => {
  const m = /^(.{3,90}?)\s+((?:[−+-]?[₹$]?\d[\d.,]*\s?(?:%|★|x|X|\+|k|K|Cr\+?|ms|s)?(?:\s?(?:checks|points?|parameters))?)|\d+\/\d+)$/.exec(t);
  return m && !/^\d/.test(t) ? { label: m[1], value: m[2] } : null;
};
const isLinksOnly = (b) => b.tag === "p" && /<a\b/.test(b.html) && !strip(b.html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "")).replace(/[→·|•]/g, "").trim();
const isLabel = (b) => b.tag === "p" && !/<a\b/.test(b.html) && words(b.text) <= 4 && b.text.length <= 32 && !/[.!?:,]$/.test(b.text) && !/\d{2,}/.test(b.text);

export function ctaRow(b, cls = "") {
  const links = [...b.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  return `<div class="cta-row ${cls}">${links.map((l, i) => {
    const attrs = l[1].replace(/\sclass="[^"]*"/, "");
    return `<a${attrs} class="btn ${i ? "btn-ghost" : "btn-primary"}">${strip(l[2]).replace(/\s*[→»]\s*$/, "")}</a>`;
  }).join("")}</div>`;
}

/** Parse one section's blocks into components and render them. */
export function renderBlocks(blocks, { icon = () => "", body = (h) => h } = {}) {
  const parts = [];
  let i = 0;
  const intro = [];
  const cards = [];
  let pendingNum = "", pendingTag = "";
  const flush = () => {
    if (!cards.length) return;
    if (cards.length === 1) parts.push(`<div class="c-card">${cards[0].html}</div>`);
    else parts.push(`<div class="svc-grid svc-cards-auto">${cards.map((c) => `<article class="svc-card">${c.num ? `<span class="num">${esc(c.num)}</span>` : ""}${c.tag ? `<span class="card-tag">${esc(c.tag)}</span>` : ""}${c.html}</article>`).join("")}</div>`);
    cards.length = 0;
  };
  const pct = (v) => Math.max(0, Math.min(100, parseFloat(String(v).replace(/[^\d.]/g, "")) || 0));
  const isNum = (t) => /^0?\d{1,2}$/.test(t);
  while (i < blocks.length) {
    const b = blocks[i], nx = blocks[i + 1], nx2 = blocks[i + 2];
    // before/after counters: [label] Before v1 With-X v2 (repeated) -> comparison bars
    const cmpAt = (k) => {
      const L = blocks[k], B = blocks[k + 1], V1 = blocks[k + 2], W = blocks[k + 3], V2 = blocks[k + 4];
      return L && B && V1 && W && V2 && words(L.text) <= 8 && /^before$/i.test(B.text) && isValue(V1.text) && /^with\b/i.test(W.text) && isValue(V2.text)
        ? { label: L.text, before: V1.text, withLabel: W.text, after: V2.text } : null;
    };
    if (cmpAt(i)) {
      flush(); const rows = [];
      while (cmpAt(i)) { rows.push(cmpAt(i)); i += 5; }
      const bar = (lab, v, after) => `<div class="bar-row${after ? " is-after" : ""}"><span>${esc(lab)}</span><div class="bar"><i style="width:${/%/.test(v) ? pct(v) : 100}%"></i></div><b>${esc(v)}</b></div>`;
      parts.push(`<div class="c-card about-compare svc-compare">${rows.map((r) => `<div class="cmp"><strong>${esc(r.label)}</strong>${bar("Before", r.before)}${bar(r.withLabel, r.after, true)}</div>`).join("")}</div>`);
      continue;
    }
    // numbered lines "01" + a text paragraph (no heading), repeated -> numbered step list
    if (b.tag === "p" && isNum(b.text) && nx && nx.tag === "p" && !isNum(nx.text) && nx2 && isNum(nx2.text)) {
      flush(); const st = [];
      while (blocks[i] && isNum(blocks[i].text) && blocks[i + 1] && blocks[i + 1].tag !== "h3") { st.push(blocks[i + 1].html.replace(/^<p>|<\/p>$/g, "")); i += 2; }
      parts.push(`<ol class="steps">${st.map((x) => `<li>${x}</li>`).join("")}</ol>`);
      continue;
    }
    // flow: h3 ↓ h3 ↓ h3 …
    if (b.tag === "h3" && nx && nx.tag === "p" && /^[↓→⟶>]+$/.test(nx.text)) {
      flush(); const steps = [];
      while (blocks[i] && blocks[i].tag === "h3") { steps.push(blocks[i].text); i++; if (blocks[i] && /^[↓→⟶>]+$/.test(blocks[i].text)) i++; else break; }
      parts.push(`<ol class="steps flow-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`); continue;
    }
    // comparison table flattened: <p>Feature</p><h3>A</h3><h3>B</h3> then rows of three
    if (b.tag === "p" && /^(feature|criteria|factor|aspect)s?$/i.test(b.text) && nx?.tag === "h3" && nx2?.tag === "h3") {
      flush(); const head = [b.text, nx.text, nx2.text]; i += 3; const rows = [];
      while (blocks[i] && blocks[i + 2] && words(blocks[i].text) <= 4 && !/^h2$/.test(blocks[i].tag) && !isLinksOnly(blocks[i])) {
        const row = [blocks[i].text, blocks[i + 1].text, blocks[i + 2].text];
        if (row.some((x) => !x) || isLabel(blocks[i + 2]) && blocks[i + 3] && blocks[i + 3].tag === "h2") break;
        rows.push(row); i += 3;
        if (blocks[i] && isLabel(blocks[i]) && (!blocks[i + 1] || blocks[i + 1].tag !== "p")) break;
      }
      parts.push(`<div class="c-card"><div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td>${k ? esc(c) : `<strong>${esc(c)}</strong>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`);
      continue;
    }
    // stat pairs: value then short heading (or heading then value), runs of 2+
    const statAt = (k) => {
      const a = blocks[k], c = blocks[k + 1];
      if (!a || !c) return null;
      if (a.tag === "p" && isValue(a.text) && /^(h3|p)$/.test(c.tag) && words(c.text) <= 6 && !isValue(c.text)) return { value: a.text, label: c.text, n: 2 };
      return null;
    };
    if (statAt(i) && statAt(i + 2)) {
      flush(); const st = [];
      while (statAt(i)) { const s = statAt(i); st.push(s); i += s.n; }
      parts.push(`<ul class="about-stats svc-stats">${st.map((s) => `<li><b>${esc(s.value)}</b><span>${esc(s.label)}</span></li>`).join("")}</ul>`); continue;
    }
    // metric lines: "Label 74%" (p or h3), runs of 2+
    if (/^(p|h3)$/.test(b.tag) && metricOf(b.text) && nx && metricOf(nx.text)) {
      flush(); const ms = [];
      while (blocks[i] && /^(p|h3)$/.test(blocks[i].tag) && metricOf(blocks[i].text)) { ms.push(metricOf(blocks[i].text)); i++; }
      // "Month 1 100 … Month 6 305" -> proportional bar chart; other metric lines -> metric cards
      if (ms.length >= 3 && ms.every((x) => /^(month|week|day|year|q|quarter)\s*\d+$/i.test(x.label))) {
        const num = (v) => parseFloat(String(v).replace(/[^\d.]/g, "")) || 0, max = Math.max(...ms.map((x) => num(x.value))) || 1;
        parts.push(`<div class="c-card about-chart"><ul class="chart">${ms.map((x) => `<li><b>${esc(x.value)}</b><div class="plot"><i style="height:${Math.round((num(x.value) / max) * 100)}%"></i></div><span>${esc(x.label)}</span></li>`).join("")}</ul></div>`);
      } else parts.push(`<ul class="about-metrics svc-metrics">${ms.map((m) => `<li><span>${esc(m.label)}</span><b>${esc(m.value)}</b></li>`).join("")}</ul>`);
      continue;
    }
    // CTA row
    if (isLinksOnly(b)) { flush(); parts.push(ctaRow(b)); i++; continue; }
    // "01" / "Phase 1" / "Step 2" labels before a heading -> card number
    if (b.tag === "p" && /^((phase|step|stage|months?|weeks?|days?)\s*)?0?\d{1,2}([–-]\d{1,2})?$/i.test(b.text) && nx?.tag === "h3") { pendingNum = b.text; i++; continue; }
    // short label right before a heading -> small tag on that card (or drop it if it repeats the heading)
    if (isLabel(b) && nx?.tag === "h3") { if (b.text.toLowerCase() !== nx.text.toLowerCase()) pendingTag = b.text; i++; continue; }
    if (b.tag === "h3") {
      cards.push({ num: pendingNum, tag: pendingTag, html: body(b.html) }); pendingNum = ""; pendingTag = ""; i++;
      while (blocks[i] && blocks[i].tag !== "h3" && !isLinksOnly(blocks[i]) && !(statAt(i) && statAt(i + 2)) &&
        !(isNum(blocks[i].text) && blocks[i + 1]?.tag === "p" && blocks[i + 2] && isNum(blocks[i + 2].text)) && !cmpAt(i) &&
        !(/^(p|h3)$/.test(blocks[i].tag) && metricOf(blocks[i].text) && blocks[i + 1] && metricOf(blocks[i + 1].text)) &&
        !(blocks[i].tag === "p" && /^((phase|step|stage|months?|weeks?|days?)\s*)?0?\d{1,2}([–-]\d{1,2})?$/i.test(blocks[i].text) && blocks[i + 1]?.tag === "h3") &&
        !(isLabel(blocks[i]) && blocks[i + 1]?.tag === "h3")) { cards[cards.length - 1].html += body(blocks[i].html); i++; }
      continue;
    }
    // plain content before any card
    if (!cards.length) { intro.push(b); i++; continue; }
    cards[cards.length - 1].html += body(b.html); i++;
  }
  flush();
  // intro: first short paragraph = section lead, the rest in a card
  let lead = "", rest = intro;
  if (intro[0] && intro[0].tag === "p" && words(intro[0].text) <= 45) { lead = intro[0].html; rest = intro.slice(1); }
  const restHtml = rest.map((b) => body(b.html)).join("");
  return { lead, introCard: restHtml.trim() ? `<div class="c-card prose">${restHtml}</div>` : "", parts: parts.join("\n") };
}

/** Split a page body into hero extras + H2 sections. */
export function splitService(body) {
  const chunks = body.split(/(?=<h2[\s>])/);
  const pre = blocksOf(chunks.shift() || "");
  // hero extras: first links-only paragraph = hero CTAs; value/label pairs = hero stats; trailing label = first eyebrow
  let heroCtas = null; const heroStats = []; const preRest = [];
  for (let k = 0; k < pre.length; k++) {
    const b = pre[k], c = pre[k + 1];
    if (!heroCtas && isLinksOnly(b)) { heroCtas = b; continue; }
    // stat pairs under the headline: numeric value, or (once a stat row has started) a short word value like "Enterprise"
    const wordValue = heroStats.length && b.tag === "p" && words(b.text) <= 2 && b.text.length <= 16 && !/[.!?]$/.test(b.text) && c?.tag === "h3";
    if (b.tag === "p" && (isValue(b.text) || wordValue) && c && /^(h3|p)$/.test(c.tag) && words(c.text) <= 6) { heroStats.push({ value: b.text, label: c.text }); k++; continue; }
    if (/class="kicker"/.test(b.html)) continue; // widget label; the first section gets its own eyebrow below
    preRest.push(b);
  }
  let eyebrow = "";
  if (preRest.length && isLabel(preRest[preRest.length - 1])) eyebrow = preRest.pop().text;
  const sections = [];
  for (const raw of chunks) {
    const title = strip((/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(raw) || [])[1] || "");
    let blocks = blocksOf(raw.replace(/<h2[^>]*>[\s\S]*?<\/h2>/, ""));
    let nextEyebrow = "";
    while (blocks.length && isLabel(blocks[blocks.length - 1])) { nextEyebrow = blocks.pop().text; }
    sections.push({ title, eyebrow, blocks });
    eyebrow = nextEyebrow;
  }
  return { heroCtas, heroStats, preRest, sections };
}
