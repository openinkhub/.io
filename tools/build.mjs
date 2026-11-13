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
  .map((n) => load(path.join(C, "pages", n))).filter((r) => r.status === 200 && r.head);
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
    `<div><h3>${E(col.title)}</h3><ul>${col.links.map((l) => `<li><a href="${E(l.href)}">${E(l.label)}</a></li>`).join("")}</ul></div>`).join("");
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
      <a class="brand brand-light" href="/"><img src="${E(CFG.logo)}" alt="" width="32" height="32"><span>openink<b>Hub</b></span></a>
      <p>${E(CFG.footer.about)}</p>
      <ul class="contact-list">
        <li>${icon("map")}<span>${E(c.address)}</span></li>
        <li>${icon("phone")}<a href="tel:${E(c.phone_raw)}">${E(c.phone)}</a></li>
        <li>${icon("mail")}<a href="mailto:${E(c.email)}">${E(c.email)}</a></li>
      </ul>
    </div>
    ${cols}
  </div>
  <div class="wrap foot-bottom">
    <span>© ${now.getFullYear()} ${E(CFG.name)}. All rights reserved.</span>
    <span class="legal">${CFG.footer.legal.map((l) => `<a href="${E(l.href)}">${E(l.label)}</a>`).join(" · ")}</span>
  </div>
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
  const im = img ? `<img src="${E(rel(img.src))}" alt="${E(img.alt || r.title)}" loading="lazy" decoding="async">`
    : `<div class="card-ph">${icon("spark")}</div>`;
  const cat = r.categories?.length ? r.categories[0].name : "Article";
  const ex = r.excerpt || "";
  return `<article class="post-card">
  <a href="${E(r.path)}" class="post-card-img">${im}</a>
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
function splitH1(content, fallback) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(content);
  if (!m) return ["", E(fallback), content];
  const inner = m[1].replace(/<\/?(?!em\b|strong\b|b\b)[a-z0-9]+[^>]*>/g, "").trim();
  let pre = content.slice(0, m.index);
  const post = content.slice(m.index + m[0].length);
  const preTxt = pre.replace(/<[^>]+>/g, " ").trim();
  let eyebrow = "";
  if (preTxt && len(preTxt) < 140 && !pre.includes("<img")) { eyebrow = unescapeHtml(preTxt.replace(/\s+/g, " ")); pre = ""; }
  return [eyebrow, inner, enhance(pre + post)];
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
  const items = faqs.map((f) => `<details class="faq"><summary>${E(f.q.replace(/<[^>]+>/g, ""))}</summary>` +
    `<div class="faq-a">${localizeBody(f.a)}</div></details>`).join("");
  return `<section class="section"><div class="wrap narrow"><h2 class="sec-title">${E(h2)}</h2>${items}</div></section>`;
}

const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "");
const contentHasFaq = (content, faqs) =>
  Boolean(faqs?.length) && faqs.slice(0, 2).every((f) => squash(content).includes(cut(squash(f.q), 40)));

// ---------------------------------------------------------------- templates
const LEGAL = new Set(["privacy-policy", "terms", "refund", "shipping", "disclaimer", "cookie", "report"]);

function pageTpl(rec) {
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
    <div>${breadcrumb([[crumb, null]])}
    ${eyebrow ? `<span class="eyebrow">${E(eyebrow)}</span>` : ""}
    <h1>${h1}</h1>${lead}
    ${legal ? "" : `<div class="hero-ctas"><a class="btn btn-primary" href="${E(CFG.contact.demo_url)}" target="_blank" rel="noopener">Schedule a Free Demo</a><a class="btn btn-ghost" href="/contact-us/">Contact Us</a></div>`}
    </div>${heroImg}
  </div>
</section>
${contact}
<section class="section"><div class="wrap narrow prose">${localizeBody(body)}</div></section>
${faqs}`, "is-page" + (legal ? " is-legal" : ""));
}

