/**
 * Automatic SEO fixes, driven by content/seo/rules.json ("autofix").
 *
 *   fixRecord(rec)        head/meta-level fixes on a page record before it is rendered
 *                         (meta description, Open Graph, Twitter card, excerpt, missing JSON-LD)
 *   fixHtml(html, file)   body-level fixes on the rendered HTML (image alt text and dimensions)
 *   keyphraseFor(rec)     the page's focus keyphrase (Squirrly -> city post -> title phrase)
 *
 * Fixes only ADD missing information; they never change URLs, canonicals, robots directives
 * or existing titles/descriptions. Every fix applied is recorded on the record (rec.seo_fixes).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "seo", "rules.json"), "utf8"));
const SQ_FILE = path.join(ROOT, "content", "seo", "squirrly.json");
export const SQUIRRLY = fs.existsSync(SQ_FILE) ? JSON.parse(fs.readFileSync(SQ_FILE, "utf8")) : { pages: {}, redirects: [] };
const FIX = RULES.autofix;
const SITE = RULES.site;

const strip = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = strip(s); if (s.length <= n) return s; const cut = s.slice(0, n - 1); return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:—-]+$/, "") + "…"; };
const meta = (rec, key) => rec.head.meta.find((m) => m.key === key);
const setIfEmpty = (rec, attr, key, value, fixes, id) => {
  if (!value) return;
  const m = meta(rec, key);
  if (m && String(m.content).trim()) return;
  if (m) m.content = value; else rec.head.meta.push({ attr, key, content: value });
  fixes.push(id + ":" + key);
};

function typesIn(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => typesIn(n, out));
  else if (node && typeof node === "object") {
    const t = node["@type"]; (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => out.add(x));
    Object.values(node).forEach((v) => typesIn(v, out));
  }
  return out;
}

/** Focus keyphrase with its source. */
export function keyphraseFor(rec) {
  if (rec.keyphrase_override) return { keyphrase: rec.keyphrase_override, source: "content file", secondary: rec.keyphrase_secondary_override || [] };
  if (["category", "tag", "archive"].includes(rec.type)) return { keyphrase: "", source: "listing (n/a)", secondary: [] };
  const sq = SQUIRRLY.pages[rec.path];
  if (sq?.keyphrase) return { keyphrase: sq.keyphrase, source: "squirrly", secondary: sq.keywords.slice(1) };
  if (rec.citylabel && rec.content_source === "city-posts") {
    const city = rec.citylabel.replace(/\s*\(.*?\)\s*/g, " ").split(/ and /)[0].trim();
    return { keyphrase: RULES.keyphrase.cityPostPattern.replace("{city}", city), source: "city post", secondary: ["AEO", "GEO", "AIO"] };
  }
  const t = strip(rec.head?.title || rec.title || "").split(/\s[|–—:-]\s|:\s/)[0].replace(/\s+-\s+openink hub$/i, "").trim();
  return { keyphrase: t.toLowerCase(), source: "title", secondary: [] };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "July 2026" for /2026/07/, "SEO tools" for a tag titled "seo tools - openink Hub". */
export function listingLabel(rec) {
  const m = /^\/(\d{4})\/(\d{2})\/$/.exec(rec.path);
  if (m) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  const t = strip(rec.head?.title || "").replace(/\s+-\s+openink hub$/i, "");
  return t.split(" ").map((w) => (w.length <= 3 ? w.toUpperCase() : w)).join(" ");
}

function firstParagraph(html) {
  const m = /<p>([\s\S]*?)<\/p>/.exec(html || "");
  return m ? strip(m[1]) : "";
}

const PL_FILE = path.join(ROOT, "content", "seo", "plain-language.json");
export const PLAIN = fs.existsSync(PL_FILE) ? JSON.parse(fs.readFileSync(PL_FILE, "utf8")) : {};
export const PLAIN_MISSES = [];
const squash = (s) => String(s).replace(/\s+/g, " ").trim();

/** Swap hard paragraphs/list items for their plain-language versions (content/seo/plain-language.json).
 *  Each edit is [start of the original block's HTML, new HTML]. FAQ schema answers are kept in sync. */
function applyPlainLanguage(rec, fixes) {
  const edits = PLAIN[rec.path];
  if (!FIX.plainLanguage || !Array.isArray(edits)) return;
  let html = rec.content_html, n = 0;
  const swaps = [];
  for (const [prefix, next] of edits) {
    const want = squash(prefix);
    let hit = false; // every matching block is replaced (some WordPress pages repeat sections)
    html = html.replace(/<(p|li)>([\s\S]*?)<\/\1>/g, (whole, tag, inner) => {
      if (!squash(inner).startsWith(want)) return whole;
      hit = true; n++; swaps.push([strip(inner), strip(next)]);
      return `<${tag}>${next}</${tag}>`;
    });
    if (!hit) PLAIN_MISSES.push(`${rec.path}: "${prefix.slice(0, 50)}"`);
  }
  rec.content_html = html;
  const syncText = (node) => {
    if (Array.isArray(node)) node.forEach(syncText);
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "string") { const sv = strip(v); const s = swaps.find(([a]) => a === sv); if (s) node[k] = s[1]; }
        else syncText(v);
      }
    }
  };
  syncText(rec.head.jsonld);
  if (rec.faqs) for (const f of rec.faqs) { const s = swaps.find(([a]) => a === strip(f.a)); if (s) f.a = `<p>${s[1]}</p>`; }
  if (n) fixes.push(`plain-language:${n}`);
}

