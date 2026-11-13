"""
Extract every live URL, its meta tags and its reusable content from openinkhub.io.

Sources:
  * sitemap.xml (+ child sitemaps)  -> the authoritative list of live URLs
  * live HTML of each URL           -> exact <head> SEO tags (title, meta, canonical, JSON-LD)
  * WordPress REST API              -> clean structured content (title, body, dates, taxonomy, images)

Output (all under ./content):
  urls.csv              one row per URL with status + key meta (for a quick audit)
  pages/<slug>.json     one file per URL: meta + content
  site.json             global data: menus, footer, site name, logo, categories, tags
  assets.txt            every wp-content/uploads file referenced (downloaded by --assets)

Usage:  python tools/extract.py            # crawl + extract
        python tools/extract.py --assets   # also download images into ./site-src/static
"""
import csv, json, re, sys, os, html, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup, Comment

BASE = "https://openinkhub.io"
UA = {"User-Agent": "Mozilla/5.0 (site-migration-extractor)"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.name == "nt" and not ROOT.startswith("\\\\?\\"):
    ROOT = "\\\\?\\" + ROOT  # allow paths > 260 chars on Windows
CACHE = os.path.join(ROOT, ".cache")
os.makedirs(CACHE, exist_ok=True)
OUT = os.path.join(ROOT, "content")
PAGES = os.path.join(OUT, "pages")
os.makedirs(PAGES, exist_ok=True)


def get(url, binary=False, tries=6):
    import hashlib
    ck = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest())
    if not binary and os.path.exists(ck):
        with open(ck, encoding="utf-8") as f:
            c = json.load(f)
        return c["status"], c["body"], c["headers"], c["final"]
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
                time.sleep(0.4)
                if binary:
                    return r.status, data, r.headers, r.geturl()
                body = data.decode("utf-8", "replace")
                hdrs = {k: v for k, v in r.headers.items()}
                with open(ck, "w", encoding="utf-8") as f:
                    json.dump({"status": r.status, "body": body, "headers": hdrs, "final": r.geturl()}, f)
                return r.status, body, hdrs, r.geturl()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return e.code, None, {}, url
            err = e
            if e.code == 429:
                time.sleep(int(e.headers.get("Retry-After") or 0) or 15 * (i + 1))
                continue
        except Exception as e:  # network hiccup
            err = e
        time.sleep(1.5 * (i + 1))
    print("  !! failed", url, err, file=sys.stderr)
    return 0, None, {}, url


# ---------------------------------------------------------------- URL discovery
def sitemap_urls():
    _, idx, _, _ = get(BASE + "/sitemap.xml")
    maps = re.findall(r"<loc>([^<]+)</loc>", idx)
    found = []
    for m in maps:
        kind = re.sub(r".*/sitemap-([a-z-]+)\.xml", r"\1", m)
        _, xml, _, _ = get(m)
        for block in re.findall(r"<url>(.*?)</url>", xml or "", re.S):
            loc = re.search(r"<loc>([^<]+)</loc>", block).group(1).strip()
            lm = re.search(r"<lastmod>([^<]+)</lastmod>", block)
            found.append({"url": loc, "sitemap": kind, "lastmod": lm.group(1) if lm else ""})
    # de-dupe, keep first
    seen, out = set(), []
    for f in found:
        k = f["url"].rstrip("/") or BASE
        if k not in seen:
            seen.add(k)
            out.append(f)
    return out


def url_to_path(url):
    """https://openinkhub.io/foo/ -> /foo/   (home -> /)"""
    p = urllib.parse.urlparse(url).path or "/"
    if not p.endswith("/") and "." not in p.rsplit("/", 1)[-1]:
        p += "/"
    return p


