/**
 * Static site generator for openinkhub.io — Node 18+, zero dependencies.
 *
 * Reads:   content/pages/*.json      one per live URL: SEO head + content (from tools/extract.py)
 *          content/home.json         homepage sections
 *          content/site-config.json  nav, footer, contact
 *          content/site.json         categories / tags
 *          static/                   images at their original /wp-content/uploads/... paths, CSS, JS
 * Writes:  dist/                     deployable site; every URL keeps its exact original path
 *
 *   npm run build
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixRecord, fixHtml, listingLabel, RULES, SQUIRRLY, COPY_MISSES } from "./seo-fix.mjs";
import { makeCover, coverFigure } from "./covers.mjs";
import { kitHtml, cardify, cardLists, faqPlain, openDetails, fixLinks } from "./layout.mjs";
import { simplifyHtml } from "./content-rules.mjs";
import { splitService, renderBlocks, ctaRow } from "./service-layout.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = path.join(ROOT, "content");
const DIST = path.join(ROOT, "dist");
const BASE = "https://openinkhub.io";

// ---------------------------------------------------------------- helpers
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/** HTML-escape (same output as Python's html.escape). */
function E(s, quote = true) {
  s = String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quote ? s.replace(/"/g, "&quot;").replace(/'/g, "&#x27;") : s;
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®",
  trade: "™", middot: "·", bull: "•", rarr: "→", larr: "←", times: "×" };
function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === "#") {
      const cp = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[g.toLowerCase()] ?? m;
  });
}

/** Python-compatible json.dumps(obj, ensure_ascii=False): ", " and ": " separators. */
function pyDumps(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "[" + v.map(pyDumps).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + pyDumps(x)).join(", ") + "}";
  return JSON.stringify(v);
}

const chars = (s) => Array.from(s ?? "");               // slice/len by code point, like Python
const cut = (s, n) => chars(s).slice(0, n).join("");
const len = (s) => chars(s).length;
const pyRound = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
const stripTags = (h) => unescapeHtml(h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? `${m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : "";
}
const readMinutes = (h) => Math.max(1, pyRound(h.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length / 220));
const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- data
const CFG = load(path.join(C, "site-config.json"));
const HOME = load(path.join(C, "home.json"));
const CATS = load(path.join(C, "site.json")).categories || [];
const RECS = fs.readdirSync(path.join(C, "pages")).filter((n) => n.endsWith(".json")).sort()
  .map((n) => load(path.join(C, "pages", n))).filter((r) => r.status === 200 && r.head).map(fixRecord); // safe SEO auto-fixes (content/seo/rules.json)
const HTML_FIXES = {}; // image fixes applied per page, reported in /admin
const POSTS = RECS.filter((r) => r.type === "post").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const now = new Date();
const VERSION = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

const ICONS = {
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 10.5h7M8.5 13.5h4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  pin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  wa: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.1 3.1Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2Z"/>',
  map: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
const icon = (name, cls = "ico") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.spark}</svg>`;

/** Absolute same-site URL -> root-relative, so the site works on any preview host. */
const rel = (url) => (url ? url.replace(/^https?:\/\/(www\.)?openinkhub\.io(?=\/|$)/, "") || "/" : url);

function localizeBody(h) {
  h = h.replace(/(href|src)="https?:\/\/(?:www\.)?openinkhub\.io(\/[^"]*)?"/g, (m, a, p) => `${a}="${p || "/"}"`);
  h = h.replace(/<img(?![^>]*\bloading=)/g, '<img loading="lazy" decoding="async"');
  h = h.replace(/<table/g, '<div class="table-wrap"><table').replace(/<\/table>/g, "</table></div>");
  h = h.replace(/<a href="(https?:\/\/(?!(?:www\.)?openinkhub\.io)[^"]+)"(?![^>]*target=)/g, '<a href="$1" target="_blank" rel="noopener"');
  return h;
}

