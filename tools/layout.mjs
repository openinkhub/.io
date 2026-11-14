/**
 * Page layout rules used by build.mjs (all switchable in rules.json -> autofix):
 *
 *  topicKits   adds what a page's own content lacks: "How to choose" (numbered), an evaluation table,
 *              named tools (cards) and key numbers with sources (content/seo/kits.json)
 *  cardLayout  each H2 section of the content becomes a card, like the home page; "Label: text" lists become card grids
 *  plainFaq    FAQs shown open as question/answer cards (no click-to-expand); <details> in content opened up
 *  linkText    every link reads as anchor text or a CTA button: bare-URL / "click here" / image-only links get the
 *              target page's name; "… →" links become buttons
 */
const E = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ topic kits
export function kitGroup(rec, kits) {
  for (const g of kits.groups || []) {
    if ((g.types || []).includes(rec.type) && rec.type !== "post") return g;
    if ((g.match || []).some((m) => rec.path.includes(m))) return g;
  }
  return null;
}

// short topic from a source URL ("…/core-web-vitals" -> "core web vitals"), so two links to the same publisher
// never share the same link text (accessibility: identical links must have the same purpose)
const srcTopic = (url) => {
  try {
    const seg = new URL(url).pathname.split("/").filter((s) => s && !/^\d+$/.test(s) && !/^(answer|docs|search|en|hl)$/i.test(s));
    return (seg.pop() || "").replace(/\.\w+$/, "").replace(/[-_]+/g, " ").trim();
  } catch { return ""; }
};

export function kitHtml(rec, body, kits) {
  const g = kitGroup(rec, kits);
  if (!g) return "";
  const text = strip(body).toLowerCase();
  const parts = [];
  const year = kits.year || new Date().getFullYear();
  if (!/<ol/.test(body) || !/<h[23][^>]*>[^<]*(how to choose|choosing|how do (you|i) choose|how to pick|decision)/i.test(body))
    parts.push(`<div class="c-card kit-choose"><h2>How to choose ${E(g.topic)} in ${year}: a step-by-step decision guide</h2>
<ol class="steps">${g.choose.map((s) => `<li>${E(s)}</li>`).join("")}</ol></div>`);
  if (!/<table\b/i.test(body))
    parts.push(`<div class="c-card kit-compare"><h2>${E(g.topic.charAt(0).toUpperCase() + g.topic.slice(1))}: evaluation framework</h2>
<p>Use this table to compare providers or to review your own setup.</p>
<div class="table-wrap"><table><thead><tr>${g.compare.cols.map((c) => `<th>${E(c)}</th>`).join("")}</tr></thead>
<tbody>${g.compare.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${E(c)}</td>` : `<td><strong>${E(c)}</strong></td>`)).join("")}</tr>`).join("")}</tbody></table></div></div>`);
  const named = g.tools.filter(([n]) => text.includes(n.toLowerCase())).length;
  if (named < 3)
    parts.push(`<div class="c-card kit-tools"><h2>Tools and platforms we use</h2>
<ul class="card-grid">${g.tools.map(([n, d]) => `<li><strong>${E(n)}</strong><span>${E(d)}</span></li>`).join("")}</ul></div>`);
  parts.push(`<div class="c-card kit-numbers"><h2>Key numbers to know</h2>
<ul class="stat-grid">${g.numbers.map(([n, label, src, url]) => `<li><b>${E(n)}</b><span>${E(label)}</span>` +
    `<small>Source: <a href="${E(url)}"${/^https?:/.test(url) ? ' target="_blank" rel="noopener"' : ""}>${E(src)}${(() => { const t = srcTopic(url); return t && !t.split(" ").every((w) => src.toLowerCase().includes(w.toLowerCase())) ? ` · ${E(t)}` : ""; })()}</a></small></li>`).join("")}</ul></div>`);
  return parts.join("\n");
}

// ------------------------------------------------------------------ cards
const balanced = (s) => ["div", "section", "ul", "ol", "table", "details", "blockquote", "figure"].every((t) =>
  (s.match(new RegExp(`<${t}\\b`, "g")) || []).length === (s.match(new RegExp(`</${t}>`, "g")) || []).length);

/** Wrap each top-level H2 section in a card. Skipped if the H2s are nested inside other blocks. */
export function cardify(html) {
  if (!/<h2\b/.test(html)) return html;
  const chunks = html.split(/(?=<h2[\s>])/);
  if (!chunks.every(balanced)) return html;
  const [lead, ...secs] = chunks;
  return lead + secs.map((s) => `<section class="c-card">${s}</section>`).join("\n");
}

/** Lists whose items all start with "<strong>Label:</strong>" (3+ items) become a grid of small cards. */
export function cardLists(html) {
  return html.replace(/<ul>((?:\s*<li>\s*<(?:strong|b)>[^<]{1,60}<\/(?:strong|b)>[\s\S]*?<\/li>){3,})\s*<\/ul>/g, (m, items) =>
    /<(ul|ol|table)\b/.test(items) ? m : `<ul class="card-grid">${items}</ul>`);
}

// ------------------------------------------------------------------ FAQ
export function faqPlain(faqs, h2, body) {
  if (!faqs?.length) return "";
  return `<section class="section"><div class="wrap narrow"><h2 class="sec-title">${E(h2)}</h2><div class="faq-list">` +
    faqs.map((f) => `<div class="faq-card"><h3>${E(strip(f.q))}</h3><div class="faq-a">${body(f.a)}</div></div>`).join("") + `</div></div></section>`;
}

/** <details><summary>Q</summary>A</details> -> an open question card */
export function openDetails(html) {
  return html.replace(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g,
    (m, q, a) => `<div class="faq-card"><h3>${strip(q)}</h3><div class="faq-a">${a}</div></div>`);
}

// ------------------------------------------------------------------ links
const GENERIC = /^(click here|here|read more|more|this|link|learn more|this page|go|know more|details|view)$/i;
export function fixLinks(html, titleOf) {
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (m, attrs, inner) => {
    const href = (/href="([^"]*)"/.exec(attrs) || [])[1] || "";
    const t = strip(inner).replace(/[→»]/g, "").trim();
    const name = () => titleOf(href) || (() => { try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    // image-only link: the image's alt text is the link text, so make sure it names the target page
    if (!t && /<img\b/.test(inner)) {
      if (/\salt="[^"]{3,}"/.test(inner)) return m;
      const n = name(); if (!n) return m;
      return `<a${attrs}>${inner.replace(/<img\b([^>]*?)(\s+alt="[^"]*")?(\s*\/?)>/, (x, a, alt, end) => `<img${a} alt="${E(n)}"${end}>`)}</a>`;
    }
    // bare URL or generic words -> target page name
    if (/^(https?:\/\/|www\.)/i.test(t) || GENERIC.test(t)) { const n = name(); return n ? `<a${attrs}>${E(n)}</a>` : m; }
    // "Do something →" -> CTA button
    if (/[→»]\s*$/.test(strip(inner)) && !/class="/.test(attrs)) return `<a${attrs} class="btn btn-ghost btn-sm">${inner}</a>`;
    return m;
  });
}