# ---------------------------------------------------------------- REST content
def rest_all(endpoint, fields):
    items, page = [], 1
    while True:
        u = f"{BASE}/wp-json/wp/v2/{endpoint}?per_page=100&page={page}&_fields={fields}"
        st, body, hdr, _ = get(u)
        if st != 200 or not body:
            break
        batch = json.loads(body)
        items += batch
        total_pages = int(hdr.get("X-WP-TotalPages", 1) or 1)
        if page >= total_pages:
            break
        page += 1
    return items


# ---------------------------------------------------------------- HTML helpers
KEEP_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "a", "img", "strong", "b", "em", "i",
             "blockquote", "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption", "br", "hr",
             "code", "pre", "details", "summary", "span", "sup", "sub", "iframe", "video", "source", "picture",
             "dl", "dt", "dd", "mark", "u", "s", "small"}
KEEP_ATTRS = {"a": {"href", "title", "rel", "target"}, "img": {"src", "alt", "width", "height", "title"},
              "iframe": {"src", "width", "height", "title", "allow", "allowfullscreen"},
              "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan", "scope"},
              "source": {"src", "srcset", "type"}, "video": {"src", "controls", "poster"},
              "ol": {"start"}}
DROP_TAGS = {"script", "style", "noscript", "svg", "form", "input", "button", "select", "textarea", "nav"}


def clean_html(fragment):
    """Strip Elementor / theme wrappers, leaving portable semantic HTML."""
    soup = BeautifulSoup(fragment or "", "html.parser")
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        c.extract()
    for t in soup.find_all(DROP_TAGS):
        t.decompose()
    for img in soup.find_all("img"):  # lazy-load fixups
        for k in ("data-src", "data-lazy-src", "data-litespeed-src"):
            if img.get(k):
                img["src"] = img[k]
    # Layout wrappers (div/section...) that hold only inline content become <p>, so
    # text styled by Elementor/CSS isn't left as loose, unwrapped text.
    BLOCKS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "div", "section", "article", "figure",
              "blockquote", "details", "header", "aside", "img", "pre", "dl", "iframe", "video", "hr"]
    WRAPS = ["div", "section", "article", "header", "aside", "main", "footer"]
    for t in reversed(soup.find_all(WRAPS)):
        if t.find(BLOCKS):
            # stray inline content next to blocks -> its own paragraph
            run = []
            def flush():
                if run and any((s.strip() if isinstance(s, str) else s.get_text(strip=True)) for s in run):
                    p = soup.new_tag("p")
                    run[0].insert_before(p)
                    for s in run:
                        p.append(s.extract())
                run.clear()
            for s in list(t.children):
                if isinstance(s, str) or (s.name in ("span", "strong", "b", "em", "i", "a", "small", "mark") and not s.find(BLOCKS)):
                    run.append(s)
                else:
                    flush()
            flush()
        elif t.get_text(strip=True):
            kids = [k for k in t.children if not (isinstance(k, str) and not k.strip())]
            for a, b in zip(kids, kids[1:]):  # keep words apart when CSS did the spacing
                if not isinstance(a, str) and not isinstance(b, str) and a.name in ("span", "div", "strong", "b") and b.name in ("span", "div", "strong", "b"):
                    b.insert_before(" ")
            t.name = "p"
            t.attrs = {}
    for t in list(soup.find_all(True)):
        if t.name not in KEEP_TAGS:
            t.unwrap()
            continue
        allowed = KEEP_ATTRS.get(t.name, set())
        t.attrs = {k: v for k, v in t.attrs.items() if k in allowed}
        if t.name == "span" and not t.attrs:
            t.unwrap()
    # drop empty paragraphs / headings
    for t in soup.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"]):
        if not t.get_text(strip=True) and not t.find("img"):
            t.decompose()
    out = str(soup)
    out = re.sub(r"\n\s*\n+", "\n", out).strip()
    return out