function related(rec, n = 3) {
  const cats = new Set((rec.categories || []).map((c) => c.path));
  const pool = POSTS.filter((p) => p.path !== rec.path && (p.categories || []).some((c) => cats.has(c.path)));
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
  <div class="wrap narrow">${fig}<div class="prose">${localizeBody(body)}</div>
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

function listingTpl(rec, posts, label) {
  const intro = (rec.content_html || "").replace(/<[^>]+>/g, " ").trim();
  const h1 = rec.h1 || rec.title;
  const cards = posts.map(postCard).join("") || "<p>No articles yet.</p>";
  const filters = CATS.filter((c) => c.count).map((c) =>
    `<a class="chip${c.path === rec.path ? " is-on" : ""}" href="${E(c.path)}">${E(c.name)}</a>`).join("");
  return document_(rec, `<section class="page-hero page-hero-sm"><div class="wrap">
  ${breadcrumb([[label, null], [h1, null]])}
  <h1>${E(h1)}</h1>
  <p class="lead">${posts.length} article${posts.length !== 1 ? "s" : ""}${intro && len(intro) < 400 ? " · " + E(cut(intro, 200)) : ""}</p>
  <div class="chips">${filters}</div>
</div></section>
<section class="section"><div class="wrap"><div class="post-grid">${cards}</div></div></section>`, "is-archive");
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
  const H = HOME, hero = H.hero;
  const ext = (h) => (h.startsWith("http") ? " target=_blank rel=noopener" : "");
  const ctas = hero.ctas.map((c) => `<a class="btn btn-${c.style}" href="${E(c.href)}"${ext(c.href)}>${E(c.label)}${c.style === "primary" ? icon("arrow") : ""}</a>`).join("");
  const services = H.services.items.map((s) => `<article class="svc-card"><div class="svc-ico">${icon(s.icon)}</div><h3>${E(s.title)}</h3>
<p>${E(s.text)}</p><a class="link-arrow" href="${E(s.href)}">${E(s.cta)}${icon("arrow")}</a></article>`).join("");
  const era = H.era.items.map((x, i) => `<div class="era-item"><span class="num">0${i + 1}</span><h3>${E(x.title)}</h3><p>${E(x.text)}</p></div>`).join("");
  const missionItems = H.mission.items.map((x) => `<li>${icon("check")}<div><strong>${E(x.title)}</strong><span>${E(x.text)}</span></div></li>`).join("");
  const team = H.team.people.map((p) => `<figure class="person"><img src="${E(p.img)}" alt="${E(p.name)}, ${E(p.role)} at Openink Hub" loading="lazy">` +
    `<figcaption><strong>${E(p.name)}</strong><span>${E(p.role)}</span></figcaption></figure>`).join("");
  const testi = H.testimonials.items.map((t) => `<figure class="quote"><blockquote>“${E(t.quote)}”</blockquote><figcaption>` +
    `<img src="${E(t.img)}" alt="${E(t.name)}" loading="lazy" width="48" height="48"><strong>${E(t.name)}</strong></figcaption></figure>`).join("");
  const wa = H.whatsapp.items.map((x) => `<div class="wa-item">${icon("check")}<div><h3>${E(x.title)}</h3><p>${E(x.text)}</p></div></div>`).join("");
  const logos = H.clients.logos.map((l) => `<img src="${E(l.img)}" alt="${E(l.name)}" loading="lazy">`).join("");
  const sol = H.solutions.links.map((l) => `<a class="sol-link" href="${E(l.href)}">${E(l.label)}${icon("arrow")}</a>`).join("");
  const faqItems = H.faq.items.map((f) => `<details class="faq"><summary>${E(f.q)}</summary><div class="faq-a"><p>${f.a}</p></div></details>`).join("");
  const latest = POSTS.filter((p) => !p.path.includes("best-seo-agency-in-")).slice(0, 3).map(postCard).join("");
  const blogCat = CATS.find((c) => c.slug === "best-seo-content-agency")?.path || "/";
  return document_(rec, `<section class="hero">
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
<section class="section section-alt"><div class="wrap">
  <div class="sec-head"><h2 class="sec-title">${E(H.team.h2)}</h2><p>${E(H.team.intro)}</p></div>
  <div class="team-grid">${team}</div>
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
<section class="section section-alt"><div class="wrap narrow"><h2 class="sec-title">${E(H.faq.h2)}</h2>${faqItems}</div></section>`, "is-home");
}

// ---------------------------------------------------------------- output
function write(p, text) {
  let target = path.join(DIST, ...p.replace(/^\/+/, "").split("/"));
  if (p.endsWith("/")) target = path.join(target, "index.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
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
  write("/robots.txt", "User-agent: *\nAllow: /\n\n" + ["", "home", "posts", "pages", "categories", "tags", "archives"]
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

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

function main() {
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
    write(r.path, out);
  }
  sitemaps();
  notFound();
  write("/CNAME", "openinkhub.io\n");
  write("/.nojekyll", "");

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