// ---------------------------------------------------------------- <head>
function headHtml(rec) {
  const hd = rec.head;
  const out = ['<meta charset="UTF-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${E(hd.title, false)}</title>`];
  for (const m of hd.meta) out.push(`<meta ${m.attr}="${E(m.key)}" content="${E(m.content)}">`);
  for (const l of hd.links) {
    const extra = ["hreflang", "type", "sizes"].filter((k) => l[k]).map((k) => ` ${k}="${E(l[k])}"`).join("");
    out.push(`<link rel="${E(l.rel)}" href="${E(l.href)}"${extra}>`);
  }
  out.push('<meta name="theme-color" content="#046bd2">');
  out.push('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  out.push('<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">');
  out.push(`<link rel="stylesheet" href="/assets/css/site.css?v=${VERSION}">`);
  for (const j of hd.jsonld) {
    out.push("_raw" in j ? `<script type="application/ld+json">${j._raw}</script>`
      : '<script type="application/ld+json">' + pyDumps(j).replaceAll("</", "<\\/") + "</script>");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- chrome
function header(p) {
  const items = CFG.nav.map((it) => {
    const active = it.href === p ? ' aria-current="page"' : "";
    if (it.children?.length) {
      const kids = it.children.map((c) => `<li><a href="${E(c.href)}">${E(c.label)}</a></li>`).join("");
      return `<li class="has-sub"><a href="${E(it.href)}"${active}>${E(it.label)}</a><ul class="sub">${kids}</ul></li>`;
    }
    return `<li><a href="${E(it.href)}"${active}>${E(it.label)}</a></li>`;
  }).join("");
  const c = CFG.contact;
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-header" id="top">
  <div class="wrap nav-row">
    <a class="brand" href="/" aria-label="${E(CFG.name)} home">
      <img src="${E(CFG.logo)}" alt="${E(CFG.name)}" width="36" height="36"><span>openink<b>Hub</b></span>
    </a>
    <nav class="main-nav" aria-label="Primary"><ul>${items}</ul></nav>
    <div class="nav-cta">
      <a class="btn btn-sm btn-ghost hide-sm" href="tel:${E(c.phone_raw)}">${icon("phone")}<span>${E(c.phone)}</span></a>
      <a class="btn btn-sm btn-primary" href="${E(c.demo_url)}" target="_blank" rel="noopener">Free Demo</a>
      <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-nav">${icon("menu")}</button>
    </div>
  </div>
  <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile"><ul>${items}</ul></nav>
</header>`;
}

function footer() {
  const c = CFG.contact;
  const cols = CFG.footer.columns.map((col) =>
    `<div><h3>${E(col.title)}</h3><ul>${col.links.map((l) => `<li><a href="${E(l.href)}"${/^https?:/.test(l.href) ? " target=\"_blank\" rel=\"noopener\"" : ""}>${E(l.label)}</a></li>`).join("")}</ul></div>`).join("");
  return `<section class="cta-band">
  <div class="wrap cta-inner">
    <div><h2>Ready to be found on Google <em>and</em> in AI answers?</h2>
    <p>Talk to the Openink Hub team about SEO, AEO, GEO, AIO and automation for your business.</p></div>
    <div class="cta-actions">
      <a class="btn btn-light" href="${E(c.demo_url)}" target="_blank" rel="noopener">Schedule a Free Demo</a>
      <a class="btn btn-outline-light" href="${E(c.whatsapp)}" target="_blank" rel="noopener">${icon("wa")}WhatsApp us</a>
    </div>
  </div>
</section>
<footer class="site-footer">
  <div class="wrap foot-grid">
    <div class="foot-about">
      <a class="brand" href="/"><img src="${E(CFG.logo)}" alt="openink Hub logo" width="32" height="32"><span>openink<b>Hub</b></span></a>
      <p>${E(CFG.footer.about)}</p>
      <ul class="contact-list">
        <li>${icon("map")}<span>${E(c.address)}</span></li>
        <li>${icon("phone")}<a href="tel:${E(c.phone_raw)}">${E(c.phone)}</a></li>
        <li>${icon("mail")}<a href="mailto:${E(c.email)}">${E(c.email)}</a></li>
      </ul>
    </div>
    ${cols}
  </div>
  <div class="foot-bar"><div class="wrap foot-bottom">
    <span>© ${now.getFullYear()} ${E(CFG.name)}. All rights reserved.</span>
    <span class="legal">${CFG.footer.legal.map((l) => `<a href="${E(l.href)}">${E(l.label)}</a>`).join(" · ")}</span>
  </div></div>
</footer>
<a class="wa-float" href="${E(c.whatsapp)}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">${icon("wa")}</a>
<script src="/assets/js/site.js?v=${VERSION}" defer></script>`;
}

const document_ = (rec, body, bodyClass = "") => `<!DOCTYPE html>
<html lang="${E(rec.head.lang || "en-US")}">
<head>
${headHtml(rec)}
</head>
<body class="${bodyClass}">
${header(rec.path)}
<main id="main">
${body}
</main>
${footer()}
</body>
</html>
`;

function breadcrumb(trail) {
  const parts = ['<a href="/">Home</a>', ...trail.map(([label, href]) =>
    href ? `<a href="${E(href)}">${E(label)}</a>` : `<span aria-current="page">${E(label)}</span>`)];
  return '<nav class="crumbs" aria-label="Breadcrumb">' + parts.join('<span class="sep">/</span>') + "</nav>";
}

function postCard(r) {
  const img = r.featured_image;
  const im = img ? `<img src="${E(rel(img.src))}" alt="${E(img.alt || r.title)}"${img.width && img.height ? ` width="${img.width}" height="${img.height}"` : ""} loading="lazy" decoding="async">`
    : `<div class="card-ph">${icon("spark")}</div>`;
  const cat = r.categories?.length ? r.categories[0].name : "Article";
  const ex = r.excerpt || "";
  return `<article class="post-card">
  <a href="${E(r.path)}" class="post-card-img"${img ? "" : ` aria-label="${E(stripTags(r.title || ""))}"`}>${im}</a>
  <div class="post-card-body">
    <span class="tag">${E(cat)}</span>
    <h3><a href="${E(r.path)}">${E(r.title)}</a></h3>
    <p>${E(cut(ex, 150))}${len(ex) > 150 ? "…" : ""}</p>
    <span class="meta">${icon("clock")}${fmtDate(r.date || "")}</span>
  </div>
</article>`;
}

// ---------------------------------------------------------------- content shaping
/** -> [eyebrowText, h1InnerHtml, remainingBody]. Keeps the page's real H1 (with <em> accents). */
function splitH1(content, fallback, raw = false) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(content);
  if (!m) return ["", E(fallback), content];
  const inner = m[1].replace(/<\/?(?!em\b|strong\b|b\b)[a-z0-9]+[^>]*>/g, "").trim();
  let pre = content.slice(0, m.index);
  const post = content.slice(m.index + m[0].length);
  const preTxt = pre.replace(/<[^>]+>/g, " ").trim();
  let eyebrow = "";
  if (preTxt && len(preTxt) < 140 && !pre.includes("<img")) { eyebrow = unescapeHtml(preTxt.replace(/\s+/g, " ")); pre = ""; }
  return [eyebrow, inner, raw ? pre + post : enhance(pre + post)];
}

const P_RUN = /(?:<p>(?:(?!<\/p>)[\s\S]){1,60}?<\/p>\s*){4,}/g;

/** Elementor leftovers -> components: tiny-paragraph runs become a stat grid; a short line before <h2> a kicker. */
function enhance(body) {
  body = body.replace(P_RUN, (whole) => {
    let items = [...whole.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => stripTags(x[1]));
    if (items.some((i) => len(i) > 48)) return whole;
    let tail = "";
    if (items.length % 2 && !/\d/.test(items.at(-1))) {
      tail = `<p class="kicker">${E(items.at(-1), false)}</p>`;
      items = items.slice(0, -1);
    }
    const pairs = [];
    for (let i = 0; i + 1 < items.length; i += 2) pairs.push([items[i], items[i + 1]]);
    const statLike = pairs.filter(([v]) => /\d|%|∞|Full|24\/7/.test(v) || len(v) <= 12).length;
    if (items.length >= 4 && items.length % 2 === 0 && statLike >= pairs.length - 1) {
      const cells = pairs.map(([v, l]) => `<div class="stat"><strong>${E(v, false)}</strong><span>${E(l, false)}</span></div>`).join("");
      return `<div class="stat-grid">${cells}</div>${tail}`;
    }
    return whole;
  });
  return body.replace(/<p>([^<]{2,60})<\/p>(\s*<h2)/g, (whole, t, h2) =>
    /[.:?]$/.test(t.trim()) ? whole : `<p class="kicker">${t.trim()}</p>${h2}`);
}

function faqBlock(faqs, h2 = "Frequently Asked Questions") {
  if (!faqs?.length) return "";
  if (RULES.autofix.plainFaq) return faqPlain(faqs, h2, localizeBody);
  const items = faqs.map((f) => `<details class="faq"><summary>${E(f.q.replace(/<[^>]+>/g, ""))}</summary>` +
    `<div class="faq-a">${localizeBody(f.a)}</div></details>`).join("");
  return `<section class="section"><div class="wrap narrow"><h2 class="sec-title">${E(h2)}</h2>${items}</div></section>`;
}

const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "");
const contentHasFaq = (content, faqs) =>
  Boolean(faqs?.length) && faqs.slice(0, 2).every((f) => squash(content).includes(cut(squash(f.q), 40)));

// ---------------------------------------------------------------- templates
// layout rules (tools/layout.mjs): links, open FAQs, card grids and H2 cards; topic kits after the content
const KITS = load(path.join(C, "seo", "kits.json"));
const TITLE_OF = new Map(RECS.map((r) => [r.path, stripTags(r.card_title || r.title || r.h1 || "").replace(/\s*[|–-]\s*openink Hub$/i, "").replace(/\s*\(20\d\d\)/, "")]));
const titleOf = (href) => TITLE_OF.get(href.replace(/^https?:\/\/(www\.)?openinkhub\.io/, "").replace(/[?#].*$/, "")) || "";
function shape(body, legal) {
  const A = RULES.autofix;
  if (A.linkText) body = fixLinks(body, titleOf);
  if (A.plainFaq) body = openDetails(body);
  if (A.cardLayout && !legal) body = cardify(cardLists(body));
  return body;
}
// In-page links (#features, #contact-form…) whose target id was lost in the WordPress migration:
// attach the id to the best-matching heading, or to the start of the page content.
function fixAnchors(html) {
  const missing = [...new Set([...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]))].filter((id) => !new RegExp(`id="${id}"`).test(html));
  for (const id of missing) {
    const words = id.split(/[-_]/).filter((w) => w.length >= 4 && !/^(details|panel|section)$/.test(w));
    const h = words.length && [...html.matchAll(/<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/g)]
      .find((m) => !/\sid=/.test(m[2]) && words.some((w) => m[3].toLowerCase().includes(w.toLowerCase())));
    if (h) html = html.replace(h[0], `<h${h[1]} id="${id}"${h[2]}>${h[3]}</h${h[1]}>`);
    else html = html.replace("<!--seo:content-->", `<!--seo:content--><span id="${id}" class="anchor"></span>`);
  }
  return html;
}
const NO_KIT = new Set([]); // every page gets the parts it lacks
const kitFor = (rec, body, legal) => (RULES.autofix.topicKits && !legal && !NO_KIT.has(rec.path.replace(/^\/+|\/+$/g, "")) ? kitHtml(rec, body, KITS) : "");

const LEGAL = new Set(["privacy-policy", "terms", "refund", "shipping", "disclaimer", "cookie"]);

// "Articles on this topic" list on hub pages that content-plan posts point to (brief_hub)
function hubArticles(rec) {
  const list = POSTS.filter((p) => p.brief_hub === rec.path).sort((x, y) => (x.brief_id || 0) - (y.brief_id || 0));
  if (!list.length) return "";
  return `<section class="section"><div class="wrap narrow prose"><h2>Articles on this topic</h2><ul>${list.map((p) =>
    `<li><a href="${E(p.path)}">${E(p.title)}</a></li>`).join("")}</ul></div></section>
`;
}

// ---------------------------------------------------------------- About Us (home-page style)
// The page linked as "About Us" in the menu: home-style hero, every H2 section as a card grid (or one card for prose),
// the team as person cards (data in content/home.json -> team), FAQs as open cards.
const ABOUT_PATH = (CFG.nav.find((n) => /about/i.test(n.label)) || {}).href || "";
function teamSection(H) {
  const t = H.team;
  const people = t.people.map((p) => `<figure class="person">
  <img src="${E(rel(p.img))}" alt="${E(p.name)}, ${E(p.role)} at Openink Hub" loading="lazy" width="400" height="279">
  <figcaption><strong>${E(p.name)}</strong><span>${E(p.role)}</span>
  ${p.experience ? `<ul class="p-meta"><li><b>${E(p.experience)}</b> experience</li><li><b>${E(p.specialization)}</b></li><li>${E(p.highlight)}</li></ul>` : ""}
  </figcaption></figure>`).join("");
  return `<section class="section section-alt" id="team"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Our team</span><h2 class="sec-title">${E(t.h2)}</h2><p>${E(t.intro)}</p></div>
  <div class="team-grid">${people}</div>
</div></section>`;
}
function aboutTpl(rec) {
  let [eyebrow, h1, body] = splitH1(rec.content_html || "", rec.h1 || rec.title);
  if (RULES.autofix.linkText) body = fixLinks(body, titleOf);
  if (RULES.autofix.plainFaq) body = openDetails(body);
  let lead = "";
  const m = /^\s*<p>([\s\S]*?)<\/p>/.exec(body);
  if (m && len(m[1].replace(/<[^>]+>/g, "")) < 420) { lead = m[1]; body = body.slice(m[0].length); }
  // hero image: the first figure/image in the content (cover), removed from the body
  let heroImg = "";
  const fig = /<figure>\s*(<img\b[^>]*>)\s*<\/figure>/.exec(body);
  if (fig) { heroImg = fig[1].replace(/<img\b/, '<img fetchpriority="high"'); body = body.replace(fig[0], ""); }
  // otherwise the home page hero image, so the hero has the same two-column look as the home page
  if (!heroImg && HOME.hero?.image?.src) heroImg = `<img src="${E(rel(HOME.hero.image.src))}" alt="${E(HOME.hero.image.alt || "Openink Hub")}" width="1024" height="576" fetchpriority="high">`;
  const quick = /<p>\s*<strong>Quick answer:<\/strong>([\s\S]*?)<\/p>/.exec(body);
  if (quick) body = body.replace(quick[0], "");
  // ---- sections from content/about.json, each with the matching home-page component
  const A = load(path.join(C, "about.json"));
  const keep = [rec.keyphrase, ...(rec.keyphrase_secondary || [])].filter(Boolean);
  const T = (s) => E(RULES.autofix.simpleWords ? simplifyHtml(String(s), keep) : String(s));
  let alt = false;
  const sec = (eb, h2, inner, intro = "", wide = true) => {
    const cls = (alt = !alt) ? "section" : "section section-alt";
    return `<section class="${cls}"><div class="wrap${wide ? "" : " narrow"}"><div class="sec-head">${eb ? `<span class="eyebrow">${T(eb)}</span>` : ""}` +
      `<h2 class="sec-title">${T(h2)}</h2>${intro ? `<p>${T(intro)}</p>` : ""}</div>${inner}</div></section>`;
  };
  const cards = (list, numbered = false) => `<div class="svc-grid about-grid">${list.map(([t, d, href], i) =>
    `<article class="svc-card">${numbered ? `<span class="num">${String(i + 1).padStart(2, "0")}</span>` : ""}<h3>${T(t)}</h3><p>${T(d)}</p>` +
    `${href ? `<a class="link-arrow" href="${E(href)}">Explore ${T(t)}${icon("arrow")}</a>` : ""}</article>`).join("")}</div>`;
  const stats = (list, cls = "") => `<ul class="about-stats ${cls}">${list.map((s) => `<li><b>${T(s.value)}</b><span>${T(s.label)}</span></li>`).join("")}</ul>`;
  let out = "";
  // key figures strip
  out += `<section class="section section-tight"><div class="wrap">${stats(A.figures, "figures")}</div></section>`;
  alt = true;
  // problem: metrics + problem cards
  const P = A.problem;
  out += sec(P.eyebrow, P.h2, `<ul class="about-metrics">${P.metrics.map(([v, l]) => `<li><b>${T(v)}</b><span>${T(l)}</span></li>`).join("")}</ul>
  <p class="about-note">${T(P.metrics_note)}</p>${cards(P.cards)}`, P.intro);
  // solution: ecosystem cards + benefit strip
  const S = A.ecosystem;
  out += sec(S.eyebrow, S.h2, cards(S.cards) + stats(S.strip, "strip"), S.intro);
  // benefits: before/after bars, traffic chart, outcomes
  const B = A.benefits, maxV = Math.max(...B.chart.map(([, v]) => v));
  out += sec(B.eyebrow, B.h2, `<div class="about-two">
  <div class="c-card about-compare"><h3>${T(B.compare_title)}</h3>${B.compare.map((c) => `<div class="cmp"><strong>${T(c.label)}</strong>
    <div class="bar-row"><span>Before</span><div class="bar"><i style="width:${c.before}%"></i></div><b>${c.before}%</b></div>
    <div class="bar-row is-after"><span>With Openink</span><div class="bar"><i style="width:${c.after}%"></i></div><b>${c.after}%</b></div></div>`).join("")}</div>
  <div class="c-card about-chart"><h3>${T(B.chart_title)}</h3><ul class="chart">${B.chart.map(([l, v]) =>
    `<li><b>${v}</b><div class="plot"><i style="height:${Math.round((v / maxV) * 100)}%"></i></div><span>${T(l)}</span></li>`).join("")}</ul><p class="about-note">${T(B.chart_note)}</p></div>
</div><ul class="about-outcomes">${B.outcomes.map((o) => `<li>${icon("check")}<span>${T(o)}</span></li>`).join("")}</ul>`, B.intro);
  // market timing: numbered cards + banner
  const W = A.why_now;
  out += sec(W.eyebrow, W.h2, cards(W.cards, true) + `<div class="about-banner"><b>${T(W.banner.value)}</b><span>${T(W.banner.label)}</span></div>`);
  // product: 8 numbered modules + platform features
  const PR = A.product;
  out += sec(PR.eyebrow, PR.h2, cards(PR.modules, true) + `<h3 class="about-sub">Platform features</h3>` + cards(PR.features), PR.intro);
  // audit framework: category cards with check counts + team expertise
  const AU = A.audit;
  out += sec(AU.eyebrow, AU.h2, `<div class="svc-grid about-grid">${AU.categories.map(([n, d, c]) =>
    `<article class="svc-card"><span class="badge">${c} checks</span><h3>${T(n)}</h3><p>${T(d)}</p></article>`).join("")}</div>
  <p class="about-note about-total">${T(AU.total)}</p>
  <div class="c-card about-expertise"><h3>${T(AU.expertise_h3)}</h3><p>${T(AU.expertise)}</p>
  <ul class="check-list">${AU.skills.map((s) => `<li>${icon("check")}<div><strong>${T(s)}</strong></div></li>`).join("")}</ul></div>`, AU.intro);
  // team (content/home.json -> team)
  out += teamSection(HOME); alt = false; // team is grey, so the next section is white
  // mission & vision
  const M = A.mission;
  out += sec(M.eyebrow, M.h2, `<div class="about-two"><div class="c-card"><h3>Our mission</h3><p>${T(M.mission)}</p></div>
  <div class="c-card"><h3>Our vision</h3><p>${T(M.vision)}</p></div></div>${cards(M.cards)}`);
  // in short (content/seo/summaries.json)
  const SUM = load(path.join(C, "seo", "summaries.json"))[rec.path];
  if (SUM) out += sec("", `In short: ${rec.keyphrase_override ? rec.keyphrase_override.replace(/\baeo\b/gi, "AEO") : "about Openink Hub"}`, `<div class="c-card prose"><p>${RULES.autofix.simpleWords ? simplifyHtml(SUM, keep) : SUM}</p></div>`, "", false);
  // FAQ: open cards (FAQPage schema comes from the same questions via rec.faqs)
  const F = A.faq;
  out += sec(F.eyebrow, F.h2, `<div class="faq-list">${F.items.map(([q, a]) => `<div class="faq-card"><h3>${T(q)}</h3><div class="faq-a"><p>${T(a)}</p></div></div>`).join("")}</div>`, "", false);
  const quickText = A.quick || (quick ? quick[1] : "");
  const k = kitFor(rec, out, false);
  const faqs = "";
  const crumb = len(rec.title) < 60 ? rec.title : cut(stripTags(h1), 60);
  return document_(rec, `<section class="hero hero-about">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">${breadcrumb([[crumb, null]])}
      ${eyebrow ? `<span class="eyebrow">${E(eyebrow)}</span>` : ""}
      <h1>${h1}</h1>
      <!--seo:content-->${lead ? `<p class="lead">${lead}</p>` : ""}<!--/seo:content-->
      <div class="hero-ctas"><a class="btn btn-primary" href="${E(CFG.contact.demo_url)}" target="_blank" rel="noopener">Schedule a Free Demo${icon("arrow")}</a><a class="btn btn-ghost" href="/contact-us/">Contact Us</a></div>
      ${quickText ? `<!--seo:content--><div class="quick-answer"><p><strong>Quick answer:</strong> ${quickText}</p></div><!--/seo:content-->` : ""}
    </div>
    ${heroImg ? `<div class="hero-visual">${heroImg}</div>` : ""}
  </div>
</section>
<!--seo:content-->${out}<!--/seo:content-->
${k ? `<section class="section kit"><div class="wrap narrow prose">${localizeBody(k)}</div></section>` : ""}
${faqs}`, "is-page is-about");
}

// ---------------------------------------------------------------- contact page (home-page style, content/contact.json)
function contactTpl(rec) {
  const X = load(path.join(C, "contact.json"));
  const keep = [rec.keyphrase, rec.keyphrase_override, ...(rec.keyphrase_secondary || [])].filter(Boolean);
  const T = (s) => E(RULES.autofix.simpleWords ? simplifyHtml(String(s), keep) : String(s));
  const ext = (h) => (/^https?:/.test(h) ? ' target="_blank" rel="noopener"' : "");
  const h1 = rec.h1 || rec.title;
  let alt = false;
  const sec = (eb, h2, inner, intro = "", wide = true, id = "") => {
    const cls = (alt = !alt) ? "section" : "section section-alt";
    return `<section class="${cls}"${id ? ` id="${id}"` : ""}><div class="wrap${wide ? "" : " narrow"}"><div class="sec-head">${eb ? `<span class="eyebrow">${T(eb)}</span>` : ""}` +
      `<h2 class="sec-title">${T(h2)}</h2>${intro ? `<div class="sec-lead"><p>${T(intro)}</p></div>` : ""}</div>${inner}</div></section>`;
  };
  let out = `<section class="section section-tight"><div class="wrap"><ul class="about-stats figures">${X.stats.map((s) => `<li><b>${T(s.value)}</b><span>${T(s.label)}</span></li>`).join("")}</ul></div></section>`;
  alt = true;
  const ch = X.channels;
  out += sec(ch.eyebrow, ch.h2, `<div class="svc-grid contact-cards">${ch.cards.map((c) => `<article class="svc-card contact-channel">
  <div class="svc-ico">${icon(c.icon)}</div><span class="card-tag">${T(c.label)}</span><h3>${T(c.title)}</h3>
  <p class="channel-value">${c.href ? `<a href="${E(c.href)}"${ext(c.href)}>${E(c.value)}</a>` : E(c.value)}</p><p>${T(c.text)}</p>
  ${c.href && c.cta ? `<a class="link-arrow" href="${E(c.href)}"${ext(c.href)}>${T(c.cta)}${icon("arrow")}</a>` : ""}</article>`).join("")}</div>`, ch.intro);
  const pr = X.process;
  out += sec(pr.eyebrow, pr.h2, `<div class="svc-grid process-cards">${pr.steps.map(([t, d], i) =>
    `<article class="svc-card"><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${T(t)}</h3><p>${T(d)}</p></article>`).join("")}</div>`, pr.intro);
  const g = X.goals;
  out += sec(g.eyebrow, g.h2, `<div class="svc-grid goal-cards">${g.cards.map(([t, d, href, label]) =>
    `<article class="svc-card"><h3>${T(t)}</h3><p>${T(d)}</p><a class="link-arrow" href="${E(href)}">${E(label)}${icon("arrow")}</a></article>`).join("")}</div>`, g.intro);
  const f = X.form;
  const form = `<form class="c-card contact-form" id="contact-form-el" onsubmit="return false">
  <div class="field"><label for="cf-name">Your name</label><input id="cf-name" name="name" autocomplete="name" required></div>
  <div class="field"><label for="cf-phone">Phone or WhatsApp</label><input id="cf-phone" name="phone" type="tel" autocomplete="tel"></div>
  <div class="field"><label for="cf-service">What do you need help with?</label><select id="cf-service" name="service">${f.services.map((s) => `<option>${E(s)}</option>`).join("")}</select></div>
  <div class="field"><label for="cf-msg">Your goal or question</label><textarea id="cf-msg" name="message" rows="4" required></textarea></div>
  <div class="form-actions"><button type="button" class="btn btn-primary" data-send="wa">Send on WhatsApp${icon("arrow")}</button><button type="button" class="btn btn-ghost" data-send="mail">Send by email</button></div>
  <p class="form-note">${T(f.note)}</p>
</form>
<script>(function(){var f=document.getElementById("contact-form-el");if(!f)return;f.addEventListener("click",function(e){var b=e.target.closest("[data-send]");if(!b)return;
var v=function(n){return (f.elements[n].value||"").trim()};if(!v("name")||!v("message")){f.reportValidity();return}
var t="Hi Openink Hub, I'm "+v("name")+(v("phone")?" ("+v("phone")+")":"")+".\\nService: "+v("service")+"\\n\\n"+v("message");
if(b.dataset.send==="wa")window.open("https://wa.me/919204135136?text="+encodeURIComponent(t),"_blank","noopener");
else location.href="mailto:info@openinkhub.io?subject="+encodeURIComponent("Enquiry: "+v("service"))+"&body="+encodeURIComponent(t)});})();</script>`;
  const side = `<aside class="c-card contact-side"><h3>${T(f.details_title)}</h3><dl class="contact-dl">${f.details.map(([k, v, h]) =>
    `<dt>${T(k)}</dt><dd>${h ? `<a href="${E(h)}"${ext(h)}>${E(v)}</a>` : E(v)}</dd>`).join("")}</dl>
  <h3>${T(f.covered_title)}</h3><ul class="chips">${f.covered.map((s) => `<li class="chip">${E(s)}</li>`).join("")}</ul></aside>`;
  out += sec(f.eyebrow, f.h2, `<div class="contact-form-grid">${form}${side}</div>`, f.intro, true, "contact-form");
  out += sec("FAQ", "Frequently asked questions", `<div class="faq-list">${(rec.faqs || []).map((q) => `<div class="faq-card"><h3>${T(stripTags(q.q))}</h3><div class="faq-a">${localizeBody(q.a)}</div></div>`).join("")}</div>`, "", false);
  out += sec("In short", "In short: contact Openink Hub", `<div class="c-card prose"><p>${T(X.in_short)}</p></div>`, "", false);
  out += sec("Explore", "Related services", `<div class="svc-grid svc-cards-auto">${X.related.map(([t, h]) =>
    `<a class="svc-card svc-link" href="${E(h)}"><h3>${E(t)}</h3><span class="link-arrow">Explore${icon("arrow")}</span></a>`).join("")}</div>`);
  const k = kitFor(rec, out, false);
  const img = rec.featured_image;
  const heroImg = img ? `<img src="${E(rel(img.src))}" alt="${E(img.alt || stripTags(h1))}" width="${img.width || 1200}" height="${img.height || 630}" fetchpriority="high">`
    : `<img src="/images/pages/contact-us.svg" alt="Contact Openink Hub" width="1200" height="630" fetchpriority="high">`;
  const ctas = X.ctas.map((c, i) => `<a class="btn ${i ? "btn-ghost" : "btn-primary"}" href="${E(c.href)}"${ext(c.href)}>${E(c.label)}${i ? "" : icon("arrow")}</a>`).join("");
  return document_(rec, `<section class="hero hero-about hero-service">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">${breadcrumb([["Contact Us", null]])}
      <span class="eyebrow">${T(X.eyebrow)}</span>
      <h1>${E(stripTags(h1))}</h1>
      <!--seo:content--><p class="lead">${T(X.lead)}</p><!--/seo:content-->
      <div class="hero-ctas">${ctas}</div>
      <!--seo:content--><div class="quick-answer"><p><strong>Quick answer:</strong> ${T(X.quick)}</p></div><!--/seo:content-->
    </div>
    <div class="hero-visual"><!--seo:content-->${heroImg}<!--/seo:content--></div>
  </div>
</section>
<!--seo:content-->${out}<!--/seo:content-->
${k ? `<section class="section kit"><div class="wrap narrow prose">${localizeBody(k)}</div></section>` : ""}`, "is-page is-about is-contact");
}

// ---------------------------------------------------------------- service pages (home-page style)
// Every page in the Services menu (and the services hub) shares one layout: home-style hero (headline, lead, the page's
// own CTA buttons, quick answer, image), a stat strip, then each H2 section full width with eyebrow, heading, lead and
// components rebuilt from the imported widgets (tools/service-layout.mjs). Sections alternate white / grey.
const SVC_NAV = CFG.nav.find((n) => n.label === "Services") || {};
const SERVICE_PATHS = new Set([SVC_NAV.href, ...(SVC_NAV.children || []).map((c) => c.href)].filter((p) => p && p !== ABOUT_PATH));
function serviceTpl(rec) {
  let [eyebrow, h1, body] = splitH1(rec.content_html || "", rec.h1 || rec.title, true);
  if (RULES.autofix.linkText) body = fixLinks(body, titleOf);
  if (RULES.autofix.plainFaq) body = openDetails(body);
  body = hubGrids(localizeBody(cardLists(body)));
  let lead = "";
  const m = /^\s*<p>([\s\S]*?)<\/p>/.exec(body);
  if (m && len(m[1].replace(/<[^>]+>/g, "")) < 420 && !/<a\b/.test(m[1])) { lead = m[1]; body = body.slice(m[0].length); }
  let heroImg = "";
  const fig = /<figure>\s*(<img\b[^>]*>)\s*<\/figure>/.exec(body);
  if (fig) { heroImg = fig[1].replace(/<img\b/, '<img fetchpriority="high"'); body = body.replace(fig[0], ""); }
  else if (rec.featured_image) heroImg = `<img src="${E(rel(rec.featured_image.src))}" alt="${E(rec.featured_image.alt || stripTags(h1))}" width="${rec.featured_image.width || 1200}" height="${rec.featured_image.height || 630}" fetchpriority="high">`;
  else if (HOME.hero?.image?.src) heroImg = `<img src="${E(rel(HOME.hero.image.src))}" alt="${E(stripTags(h1))}" width="1024" height="576" fetchpriority="high">`;
  const quick = /<p>\s*<strong>Quick answer:<\/strong>([\s\S]*?)<\/p>/.exec(body);
  if (quick) body = body.replace(quick[0], "");
  const { heroCtas, heroStats, preRest, sections } = splitService(body);
  let alt = false, out = "";
  const secOpen = () => ((alt = !alt) ? "section" : "section section-alt");
  if (heroStats.length >= 2) { out += `<section class="section section-tight"><div class="wrap"><ul class="about-stats figures">${heroStats.map((s) => `<li><b>${E(s.value)}</b><span>${E(s.label)}</span></li>`).join("")}</ul></div></section>`; alt = false; }
  const preHtml = preRest.map((b) => b.html).join("");
  if (stripTags(preHtml).length > 30) out += `<section class="${secOpen()}"><div class="wrap narrow"><div class="c-card prose">${preHtml}</div></div></section>`;
  for (const s of sections) {
    const cls = secOpen();
    const head = (ld = "") => `<div class="sec-head">${s.eyebrow ? `<span class="eyebrow">${E(s.eyebrow)}</span>` : ""}<h2 class="sec-title">${E(s.title)}</h2>${ld ? `<div class="sec-lead">${ld}</div>` : ""}</div>`;
    if (/asked questions|^faq|frequently/i.test(s.title)) {
      const items = []; let cur = null;
      // split on every h3, even inside wrappers (e.g. opened <details>)
      const all = s.blocks.map((b) => b.html).join("");
      for (const seg of all.split(/(?=<h3[\s>])/)) {
        const q = /^<h3[^>]*>([\s\S]*?)<\/h3>/.exec(seg);
        if (!q) continue;
        cur = { q: stripTags(q[1]), a: seg.slice(q[0].length).replace(/<\/?(details|summary|div)\b[^>]*>/g, "").trim() };
        items.push(cur);
      }
      out += `<section class="${cls}"><div class="wrap narrow">${head()}<div class="faq-list">${items.map((f) => `<div class="faq-card"><h3>${E(f.q)}</h3><div class="faq-a">${f.a}</div></div>`).join("")}</div></div></section>`;
      continue;
    }
    if (/^related services$/i.test(s.title)) {
      const links = s.blocks.flatMap((b) => [...b.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]);
      out += `<section class="${cls}"><div class="wrap">${head()}<div class="svc-grid svc-cards-auto">${links.map((l) =>
        `<a class="svc-card svc-link" href="${E(l[1])}"><h3>${stripTags(l[2])}</h3><span class="link-arrow">Explore${icon("arrow")}</span></a>`).join("")}</div></div></section>`;
      continue;
    }
    const r = renderBlocks(s.blocks, { icon });
    const narrow = !/svc-grid|about-stats|about-metrics|guide-grid|svc-cards/.test(r.parts) && !r.parts.includes("<table");
    out += `<section class="${cls}"><div class="wrap${narrow ? " narrow" : ""}">${head(r.lead)}${r.introCard}${r.parts}</div></section>`;
  }
  const k = kitFor(rec, body, false);
  const faqs = /asked questions|frequently/i.test(body) || contentHasFaq(body, rec.faqs) ? "" : faqBlock(rec.faqs);
  const crumb = len(rec.title) < 60 ? rec.title : cut(stripTags(h1), 60);
  const ctas = heroCtas ? ctaRow(heroCtas, "hero-ctas") :
    `<div class="hero-ctas"><a class="btn btn-primary" href="${E(CFG.contact.demo_url)}" target="_blank" rel="noopener">Schedule a Free Demo${icon("arrow")}</a><a class="btn btn-ghost" href="/contact-us/">Contact Us</a></div>`;
  return document_(rec, `<section class="hero hero-about hero-service">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">${breadcrumb([["Services", SVC_NAV.href !== rec.path ? SVC_NAV.href : null], ...(SVC_NAV.href !== rec.path ? [[crumb, null]] : [])])}
      ${eyebrow ? `<span class="eyebrow">${E(eyebrow)}</span>` : ""}
      <h1>${h1}</h1>
      <!--seo:content-->${lead ? `<p class="lead">${lead}</p>` : ""}${quick ? `<div class="quick-answer"><p><strong>Quick answer:</strong>${quick[1]}</p></div>` : ""}<!--/seo:content-->
      ${ctas}
    </div>
    ${heroImg ? `<div class="hero-visual"><!--seo:content-->${heroImg}<!--/seo:content--></div>` : ""}
  </div>
</section>
<!--seo:content-->${out}<!--/seo:content-->
${k ? `<section class="section kit"><div class="wrap narrow prose">${localizeBody(k)}</div></section>` : ""}
${faqs}`, "is-page is-service");
}

function pageTpl(rec) {
  if (rec.path === ABOUT_PATH) return aboutTpl(rec);
  if (rec.path === "/contact-us/") return contactTpl(rec);
  if (SERVICE_PATHS.has(rec.path)) return serviceTpl(rec);
  let [eyebrow, h1, body] = splitH1(rec.content_html || "", rec.h1 || rec.title);
  const h1Txt = stripTags(h1);
  const legal = LEGAL.has(rec.path.replace(/^\/+|\/+$/g, ""));
  let lead = "";
  const m = /^\s*<p>([\s\S]*?)<\/p>/.exec(body);
  if (m && !legal && len(m[1].replace(/<[^>]+>/g, "")) < 420) {
    lead = `<p class="lead">${m[1]}</p>`;
    body = body.slice(m[0].length);
  }
  const faqs = contentHasFaq(body, rec.faqs) ? "" : faqBlock(rec.faqs);
  const contact = rec.path === "/contact-us/" ? contactCards() : "";
  const img = rec.featured_image;
  const heroImg = img && !legal ? `<div class="page-hero-img"><img src="${E(rel(img.src))}" alt="${E(img.alt || h1Txt)}" ` +
    `width="${img.width || ""}" height="${img.height || ""}"></div>` : "";
  const crumb = len(rec.title) < 60 ? rec.title : cut(h1Txt, 60);
  return document_(rec, `<section class="page-hero${legal ? " page-hero-sm" : ""}">
  <div class="wrap ${heroImg ? "hero-split" : ""}">
    <div>${breadcrumb(rec.hub ? [["Website Design & Development", rec.hub], [rec.card_title || crumb, null]] : [[crumb, null]])}
    ${eyebrow ? `<span class="eyebrow">${E(eyebrow)}</span>` : ""}
    <h1>${h1}</h1>${lead ? `<!--seo:content-->${lead}<!--/seo:content-->` : ""}
    ${legal ? "" : `<div class="hero-ctas"><a class="btn btn-primary" href="${E(CFG.contact.demo_url)}" target="_blank" rel="noopener">Schedule a Free Demo</a><a class="btn btn-ghost" href="/contact-us/">Contact Us</a></div>`}
    </div>${heroImg}
  </div>
</section>
${contact}
<section class="section"><div class="wrap narrow prose"><!--seo:content-->${hubGrids(localizeBody(shape(body, legal)))}<!--/seo:content--></div></section>
${(() => { const k = kitFor(rec, body, legal); return k ? `<section class="section kit"><div class="wrap narrow prose">${localizeBody(k)}</div></section>` : ""; })()}
${hubArticles(rec)}${faqs}`, "is-page" + (legal ? " is-legal" : ""));
}

function related(rec, n = 3) {
  const cats = new Set((rec.categories || []).map((c) => c.path));
  const pool = POSTS.filter((p) => p.path !== rec.path && (p.categories || []).some((c) => cats.has(c.path)));
  // content-plan articles: same hub first, then same cluster
  if (rec.brief_hub) {
    const score = (p) => (p.brief_hub === rec.brief_hub ? 2 : 0) + (p.cluster && p.cluster === rec.cluster ? 1 : 0);
    const near = pool.filter((p) => score(p) > 0).sort((x, y) => score(y) - score(x) || (x.brief_id || 0) - (y.brief_id || 0));
    if (near.length >= n) return near.slice(0, n);
  }
  // prefer non-city articles, oldest first (matches the original ordering)
  pool.sort((a, b) => (a.path.includes("best-seo-agency-in-") - b.path.includes("best-seo-agency-in-")) ||
    (a.date || "").localeCompare(b.date || ""));
  return pool.length ? pool.slice(0, n) : POSTS.filter((p) => p.path !== rec.path).slice(0, n);
}

const noSize = (u) => u.replace(/-\d+x\d+(?=\.\w+$)/, "");

function postTpl(rec) {
  const [eyebrow, h1, body] = splitH1(rec.content_html || "", rec.h1 || rec.title);
  const h1Txt = stripTags(h1);
  const cat = rec.categories?.length ? rec.categories[0] : null;
  const trail = [...(cat ? [[cat.name, cat.path]] : []), [len(h1Txt) < 50 ? h1Txt : cut(h1Txt, 50) + "…", null]];
  const img = rec.featured_image;
  // don't repeat the featured image if the article body already opens with it
  const first = /<img[^>]*src="([^"]+)"/.exec(cut(body, 600));
  const dup = img && first && noSize(rel(first[1])) === noSize(rel(img.src));
  const fig = img && !dup ? `<figure class="post-feature"><img src="${E(rel(img.src))}" alt="${E(img.alt || h1Txt)}" ` +
    `width="${img.width || ""}" height="${img.height || ""}"></figure>` : "";
  const tags = (rec.tags || []).map((t) => `<a class="chip" href="${E(t.path)}">#${E(t.name)}</a>`).join("");
  const faqs = contentHasFaq(body, rec.faqs) ? "" : faqBlock(rec.faqs);
  const relPosts = related(rec).map(postCard).join("");
  return document_(rec, `<article class="post">
  <header class="post-hero"><div class="wrap narrow">
    ${breadcrumb(trail)}
    ${cat ? `<a class="tag" href="${E(cat.path)}">${E(cat.name)}</a>` : ""}
    ${eyebrow ? `<span class="eyebrow">${E(eyebrow)}</span>` : ""}
    <h1>${h1}</h1>
    <div class="post-meta">
      <span>By ${E(rec.author || "Openink Hub")}</span><span>·</span>
      <time datetime="${E(rec.date || "")}">${fmtDate(rec.date || "")}</time><span>·</span>
      <span>${readMinutes(body)} min read</span>
    </div>
  </div></header>
  <div class="wrap narrow">${fig}<div class="prose"><!--seo:content-->${localizeBody(shape(body, false))}<!--/seo:content--></div>
  ${(() => { const k = kitFor(rec, body, false); return k ? `<div class="prose kit">${localizeBody(k)}</div>` : ""; })()}
  ${tags ? `<div class="post-tags">${tags}</div>` : ""}
  <aside class="post-cta"><div><h2>Want results like this for your business?</h2>
  <p>Get a free consultation on SEO, AEO, GEO and AI automation from the Openink Hub team.</p></div>
  <a class="btn btn-primary" href="${E(CFG.contact.demo_url)}" target="_blank" rel="noopener">Book a Free Demo</a></aside>
  </div>
</article>
${faqs}
<section class="section section-alt"><div class="wrap"><h2 class="sec-title">Related articles</h2>
<div class="post-grid">${relPosts}</div></div></section>`, "is-post");
}

// Extra content for category pages (hero, topic cards, decision table, steps, FAQ) — content/categories.json
const CATX = fs.existsSync(path.join(C, "categories.json")) ? load(path.join(C, "categories.json")) : {};

/** City guides grouped by state, from content/city-posts (only guides that exist as pages). */
function cityStates() {
  const dir = path.join(C, "city-posts");
  if (!fs.existsSync(dir)) return [];
  const live = new Set(RECS.filter((r) => !r.draft).map((r) => r.path));
  const by = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const j = load(path.join(dir, f));
    for (const c of Array.isArray(j) ? j : [j]) {
      const p = `/${c.file}/`;
      if (!live.has(p)) continue;
      const list = by.get(c.state) || [];
      if (!list.some((x) => x.city === c.city)) list.push({ city: c.city, path: p });
      by.set(c.state, list);
    }
  }
  return [...by.entries()].map(([state, cities]) => ({ state, cities: cities.sort((a, b) => a.city.localeCompare(b.city)) }))
    .sort((a, b) => b.cities.length - a.cities.length || a.state.localeCompare(b.state));
}

function categoryTpl(rec, posts, x, cards, filters) {
  const h1 = rec.h1 || rec.title;
  let alt = false;
  const secOpen = () => ((alt = !alt) ? "section" : "section section-alt");
  const head = (s) => `<div class="sec-head">${s.eyebrow ? `<span class="eyebrow">${E(s.eyebrow)}</span>` : ""}<h2 class="sec-title">${E(s.title)}</h2>${s.lead ? `<div class="sec-lead"><p>${E(s.lead)}</p></div>` : ""}</div>`;
  const link = (l) => `<a href="${E(l[1])}">${E(l[0])}</a>`;
  const ctas = (x.ctas || []).map((c, i) => `<a class="btn ${i ? "btn-ghost" : "btn-primary"}" href="${E(c.href)}">${E(c.label)}${i ? "" : icon("arrow")}</a>`).join("");
  let out = `<section class="hero hero-about hero-service">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap">
    <div class="hero-copy">${breadcrumb([["Blog", rec.path === "/category/best-seo-content-agency/" ? null : "/category/best-seo-content-agency/"], ...(rec.path === "/category/best-seo-content-agency/" ? [] : [[cut(stripTags(h1), 40), null]])])}
      ${x.eyebrow ? `<span class="eyebrow">${E(x.eyebrow)}</span>` : ""}
      <h1>${E(h1)}</h1>
      <!--seo:content--><p class="lead">${E(x.lead)}</p>${x.quick ? `<div class="quick-answer"><p><strong>Quick answer:</strong> ${E(x.quick)}</p></div>` : ""}<!--/seo:content-->
      <div class="hero-ctas">${ctas}</div>
    </div>
  </div>
</section>`;
  if (x.stats?.length) out += `<section class="section section-tight"><div class="wrap"><!--seo:content--><ul class="about-stats figures">${x.stats.map((s) => `<li><span>${E(s.label)}</span><b>${E(s.value)}</b></li>`).join("")}</ul><!--/seo:content--></div></section>`;
  const b = x.browse || { title: "All articles" };
  out += `<section class="${secOpen()}"><div class="wrap"><!--seo:content-->${head(b)}<!--/seo:content--><div class="chips">${filters}</div><div class="post-grid">${cards}</div></div></section>`;
  if (x.states) {
    const st = cityStates();
    out += `<section class="${secOpen()}"><div class="wrap"><!--seo:content-->${head({ eyebrow: "By state", title: "Find your city by state", lead: `${st.reduce((t, s) => t + s.cities.length, 0)} cities in ${st.length} states and union territories.` })}
<div class="svc-grid svc-cards-auto state-grid">${st.map((s) => `<article class="svc-card"><span class="card-tag">${s.cities.length} ${s.cities.length === 1 ? "guide" : "guides"}</span><h3>${E(s.state)}</h3><p class="state-cities">${s.cities.map((c) => `<a href="${E(c.path)}">${E(c.city)}</a>`).join(" · ")}</p></article>`).join("")}</div><!--/seo:content--></div></section>`;
  }
  for (const s of x.sections || []) {
    let body = "";
    if (s.cards) body = `<div class="svc-grid svc-cards-auto">${s.cards.map((c) => `<article class="svc-card"><h3>${E(c.title)}</h3><p>${E(c.text)}</p>${c.links ? `<ul class="card-links">${c.links.map((l) => `<li>${link(l)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div>`;
    else if (s.table) body = `<div class="c-card"><div class="table-wrap"><table><thead><tr>${s.table.head.map((h) => `<th>${E(h)}</th>`).join("")}</tr></thead><tbody>${s.table.rows.map((r) => `<tr>${r.map((c, k) => `<td>${k ? c : `<strong>${E(c)}</strong>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
    else if (s.lessons) body = `<div class="svc-grid svc-cards-auto lesson-grid">${s.lessons.map((l) => `<a class="svc-card svc-link" href="${E(l.href)}"><span class="num">${E(l.n)}</span><h3>${E(l.title)}</h3><p>${E(l.text)}</p><span class="link-arrow">Start lesson${icon("arrow")}</span></a>`).join("")}</div>`;
    else if (s.steps) body =`<ol class="steps">${s.steps.map((t) => `<li>${E(t)}</li>`).join("")}</ol>`;
    out += `<section class="${secOpen()}"><div class="wrap${s.steps ? " narrow" : ""}"><!--seo:content-->${head(s)}${body}<!--/seo:content--></div></section>`;
  }
  if (rec.faqs?.length) out += `<section class="${secOpen()}"><div class="wrap narrow"><!--seo:content-->${head({ eyebrow: "FAQ", title: "Frequently Asked Questions" })}<div class="faq-list">${rec.faqs.map((f) => `<div class="faq-card"><h3>${E(stripTags(f.q))}</h3><div class="faq-a">${localizeBody(f.a)}</div></div>`).join("")}</div><!--/seo:content--></div></section>`;
  return document_(rec, out, "is-archive is-service is-category");
}

function listingTpl(rec, posts, label) {
  const intro = (rec.content_html || "").replace(/<[^>]+>/g, " ").trim();
  const h1 = rec.h1 || rec.title;
  // images on the first cards only (the rest are text cards), so big archives stay light
  const maxImg = Math.max(0, (RULES.thresholds.pageWeight.maxImagesPerPage || 30) - 6);
  const cards = posts.map((p, i) => postCard(i < maxImg ? p : { ...p, featured_image: null })).join("") || "<p>No articles yet.</p>";
  const months = RECS.filter((r) => r.type === "archive").sort((a, b) => b.path.localeCompare(a.path));
  const filters = CATS.filter((c) => c.count).map((c) =>
    `<a class="chip${c.path === rec.path || (rec.path === "/category/seo-agency-by-city/" && c.slug === "seo-services") ? " is-on" : ""}" href="${E(c.path)}">${E(c.name)}</a>`).join("") +
    months.map((m) => `<a class="chip${m.path === rec.path ? " is-on" : ""}" href="${E(m.path)}">${E(listingLabel(m))}</a>`).join("");
  if (CATX[rec.path]) return categoryTpl(rec, posts, CATX[rec.path], cards, filters);
  return document_(rec, `<!--seo:content--><section class="page-hero page-hero-sm"><div class="wrap">
  ${breadcrumb([[label, null], [h1, null]])}
  <h1>${E(h1)}</h1>
  <p class="lead">${posts.length} article${posts.length !== 1 ? "s" : ""}${intro && len(intro) < 400 ? " · " + E(cut(intro, 200)) : ""}</p>
  <p>Guides from Openink Hub in Ranchi on SEO, AEO, GEO and AIO, Google Business Profile, WhatsApp automation and growing your business online.</p>
  <div class="chips">${filters}</div>
</div></section><!--/seo:content-->
<section class="section"><div class="wrap"><div class="post-grid">${cards}</div></div></section>`, "is-archive");
}

/** Replace <!--hub:NAME--> with a card grid of the guides in content/articles/NAME.json.
 *  Published guides are linked; drafts show "Coming soon" (no link, so search engines never find thin pages). */
function hubGrids(html) {
  return html.replace(/<!--hub:([a-z0-9-]+)-->/g, (m, name) => {
    const f = path.join(C, "articles", `${name}.json`);
    if (!fs.existsSync(f)) return "";
    const items = load(f).items;
    const byPath = new Map(RECS.map((r) => [r.path, r]));
    return `<div class="guide-grid">${items.map((a) => {
      const rec = byPath.get(`/${a.slug}/`);
      const live = rec && !rec.draft;
      const inner = `<span class="g-n">${E(a.n)}</span><h3>${E(a.card_title)}</h3><span class="g-t">${E(a.card_text)}</span>` +
        `<span class="g-s">${live ? "Read the guide →" : "Coming soon"}</span>`;
      return live ? `<a class="guide-card" href="/${E(a.slug)}/">${inner}</a>` : `<div class="guide-card is-soon">${inner}</div>`;
    }).join("")}</div>`;
  });
}

function contactCards() {
  const c = CFG.contact;
  const cards = [["phone", "Call us", c.phone, `tel:${c.phone_raw}`], ["wa", "WhatsApp", "Chat instantly", c.whatsapp],
    ["mail", "Email", c.email, `mailto:${c.email}`], ["map", "Visit", c.address, c.map_url || "#"]];
  return '<section class="section section-tight"><div class="wrap contact-grid">' + cards.map(([i, t, v, h]) =>
    `<a class="contact-card" href="${E(h)}"${h.startsWith("http") ? " target=_blank rel=noopener" : ""}>` +
    `${icon(i)}<strong>${E(t)}</strong><span>${E(v)}</span></a>`).join("") + "</div></section>";
}

function homeTpl(rec) {
  // plain words on the home page too (home.json is not a page record), keeping the home keyphrase
  if (RULES.autofix.simpleWords && !HOME._simple) {
    const keep = [rec.keyphrase, ...(rec.keyphrase_secondary || [])].filter(Boolean);
    const walk = (o) => { for (const [k, v] of Object.entries(o)) { if (k === "_note" || /^(href|url|link|src|path|icon|img|image)$/i.test(k)) continue; if (typeof v === "string") { if (!/^(\/|https?:|#|mailto:|tel:)/.test(v)) o[k] = simplifyHtml(v, keep); } else if (v && typeof v === "object") walk(v); } };
    walk(HOME); HOME._simple = true;
  }
  const H = HOME, hero = H.hero;
  const ext = (h) => (h.startsWith("http") ? " target=_blank rel=noopener" : "");
  const ctas = hero.ctas.map((c) => `<a class="btn btn-${c.style}" href="${E(c.href)}"${ext(c.href)}>${E(c.label)}${c.style === "primary" ? icon("arrow") : ""}</a>`).join("");
  const services = H.services.items.map((s) => `<article class="svc-card"><div class="svc-ico">${icon(s.icon)}</div><h3>${E(s.title)}</h3>
<p>${E(s.text)}</p><a class="link-arrow" href="${E(s.href)}">${E(s.cta)}${icon("arrow")}</a></article>`).join("");
  const era = H.era.items.map((x, i) => `<div class="era-item"><span class="num">0${i + 1}</span><h3>${E(x.title)}</h3><p>${E(x.text)}</p></div>`).join("");
  const missionItems = H.mission.items.map((x) => `<li>${icon("check")}<div><strong>${E(x.title)}</strong><span>${E(x.text)}</span></div></li>`).join("");
  const testi = H.testimonials.items.map((t) => `<figure class="quote"><blockquote>“${E(t.quote)}”</blockquote><figcaption>` +
    `<img src="${E(t.img)}" alt="${E(t.name)}" loading="lazy" width="48" height="48"><strong>${E(t.name)}</strong></figcaption></figure>`).join("");
  const wa = H.whatsapp.items.map((x) => `<div class="wa-item">${icon("check")}<div><h3>${E(x.title)}</h3><p>${E(x.text)}</p></div></div>`).join("");
  const logos = H.clients.logos.map((l) => `<img src="${E(l.img)}" alt="${E(l.name)} logo" loading="lazy">`).join("");
  const sol = H.solutions.links.map((l) => `<a class="sol-link" href="${E(l.href)}">${E(l.label)}${icon("arrow")}</a>`).join("");
  const faqItems = RULES.autofix.plainFaq ? `<div class="faq-list">${H.faq.items.map((f) => `<div class="faq-card"><h3>${E(f.q)}</h3><div class="faq-a"><p>${f.a}</p></div></div>`).join("")}</div>`
    : H.faq.items.map((f) => `<details class="faq"><summary>${E(f.q)}</summary><div class="faq-a"><p>${f.a}</p></div></details>`).join("");
  const latest = POSTS.filter((p) => !p.path.includes("best-seo-agency-in-")).slice(0, 3).map(postCard).join("");
  const blogCat = CATS.find((c) => c.slug === "best-seo-content-agency")?.path || "/";
  return document_(rec, (RULES.autofix.linkText ? (h) => fixLinks(h, titleOf) : (h) => h)(`<!--seo:content--><section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">${E(hero.eyebrow)}</span>
      <h1>${E(hero.h1)}</h1>
      <p class="lead">${E(hero.lead)}</p>
      <div class="hero-ctas">${ctas}</div>
      <div class="quick-answer"><strong>Quick answer:</strong> ${E(hero.quick_answer)}</div>
    </div>
    <div class="hero-visual">
      <img src="${E(hero.image.src)}" alt="${E(hero.image.alt)}" width="1024" height="576" fetchpriority="high">
      <div class="engines"><span>Google</span><span>ChatGPT</span><span>Gemini</span><span>Perplexity</span></div>
    </div>
  </div>
</section>
<section class="logo-strip" aria-label="Clients"><div class="wrap"><p>${E(H.clients.h2)}</p><div class="marquee"><div class="marquee-track">${logos}${logos}</div></div></div></section>
<section class="section" id="services"><div class="wrap">
  <div class="sec-head"><h2 class="sec-title">${E(H.services.h2)}</h2><p>${E(H.services.intro)}</p></div>
  <div class="svc-grid">${services}</div>
</div></section>
<section class="section section-dark"><div class="wrap">
  <div class="sec-head"><span class="eyebrow eyebrow-light">The Tipping Point of the Modern AI Era</span><h2 class="sec-title">${E(H.era.h2)}</h2><p>${E(H.era.intro)}</p></div>
  <div class="era-grid">${era}</div>
</div></section>
<section class="section"><div class="wrap split">
  <div><h2 class="sec-title">${E(H.mission.h2)}</h2>${H.mission.paras.map((p) => `<p>${E(p)}</p>`).join("")}</div>
  <ul class="check-list">${missionItems}</ul>
</div></section>
<section class="section"><div class="wrap platform">
  <div><h2 class="sec-title">${E(H.platform.h2)}</h2><p>${E(H.platform.text)}</p>
  <a class="btn btn-primary" href="${E(H.platform.cta.href)}">${E(H.platform.cta.label)}${icon("arrow")}</a></div>
  <div class="sol-grid"><h3>${E(H.solutions.h2)}</h3><p>${E(H.solutions.text)}</p><div class="sol-links">${sol}</div></div>
</div></section>
<section class="section section-wa"><div class="wrap split">
  <div><span class="eyebrow">WhatsApp AI ChatBot</span><h2 class="sec-title">${E(H.whatsapp.h2)}</h2>
  <a class="btn btn-primary" href="${E(H.whatsapp.cta.href)}">${E(H.whatsapp.cta.label)}${icon("arrow")}</a></div>
  <div class="wa-list">${wa}</div>
</div></section>
<section class="section section-alt"><div class="wrap">
  <div class="sec-head"><h2 class="sec-title">${E(H.testimonials.h2)}</h2></div>
  <div class="quote-grid">${testi}</div>
</div></section>
<section class="section"><div class="wrap">
  <div class="sec-head sec-head-row"><h2 class="sec-title">Latest insights</h2><a class="link-arrow" href="${E(blogCat)}">All articles${icon("arrow")}</a></div>
  <div class="post-grid">${latest}</div>
</div></section>
<section class="section section-alt"><div class="wrap narrow"><h2 class="sec-title">${E(H.faq.h2)}</h2>${faqItems}</div></section><!--/seo:content-->`) + (() => { const k = kitFor(rec, "", false); return k ? `<section class="section kit"><div class="wrap narrow prose">${k}</div></section>` : ""; })(), "is-home");
}

// ---------------------------------------------------------------- output
function write(p, text) {
  let target = path.join(DIST, ...p.replace(/^\/+/, "").split("/"));
  if (p.endsWith("/")) target = path.join(target, "index.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (target.endsWith(".html")) {
    const fx = fixHtml(text, DIST, (/<title>([^<]*)<\/title>/.exec(text) || [])[1] || "");
    text = fx.html;
    if (fx.fixes.length) HTML_FIXES[p] = [...new Set(fx.fixes)].map((f) => `${f}:${fx.fixes.filter((x) => x === f).length}`);
  }
  fs.writeFileSync(target, text, "utf8");
}

function sitemaps() {
  const KIND = { home: "home", post: "posts", page: "pages", category: "categories", tag: "tags", archive: "archives" };
  const groups = {};
  for (const r of RECS) {
    if (r.head.meta.some((m) => m.key === "robots" && m.content.includes("noindex"))) continue;
    (groups[KIND[r.type] || "pages"] ||= []).push(r);
  }
  const stamp = now.toISOString().slice(0, 19) + "+00:00";
  const idx = ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const name of ["home", "posts", "pages", "categories", "tags", "archives"]) {
    const rows = [...(groups[name] || [])].sort((a, b) => (b.lastmod || "").localeCompare(a.lastmod || ""));
    const urls = rows.map((r) => {
      const lm = r.lastmod || r.modified ? `<lastmod>${E(r.lastmod || (r.modified || "") + "+00:00")}</lastmod>` : "";
      return `<url><loc>${E(r.path !== "/" ? r.url : BASE)}</loc>${lm}</url>\n`;
    }).join("");
    write(`/sitemap-${name}.xml`, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n");
    idx.push(`<sitemap><loc>${BASE}/sitemap-${name}.xml</loc><lastmod>${stamp}</lastmod></sitemap>`);
  }
  idx.push("</sitemapindex>\n");
  write("/sitemap.xml", idx.join("\n"));
  write("/sitemap_index.xml", idx.join("\n")); // was live on WordPress too
  write("/robots.txt", "User-agent: *\nAllow: /\n" + (RULES.autofix.robotsDisallowAdmin ? "Disallow: /admin/\n" : "") + "\n" + ["", "home", "posts", "pages", "categories", "tags", "archives"]
    .map((n) => `Sitemap: ${BASE}/sitemap${n ? "-" + n : ""}.xml\n`).join(""));
}

function notFound() {
  const rec = { path: "/404", head: { title: "Page not found | openink Hub", lang: "en-US", links: [], jsonld: [],
    meta: [{ attr: "name", key: "robots", content: "noindex,follow" }] } };
  const latest = POSTS.slice(0, 3).map(postCard).join("");
  write("/404.html", document_(rec, `<section class="page-hero"><div class="wrap narrow center">
<span class="eyebrow">Error 404</span><h1>We couldn’t find that page</h1>
<p class="lead">The link may be outdated. Try one of our services or the latest articles below.</p>
<div class="hero-ctas center"><a class="btn btn-primary" href="/">Back to home</a><a class="btn btn-ghost" href="/best-seo-services-in-india/">Our services</a></div>
</div></section><section class="section"><div class="wrap"><div class="post-grid">${latest}</div></div></section>`));
}

/** _redirects (from Squirrly), _headers (security + noindex for /admin), llms.txt (for AI crawlers). */
function seoFiles() {
  const retiredFile = path.join(C, "seo", "retired.json");
  const retired = fs.existsSync(retiredFile) ? load(retiredFile).redirects || [] : [];
  if ((RULES.autofix.redirects && SQUIRRLY.redirects?.length) || retired.length) {
    const lines = (RULES.autofix.redirects ? SQUIRRLY.redirects || [] : []).flatMap((r) => [`${r.from} ${r.to} ${r.code}`, `${r.from}/ ${r.to} ${r.code}`]);
    const ret = retired.flatMap((r) => [`${r.from} ${r.to} ${r.code}`, `${r.from.replace(/\/$/, "")} ${r.to} ${r.code}`]);
    write("/_redirects", "# Imported from Squirrly SEO (content/seo/squirrly.json). Live URLs are never redirected.\n" + lines.join("\n") + "\n" +
      (ret.length ? "# Retired on purpose (content/seo/retired.json)\n" + ret.join("\n") + "\n" : ""));
  }
  if (RULES.autofix.securityHeaders) {
    write("/_headers", [
      "/*", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: strict-origin-when-cross-origin",
      "  X-Frame-Options: SAMEORIGIN", "  Permissions-Policy: camera=(), microphone=(), geolocation=()", "",
      "/admin/*", "  X-Robots-Tag: noindex, nofollow", "  Cache-Control: no-store", "",
      "/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "",
      "/wp-content/uploads/*", "  Cache-Control: public, max-age=2592000", "",
    ].join("\n"));
  }
  if (RULES.autofix.llmsTxt) {
    const plain = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const indexable = RECS.filter((r) => !r.head.meta.some((m) => m.key === "robots" && /noindex/.test(m.content)));
    const isCity = (r) => (r.categories || []).some((c) => c.path === "/category/seo-agency-by-city/");
    const line = (r) => `- [${plain(r.head.title)}](${BASE}${r.path}): ${plain((r.head.meta.find((m) => m.key === "description") || {}).content || r.excerpt).slice(0, 160)}`;
    const group = (label, list) => (list.length ? [`\n## ${label}\n`, ...list.map(line)] : []);
    write("/llms.txt", [
      "# openink Hub", "",
      "> AI-powered growth engine for startups and SMEs in India: SEO, answer engine optimization (AEO), generative engine optimization (GEO), artificial intelligence optimization (AIO), WhatsApp AI automation, Google Business Profile optimization and AI voice agents. Based in Ranchi, Jharkhand.",
      "", `Contact: ${CFG.contact.email} · ${CFG.contact.phone} · ${CFG.contact.address}`,
      ...group("Services and key pages", indexable.filter((r) => ["home", "page"].includes(r.type))),
      ...group("Guides and articles", indexable.filter((r) => r.type === "post" && !isCity(r))),
      ...group("Website development guides", indexable.filter((r) => r.type === "guide")),
      ...group("SEO city guides", indexable.filter(isCity)),
      ...group("Topics and archives", indexable.filter((r) => ["category", "tag", "archive"].includes(r.type))),
    ].join("\n") + "\n");
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

// Pages and guides with no image in their content get a branded title card (static/images/pages/<slug>.svg),
// placed after the lead paragraph so it counts as a content image (hero_image + text_image_ratio checks).
const NO_COVER = new Set([]);
function addCovers() {
  for (const r of RECS) {
    const slug = r.path.replace(/^\/+|\/+$/g, "");
    if (!["page", "guide"].includes(r.type) || !slug || r.draft || LEGAL.has(slug) || NO_COVER.has(slug)) continue;
    if (/<img\b/.test(r.content_html || "")) continue;
    const h1 = stripTags(r.h1 || r.title || "");
    const title = h1.length <= 90 ? h1 : stripTags(r.head?.title || r.title || h1).replace(/\s*[|–-]\s*openink Hub$/i, "");
    const img = makeCover({ dir: "pages", slug, title, label: r.type === "guide" ? "Website development guide" : "openink Hub" });
    const fig = coverFigure(img);
    // after the first paragraph that follows the H1 (that paragraph becomes the hero lead)
    r.content_html = r.content_html.replace(/(<\/h1>\s*(?:<p>[\s\S]*?<\/p>)?)/, `$1\n${fig}\n`);
    if (!r.content_html.includes(fig)) r.content_html = fig + "\n" + r.content_html;
  }
}

// Service pages with fewer than 3 internal links in their content get a short "Related services" list
// (closest topics first, by shared title words), so visitors and crawlers can move between services.
const RELATED_POOL = (RULES.related_services || []).map((x) => ({ ...x, words: new Set(x.topic.toLowerCase().split(/\W+/)) }));
function addRelatedLinks() {
  const min = RULES.thresholds.internalLinks.min;
  for (const r of RECS) {
    const slug = r.path.replace(/^\/+|\/+$/g, "");
    if (r.type !== "page" || !slug || LEGAL.has(slug) || NO_COVER.has(slug)) continue;
    const have = new Set([...(r.content_html || "").matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]));
    if (have.size >= min) continue;
    const mine = new Set(stripTags(`${r.title} ${r.h1}`).toLowerCase().split(/\W+/));
    const picks = RELATED_POOL.filter((x) => x.path !== r.path && !have.has(x.path))
      .map((x) => ({ x, s: [...x.words].filter((w) => w.length > 2 && mine.has(w)).length }))
      .sort((a, b) => b.s - a.s).slice(0, 4).map(({ x }) => x);
    r.content_html += `\n<h2>Related services</h2>\n<ul>${picks.map((x) => `<li><a href="${x.path}">${E(x.label)}</a></li>`).join("")}</ul>`;
  }
}

function main() {
  if (COPY_MISSES.length) { console.error("copy-edits.json: text not found (page changed?)\n  " + COPY_MISSES.join("\n  ")); process.exit(1); }
  addCovers();
  addRelatedLinks();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "static"), DIST, { recursive: true });
  const byCat = {}, byTag = {}, byMonth = {};
  for (const p of POSTS) {
    for (const c of p.categories || []) (byCat[c.path] ||= []).push(p);
    for (const t of p.tags || []) (byTag[t.path] ||= []).push(p);
    if (p.date) (byMonth[`/${p.date.slice(0, 4)}/${p.date.slice(5, 7)}/`] ||= []).push(p);
  }
  for (const r of RECS) {
    const out = r.type === "home" ? homeTpl(r)
      : r.type === "post" ? postTpl(r)
      : r.type === "category" ? listingTpl(r, byCat[r.path] || [], "Category")
      : r.type === "tag" ? listingTpl(r, byTag[r.path] || [], "Tag")
      : r.type === "archive" ? listingTpl(r, byMonth[r.path] || [], "Archive")
      : pageTpl(r);
    write(r.path, fixAnchors(out));
  }
  sitemaps();
  notFound();
  write("/CNAME", "openinkhub.io\n");
  write("/.nojekyll", "");
  seoFiles();
  fs.mkdirSync(path.join(DIST, "admin"), { recursive: true });
  fs.writeFileSync(path.join(DIST, "admin", "html-fixes.json"), JSON.stringify(HTML_FIXES));

  // sanity: every referenced local asset exists
  const missing = new Set();
  for (const f of walk(DIST).filter((f) => f.endsWith(".html"))) {
    for (const [, src] of fs.readFileSync(f, "utf8").matchAll(/(?:src|href)="(\/wp-content\/[^"?#]+)"/g)) {
      if (!fs.existsSync(path.join(DIST, ...src.slice(1).split("/")))) missing.add(src);
    }
  }
  console.log(`built ${RECS.length} URLs into dist/  (${POSTS.length} posts)`);
  if (missing.size) console.log(`WARNING ${missing.size} referenced assets missing, e.g.:\n  ` + [...missing].sort().slice(0, 10).join("\n  "));
}

main();