def parse_head(doc):
    soup = BeautifulSoup(doc, "html.parser")
    head = soup.head or soup
    meta = {"title": (head.title.get_text(strip=True) if head.title else ""), "meta": [], "links": [], "jsonld": []}
    for m in head.find_all("meta"):
        a = dict(m.attrs)
        if "charset" in a or a.get("name") in ("viewport", "generator", "theme-color") or a.get("http-equiv"):
            continue
        key = a.get("name") or a.get("property") or a.get("itemprop")
        if key and "content" in a:
            meta["meta"].append({"attr": "property" if "property" in a else ("itemprop" if "itemprop" in a else "name"),
                                 "key": key, "content": a["content"]})
    for l in head.find_all("link"):
        rel = " ".join(l.get("rel", []))
        if rel in ("canonical", "alternate", "prev", "next", "shortlink", "icon", "apple-touch-icon") and l.get("href"):
            if rel == "alternate" and "json" in (l.get("type") or ""):
                continue  # wp-json oembed links, not needed
            meta["links"].append({"rel": rel, "href": l["href"], "hreflang": l.get("hreflang"),
                                  "type": l.get("type"), "sizes": l.get("sizes")})
    for s in soup.find_all("script", type="application/ld+json"):
        txt = (s.string or s.get_text() or "").strip()
        if txt:
            try:
                meta["jsonld"].append(json.loads(txt))
            except Exception:
                meta["jsonld"].append({"_raw": txt})
    html_tag = soup.find("html")
    meta["lang"] = (html_tag.get("lang") if html_tag else None) or "en-US"
    return soup, meta


def main_content_from_live(soup):
    """Fallback body extraction (used for archives/home) from the live DOM."""
    # pick the candidate container holding the most text (Elementor templates can wrap
    # small widgets like "related posts" in the same container types as the article)
    cands = []
    for sel in ("[data-elementor-type='wp-post']", "[data-elementor-type='wp-page']", ".entry-content",
                "article", "main"):
        cands += [el for el in soup.select(sel) if not el.find_parent(["header", "footer"])]
    if not cands:
        cands = [soup.body] if soup.body else []
    main = max(cands, key=lambda el: len(el.get_text(" ", strip=True)), default=None)
    return clean_html(str(main)) if main else ""


def faq_from_jsonld(jsonld):
    faqs = []
    def walk(n):
        if isinstance(n, dict):
            t = n.get("@type")
            if t == "FAQPage" or (isinstance(t, list) and "FAQPage" in t):
                for q in n.get("mainEntity", []) or []:
                    ans = (q.get("acceptedAnswer") or {}).get("text", "")
                    faqs.append({"q": q.get("name", ""), "a": ans})
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(jsonld)
    return faqs


def extract_nav(soup):
    def menu(sel):
        out = []
        root = soup.select_one(sel)
        if not root:
            return out
        for li in root.find_all("li", recursive=False):
            a = li.find("a")
            if not a:
                continue
            item = {"label": a.get_text(" ", strip=True), "href": a.get("href", "#"), "children": []}
            sub = li.find("ul")
            if sub:
                for sli in sub.find_all("li", recursive=False):
                    sa = sli.find("a")
                    if sa:
                        item["children"].append({"label": sa.get_text(" ", strip=True), "href": sa.get("href", "#")})
            out.append(item)
        return out
    primary = menu("#ast-hf-menu-1") or menu(".main-header-menu") or menu("header nav ul")
    footer_links = []
    footer = soup.select_one("footer") or soup.select_one("[data-elementor-type='footer']")
    if footer:
        for a in footer.find_all("a"):
            t = a.get_text(" ", strip=True)
            if t and a.get("href"):
                footer_links.append({"label": t, "href": a["href"]})
    logo = soup.select_one(".custom-logo, .site-logo-img img, header img")
    return {"primary": primary, "footer_links": footer_links,
            "logo": (logo.get("data-src") or logo.get("src")) if logo else None,
            "footer_text": clean_html(str(footer)) if footer else ""}


