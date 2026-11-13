"""
Static site generator for openinkhub.io  (Python 3.12+, standard library only).

Reads:   content/pages/*.json   (one per live URL: SEO head + content, produced by tools/extract.py)
         content/home.json      (homepage sections)
         content/site-config.json (nav, footer, contact)
         static/                (images at their original /wp-content/uploads/... paths, CSS, JS)
Writes:  dist/                  (deployable site; every URL keeps its exact original path)

    python tools/build.py
"""
import json, os, re, shutil, html, glob, datetime
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.name == "nt" and not ROOT.startswith("\\\\?\\"):
    ROOT = "\\\\?\\" + ROOT  # long-path support on Windows
C = os.path.join(ROOT, "content")
DIST = os.path.join(ROOT, "dist")
BASE = "https://openinkhub.io"
E = html.escape


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


CFG = load(os.path.join(C, "site-config.json"))
HOME = load(os.path.join(C, "home.json"))
RECS = [load(os.path.join(C, "pages", n)) for n in sorted(os.listdir(os.path.join(C, "pages"))) if n.endswith(".json")]
RECS = [r for r in RECS if r.get("status") == 200 and r.get("head")]
BY_PATH = {r["path"]: r for r in RECS}
POSTS = sorted([r for r in RECS if r.get("type") == "post"], key=lambda r: r.get("date") or "", reverse=True)

