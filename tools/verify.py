"""
Verify the built site against the URL inventory captured from the live WordPress site.

For every URL in content/urls.csv checks that dist/ has the page at the identical path and that
its <title>, meta description, canonical, robots, og:title, og:image and JSON-LD block count match.
Exits non-zero on any mismatch (used as a CI gate before deploy).

    python tools/verify.py
"""
import csv, os, re, sys, html, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.name == "nt" and not ROOT.startswith("\\\\?\\"):
    ROOT = "\\\\?\\" + ROOT
DIST = os.path.join(ROOT, "dist")


def meta(doc, key):
    m = re.search(r'<meta (?:name|property)="%s" content="([^"]*)"' % re.escape(key), doc)
    return html.unescape(m.group(1)) if m else ""


def main():
    rows = list(csv.DictReader(open(os.path.join(ROOT, "content", "urls.csv"), encoding="utf-8-sig")))
    errors = []
    for r in rows:
        path = urllib.parse.urlparse(r["url"]).path or "/"
        f = os.path.join(DIST, path.strip("/").replace("/", os.sep), "index.html") if path != "/" else os.path.join(DIST, "index.html")
        if not os.path.exists(f):
            errors.append(f"MISSING  {r['url']}")
            continue
        doc = open(f, encoding="utf-8").read()
        title = html.unescape(re.search(r"<title>(.*?)</title>", doc, re.S).group(1))
        canon = re.search(r'<link rel="canonical" href="([^"]*)"', doc)
        checks = {
            "title": (title, r["title"]),
            "description": (meta(doc, "description"), r["meta_description"]),
            "canonical": (html.unescape(canon.group(1)) if canon else "", r["canonical"]),
            "robots": (meta(doc, "robots"), r["robots"]),
            "og:title": (meta(doc, "og:title"), r["og_title"]),
            "og:image": (meta(doc, "og:image"), r["og_image"]),
            "json-ld blocks": (str(doc.count('type="application/ld+json"')), r["jsonld_blocks"]),
        }
        for k, (got, want) in checks.items():
            if got.strip() != want.strip():
                errors.append(f"MISMATCH {r['url']}  {k}: got {got[:80]!r} want {want[:80]!r}")
        if doc.count("<h1") != 1:
            errors.append(f"H1 COUNT {r['url']}  {doc.count('<h1')}")
    for extra in ("sitemap.xml", "robots.txt", "CNAME", "404.html"):
        if not os.path.exists(os.path.join(DIST, extra)):
            errors.append(f"MISSING  /{extra}")
    print(f"checked {len(rows)} URLs: {len(errors)} problem(s)")
    for e in errors[:60]:
        print("  " + e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