# ---------------------------------------------------------------- main
def main():
    print("1/4 reading sitemaps ...")
    urls = sitemap_urls()
    print(f"    {len(urls)} URLs in sitemaps")

    print("2/4 REST content ...")
    pfields = "id,slug,link,date,modified,title,content,excerpt,author,featured_media,categories,tags,parent,menu_order,template"
    posts = rest_all("posts", pfields)
    pages = rest_all("pages", pfields.replace("categories,tags,", ""))
    cats = rest_all("categories", "id,name,slug,link,description,count,parent")
    tags = rest_all("tags", "id,name,slug,link,description,count")
    users = rest_all("users", "id,name,slug,link,description")
    media_ids = {p["featured_media"] for p in posts + pages if p.get("featured_media")}
    media = {}
    ids = sorted(media_ids)
    for i in range(0, len(ids), 100):
        chunk = ",".join(map(str, ids[i:i + 100]))
        st, body, _, _ = get(f"{BASE}/wp-json/wp/v2/media?per_page=100&include={chunk}&_fields=id,source_url,alt_text,media_details")
        for m in json.loads(body or "[]"):
            md = m.get("media_details") or {}
            media[m["id"]] = {"src": m["source_url"], "alt": m.get("alt_text", ""),
                              "width": md.get("width"), "height": md.get("height")}
    by_link = {}
    for kind, coll in (("post", posts), ("page", pages)):
        for p in coll:
            by_link[url_to_path(p["link"])] = (kind, p)
    print(f"    posts={len(posts)} pages={len(pages)} categories={len(cats)} tags={len(tags)}")

    # make sure every published REST item is in the URL list too (sitemaps can miss some)
    listed = {url_to_path(u["url"]) for u in urls}
    for path, (kind, p) in by_link.items():
        if path not in listed:
            urls.append({"url": p["link"], "sitemap": f"rest-{kind}-not-in-sitemap", "lastmod": p.get("modified", "")})

    cat_by_id = {c["id"]: c for c in cats}
    tag_by_id = {t["id"]: t for t in tags}
    user_by_id = {u["id"]: u for u in users}

    print("3/4 fetching live HTML for every URL ...")
    site_nav = {}

    def work(entry):
        url = entry["url"]
        path = url_to_path(url)
        st, doc, hdr, final = get(url)
        rec = {"url": url, "path": path, "status": st, "final_url": final, "sitemap": entry["sitemap"],
               "lastmod": entry["lastmod"]}
        if not doc:
            return rec, None
        soup, head = parse_head(doc)
        rec["head"] = head
        h1 = soup.find("h1")
        rec["h1"] = h1.get_text(" ", strip=True) if h1 else ""
        kind, item = by_link.get(path, (None, None))
        if path == "/":
            kind = "home"
        elif path.startswith("/category/"):
            kind = "category"
        elif path.startswith("/tag/"):
            kind = "tag"
        elif re.match(r"^/\d{4}/\d{2}/$", path):
            kind = "archive"
        rec["type"] = kind or "page"
        if item:
            rec["wp_id"] = item["id"]
            rec["slug"] = item["slug"]
            rec["title"] = html.unescape(item["title"]["rendered"])
            rec["date"] = item.get("date")
            rec["modified"] = item.get("modified")
            rec["excerpt"] = BeautifulSoup(item.get("excerpt", {}).get("rendered", ""), "html.parser").get_text(" ", strip=True)
            # Live rendered HTML is the source of truth (REST output can contain unrendered
            # placeholders such as [[oh_seo_points]]); REST body is the fallback.
            live = main_content_from_live(soup)
            rest = clean_html(item.get("content", {}).get("rendered", ""))
            tl = lambda h: len(BeautifulSoup(h, "html.parser").get_text(strip=True))
            rec["content_html"] = rest if (tl(rest) > 1.3 * tl(live) and "[[" not in rest) else live
            rec["content_source"] = "rest" if rec["content_html"] is rest else "live"
            rec["featured_image"] = media.get(item.get("featured_media"))
            rec["author"] = (user_by_id.get(item.get("author")) or {}).get("name")
            rec["categories"] = [{"name": html.unescape(cat_by_id[c]["name"]), "path": url_to_path(cat_by_id[c]["link"])}
                                 for c in item.get("categories", []) if c in cat_by_id]
            rec["tags"] = [{"name": html.unescape(tag_by_id[t]["name"]), "path": url_to_path(tag_by_id[t]["link"])}
                           for t in item.get("tags", []) if t in tag_by_id]
        else:
            rec["title"] = rec["h1"] or head["title"]
            rec["content_html"] = main_content_from_live(soup) if kind == "home" else ""
        if kind == "home":
            rec["content_html"] = main_content_from_live(soup)
        rec["faqs"] = faq_from_jsonld(head["jsonld"])
        if path == "/":
            site_nav.update(extract_nav(soup))
        return rec, doc

    with ThreadPoolExecutor(max_workers=2) as ex:
        results = list(ex.map(work, urls))

    assets = set()
    rows = []
    for rec, doc in results:
        name = "home" if rec["path"] == "/" else rec["path"].strip("/").replace("/", "__")
        if doc:
            for m in re.findall(r"https?://openinkhub\.io(/wp-content/uploads/[^\s\"'()<>,]+?\.(?:webp|png|jpe?g|gif|svg|avif|ico|pdf|mp4))", doc, re.I):
                assets.add(m)
        with open(os.path.join(PAGES, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=2)
        head = rec.get("head", {})
        md = {m["key"]: m["content"] for m in head.get("meta", [])}
        canon = next((l["href"] for l in head.get("links", []) if l["rel"] == "canonical"), "")
        rows.append([rec["url"], rec["status"], rec.get("type"), rec["sitemap"], head.get("title", ""),
                     md.get("description", ""), canon, md.get("robots", ""), md.get("og:title", ""),
                     md.get("og:image", ""), rec.get("h1", ""), len(head.get("jsonld", [])), name + ".json"])

    rows.sort(key=lambda r: (r[2] or "", r[0]))
    with open(os.path.join(OUT, "urls.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["url", "status", "type", "sitemap", "title", "meta_description", "canonical", "robots",
                    "og_title", "og_image", "h1", "jsonld_blocks", "content_file"])
        w.writerows(rows)

    site = {"name": "openink Hub", "base_url": BASE, "nav": site_nav,
            "categories": [{**c, "name": html.unescape(c["name"]), "path": url_to_path(c["link"])} for c in cats],
            "tags": [{**t, "name": html.unescape(t["name"]), "path": url_to_path(t["link"])} for t in tags]}
    with open(os.path.join(OUT, "site.json"), "w", encoding="utf-8") as f:
        json.dump(site, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT, "assets.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(assets)))

    bad = [r for r in rows if r[1] != 200]
    print(f"4/4 done: {len(rows)} URLs, {len(bad)} non-200, {len(assets)} upload assets referenced")
    for r in bad:
        print("    non-200:", r[1], r[0])

    if "--assets" in sys.argv:
        download_assets(sorted(assets))


def download_assets(paths):
    dest = os.path.join(ROOT, "static")
    def dl(p):
        target = os.path.join(dest, p.lstrip("/").replace("/", os.sep))
        if os.path.exists(target):
            return 0
        st, data, _, final = get(BASE + p, binary=True)
        # WordPress redirects missing uploads to the homepage (HTTP 200 HTML) - never save that as an image
        if st == 200 and data and final.rstrip("/").endswith(p.rstrip("/")) and not data[:200].lstrip().lower().startswith((b"<!doctype", b"<html")):
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as f:
                f.write(data)
            return 1
        return 0
    with ThreadPoolExecutor(max_workers=2) as ex:
        n = sum(ex.map(dl, paths))
    print(f"    downloaded {n} assets into static/")


if __name__ == "__main__":
    main()
