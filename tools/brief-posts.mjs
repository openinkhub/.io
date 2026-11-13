/**
 * Publish articles from the content-plan briefs as blog posts.
 *
 *   npm run brief-posts      (then npm test)
 *
 * Source:  content/articles/website-development-briefs.json   (brief metadata; a brief is published when it has
 *          "slug", "faqs" and "status": "published")
 *          content/articles/website-development-posts/<slug>.html   (article body)
 * Output:  content/pages/<slug>.json   type "post", category Blogs, linked to its hub page (brief_hub)
 *
 * Filler keyword variants ("... guide", "... explained", "... benefits") are dropped from the related terms.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRIEFS = path.join(ROOT, "content", "articles", "website-development-briefs.json");
const BODIES = path.join(ROOT, "content", "articles", "website-development-posts");
const PAGES = path.join(ROOT, "content", "pages");
const BASE = "https://openinkhub.io";
const IMAGE = `${BASE}/wp-content/uploads/2026/07/business-process-optimization-1.webp`;
const BLOGS = { name: "Blogs", path: "/category/best-seo-content-agency/" };
const AUTHOR = "Hiten Neotia";
const now = new Date().toISOString().slice(0, 19);
const E = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FILLER = /\b(guide|explained|benefits|examples|for business|cost)$/i;

const COVERS = path.join(ROOT, "static", "images", "articles");
const wrap = (t, n) => t.split(" ").reduce((ls, w) => { const l = ls[ls.length - 1]; (l && (l + " " + w).length <= n) ? ls[ls.length - 1] = l + " " + w : ls.push(w); return ls; }, []);
// 1200x630 title card (brand colours), written to static/images/articles/<slug>.svg
function cover(b) {
  const lines = wrap(b.seo_title || b.title, 30).slice(0, 4), y0 = 315 - (lines.length - 1) * 38;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${E(b.seo_title || b.title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1424"/><stop offset="1" stop-color="#0352a3"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/><circle cx="1080" cy="110" r="180" fill="#046bd2" opacity=".25"/><circle cx="1130" cy="560" r="120" fill="#eef5fd" opacity=".08"/>
<text x="80" y="110" fill="#9cc6f5" font-family="Segoe UI,Arial,sans-serif" font-size="26" font-weight="600" letter-spacing="2">WEBSITE DEVELOPMENT · ${E(b.role.toUpperCase())}</text>
${lines.map((l, i) => `<text x="80" y="${y0 + i * 76}" fill="#fff" font-family="Segoe UI,Arial,sans-serif" font-size="60" font-weight="700">${E(l)}</text>`).join("\n")}
<text x="80" y="560" fill="#cfe3fa" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="600">openink Hub</text></svg>\n`;
  fs.mkdirSync(COVERS, { recursive: true });
  fs.writeFileSync(path.join(COVERS, `${b.slug}.svg`), svg);
  return { src: `${BASE}/images/articles/${b.slug}.svg`, alt: b.seo_title || b.title, width: 1200, height: 630 };
}

const data = JSON.parse(fs.readFileSync(BRIEFS, "utf8"));
let made = 0;
for (const b of data.briefs.filter((x) => x.status === "published")) {
  if (!b.slug || !Array.isArray(b.faqs)) throw new Error(`brief ${b.id}: published briefs need slug and faqs`);
  const bodyFile = path.join(BODIES, `${b.slug}.html`);
  if (!fs.existsSync(bodyFile)) throw new Error(`brief ${b.id}: missing ${path.relative(ROOT, bodyFile)}`);
  const p = `/${b.slug}/`, url = BASE + p, target = path.join(PAGES, `${b.slug}.json`);
  const prev = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null;
  if (prev && !prev.brief_id) throw new Error(`${p} already exists as a different page`);
  const date = prev?.date || now;
  const kw = b.keyphrase || b.primary_keyword; // keyphrase: natural-language form of the sheet keyword, if set
  const secondary = [...new Set(b.secondary_keywords.filter((k) => k.toLowerCase() !== kw.toLowerCase() && !(k.toLowerCase().startsWith(kw.toLowerCase()) && FILLER.test(k))))].slice(0, 8);
  const faqs = b.faqs.map(([q, a]) => ({ q, a: `<p>${E(a)}</p>` }));
  const title = b.seo_title || b.title;
  const img = cover(b);
  const desc = b.description;
  const rec = {
    url, path: p, status: 200, type: "post", brief_id: b.id, brief_hub: b.hub, cluster: b.cluster,
    title, h1: b.h1, date, modified: now, author: AUTHOR, excerpt: desc,
    keyphrase_override: kw, keyphrase_secondary_override: secondary,
    categories: [BLOGS], tags: [], faqs, featured_image: img, content_source: "brief-posts",
    content_html: `<h1>${E(b.h1)}</h1>\n<figure><img src="${img.src}" alt="${E(img.alt)}" width="${img.width}" height="${img.height}"></figure>\n` +
      fs.readFileSync(bodyFile, "utf8") +
      `<h2>Frequently asked questions</h2>${b.faqs.map(([q, a]) => `<h3>${E(q)}</h3><p>${E(a)}</p>`).join("")}`,
    head: {
      title: `${title} | openink Hub`.length <= 60 ? `${title} | openink Hub` : title, lang: "en-US",
      links: [{ rel: "canonical", href: url }],
      meta: [
        { attr: "name", key: "robots", content: "index, follow, max-image-preview:large" },
        { attr: "name", key: "description", content: desc },
        { attr: "property", key: "og:title", content: title },
        { attr: "property", key: "og:description", content: desc },
        { attr: "property", key: "og:type", content: "article" },
        { attr: "property", key: "og:url", content: url },
        { attr: "property", key: "og:image", content: IMAGE },
        { attr: "property", key: "article:published_time", content: date + "+05:30" },
        { attr: "property", key: "article:section", content: BLOGS.name },
        { attr: "name", key: "twitter:card", content: "summary_large_image" },
      ],
      jsonld: [{ "@context": "https://schema.org", "@graph": [
        { "@type": "BlogPosting", "@id": `${url}#article`, headline: title, description: desc, url, image: IMAGE,
          datePublished: date + "+05:30", dateModified: now + "+05:30", keywords: [kw, ...secondary].join(", "),
          author: { "@type": "Person", name: AUTHOR }, publisher: { "@id": `${BASE}/#organization` },
          isPartOf: { "@id": `${BASE}${b.hub}#webpage` } },
        { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
          { "@type": "ListItem", position: 2, name: BLOGS.name, item: BASE + BLOGS.path },
          { "@type": "ListItem", position: 3, name: title, item: url }] },
      ] }],
    },
  };
  fs.writeFileSync(target, JSON.stringify(rec, null, 2) + "\n");
  made++;
}
const long = data.briefs.filter((x) => x.status === "published" && ((x.seo_title || x.title).length > 60 || x.description.length > 160));
console.log(`brief-posts: ${made} article(s) published`, long.length ? `· length warnings: ${long.map((x) => x.id).join(",")}` : "");