ICONS = {
    "chat": '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 10.5h7M8.5 13.5h4"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    "pin": '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    "code": '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    "spark": '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    "check": '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    "arrow": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "phone": '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    "wa": '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.1 3.1Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2Z"/>',
    "map": '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}


def icon(name, cls="ico"):
    return (f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS.get(name, ICONS["spark"])}</svg>')


def rel(url):
    """Absolute same-site URL -> root-relative, so the site works on any preview host."""
    if not url:
        return url
    return re.sub(r"^https?://(www\.)?openinkhub\.io(?=/|$)", "", url) or "/"


def localize_body(h):
    h = re.sub(r'(href|src)="https?://(?:www\.)?openinkhub\.io(/[^"]*)?"',
               lambda m: f'{m.group(1)}="{m.group(2) or "/"}"', h)
    h = re.sub(r"<img(?![^>]*\bloading=)", '<img loading="lazy" decoding="async"', h)
    h = re.sub(r"<table", '<div class="table-wrap"><table', h)
    h = re.sub(r"</table>", "</table></div>", h)
    h = re.sub(r'<a href="(https?://(?!(?:www\.)?openinkhub\.io)[^"]+)"(?![^>]*target=)',
               r'<a href="\1" target="_blank" rel="noopener"', h)
    return h


def fmt_date(d):
    try:
        return datetime.datetime.fromisoformat(d[:19]).strftime("%d %b %Y")
    except Exception:
        return ""


def read_minutes(h):
    words = len(re.sub(r"<[^>]+>", " ", h).split())
    return max(1, round(words / 220))


# ------------------------------------------------------------------ <head>
def head_html(rec):
    hd = rec["head"]
    out = [f'<meta charset="UTF-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">',
           f'<title>{E(hd["title"], quote=False)}</title>']
    for m in hd["meta"]:
        out.append(f'<meta {m["attr"]}="{E(m["key"])}" content="{E(m["content"])}">')
    for l in hd["links"]:
        extra = "".join(f' {k}="{E(l[k])}"' for k in ("hreflang", "type", "sizes") if l.get(k))
        out.append(f'<link rel="{E(l["rel"])}" href="{E(l["href"])}"{extra}>')
    out.append('<meta name="theme-color" content="#046bd2">')
    out.append('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    out.append('<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">')
    out.append(f'<link rel="stylesheet" href="/assets/css/site.css?v={VERSION}">')
    for j in hd["jsonld"]:
        if "_raw" in j:
            out.append(f'<script type="application/ld+json">{j["_raw"]}</script>')
        else:
            out.append('<script type="application/ld+json">' +
                       json.dumps(j, ensure_ascii=False).replace("</", "<\\/") + "</script>")
    return "\n".join(out)


# ------------------------------------------------------------------ chrome
def header(path):
    items = []
    for it in CFG["nav"]:
        active = ' aria-current="page"' if it["href"] == path else ""
        if it.get("children"):
            kids = "".join(f'<li><a href="{E(c["href"])}">{E(c["label"])}</a></li>' for c in it["children"])
            items.append(f'<li class="has-sub"><a href="{E(it["href"])}"{active}>{E(it["label"])}</a>'
                         f'<ul class="sub">{kids}</ul></li>')
        else:
            items.append(f'<li><a href="{E(it["href"])}"{active}>{E(it["label"])}</a></li>')
    c = CFG["contact"]
    return f'''<a class="skip" href="#main">Skip to content</a>
<header class="site-header" id="top">
  <div class="wrap nav-row">
    <a class="brand" href="/" aria-label="{E(CFG["name"])} home">
      <img src="{E(CFG["logo"])}" alt="{E(CFG["name"])}" width="36" height="36"><span>openink<b>Hub</b></span>
    </a>
    <nav class="main-nav" aria-label="Primary"><ul>{"".join(items)}</ul></nav>
    <div class="nav-cta">
      <a class="btn btn-sm btn-ghost hide-sm" href="tel:{E(c["phone_raw"])}">{icon("phone")}<span>{E(c["phone"])}</span></a>
      <a class="btn btn-sm btn-primary" href="{E(c["demo_url"])}" target="_blank" rel="noopener">Free Demo</a>
      <button class="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-nav">{icon("menu")}</button>
    </div>
  </div>
  <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile"><ul>{"".join(items)}</ul></nav>
</header>'''


def footer():
    c = CFG["contact"]
    cols = []
    for col in CFG["footer"]["columns"]:
        links = "".join(f'<li><a href="{E(l["href"])}">{E(l["label"])}</a></li>' for l in col["links"])
        cols.append(f'<div><h3>{E(col["title"])}</h3><ul>{links}</ul></div>')
    year = datetime.date.today().year
    return f'''<section class="cta-band">
  <div class="wrap cta-inner">
    <div><h2>Ready to be found on Google <em>and</em> in AI answers?</h2>
    <p>Talk to the Openink Hub team about SEO, AEO, GEO, AIO and automation for your business.</p></div>
    <div class="cta-actions">
      <a class="btn btn-light" href="{E(c["demo_url"])}" target="_blank" rel="noopener">Schedule a Free Demo</a>
      <a class="btn btn-outline-light" href="{E(c["whatsapp"])}" target="_blank" rel="noopener">{icon("wa")}WhatsApp us</a>
    </div>
  </div>
</section>
<footer class="site-footer">
  <div class="wrap foot-grid">
    <div class="foot-about">
      <a class="brand brand-light" href="/"><img src="{E(CFG["logo"])}" alt="" width="32" height="32"><span>openink<b>Hub</b></span></a>
      <p>{E(CFG["footer"]["about"])}</p>
      <ul class="contact-list">
        <li>{icon("map")}<span>{E(c["address"])}</span></li>
        <li>{icon("phone")}<a href="tel:{E(c["phone_raw"])}">{E(c["phone"])}</a></li>
        <li>{icon("mail")}<a href="mailto:{E(c["email"])}">{E(c["email"])}</a></li>
      </ul>
    </div>
    {"".join(cols)}
  </div>
  <div class="wrap foot-bottom">
    <span>© {year} {E(CFG["name"])}. All rights reserved.</span>
    <span class="legal">{" · ".join(f'<a href="{E(l["href"])}">{E(l["label"])}</a>' for l in CFG["footer"]["legal"])}</span>
  </div>
</footer>
<a class="wa-float" href="{E(c["whatsapp"])}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">{icon("wa")}</a>
<script src="/assets/js/site.js?v={VERSION}" defer></script>'''


def document(rec, body, body_class=""):
    lang = rec["head"].get("lang") or "en-US"
    return f'''<!DOCTYPE html>
<html lang="{E(lang)}">
<head>
{head_html(rec)}
</head>
<body class="{body_class}">
{header(rec["path"])}
<main id="main">
{body}
</main>
{footer()}
</body>
</html>
'''


def breadcrumb(trail):
    parts = ['<a href="/">Home</a>']
    for label, href in trail:
        parts.append(f'<a href="{E(href)}">{E(label)}</a>' if href else f'<span aria-current="page">{E(label)}</span>')
    return '<nav class="crumbs" aria-label="Breadcrumb">' + '<span class="sep">/</span>'.join(parts) + "</nav>"


def post_card(r):
    img = r.get("featured_image")
    im = (f'<img src="{E(rel(img["src"]))}" alt="{E(img.get("alt") or r["title"])}" loading="lazy" decoding="async">'
          if img else f'<div class="card-ph">{icon("spark")}</div>')
    cat = r["categories"][0]["name"] if r.get("categories") else "Article"
    return f'''<article class="post-card">
  <a href="{E(r["path"])}" class="post-card-img">{im}</a>
  <div class="post-card-body">
    <span class="tag">{E(cat)}</span>
    <h3><a href="{E(r["path"])}">{E(r["title"])}</a></h3>
    <p>{E((r.get("excerpt") or "")[:150])}{"…" if len(r.get("excerpt") or "") > 150 else ""}</p>
    <span class="meta">{icon("clock")}{fmt_date(r.get("date") or "")}</span>
  </div>
</article>'''


# ------------------------------------------------------------------ templates
def split_h1(content, fallback):
    """-> (eyebrow_text, h1_inner_html, remaining_body). Keeps the page's real H1 (with <em> accents)."""
    m = re.search(r"<h1[^>]*>(.*?)</h1>", content, re.S)
    if not m:
        return "", E(fallback), content
    inner = re.sub(r"</?(?!em\b|strong\b|b\b)[a-z0-9]+[^>]*>", "", m.group(1)).strip()
    pre, post = content[:m.start()], content[m.end():]
    pre_txt = re.sub(r"<[^>]+>", " ", pre).strip()
    eyebrow = ""
    if pre_txt and len(pre_txt) < 140 and "<img" not in pre:
        eyebrow, pre = html.unescape(re.sub(r"\s+", " ", pre_txt)), ""
    return eyebrow, inner, enhance(pre + post)


P_RUN = re.compile(r"(?:<p>(?:(?!</p>).){1,60}?</p>\s*){4,}", re.S)


def enhance(body):
    """Turn Elementor leftovers into designed components:
       runs of tiny paragraphs  -> stat grid (value/label pairs) or pill list
       a short line right before an <h2> -> section kicker"""
    def run(m):
        items = [strip_tags(x) for x in re.findall(r"<p>(.*?)</p>", m.group(0), re.S)]
        if any(len(i) > 48 for i in items):
            return m.group(0)
        tail = ""
        if len(items) % 2 and not re.search(r"\d", items[-1]):  # trailing kicker, e.g. "Understanding our approach"
            tail = f'<p class="kicker">{E(items[-1], quote=False)}</p>'
            items = items[:-1]
        pairs = list(zip(items[::2], items[1::2]))
        if len(items) >= 4 and len(items) % 2 == 0 and sum(bool(re.search(r"\d|%|∞|Full|24/7", v)) or len(v) <= 12 for v, _ in pairs) >= len(pairs) - 1:
            cells = "".join(f'<div class="stat"><strong>{E(v, quote=False)}</strong><span>{E(l, quote=False)}</span></div>' for v, l in pairs)
            return f'<div class="stat-grid">{cells}</div>{tail}'
        return m.group(0)
    body = P_RUN.sub(run, body)
    body = re.sub(r"<p>([^<]{2,60})</p>(\s*<h2)", lambda m: (f'<p class="kicker">{m.group(1).strip()}</p>{m.group(2)}'
                  if not m.group(1).strip().endswith((".", ":", "?")) else m.group(0)), body)
    return body


def strip_tags(h):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", h)).strip())


def faq_block(faqs, h2="Frequently Asked Questions"):
    if not faqs:
        return ""
    items = "".join(f'<details class="faq"><summary>{E(re.sub("<[^>]+>", "", f["q"]))}</summary>'
                    f'<div class="faq-a">{localize_body(f["a"])}</div></details>' for f in faqs)
    return f'<section class="section"><div class="wrap narrow"><h2 class="sec-title">{E(h2)}</h2>{items}</div></section>'


def content_has_faq(content, faqs):
    return bool(faqs) and all(re.sub(r"\W+", "", f["q"].lower())[:40] in re.sub(r"\W+", "", content.lower()) for f in faqs[:2])


def page_tpl(rec):
    eyebrow, h1, body = split_h1(rec.get("content_html", ""), rec.get("h1") or rec["title"])
    h1_txt = strip_tags(h1)
    legal =rec["path"].strip("/") in {"privacy-policy", "terms", "refund", "shipping", "disclaimer", "cookie", "report"}
    lead = ""
    m = re.match(r"\s*<p>(.*?)</p>", body, re.S)
    if m and not legal and len(re.sub(r"<[^>]+>", "", m.group(1))) < 420:
        lead = f'<p class="lead">{m.group(1)}</p>'
        body = body[m.end():]
    faqs = "" if content_has_faq(body, rec.get("faqs")) else faq_block(rec.get("faqs"))
    contact = contact_cards() if rec["path"] == "/contact-us/" else ""
    img = rec.get("featured_image")
    hero_img = (f'<div class="page-hero-img"><img src="{E(rel(img["src"]))}" alt="{E(img.get("alt") or h1_txt)}" '
                f'width="{img.get("width") or ""}" height="{img.get("height") or ""}"></div>') if img and not legal else ""
    crumb = rec["title"] if len(rec["title"]) < 60 else h1_txt[:60]
    return document(rec, f'''<section class="page-hero{' page-hero-sm' if legal else ''}">
  <div class="wrap {'hero-split' if hero_img else ''}">
    <div>{breadcrumb([(crumb, None)])}
    {f'<span class="eyebrow">{E(eyebrow)}</span>' if eyebrow else ''}
    <h1>{h1}</h1>{lead}
    {"" if legal else f'<div class="hero-ctas"><a class="btn btn-primary" href="{E(CFG["contact"]["demo_url"])}" target="_blank" rel="noopener">Schedule a Free Demo</a><a class="btn btn-ghost" href="/contact-us/">Contact Us</a></div>'}
    </div>{hero_img}
  </div>
</section>
{contact}
<section class="section"><div class="wrap narrow prose">{localize_body(body)}</div></section>
{faqs}''', "is-page" + (" is-legal" if legal else ""))


def related(rec, n=3):
    cats = {c["path"] for c in rec.get("categories", [])}
    pool = [p for p in POSTS if p["path"] != rec["path"] and cats & {c["path"] for c in p.get("categories", [])}]
    # prefer non-city articles for variety when available
    pool.sort(key=lambda p: ("best-seo-agency-in-" in p["path"], p.get("date") or ""), reverse=False)
    return pool[:n] or [p for p in POSTS if p["path"] != rec["path"]][:n]


def post_tpl(rec):
    eyebrow, h1, body = split_h1(rec.get("content_html", ""), rec.get("h1") or rec["title"])
    h1_txt = strip_tags(h1)
    cat = rec["categories"][0] if rec.get("categories") else None
    trail = ([(cat["name"], cat["path"])] if cat else []) + [(h1_txt if len(h1_txt) < 50 else h1_txt[:50] + "…", None)]
    img = rec.get("featured_image")
    # don't repeat the featured image if the article body already opens with it
    first_img = re.search(r'<img[^>]*src="([^"]+)"', body[:600])
    dup = img and first_img and re.sub(r"-\d+x\d+(?=\.\w+$)", "", rel(first_img.group(1))) == re.sub(r"-\d+x\d+(?=\.\w+$)", "", rel(img["src"]))
    fig = (f'<figure class="post-feature"><img src="{E(rel(img["src"]))}" alt="{E(img.get("alt") or h1_txt)}" '
           f'width="{img.get("width") or ""}" height="{img.get("height") or ""}"></figure>') if img and not dup else ""
    tags = "".join(f'<a class="chip" href="{E(t["path"])}">#{E(t["name"])}</a>' for t in rec.get("tags", []))
    faqs = "" if content_has_faq(body, rec.get("faqs")) else faq_block(rec.get("faqs"))
    rel_posts = "".join(post_card(p) for p in related(rec))
    return document(rec, f'''<article class="post">
  <header class="post-hero"><div class="wrap narrow">
    {breadcrumb(trail)}
    {f'<a class="tag" href="{E(cat["path"])}">{E(cat["name"])}</a>' if cat else ""}
    {f'<span class="eyebrow">{E(eyebrow)}</span>' if eyebrow else ''}
    <h1>{h1}</h1>
    <div class="post-meta">
      <span>By {E(rec.get("author") or "Openink Hub")}</span><span>·</span>
      <time datetime="{E(rec.get("date") or "")}">{fmt_date(rec.get("date") or "")}</time><span>·</span>
      <span>{read_minutes(body)} min read</span>
    </div>
  </div></header>
  <div class="wrap narrow">{fig}<div class="prose">{localize_body(body)}</div>
  {f'<div class="post-tags">{tags}</div>' if tags else ""}
  <aside class="post-cta"><div><h2>Want results like this for your business?</h2>
  <p>Get a free consultation on SEO, AEO, GEO and AI automation from the Openink Hub team.</p></div>
  <a class="btn btn-primary" href="{E(CFG["contact"]["demo_url"])}" target="_blank" rel="noopener">Book a Free Demo</a></aside>
  </div>
</article>
{faqs}
<section class="section section-alt"><div class="wrap"><h2 class="sec-title">Related articles</h2>
<div class="post-grid">{rel_posts}</div></div></section>''', "is-post")


def listing_tpl(rec, posts, label):
    intro = re.sub(r"<[^>]+>", " ", rec.get("content_html") or "").strip()
    h1 = rec.get("h1") or rec["title"]
    cards = "".join(post_card(p) for p in posts) or "<p>No articles yet.</p>"
    filters = "".join(f'<a class="chip{" is-on" if c["path"] == rec["path"] else ""}" href="{E(c["path"])}">{E(c["name"])}</a>'
                      for c in CATS if c.get("count"))
    return document(rec, f'''<section class="page-hero page-hero-sm"><div class="wrap">
  {breadcrumb([(label, None), (h1, None)])}
  <h1>{E(h1)}</h1>
  <p class="lead">{len(posts)} article{"s" if len(posts) != 1 else ""}{(" · " + E(intro[:200])) if intro and len(intro) < 400 else ""}</p>
  <div class="chips">{filters}</div>
</div></section>
<section class="section"><div class="wrap"><div class="post-grid">{cards}</div></div></section>''', "is-archive")


def contact_cards():
    c = CFG["contact"]
    cards = [("phone", "Call us", c["phone"], f'tel:{c["phone_raw"]}'),
             ("wa", "WhatsApp", "Chat instantly", c["whatsapp"]),
             ("mail", "Email", c["email"], f'mailto:{c["email"]}'),
             ("map", "Visit", c["address"], c.get("map_url") or "#")]
    return '<section class="section section-tight"><div class="wrap contact-grid">' + "".join(
        f'<a class="contact-card" href="{E(h)}"{" target=_blank rel=noopener" if h.startswith("http") else ""}>'
        f'{icon(i)}<strong>{E(t)}</strong><span>{E(v)}</span></a>' for i, t, v, h in cards) + "</div></section>"


def home_tpl(rec):
    H = HOME
    hero = H["hero"]
    ctas = "".join(f'<a class="btn btn-{c["style"]}" href="{E(c["href"])}"{" target=_blank rel=noopener" if c["href"].startswith("http") else ""}>{E(c["label"])}{icon("arrow") if c["style"] == "primary" else ""}</a>' for c in hero["ctas"])
    services = "".join(f'''<article class="svc-card"><div class="svc-ico">{icon(s["icon"])}</div><h3>{E(s["title"])}</h3>
<p>{E(s["text"])}</p><a class="link-arrow" href="{E(s["href"])}">{E(s["cta"])}{icon("arrow")}</a></article>''' for s in H["services"]["items"])
    era = "".join(f'<div class="era-item"><span class="num">0{i+1}</span><h3>{E(x["title"])}</h3><p>{E(x["text"])}</p></div>'
                  for i, x in enumerate(H["era"]["items"]))
    mission_items = "".join(f'<li>{icon("check")}<div><strong>{E(x["title"])}</strong><span>{E(x["text"])}</span></div></li>'
                            for x in H["mission"]["items"])
    team = "".join(f'<figure class="person"><img src="{E(p["img"])}" alt="{E(p["name"])}, {E(p["role"])} at Openink Hub" loading="lazy">'
                   f'<figcaption><strong>{E(p["name"])}</strong><span>{E(p["role"])}</span></figcaption></figure>' for p in H["team"]["people"])
    testi = "".join(f'<figure class="quote"><blockquote>“{E(t["quote"])}”</blockquote><figcaption>'
                    f'<img src="{E(t["img"])}" alt="{E(t["name"])}" loading="lazy" width="48" height="48"><strong>{E(t["name"])}</strong></figcaption></figure>'
                    for t in H["testimonials"]["items"])
    wa = "".join(f'<div class="wa-item">{icon("check")}<div><h3>{E(x["title"])}</h3><p>{E(x["text"])}</p></div></div>' for x in H["whatsapp"]["items"])
    logos = "".join(f'<img src="{E(l["img"])}" alt="{E(l["name"])}" loading="lazy">' for l in H["clients"]["logos"])
    sol = "".join(f'<a class="sol-link" href="{E(l["href"])}">{E(l["label"])}{icon("arrow")}</a>' for l in H["solutions"]["links"])
    faq_items = "".join(f'<details class="faq"><summary>{E(f["q"])}</summary><div class="faq-a"><p>{f["a"]}</p></div></details>' for f in H["faq"]["items"])
    latest = "".join(post_card(p) for p in [p for p in POSTS if "best-seo-agency-in-" not in p["path"]][:3])
    blog_cat = next((c["path"] for c in CATS if c["slug"] == "best-seo-content-agency"), "/")
    body = f'''<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">{E(hero["eyebrow"])}</span>
      <h1>{E(hero["h1"])}</h1>
      <p class="lead">{E(hero["lead"])}</p>
      <div class="hero-ctas">{ctas}</div>
      <div class="quick-answer"><strong>Quick answer:</strong> {E(hero["quick_answer"])}</div>
    </div>
    <div class="hero-visual">
      <img src="{E(hero["image"]["src"])}" alt="{E(hero["image"]["alt"])}" width="1024" height="576" fetchpriority="high">
      <div class="engines"><span>Google</span><span>ChatGPT</span><span>Gemini</span><span>Perplexity</span></div>
    </div>
  </div>
</section>
<section class="logo-strip" aria-label="Clients"><div class="wrap"><p>{E(H["clients"]["h2"])}</p><div class="marquee"><div class="marquee-track">{logos}{logos}</div></div></div></section>
<section class="section" id="services"><div class="wrap">
  <div class="sec-head"><h2 class="sec-title">{E(H["services"]["h2"])}</h2><p>{E(H["services"]["intro"])}</p></div>
  <div class="svc-grid">{services}</div>
</div></section>
<section class="section section-dark"><div class="wrap">
  <div class="sec-head"><span class="eyebrow eyebrow-light">The Tipping Point of the Modern AI Era</span><h2 class="sec-title">{E(H["era"]["h2"])}</h2><p>{E(H["era"]["intro"])}</p></div>
  <div class="era-grid">{era}</div>
</div></section>
<section class="section"><div class="wrap split">
  <div><h2 class="sec-title">{E(H["mission"]["h2"])}</h2>{"".join(f"<p>{E(p)}</p>" for p in H["mission"]["paras"])}</div>
  <ul class="check-list">{mission_items}</ul>
</div></section>
<section class="section section-alt"><div class="wrap">
  <div class="sec-head"><h2 class="sec-title">{E(H["team"]["h2"])}</h2><p>{E(H["team"]["intro"])}</p></div>
  <div class="team-grid">{team}</div>
</div></section>
<section class="section"><div class="wrap platform">
  <div><h2 class="sec-title">{E(H["platform"]["h2"])}</h2><p>{E(H["platform"]["text"])}</p>
  <a class="btn btn-primary" href="{E(H["platform"]["cta"]["href"])}">{E(H["platform"]["cta"]["label"])}{icon("arrow")}</a></div>
  <div class="sol-grid"><h3>{E(H["solutions"]["h2"])}</h3><p>{E(H["solutions"]["text"])}</p><div class="sol-links">{sol}</div></div>
</div></section>
<section class="section section-wa"><div class="wrap split">
  <div><span class="eyebrow">WhatsApp AI ChatBot</span><h2 class="sec-title">{E(H["whatsapp"]["h2"])}</h2>
  <a class="btn btn-primary" href="{E(H["whatsapp"]["cta"]["href"])}">{E(H["whatsapp"]["cta"]["label"])}{icon("arrow")}</a></div>
  <div class="wa-list">{wa}</div>
</div></section>
<section class="section section-alt"><div class="wrap">
  <div class="sec-head"><h2 class="sec-title">{E(H["testimonials"]["h2"])}</h2></div>
  <div class="quote-grid">{testi}</div>
</div></section>
<section class="section"><div class="wrap">
  <div class="sec-head sec-head-row"><h2 class="sec-title">Latest insights</h2><a class="link-arrow" href="{E(blog_cat)}">All articles{icon("arrow")}</a></div>
  <div class="post-grid">{latest}</div>
</div></section>
<section class="section section-alt"><div class="wrap narrow"><h2 class="sec-title">{E(H["faq"]["h2"])}</h2>{faq_items}</div></section>'''
    return document(rec, body, "is-home")


# ------------------------------------------------------------------ build
def write(path, text):
    target = os.path.join(DIST, path.lstrip("/").replace("/", os.sep))
    if path.endswith("/"):
        target = os.path.join(target, "index.html")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def sitemaps():
    groups = defaultdict(list)
    for r in RECS:
        if r.get("head") and any(m["key"] == "robots" and "noindex" in m["content"] for m in r["head"]["meta"]):
            continue
        name = {"home": "home", "post": "posts", "page": "pages", "category": "categories", "tag": "tags",
                "archive": "archives"}.get(r.get("type"), "pages")
        groups[name].append(r)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    idx = ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for name in ("home", "posts", "pages", "categories", "tags", "archives"):
        rows = groups.get(name, [])
        urls = "".join(
            f"<url><loc>{E(r['url'] if r['path'] != '/' else BASE)}</loc>"
            f"{'<lastmod>' + E(r.get('lastmod') or (r.get('modified') or '') + '+00:00') + '</lastmod>' if (r.get('lastmod') or r.get('modified')) else ''}</url>\n"
            for r in sorted(rows, key=lambda r: r.get("lastmod") or "", reverse=True))
        write(f"/sitemap-{name}.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
              + urls + "</urlset>\n")
        idx.append(f"<sitemap><loc>{BASE}/sitemap-{name}.xml</loc><lastmod>{now}</lastmod></sitemap>")
    idx.append("</sitemapindex>\n")
    write("/sitemap.xml", "\n".join(idx))
    write("/sitemap_index.xml", "\n".join(idx))  # was live on WordPress too
    write("/robots.txt", "User-agent: *\nAllow: /\n\n" + "".join(
        f"Sitemap: {BASE}/sitemap{'' if n == '' else '-' + n}.xml\n" for n in ["", "home", "posts", "pages", "categories", "tags", "archives"]))


def not_found():
    rec = {"path": "/404", "head": {"title": "Page not found | openink Hub", "lang": "en-US", "links": [], "jsonld": [],
                                    "meta": [{"attr": "name", "key": "robots", "content": "noindex,follow"}]}}
    latest = "".join(post_card(p) for p in POSTS[:3])
    write("/404.html", document(rec, f'''<section class="page-hero"><div class="wrap narrow center">
<span class="eyebrow">Error 404</span><h1>We couldn’t find that page</h1>
<p class="lead">The link may be outdated. Try one of our services or the latest articles below.</p>
<div class="hero-ctas center"><a class="btn btn-primary" href="/">Back to home</a><a class="btn btn-ghost" href="/best-seo-services-in-india/">Our services</a></div>
</div></section><section class="section"><div class="wrap"><div class="post-grid">{latest}</div></div></section>'''))


def main():
    global VERSION, CATS
    VERSION = datetime.datetime.now().strftime("%Y%m%d%H%M")
    CATS = load(os.path.join(C, "site.json")).get("categories", [])
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    shutil.copytree(os.path.join(ROOT, "static"), DIST)
    by_cat, by_tag, by_month = defaultdict(list), defaultdict(list), defaultdict(list)
    for p in POSTS:
        for c in p.get("categories", []):
            by_cat[c["path"]].append(p)
        for t in p.get("tags", []):
            by_tag[t["path"]].append(p)
        if p.get("date"):
            by_month[f"/{p['date'][:4]}/{p['date'][5:7]}/"].append(p)
    for r in RECS:
        t = r.get("type")
        if t == "home":
            out = home_tpl(r)
        elif t == "post":
            out = post_tpl(r)
        elif t == "category":
            out = listing_tpl(r, by_cat.get(r["path"], []), "Category")
        elif t == "tag":
            out = listing_tpl(r, by_tag.get(r["path"], []), "Tag")
        elif t == "archive":
            out = listing_tpl(r, by_month.get(r["path"], []), "Archive")
        else:
            out = page_tpl(r)
        write(r["path"], out)
    sitemaps()
    not_found()
    write("/CNAME", "openinkhub.io\n")
    write("/.nojekyll", "")
    # sanity: every referenced local asset exists
    missing = set()
    for f in glob.glob(os.path.join(DIST, "**", "*.html"), recursive=True):
        for src in re.findall(r'(?:src|href)="(/wp-content/[^"?#]+)"', open(f, encoding="utf-8").read()):
            if not os.path.exists(os.path.join(DIST, src.lstrip("/").replace("/", os.sep))):
                missing.add(src)
    print(f"built {len(RECS)} URLs into dist/  ({len(POSTS)} posts)")
    if missing:
        print(f"WARNING {len(missing)} referenced assets missing, e.g.:", *sorted(missing)[:10], sep="\n  ")


VERSION = ""
CATS = []
if __name__ == "__main__":
    main()
