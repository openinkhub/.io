/**
 * Site-wide link, CTA, redirect and image check on the built site (dist/).
 *
 *   npm run check-links            (internal checks only, fast)
 *   npm run check-links -- --external   (also requests every external URL)
 *
 * Checks: every internal href resolves to a page/file or a redirect; every _redirects target exists;
 * tel:/mailto:/WhatsApp links are well-formed; every link has readable text (or an aria-label);
 * every <img> has meaningful alt text and its file exists. Exits 1 on any internal problem.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const EXTERNAL = process.argv.includes("--external");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const pages = walk(DIST).filter((f) => f.endsWith(".html") && !f.includes(`${path.sep}admin${path.sep}`));
const redirects = new Map(fs.existsSync(path.join(DIST, "_redirects")) ? fs.readFileSync(path.join(DIST, "_redirects"), "utf8").split("\n")
  .map((l) => l.trim().split(/\s+/)).filter((x) => x.length >= 2 && !x[0].startsWith("#")).map(([a, b]) => [a, b]) : []);
const exists = (p) => {
  const clean = decodeURIComponent(p.split(/[?#]/)[0]);
  if (!clean || clean === "/") return fs.existsSync(path.join(DIST, "index.html"));
  const f = path.join(DIST, ...clean.split("/").filter(Boolean));
  return fs.existsSync(f) && fs.statSync(f).isFile() || fs.existsSync(path.join(f, "index.html"));
};
const problems = [], external = new Map(), warn = [];
let links = 0, imgs = 0;
const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
for (const f of pages) {
  const page = "/" + path.relative(DIST, f).replace(/\\/g, "/").replace(/index\.html$/, "");
  const html = fs.readFileSync(f, "utf8");
  const body = (/<body[^>]*>([\s\S]*)<\/body>/.exec(html) || [])[1] || html;
  // inline scripts must parse (a broken one fails silently in the browser, e.g. the contact form buttons)
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)) {
    try { new Function(m[1]); } catch (e) { problems.push(`${page}: inline script does not parse (${e.message})`); }
  }
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    links++;
    const attrs = m[1], href = (/href="([^"]*)"/.exec(attrs) || [])[1] ?? "";
    const label = strip(m[2]) || (/aria-label="([^"]+)"/.exec(attrs) || [])[1] || (/<img[^>]*alt="([^"]+)"/.exec(m[2]) || [])[1] || "";
    if (!label) problems.push(`${page}: link with no text -> ${href}`);
    else if (/^(click here|here|read more|learn more|more|link)$/i.test(label.replace(/[→»]/g, "").trim()) || /^https?:\/\//.test(label)) problems.push(`${page}: generic/URL link text "${label}" -> ${href}`);
    if (!href || href === "#") { problems.push(`${page}: empty href ("${label}")`); continue; }
    if (href.startsWith("#")) { if (!new RegExp(`id="${href.slice(1)}"`).test(html)) problems.push(`${page}: missing anchor ${href}`); continue; }
    if (href.startsWith("tel:")) { if (!/^tel:\+?\d{8,15}$/.test(href)) problems.push(`${page}: bad phone link ${href}`); continue; }
    if (href.startsWith("mailto:")) { if (!/^mailto:[^@\s]+@[^@\s]+\.\w+/.test(href)) problems.push(`${page}: bad email link ${href}`); continue; }
    let u = href;
    if (/^https?:\/\/(www\.)?openinkhub\.io/.test(u)) u = u.replace(/^https?:\/\/(www\.)?openinkhub\.io/, "") || "/";
    if (u.startsWith("/")) {
      const p = u.split(/[?#]/)[0];
      if (!exists(p) && !redirects.has(p) && !redirects.has(p.replace(/\/$/, ""))) problems.push(`${page}: broken internal link ${href}`);
    } else if (/^https?:/.test(u)) { if (!external.has(u)) external.set(u, page); }
  }
  for (const m of body.matchAll(/<img\b[^>]*>/g)) {
    imgs++;
    const tag = m[0], src = (/src="([^"]*)"/.exec(tag) || [])[1] || "", alt = (/alt="([^"]*)"/.exec(tag) || [])[1];
    if (alt === undefined || !alt.trim()) problems.push(`${page}: image without alt text ${src}`);
    else if (/\.(webp|png|jpe?g|svg|gif)$/i.test(alt) || /^(image|img|photo|picture|logo|icon)\s*\d*$/i.test(alt) || /\d{3,}x\d{3,}/.test(alt)) problems.push(`${page}: weak alt text "${alt}" ${src}`);
    if (src.startsWith("/") && !exists(src)) problems.push(`${page}: image file missing ${src}`);
  }
}
for (const [from, to] of redirects) if (to.startsWith("/") && !exists(to)) problems.push(`_redirects: ${from} -> ${to} (target missing)`);

if (EXTERNAL) {
  const list = [...external.keys()];
  const check = async (u) => {
    for (const method of ["HEAD", "GET"]) {
      try {
        const res = await fetch(u, { method, redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (link check)" } });
        if (res.status < 400) return null;
        if (method === "GET") return res.status;
      } catch (e) { if (method === "GET") return e.name === "TimeoutError" ? "timeout" : "error"; }
    }
  };
  for (let i = 0; i < list.length; i += 8) {
    const batch = list.slice(i, i + 8);
    const res = await Promise.all(batch.map(check));
    batch.forEach((u, k) => { if (res[k]) warn.push(`external ${res[k]}: ${u} (first seen on ${external.get(u)})`); });
  }
}
console.log(`check-links: ${pages.length} pages, ${links} links, ${imgs} images, ${redirects.size} redirects, ${external.size} external URLs` +
  (EXTERNAL ? " (requested)" : ""));
for (const p of [...new Set(problems)].slice(0, 60)) console.log("  ✗ " + p);
for (const w of warn) console.log("  ! " + w);
console.log(problems.length ? `${new Set(problems).size} problem(s)` : "no internal problems");
process.exit(problems.length ? 1 : 0);