export function fixRecord(rec) {
  if (rec._fixed) return rec;
  rec._fixed = true;
  const fixes = [];
  applyPlainLanguage(rec, fixes);
  const url = rec.url?.replace(/\/?$/, rec.path === "/" ? "" : "/") || SITE.url + rec.path;
  const kp = keyphraseFor(rec);
  rec.keyphrase = kp.keyphrase; rec.keyphrase_source = kp.source; rec.keyphrase_secondary = kp.secondary;

  // archive / tag pages: unique H1 + repair WordPress's broken archive <title> (e.g. "2026-01-07T05:30:00+05:30")
  if (FIX.listingHeadings && ["archive", "tag"].includes(rec.type)) {
    const label = listingLabel(rec);
    const generic = /^Insights on digital growth/i.test(strip(rec.h1 || ""));
    if (generic) { rec.h1 = rec.type === "archive" ? `Articles from ${label}` : `Articles tagged “${label}”`; fixes.push("listing-h1"); }
    if (rec.type === "archive" && /^\d{4}-\d{2}-\d{2}T/.test(rec.head.title)) {
      const nt = `Articles from ${label} - ${SITE.name}`;
      for (const k of ["og:title", "twitter:title"]) { const m = meta(rec, k); if (m && m.content === rec.head.title) m.content = nt; }
      rec.head.title = nt; rec.title = nt; fixes.push("listing-title");
    }
  }

  const title = rec.head.title;

  // excerpt + meta description
  if (FIX.excerpt && !rec.excerpt) {
    const ex = clip(firstParagraph(rec.content_html), 200);
    if (ex) { rec.excerpt = ex; fixes.push("excerpt"); }
  }
  let desc = meta(rec, "description")?.content?.trim();
  if (FIX.metaDescription && !desc) {
    desc = rec.excerpt ? clip(rec.excerpt, 155) : "";
    if (!desc && ["category", "tag", "archive"].includes(rec.type)) {
      const what = rec.type === "archive" ? `published in ${strip(rec.h1 || rec.title).replace(/^.*?:\s*/, "")}` : `about ${strip(rec.h1 || rec.title)}`;
      desc = clip(`Articles from openink Hub ${what}: guides to SEO, answer engine optimization, generative engine optimization and AI automation.`, 155);
    }
    setIfEmpty(rec, "name", "description", desc, fixes, "meta");
  }

  // Open Graph / Twitter
  const image = meta(rec, "og:image")?.content || rec.featured_image?.src || SITE.defaultImage;
  if (FIX.openGraph) {
    setIfEmpty(rec, "property", "og:title", title, fixes, "og");
    setIfEmpty(rec, "property", "og:description", desc, fixes, "og");
    setIfEmpty(rec, "property", "og:url", url, fixes, "og");
    setIfEmpty(rec, "property", "og:type", rec.type === "post" ? "article" : "website", fixes, "og");
    setIfEmpty(rec, "property", "og:image", image, fixes, "og");
    setIfEmpty(rec, "property", "og:site_name", SITE.name, fixes, "og");
  }
  if (FIX.twitterCard) {
    setIfEmpty(rec, "name", "twitter:card", SITE.twitterCard, fixes, "twitter");
    setIfEmpty(rec, "name", "twitter:title", title, fixes, "twitter");
    setIfEmpty(rec, "name", "twitter:description", desc, fixes, "twitter");
    setIfEmpty(rec, "name", "twitter:image", image, fixes, "twitter");
  }

  // JSON-LD: add only what is missing, as ONE extra block
  const present = typesIn(rec.head.jsonld);
  const graph = [];
  const orgId = `${SITE.url}/#organization`;
  if (FIX.organizationSchema && !present.has("Organization")) {
    graph.push({ "@type": "Organization", "@id": orgId, name: SITE.name, legalName: SITE.legalName, url: SITE.url + "/", logo: SITE.logo });
  }
  if (FIX.websiteSchema && rec.path === "/" && !present.has("WebSite")) {
    graph.push({ "@type": "WebSite", "@id": `${SITE.url}/#website`, url: SITE.url + "/", name: SITE.name, publisher: { "@id": orgId } });
  }
  if (FIX.breadcrumbSchema && rec.path !== "/" && !present.has("BreadcrumbList")) {
    const items = [{ name: "Home", item: SITE.url + "/" }];
    const cat = rec.categories?.[0];
    if (cat) items.push({ name: cat.name, item: SITE.url + cat.path });
    items.push({ name: strip(rec.h1 || title), item: url });
    graph.push({ "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
      itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.item })) });
  }
  if (FIX.articleSchema && rec.type === "post" && !present.has("Article") && !present.has("BlogPosting")) {
    graph.push({ "@type": "BlogPosting", "@id": `${url}#article`, headline: title, description: desc || undefined, url,
      datePublished: rec.date ? rec.date + "+05:30" : undefined, dateModified: (rec.modified || rec.date || "") ? (rec.modified || rec.date) + "+05:30" : undefined,
      image, author: FIX.authorSchema ? { "@type": "Person", name: rec.author || SITE.name } : undefined, publisher: { "@id": orgId } });
  } else if (FIX.authorSchema && rec.type === "post" && !present.has("Person")) {
    graph.push({ "@type": "Person", "@id": `${url}#author`, name: rec.author || SITE.name });
  }
  if (FIX.faqSchema && rec.faqs?.length && !present.has("FAQPage")) {
    graph.push({ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: rec.faqs.map((f) => ({ "@type": "Question", name: strip(f.q),
      acceptedAnswer: { "@type": "Answer", text: strip(f.a) } })) });
  }
  if (graph.length) {
    rec.head.jsonld.push({ "@context": "https://schema.org", "@graph": JSON.parse(JSON.stringify(graph)) });
    fixes.push("schema:" + graph.map((g) => g["@type"]).join("+"));
  }
  rec.seo_fixes = fixes;
  return rec;
}

