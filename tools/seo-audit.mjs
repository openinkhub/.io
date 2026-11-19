/**
 * SEO checklist audit for every page and post (spec: "WP SEO Plugin" checklist, ~70 checks).
 * Runs on the built site in dist/ and writes the /admin report:
 *
 *   dist/admin/report.json   full results (per page, per section, site-level)
 *   dist/admin/report.csv    one row per page with every check status
 *   dist/admin/index.html    report UI (copied from tools/admin/index.html)
 *
 * Thresholds, weights, sections and critical checks come from content/seo/rules.json.
 * Exit code 1 if any page fails a check listed in rules.critical (blocks the deploy).
 *
 *   npm run audit                      (runs after the build)
 *   PSI_API_KEY=... npm run audit      also measures Core Web Vitals via PageSpeed Insights (PSI_LIMIT pages, default 10)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, fixRecord } from "./seo-fix.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PAGES = path.join(ROOT, "content", "pages");
const T = RULES.thresholds, W = RULES.words, SITE = RULES.site;
const BASE = SITE.url;
const NOW = Date.now();

// ---------------------------------------------------------------- check catalogue (spec order)
const G = { basics: "Basics", content: "Content & readability", schema: "Schema & social", tech: "Technical", perf: "Performance", ai: "AEO / GEO / AIO & topical" };
const CHECKS = [
  ["page_name", "Page name", "basics"], ["publish_date", "Publish date", "basics"], ["author", "Author", "basics"],
  ["seo_title", "SEO title", "basics"], ["slug", "Slug", "basics"], ["meta_description", "Meta description", "basics"],
  ["keyphrase", "Keyphrase", "basics"], ["canonical", "Canonical URL", "basics"], ["hero_image", "Hero image", "basics"],
  ["h1", "H1 heading", "basics"], ["indexing", "Google indexing", "basics"], ["authority_signal", "Authority signal", "basics"],
  ["trust_signal", "Trust signal", "basics"], ["sitemap", "Insert in sitemap.xml", "basics"], ["follow", "Follow", "basics"],
  ["seo_score", "SEO score", "basics"], ["readability_score", "Readability score", "content"],
  ["outbound_links", "Outbound links", "content"], ["internal_links", "Internal links", "content"], ["crawling", "Crawling", "tech"],
  ["llm_submit", "Submit to LLM (llms.txt)", "ai"], ["serp", "SERP view", "basics"], ["excerpt", "Excerpt", "basics"],
  ["word_complexity", "Word complexity", "content"], ["transition_words", "Transition words", "content"],
  ["passive_voice", "Passive voice", "content"], ["consecutive_sentences", "Consecutive sentences", "content"],
  ["inclusive_language", "Inclusive language", "content"], ["subheading_distribution", "Subheading distribution", "content"],
  ["paragraph_length", "Paragraph length", "content"], ["sentence_length", "Sentence length", "content"],
  ["word_count", "Word count", "content"], ["text_image_ratio", "Text to image ratio", "content"],
  ["schema_jsonld", "Schema / JSON-LD", "schema"], ["custom_schema", "Custom schema", "schema"],
  ["open_graph", "Open Graph", "schema"], ["twitter_card", "Twitter card", "schema"], ["viewport", "Viewport", "tech"],
  ["images", "Images", "tech"], ["redirects", "Redirects", "tech"], ["not_found", "Not found (404)", "tech"],
  ["broken_links", "Broken links", "tech"], ["robots_txt", "Robots.txt", "tech"], ["llms_txt", "llms.txt", "ai"],
  ["page_speed", "Page speed", "perf"], ["lcp", "Largest Contentful Paint", "perf"], ["inp", "Interaction to Next Paint", "perf"],
  ["cls", "Cumulative Layout Shift", "perf"], ["ttfb", "Time to First Byte", "perf"], ["fcp", "First Contentful Paint", "perf"],
  ["cls_risk", "Layout-shift risk (images without size)", "perf"], ["js_issues", "Frontend JavaScript issues", "perf"],
  ["css_errors", "CSS errors", "perf"], ["crawl_depth", "Crawl depth", "tech"], ["keyword_density", "Keyword density", "ai"],
  ["semantic_coverage", "Semantic keyword coverage", "ai"], ["search_intent", "Search intent match", "ai"],
  ["topical_relevance", "Topical relevance", "ai"], ["content_freshness", "Content freshness", "ai"],
  ["content_uniqueness", "Content uniqueness", "ai"], ["cannibalization", "Cannibalization", "ai"],
  ["faq_optimization", "FAQ optimization", "ai"], ["entity_coverage", "Entity coverage", "ai"],
  ["anchor_text", "Anchor text distribution", "ai"], ["schema_entity_consistency", "Schema entity consistency", "schema"],
  ["breadcrumb_schema", "Breadcrumb schema", "schema"], ["article_schema", "Article schema", "schema"],
  ["organization_schema", "Organization schema", "schema"], ["author_schema", "Author schema", "schema"],
  ["faq_schema_validation", "FAQ schema validation", "schema"],
];
const READABILITY = ["word_complexity", "transition_words", "passive_voice", "consecutive_sentences", "inclusive_language",
  "subheading_distribution", "paragraph_length", "sentence_length"];

// ---------------------------------------------------------------- helpers
const un = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&#x27;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = (h) => un(String(h || "").replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const words = (t) => (t.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []);
// Syllable estimate. Exceptions: common words the vowel-group rule miscounts (silent letters), e.g. business = biz-ness.
const SYL = { business: 2, businesses: 3, every: 2, everything: 3, everyone: 3, everywhere: 3, everyday: 3, several: 2, interest: 2, interested: 3, interesting: 3, different: 2, family: 2, camera: 2, evening: 2, average: 2, favorite: 2, chocolate: 2, vegetable: 3, comfortable: 3, temperature: 3, restaurant: 2, separate: 2, actually: 3, usually: 3, generally: 3, basically: 3, naturally: 3, especially: 3, finally: 3, really: 2 };
const syllables = (w) => { w = w.toLowerCase().replace(/[^a-z]/g, ""); if (SYL[w]) return SYL[w]; if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e|[aeiou]le|[aeiou]les)$/, (m) => (/le?s?$/.test(m) && /^[aeiou]/.test(m) ? m[0] + "l" : "")).replace(/^y/, ""); // silent e in -ile/-ole/-ale (profile, mobile)
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) || []).length); };
const sentencesOf = (t) => t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/).map((s) => s.trim()).filter((s) => words(s).length >= 3);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const r = (status, value, note = "") => ({ status, value, note }); // status: pass | warn | fail | info | na
const kpNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set("a an the in on of for to and or with by at from is are best top your our how what why".split(" "));
const tokens = (s) => kpNorm(s).split(" ").filter((x) => x && !STOP.has(x));
const fileFor = (p) => path.join(DIST, ...p.split("/").filter(Boolean), "index.html");
const attr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];

function typesIn(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => typesIn(n, out));
  else if (node && typeof node === "object") {
    const t = node["@type"]; (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => out.push({ type: x, node }));
    Object.values(node).forEach((v) => typesIn(v, out));
  }
  return out;
}

// ---------------------------------------------------------------- load
const recs = fs.readdirSync(PAGES).filter((n) => n.endsWith(".json")).sort()
  .map((n) => fixRecord(JSON.parse(fs.readFileSync(path.join(PAGES, n), "utf8")))).filter((x) => x.status === 200 && x.head);
// drafts are built but noindex and unlinked: list them, don't score them
const drafts = recs.filter((x) => x.draft).map((x) => ({ path: x.path, title: x.head.title, n: x.n || "" }));
recs.splice(0, recs.length, ...recs.filter((x) => !x.draft));
// paths of the original live site (content/urls.csv): those URLs are kept exactly as they were
const LIVE = new Set(fs.existsSync(path.join(ROOT, "content", "urls.csv")) ? fs.readFileSync(path.join(ROOT, "content", "urls.csv"), "utf8").split("\n").slice(1)
  .map((l) => (l.split(",")[0] || "").replace(/^https?:\/\/[^/]+/, "")).filter(Boolean) : []);
const sectionOf = (rec) => {
  for (const s of RULES.sections) {
    const m = s.match, cats = (rec.categories || []).map((c) => c.path);
    if (m.type && !m.type.includes(rec.type)) continue;
    if (m.category && !cats.includes(m.category)) continue;
    if (m.notCategory && cats.includes(m.notCategory)) continue;
    if (m.has && !rec[m.has]) continue;
    return s.id;
  }
  return "pages";
};

const robotsTxt = fs.existsSync(path.join(DIST, "robots.txt")) ? fs.readFileSync(path.join(DIST, "robots.txt"), "utf8") : "";
const llmsTxt = fs.existsSync(path.join(DIST, "llms.txt")) ? fs.readFileSync(path.join(DIST, "llms.txt"), "utf8") : "";
const redirectsTxt = fs.existsSync(path.join(DIST, "_redirects")) ? fs.readFileSync(path.join(DIST, "_redirects"), "utf8") : "";
const redirects = redirectsTxt.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/)).map(([from, to, code]) => ({ from, to, code }));
const sitemapUrls = new Set(fs.readdirSync(DIST).filter((n) => /^sitemap-.*\.xml$/.test(n))
  .flatMap((n) => [...fs.readFileSync(path.join(DIST, n), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/\/?$/, "/"))));
const disallow = [...robotsTxt.matchAll(/^Disallow:\s*(\S+)/gim)].map((m) => m[1]);
const css = fs.existsSync(path.join(DIST, "assets/css/site.css")) ? fs.readFileSync(path.join(DIST, "assets/css/site.css"), "utf8") : "";

// parse every page once
const pages = recs.map((rec) => {
  const html = fs.existsSync(fileFor(rec.path)) ? fs.readFileSync(fileFor(rec.path), "utf8") : "";
  const head = (/<head>([\s\S]*?)<\/head>/.exec(html) || [])[1] || "";
  const main = (/<main[^>]*>([\s\S]*?)<\/main>/.exec(html) || [])[1] || "";
  const regions = [...html.matchAll(/<!--seo:content-->([\s\S]*?)<!--\/seo:content-->/g)].map((m) => m[1]);
  const content = regions.join("\n") || main;
  const metaMap = {};
  for (const m of head.matchAll(/<meta (name|property)="([^"]+)" content="([^"]*)">/g)) metaMap[m[2]] = un(m[3]);
  let jsonldOk = true; const jsonld = [];
  for (const m of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { jsonld.push(JSON.parse(m[1])); } catch { jsonldOk = false; } }
  const links = [...main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: attr(m[1], "href") || "", text: text(m[2]), inContent: false }));
  const contentLinks = [...content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: attr(m[1], "href") || "", text: text(m[2]) }));
  const allLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  return { rec, html, head, main, content, metaMap, jsonld, jsonldOk, links, contentLinks, allLinks, section: sectionOf(rec) };
});
const byPath = new Map(pages.map((p) => [p.rec.path, p]));

// link graph -> crawl depth (BFS from home)
const isInternal = (h) => h.startsWith("/") && !h.startsWith("//");
const norm = (h) => { const p = h.split(/[?#]/)[0]; return p.endsWith("/") || /\.\w+$/.test(p) ? p : p + "/"; };
const depth = new Map([["/", 0]]); const queue = ["/"];
while (queue.length) {
  const cur = queue.shift(); const pg = byPath.get(cur); if (!pg) continue;
  for (const h of pg.allLinks.filter(isInternal).map(norm)) if (!depth.has(h) && byPath.has(h)) { depth.set(h, depth.get(cur) + 1); queue.push(h); }
}
const exists = (h) => {
  const p = h.split(/[?#]/)[0];
  if (byPath.has(norm(p))) return true;
  const f = path.join(DIST, ...decodeURIComponent(p).split("/").filter(Boolean));
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return true;
  if (fs.existsSync(path.join(f, "index.html"))) return true;
  return redirects.some((r) => r.from === p || r.from === p.replace(/\/$/, ""));
};

// uniqueness: 8-word shingles on content text (navigation link lists such as the city chips are not content)
const shingles = new Map(pages.map((p) => {
  const w = words(text(p.content.replace(/<ul class="chips">[\s\S]*?<\/ul>/g, " ")).toLowerCase()); const s = new Set();
  for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(" "));
  return [p.rec.path, s];
}));
const kpGroups = new Map();
for (const p of pages) { const k = kpNorm(p.rec.keyphrase); if (!k) continue; (kpGroups.get(k) || kpGroups.set(k, []).get(k)).push(p.rec.path); }
const orgNames = new Set(pages.flatMap((p) => typesIn(p.jsonld).filter((t) => t.type === "Organization" && t.node.name).map((t) => kpNorm(t.node.name))));

// optional Core Web Vitals via PageSpeed Insights
const psi = new Map();
async function measurePsi() {
  const key = process.env.PSI_API_KEY; if (!key) return;
  const limit = Number(process.env.PSI_LIMIT) || 10;
  const targets = pages.filter((p) => p.section === "pages").slice(0, limit);
  for (const p of targets) {
    try {
      const u = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&url=${encodeURIComponent(BASE + p.rec.path)}&key=${key}`;
      const j = await (await fetch(u)).json();
      const a = j.lighthouseResult?.audits || {}, f = j.loadingExperience?.metrics || {};
      psi.set(p.rec.path, {
        lcp: f.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? a["largest-contentful-paint"]?.numericValue,
        inp: f.INTERACTION_TO_NEXT_PAINT?.percentile, cls: f.CUMULATIVE_LAYOUT_SHIFT_SCORE ? f.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : a["cumulative-layout-shift"]?.numericValue,
        ttfb: f.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? a["server-response-time"]?.numericValue,
        fcp: f.FIRST_CONTENTFUL_PAINT_MS?.percentile ?? a["first-contentful-paint"]?.numericValue, source: f.LARGEST_CONTENTFUL_PAINT_MS ? "field (CrUX)" : "lab (Lighthouse)",
      });
    } catch (e) { console.warn("  PSI failed for", p.rec.path, e.message); }
  }
}

// ---------------------------------------------------------------- per-page checks
function audit(p) {
  const { rec, metaMap, content } = p;
  const c = {};
  const url = BASE + rec.path;
  const title = rec.head.title || "";
  const desc = metaMap.description || "";
  const robots = (metaMap.robots || "").toLowerCase();
  const kp = rec.keyphrase || ""; const kpn = kpNorm(kp); const kpTok = tokens(kp);
  const isPost = rec.type === "post", isListing = ["category", "tag", "archive"].includes(rec.type) && !rec.keyphrase_override; // listing pages with their own copy and keyphrase get the full checks
  const ctext = text(content);
  const w = words(ctext); const wc = w.length;
  // Every block element (heading, paragraph, list item, cell, button…) ends a sentence, as in Yoast/Flesch tools;
  // otherwise headings and link lists without full stops merge into giant fake "sentences".
  const blocks = content.replace(/<\/(h[1-6]|p|li|td|th|dt|dd|summary|blockquote|figcaption|button|a|span|strong|div|section|article|header|footer|figure|ul|ol|tr)>/gi, " ¶ ")
    .replace(/<br\s*\/?>/gi, " ¶ ");
  const sents = text(blocks).split("¶").flatMap((b) => sentencesOf(b.trim()));
  const h1s = [...p.html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]));
  const subheads = [...content.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g)].map((m) => text(m[1]));
  const paras = [...content.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)].map((m) => text(m[1])).filter(Boolean); // not <path>/<picture>
  const imgs = [...p.main.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  // logos and icons are decoration, not illustrations, so they don't count towards the text-to-image ratio
  const contentImgs = [...content.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/alt="[^"]*\blogo\b/i.test(t) && !/class="[^"]*\b(logo|client|icon)/i.test(t));
  const types = typesIn(p.jsonld); const typeSet = new Set(types.map((t) => t.type));
  const short = wc < 150; // readability metrics are meaningless on very short pages

  c.page_name = r(rec.title || rec.h1 ? "pass" : "fail", text(rec.h1 || rec.title));
  c.publish_date = isPost ? r(rec.date ? "pass" : "fail", rec.date?.slice(0, 10) || "missing") : r("info", rec.date?.slice(0, 10) || "—");
  c.author = isPost ? r(rec.author ? "pass" : "warn", rec.author || "missing") : r("info", rec.author || "—");
  c.seo_title = !title ? r("fail", "missing")
    : r(title.length >= T.title.min && title.length <= T.title.max ? "pass" : "warn", `${title.length} chars`, title.length > T.title.max ? `longer than ${T.title.max}; may be truncated in Google` : title.length < T.title.min ? `shorter than ${T.title.min}` : "");
  const slug = rec.path.split("/").filter(Boolean).pop() || "";
  const slugOk = rec.path === "/" || (/^[a-z0-9-]+$/.test(slug) && slug.length <= T.slug.maxLength && slug.split("-").length <= T.slug.maxWords);
  c.slug = slugOk ? r("pass", rec.path) : LIVE.has(rec.path) ? r("info", rec.path, "original live URL kept (URLs are never changed)")
    : r("warn", rec.path, `use lowercase words and hyphens, ≤${T.slug.maxWords} words`);
  c.meta_description = !desc ? r("fail", "missing")
    : r(desc.length >= T.description.min && desc.length <= T.description.max ? "pass" : "warn", `${desc.length} chars`, desc.length > T.description.max ? "may be truncated" : desc.length < T.description.min ? "too short" : "");
  const inTitle = kpTok.every((t) => kpNorm(title).includes(t)), inDesc = kpTok.every((t) => kpNorm(desc).includes(t));
  const inH1 = kpTok.every((t) => kpNorm(h1s[0] || "").includes(t)), inSlug = kpTok.some((t) => slug.includes(t));
  const inFirst = kpTok.every((t) => kpNorm((paras[0] || "") + " " + (paras[1] || "")).includes(t));
  const kpHits = [inTitle, inDesc, inH1, inSlug, inFirst].filter(Boolean).length;
  c.keyphrase = isListing ? r("na", "listing page") : !kp ? r("fail", "none") : r(kpHits >= 4 ? "pass" : kpHits >= 2 ? "warn" : "fail", `${kp} (${rec.keyphrase_source})`,
    `in title ${inTitle ? "✓" : "✗"} · description ${inDesc ? "✓" : "✗"} · H1 ${inH1 ? "✓" : "✗"} · slug ${inSlug ? "✓" : "✗"} · intro ${inFirst ? "✓" : "✗"}`);
  const canon = (/<link rel="canonical" href="([^"]+)"/.exec(p.head) || [])[1] || "";
  c.canonical = !canon ? r("fail", "missing") : r(canon.replace(/\/?$/, "/") === url.replace(/\/?$/, "/") ? "pass" : "warn", canon, canon.replace(/\/?$/, "/") === url.replace(/\/?$/, "/") ? "self-referencing" : "points to another URL");
  const ogImg = metaMap["og:image"]; const firstImg = imgs.find((t) => !/favicon/.test(attr(t, "src") || ""));
  c.hero_image = r(ogImg && firstImg ? "pass" : ogImg || firstImg ? "warn" : "fail", ogImg ? "og:image set" : "no og:image", firstImg ? "" : "no image in page body");
  c.h1 = h1s.length !== 1 ? r("fail", `${h1s.length} H1 tags`) : r("pass", h1s[0].slice(0, 90));
  c.indexing = r(/noindex/.test(robots) ? "fail" : "pass", robots || "index (default)");
  const outbound = p.contentLinks.filter((l) => /^https?:\/\//.test(l.href) && !l.href.includes("openinkhub.io"));
  const authority = outbound.filter((l) => W.authority_domains.some((d) => { try { const h = new URL(l.href).hostname; return d.startsWith(".") ? h.endsWith(d) : h === d || h.endsWith("." + d); } catch { return false; } }));
  c.authority_signal = r(authority.length ? "pass" : isPost ? "warn" : "info", `${authority.length} authoritative citation(s)`, authority.length ? "" : "cite a primary source (Google docs, schema.org, government, standards)");
  const hasOrg = typeSet.has("Organization");
  const trustBits = [hasOrg, /info@openinkhub\.io|tel:/.test(p.html), !isPost || !!rec.author, !isPost || !!rec.date];
  c.trust_signal = r(trustBits.every(Boolean) ? "pass" : "warn", `${trustBits.filter(Boolean).length}/4`, "organization schema · contact details · author · date");
  const inSitemap = sitemapUrls.has(url.replace(/\/?$/, "/")) || (rec.path === "/" && sitemapUrls.has(BASE + "/"));
  c.sitemap = /noindex/.test(robots) ? r(inSitemap ? "warn" : "pass", inSitemap ? "listed but noindex" : "excluded (noindex)") : r(inSitemap ? "pass" : "fail", inSitemap ? "listed" : "missing from sitemap");
  c.follow = r(/nofollow/.test(robots) ? "warn" : "pass", /nofollow/.test(robots) ? "nofollow" : "follow");
  c.outbound_links = r(outbound.length || !isPost ? "pass" : "warn", `${outbound.length} external`, isPost && !outbound.length ? `posts should link at least ${T.outboundLinks.minForPosts} external source` : "");
  const internal = p.contentLinks.filter((l) => isInternal(l.href));
  c.internal_links = isListing ? r("info", `${p.links.filter((l) => isInternal(l.href)).length} in page`) : r(internal.length >= T.internalLinks.min ? "pass" : "warn", `${internal.length} in content`, internal.length < T.internalLinks.min ? `aim for ${T.internalLinks.min}+ contextual links` : "");
  const blocked = disallow.some((d) => rec.path.startsWith(d));
  c.crawling = r(p.html && !blocked ? "pass" : "fail", p.html ? (blocked ? "blocked by robots.txt" : `200 · depth ${depth.get(rec.path) ?? "?"}`) : "not built");
  c.llm_submit = r(llmsTxt.includes(url.replace(/\/?$/, rec.path === "/" ? "/" : "/")) || llmsTxt.includes(BASE + rec.path) ? "pass" : "warn", llmsTxt.includes(BASE + rec.path) ? "listed in llms.txt" : "not in llms.txt");
  c.serp = r("info", title.slice(0, 60) + (title.length > 60 ? "…" : ""), desc.slice(0, 158) + (desc.length > 158 ? "…" : ""));
  c.excerpt = r(rec.excerpt ? "pass" : isPost ? "warn" : "info", rec.excerpt ? `${rec.excerpt.length} chars` : "missing");

  // readability
  if (short) for (const id of [...READABILITY, "readability_score"]) c[id] = r("na", "too little text", `${wc} words`);
  else {
    // all readability scores are measured on prose: short fragments (menu labels, table cells, buttons, step names,
    // card titles) are not sentences, so they are left out of Flesch, word complexity, transitions and repeats alike
    const prose = sents.filter((s) => words(s).length >= (T.transitionWords.minSentenceWords || 1));
    const pw = prose.flatMap((s) => words(s)), pwc = Math.max(1, pw.length);
    const syl = pw.reduce((t, x) => t + syllables(x), 0);
    const flesch = Math.round(206.835 - 1.015 * (pwc / Math.max(1, prose.length)) - 84.6 * (syl / pwc));
    const complex = pct(pw.filter((x) => syllables(x) >= 3).length, pwc);
    c.word_complexity = r(complex <= T.wordComplexity.maxPercentComplex ? "pass" : "warn", `${complex}% complex words`);
    const tw = new RegExp(`\\b(${W.transition.map((x) => x.replace(/ /g, "\\s+")).join("|")})\\b`, "i");
    const trans = pct(prose.filter((s) => tw.test(s)).length, prose.length);
    c.transition_words = r(trans >= T.transitionWords.minPercent ? "pass" : "warn", `${trans}% of ${prose.length} sentences`);
    const passive = pct(sents.filter((s) => /\b(is|are|was|were|be|been|being|get|gets|got)\s+(\w+ly\s+)?\w+(ed|en)\b/i.test(s)).length, sents.length);
    c.passive_voice = r(passive <= T.passiveVoice.maxPercent ? "pass" : "warn", `${passive}% of sentences`);
    let run = 1, maxRun = 1, prev = "";
    for (const s of prose) { const f = (words(s)[0] || "").toLowerCase(); run = f && f === prev ? run + 1 : 1; maxRun = Math.max(maxRun, run); prev = f; } // prose only, like transitions
    c.consecutive_sentences = r(maxRun <= T.consecutiveSentences.maxRun ? "pass" : "warn", `max ${maxRun} in a row start the same`);
    const flagged = W.inclusive.filter((x) => new RegExp(`\\b${x.replace(/[/]/g, "\\/")}\\b`, "i").test(ctext));
    c.inclusive_language = r(flagged.length ? "warn" : "pass", flagged.length ? flagged.join(", ") : "none flagged");
    const segs = content.split(/<h[23][^>]*>/).map((s) => words(text(s)).length);
    const longSeg = Math.max(...segs);
    c.subheading_distribution = r(longSeg <= T.subheadingDistribution.maxWordsWithoutHeading ? "pass" : "warn", `longest section ${longSeg} words`);
    const longParas = paras.filter((x) => words(x).length > T.paragraphLength.maxWords).length;
    c.paragraph_length = r(longParas ? "warn" : "pass", `${longParas} paragraph(s) > ${T.paragraphLength.maxWords} words`);
    const longS = pct(sents.filter((s) => words(s).length > T.sentenceLength.longSentenceWords).length, sents.length);
    c.sentence_length = r(longS <= T.sentenceLength.maxPercentLong ? "pass" : "warn", `${longS}% > ${T.sentenceLength.longSentenceWords} words`);
    const fStatus = flesch >= T.readability.minFleschGood ? "pass" : flesch >= T.readability.minFleschOk ? "warn" : "fail";
    c.readability_score = r(fStatus, `Flesch ${flesch}`, flesch >= 60 ? "easy" : flesch >= 50 ? "fairly easy" : flesch >= 30 ? "fairly difficult (normal for B2B)" : "difficult");
  }
  const minWords = T.wordCount[rec.type] ?? 300;
  c.word_count = r(minWords === 0 || wc >= minWords ? "pass" : wc >= minWords * 0.6 ? "warn" : "fail", `${wc} words`, minWords ? `target ${minWords}+` : "");
  c.text_image_ratio = contentImgs.length ? r(wc / contentImgs.length >= T.textToImage.minWordsPerImage ? "pass" : "warn", `${Math.round(wc / contentImgs.length)} words per image`) : r(isListing ? "info" : "warn", "no images in content", "add at least one relevant image");

  // schema & social
  const std = new Set(["Organization", "WebSite", "WebPage", "Article", "BlogPosting", "BreadcrumbList", "ListItem", "Person", "FAQPage", "Question", "Answer", "ImageObject", "CollectionPage", "Service", "City", "State", "PostalAddress", "GeoCoordinates", "ContactPoint", "OpeningHoursSpecification", "Country", "Thing", "SearchAction", "EntryPoint", "PropertyValueSpecification", "ReadAction", "Place", "LocalBusiness", "ProfessionalService"]);
  c.schema_jsonld = !p.jsonldOk ? r("fail", "invalid JSON-LD") : p.jsonld.length ? r("pass", [...typeSet].filter((t) => !["ListItem", "Question", "Answer", "ImageObject", "EntryPoint", "SearchAction", "PropertyValueSpecification", "ReadAction"].includes(t)).join(", ")) : r("fail", "no JSON-LD");
  const custom = [...typeSet].filter((t) => !std.has(t));
  c.custom_schema = r("info", custom.length ? custom.join(", ") : "none");
  const og = ["og:title", "og:description", "og:image", "og:url", "og:type"].filter((k) => metaMap[k]);
  c.open_graph = r(og.length === 5 ? "pass" : og.length >= 3 ? "warn" : "fail", `${og.length}/5 tags`);
  const tw2 = ["twitter:card", "twitter:title", "twitter:description", "twitter:image"].filter((k) => metaMap[k]);
  c.twitter_card = r(tw2.length === 4 ? "pass" : tw2.length >= 2 ? "warn" : "fail", `${tw2.length}/4 tags`);
  c.viewport = r(/name="viewport"/.test(p.head) ? "pass" : "fail", /width=device-width/.test(p.head) ? "width=device-width" : "missing");
  const noAlt = imgs.filter((t) => !/\salt=/.test(t)).length, noDim = imgs.filter((t) => !/\swidth="\d+"/.test(t) || !/\sheight="\d+"/.test(t)).length;
  const notLazy = contentImgs.slice(1).filter((t) => !/loading="lazy"/.test(t)).length;
  c.images = r(noAlt ? "fail" : noDim || notLazy ? "warn" : "pass", `${imgs.length} images`, `${noAlt} without alt · ${noDim} without size · ${notLazy} below-fold not lazy`);
  const inbound = redirects.filter((x) => norm(x.to) === rec.path && !x.from.endsWith("/"));
  c.redirects = r("info", inbound.length ? `${inbound.length} old URL(s) redirect here` : "none", inbound.map((x) => x.from).join(", "));
  c.not_found = r(fs.existsSync(path.join(DIST, "404.html")) ? "pass" : "fail", "custom 404 page", "site-wide");
  const broken = [...new Set(p.allLinks.filter(isInternal).filter((h) => !exists(h)))];
  c.broken_links = r(broken.length ? "fail" : "pass", `${broken.length} broken internal link(s)`, broken.slice(0, 5).join(", "));
  c.robots_txt = r(robotsTxt && /Sitemap:/i.test(robotsTxt) && !blocked ? "pass" : "fail", blocked ? "page blocked" : "allowed · sitemap declared");
  c.llms_txt = r(llmsTxt ? "pass" : "fail", llmsTxt ? `${llmsTxt.split("\n").filter((l) => l.startsWith("- [")).length} pages listed` : "missing");

  // performance
  const kb = Math.round(Buffer.byteLength(p.html) / 1024);
  c.page_speed = r(kb <= T.pageWeight.maxHtmlKB && imgs.length <= (T.pageWeight.maxImagesPerPageOverrides?.[rec.path] ?? T.pageWeight.maxImagesPerPage) ? "pass" : "warn", `${kb} KB HTML · ${imgs.length} images · ${(p.html.match(/<script\b[^>]*src=/g) || []).length} scripts`, "static build, CDN-cached");
  const m = psi.get(rec.path);
  const vital = (val, good, poor, unit) => val == null ? r("na", "not measured", "set PSI_API_KEY to measure with PageSpeed Insights") : r(val <= good ? "pass" : val <= poor ? "warn" : "fail", unit === "s" ? `${(val / 1000).toFixed(2)} s` : unit === "" ? val.toFixed(3) : `${Math.round(val)} ms`, m?.source || "");
  c.lcp = vital(m?.lcp, 2500, 4000, "s"); c.inp = vital(m?.inp, 200, 500, "ms"); c.cls = vital(m?.cls, 0.1, 0.25, "");
  c.ttfb = vital(m?.ttfb, 800, 1800, "ms"); c.fcp = vital(m?.fcp, 1800, 3000, "s");
  c.cls_risk = r(noDim ? "warn" : "pass", `${noDim} image(s) without width/height`);
  const jsBad = [/\son(click|load|error|mouseover)=/i.test(p.main) && "inline event handlers", /document\.write/.test(p.html) && "document.write", /href="javascript:/i.test(p.html) && "javascript: links",
    /<head>[\s\S]*<script\b(?![^>]*\b(defer|async|type="application\/ld\+json"))[^>]*src=/.test(p.html) && "render-blocking script in head"].filter(Boolean);
  c.js_issues = r(jsBad.length ? "warn" : "pass", jsBad.length ? jsBad.join(", ") : "none found");
  c.css_errors = r(cssErrors.length ? "warn" : "pass", cssErrors.length ? cssErrors.join("; ") : "site.css parses cleanly", "site-wide");
  const d = depth.get(rec.path);
  c.crawl_depth = r(d == null ? "fail" : d <= T.crawlDepth.max ? "pass" : "warn", d == null ? "orphan (not linked)" : `${d} click(s) from home`);

  // AEO / GEO / topical
  const occ = kpn ? (kpNorm(ctext).match(new RegExp(`\\b${kpn.replace(/ /g, "\\s+")}\\b`, "g")) || []).length : 0;
  const dens = wc ? Math.round((occ / wc) * 1000) / 10 : 0;
  c.keyword_density = !kpn || short ? r("na", short ? "too little text" : "no keyphrase") : r(dens >= T.keyphraseDensity.min && dens <= T.keyphraseDensity.max ? "pass" : "warn", `${dens}% (${occ}×)`, dens < T.keyphraseDensity.min ? "use the keyphrase a little more" : dens > T.keyphraseDensity.max ? "possible keyword stuffing" : "");
  const sem = (rec.keyphrase_secondary?.length ? rec.keyphrase_secondary : ["SEO", "AEO", "GEO", "AIO"]).slice(0, 8);
  // a related term counts as covered when ≥75% of its meaningful words appear (topic coverage, not exact phrase;
  // simple stemming so "personalisation"/"personalization" and plurals match)
  const stem = (w) => w.replace(/isation$|ization$/, "iz").replace(/ies$/, "y").replace(/(ing|ed|es|s)$/, "");
  const ctoks = new Set(kpNorm(ctext + " " + title).split(" ").map(stem));
  const semHit = sem.filter((x) => { const t = tokens(x).map(stem); return t.length && t.filter((w) => ctoks.has(w)).length / t.length >= 0.75; });
  c.semantic_coverage = isListing ? r("na", "listing page") : r(semHit.length / sem.length >= 0.6 ? "pass" : semHit.length ? "warn" : "fail", `${semHit.length}/${sem.length} related terms`, sem.filter((x) => !semHit.includes(x)).slice(0, 4).join(", "));
  const tn = kpNorm(kp + " " + title);
  const intent = W.informational.some((x) => tn.split(" ").includes(x)) ? "informational" : W.commercial.some((x) => tn.split(" ").includes(x)) ? "commercial" : "navigational";
  const hasCta = /calendly\.com|\/contact-us\//.test(p.html);
  const intentOk = intent === "commercial" ? hasCta && wc >= 200 : intent === "informational" ? subheads.length >= 2 && wc >= 300 : true;
  c.search_intent = isListing ? r("info", "listing") : r(intentOk ? "pass" : "warn", intent, intent === "commercial" ? "needs a clear CTA and service detail" : intent === "informational" ? "needs structured answers (H2s) and depth" : "");
  const topicalHits = kpTok.length ? kpTok.filter((t) => subheads.some((h) => kpNorm(h).includes(t))).length : 0;
  c.topical_relevance = !kpTok.length || isListing ? r("na", "—") : r(topicalHits / kpTok.length >= 0.5 ? "pass" : "warn", `${topicalHits}/${kpTok.length} keyphrase terms in subheadings`);
  const mod = Date.parse(rec.modified || rec.date || "");
  const age = isNaN(mod) ? null : Math.round((NOW - mod) / 864e5);
  c.content_freshness = age == null ? r("info", "no date") : r(age <= T.freshness.warnAfterDays ? "pass" : age <= T.freshness.failAfterDays ? "warn" : "fail", `updated ${age} day(s) ago`);
  let maxOv = 0, twin = "";
  const mine = shingles.get(rec.path);
  if (mine.size > 20) for (const [k, s] of shingles) { if (k === rec.path || s.size < 20) continue; let x = 0; for (const a of mine) if (s.has(a)) x++; const v = x / Math.min(mine.size, s.size); if (v > maxOv) { maxOv = v; twin = k; } }
  c.content_uniqueness = isListing ? r("na", "listing page (lists other pages)") : mine.size <= 20 ? r("na", "too little text") : r(maxOv >= T.uniqueness.maxOverlapFail ? "fail" : maxOv >= T.uniqueness.maxOverlapWarn ? "warn" : "pass", `${Math.round(maxOv * 100)}% max overlap`, maxOv >= T.uniqueness.maxOverlapWarn ? `with ${twin}` : "");
  const same = (kpGroups.get(kpn) || []).filter((x) => x !== rec.path);
  c.cannibalization = !kpn || isListing ? r("na", "no keyphrase") : r(same.length ? "warn" : "pass", same.length ? `${same.length} other page(s) target "${kp}"` : "unique keyphrase", same.join(", "));
  const faqQs = (rec.faqs || []).length || (content.match(/<summary>|<h3>[^<]*\?<\/h3>/g) || []).length;
  c.faq_optimization = isListing ? r("na", "—") : r(faqQs >= T.faq.minQuestions && typeSet.has("FAQPage") ? "pass" : faqQs ? "warn" : "warn", `${faqQs} question(s)${typeSet.has("FAQPage") ? " + FAQ schema" : ""}`, faqQs < T.faq.minQuestions ? `add ${T.faq.minQuestions}+ FAQs for answer engines` : "");
  const entList = RULES.entities_by_section?.[p.section] || SITE.entities;
  const ents = entList.filter((e) => kpNorm(ctext + " " + title).includes(kpNorm(e)));
  c.entity_coverage = r(ents.length >= 3 ? "pass" : ents.length ? "warn" : "fail", `${ents.length}/${entList.length} entities`, ents.join(", "));
  const anchors = p.contentLinks.filter((l) => l.text);
  const generic = anchors.filter((l) => W.generic_anchors.includes(l.text.toLowerCase().replace(/[^a-z ]/g, "").trim()));
  c.anchor_text = !anchors.length ? r("na", "no links in content") : r(pct(generic.length, anchors.length) <= T.anchors.maxPercentGeneric ? "pass" : "warn", `${pct(generic.length, anchors.length)}% generic anchors`, generic.slice(0, 3).map((g) => `"${g.text}"`).join(", "));
  const pageOrgNames = new Set(types.filter((t) => t.type === "Organization" && t.node.name).map((t) => kpNorm(t.node.name)));
  c.schema_entity_consistency = r(pageOrgNames.size <= 1 && [...pageOrgNames].every((n) => n.includes("openink")) ? "pass" : "warn", [...pageOrgNames].join(" / ") || "no Organization", orgNames.size > 1 ? `${orgNames.size} organization name variants site-wide` : "");
  c.breadcrumb_schema = rec.path === "/" ? r("na", "home") : r(typeSet.has("BreadcrumbList") ? "pass" : "fail", typeSet.has("BreadcrumbList") ? "present" : "missing");
  c.article_schema = isPost ? r(typeSet.has("Article") || typeSet.has("BlogPosting") ? "pass" : "fail", typeSet.has("Article") ? "Article" : typeSet.has("BlogPosting") ? "BlogPosting" : "missing") : r("na", "not a post");
  c.organization_schema = r(hasOrg ? "pass" : "fail", hasOrg ? "present" : "missing");
  const authorNode = types.find((t) => t.type === "Person" && t.node.name);
  c.author_schema = isPost ? r(authorNode ? "pass" : "fail", authorNode ? authorNode.node.name : "missing") : r(authorNode ? "pass" : "info", authorNode ? authorNode.node.name : "—");
  const faqNodes = types.filter((t) => t.type === "FAQPage");
  if (!faqNodes.length) c.faq_schema_validation = r("na", "no FAQ schema");
  else {
    const qs = faqNodes.flatMap((f) => [].concat(f.node.mainEntity || []));
    const bad = qs.filter((q) => !q.name || !q.acceptedAnswer?.text);
    const invisible = qs.filter((q) => q.name && !kpNorm(ctext).includes(kpNorm(q.name).slice(0, 40)));
    c.faq_schema_validation = r(bad.length ? "fail" : invisible.length ? "warn" : "pass", `${qs.length} question(s)`, bad.length ? `${bad.length} incomplete` : invisible.length ? `${invisible.length} not visible on page` : "all valid and visible");
  }

  // legal / utility pages (privacy, terms, refund...): marketing checks such as keyphrase, images and FAQs don't apply
  const legal = RULES.legal || {};
  if ((legal.paths || []).includes(rec.path)) for (const id of legal.skip || []) if (c[id] && c[id].status !== "pass") c[id] = r("na", "legal page", c[id].value || "");

  // scores
  const score = (ids) => { let t = 0, s = 0; for (const id of ids) { const x = c[id]; if (!x || !["pass", "warn", "fail"].includes(x.status)) continue; const wgt = RULES.weights[id] ?? 1; t += wgt; s += wgt * (x.status === "pass" ? 1 : x.status === "warn" ? 0.5 : 0); } return t ? Math.round((s / t) * 100) : null; };
  const seoScore = score(Object.keys(RULES.weights));
  c.seo_score = r(seoScore >= 80 ? "pass" : seoScore >= 60 ? "warn" : "fail", `${seoScore}/100`);
  const readScore = short ? null : score([...READABILITY, "readability_score"]);
  if (!short) c.readability_score.value += ` · ${readScore}/100`;

  return {
    path: rec.path, url, title, h1: h1s[0] || "", section: p.section, type: rec.type, date: rec.date?.slice(0, 10) || "",
    modified: (rec.modified || "").slice(0, 10), author: rec.author || "", keyphrase: kp, keyphrase_source: rec.keyphrase_source,
    words: wc, seo_score: seoScore, readability_score: readScore, fixes: rec.seo_fixes || [],
    serp: { title, description: desc, url }, checks: c,
  };
}

// site-level CSS sanity
const cssErrors = [];
{
  const open = (css.match(/{/g) || []).length, close = (css.match(/}/g) || []).length;
  if (open !== close) cssErrors.push(`unbalanced braces (${open} { vs ${close} })`);
  if (/;;/.test(css)) cssErrors.push("double semicolons");
  if (/:\s*;/.test(css)) cssErrors.push("empty declaration");
}

// ---------------------------------------------------------------- run
await measurePsi();
const results = pages.map(audit);
const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const sections = RULES.sections.map((s) => {
  const list = results.filter((x) => x.section === s.id);
  return { id: s.id, label: s.label, count: list.length, avg_seo: avg(list.map((x) => x.seo_score)), avg_readability: avg(list.map((x) => x.readability_score)),
    fails: list.reduce((t, x) => t + Object.values(x.checks).filter((c) => c.status === "fail").length, 0) };
});
const issues = CHECKS.map(([id, label, group]) => ({ id, label, group: G[group],
  fail: results.filter((x) => x.checks[id]?.status === "fail").length, warn: results.filter((x) => x.checks[id]?.status === "warn").length }))
  .filter((x) => x.fail || x.warn).sort((a, b) => b.fail * 3 + b.warn - (a.fail * 3 + a.warn));
const critical = results.flatMap((x) => RULES.critical.filter((id) => x.checks[id]?.status === "fail").map((id) => ({ path: x.path, check: id, value: x.checks[id].value })));
const fixCounts = {};
const htmlFixFile = path.join(DIST, "admin", "html-fixes.json");
const htmlFixes = fs.existsSync(htmlFixFile) ? JSON.parse(fs.readFileSync(htmlFixFile, "utf8")) : {};
for (const x of results) { x.fixes = [...x.fixes, ...(htmlFixes[x.path] || [])]; }
for (const x of results) for (const f of new Set(x.fixes.map((f) => f.split(":")[0]))) fixCounts[f] = (fixCounts[f] || 0) + 1;

const report = {
  generated: new Date().toISOString(), site: BASE, pages: results.length,
  avg_seo: avg(results.map((x) => x.seo_score)), avg_readability: avg(results.map((x) => x.readability_score)),
  sections, issues, critical, fixes_applied: fixCounts, drafts,
  site_checks: {
    robots_txt: robotsTxt, llms_txt_pages: llmsTxt.split("\n").filter((l) => l.startsWith("- [")).length,
    redirects: SQUIRRLY_REDIRECTS(), sitemap_urls: sitemapUrls.size, css_errors: cssErrors, cwv_measured: psi.size,
  },
  checks: CHECKS.map(([id, label, group]) => ({ id, label, group: G[group] })),
  results,
};
function SQUIRRLY_REDIRECTS() {
  const f = path.join(ROOT, "content", "seo", "squirrly.json");
  if (!fs.existsSync(f)) return { active: redirects.length, skipped: [] };
  const sq = JSON.parse(fs.readFileSync(f, "utf8"));
  return { active: sq.redirects.length, skipped: sq.skipped_redirects };
}

const ADMIN = path.join(DIST, "admin");
fs.mkdirSync(ADMIN, { recursive: true });
fs.writeFileSync(path.join(ADMIN, "report.json"), JSON.stringify(report));
const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const csv = [["section", "url", "title", "keyphrase", "seo_score", "readability_score", "words", ...CHECKS.map((x) => x[0])].map(csvCell).join(",")]
  .concat(results.map((x) => [x.section, x.url, x.title, x.keyphrase, x.seo_score, x.readability_score, x.words, ...CHECKS.map(([id]) => x.checks[id]?.status || "")].map(csvCell).join(",")));
fs.writeFileSync(path.join(ADMIN, "report.csv"), "﻿" + csv.join("\n"));
fs.copyFileSync(path.join(ROOT, "tools", "admin", "index.html"), path.join(ADMIN, "index.html"));

console.log(`SEO audit: ${results.length} URLs · avg SEO ${report.avg_seo}/100 · avg readability ${report.avg_readability}/100 · ${CHECKS.length} checks`);
for (const s of sections) console.log(`  ${s.label.padEnd(30)} ${String(s.count).padStart(4)} · SEO ${s.avg_seo} · readability ${s.avg_readability ?? "—"} · ${s.fails} fails`);
console.log(`  drafts (not audited): ${drafts.length}`);
console.log(`  auto-fixes applied: ${Object.entries(fixCounts).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
console.log(`  top issues: ${issues.slice(0, 6).map((i) => `${i.label} (${i.fail}✗ ${i.warn}!)`).join("; ")}`);
if (critical.length) {
  console.log(`CRITICAL: ${critical.length} failure(s)`);
  for (const x of critical.slice(0, 20)) console.log(`  ${x.check} ${x.path}: ${x.value}`);
  process.exit(1);
}