// ---------------------------------------------------------------- images
const dimCache = new Map();
/** Read width/height from a local webp/png/jpeg/gif file header. */
export function imageSize(file) {
  if (dimCache.has(file)) return dimCache.get(file);
  let r = null;
  try {
    const b = fs.readFileSync(file);
    if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8X") r = { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      else if (kind === "VP8L") { const v = b.readUInt32LE(21); r = { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
      else if (kind === "VP8 ") r = { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    } else if (b.readUInt32BE(0) === 0x89504e47) r = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    else if (b.toString("ascii", 0, 3) === "GIF") r = { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    else if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { r = { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }; break; }
        i += 2 + len;
      }
    }
  } catch { r = null; }
  dimCache.set(file, r);
  return r;
}

const humanize = (src) => decodeURIComponent(src.split("/").pop().replace(/\.\w+$/, "").replace(/-\d+x\d+$/, ""))
  .replace(/[-_]+/g, " ").replace(/\b\d{2,}\b/g, "").replace(/\s+/g, " ").trim();

/** Body-level fixes on rendered HTML. distRoot is used to read local image sizes. */
export function fixHtml(html, distRoot, pageTitle = "") {
  const fixes = [];
  html = html.replace(/<img\b[^>]*>/g, (tag) => {
    let t = tag;
    const src = /\ssrc="([^"]+)"/.exec(t)?.[1] || "";
    if (FIX.imageAlt && !/\salt=/.test(t)) {
      const alt = humanize(src) || pageTitle;
      t = t.replace(/^<img/, `<img alt="${alt.replace(/"/g, "&quot;")}"`); fixes.push("img-alt");
    }
    if (FIX.imageDimensions && src.startsWith("/") && !/\swidth="\d+"/.test(t)) {
      const d = imageSize(path.join(distRoot, ...decodeURIComponent(src.split("?")[0]).split("/").filter(Boolean)));
      if (d?.w && d?.h) {
        t = t.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "").replace(/^<img/, `<img width="${d.w}" height="${d.h}"`);
        fixes.push("img-size");
      }
    }
    return t;
  });
  return { html, fixes };
}
