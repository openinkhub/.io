# openinkhub.io — static site

A fast, static rebuild of openinkhub.io (previously WordPress + Elementor), deployed with **GitHub Pages**.
Every one of the 154 live URLs is kept at the **exact same path**, with its original SEO head
(title, meta description, keywords, robots, canonical, Open Graph, Twitter, Google verification, JSON-LD).

## Layout

| Path | What it is |
|---|---|
| `content/urls.csv` | Inventory of every live URL with status, title, description, canonical, robots, OG, H1 |
| `content/pages/*.json` | One file per URL: full `<head>` SEO data + cleaned, reusable body HTML |
| `content/home.json` | Homepage sections (text extracted verbatim from the live homepage) |
| `content/site-config.json` | Navigation, footer, contact details |
| `content/site.json` | Categories, tags, menus as found on WordPress |
| `static/` | Images at their original `/wp-content/uploads/...` paths, plus CSS/JS in `assets/` |
| `tools/extract.py` | Re-crawls the live site (sitemaps + live HTML + WP REST API) into `content/` |
| `tools/build.py` | Generates `dist/` (Python standard library only) |
| `tools/verify.py` | Fails if any original URL or SEO tag is missing/changed in `dist/` |
| `.github/workflows/deploy.yml` | Builds, verifies, and deploys to GitHub Pages on every push to `main` |

## Local

```bash
python tools/build.py
python tools/verify.py
python -m http.server 8080 -d dist
```

## Deploy (GitHub Pages)

1. Push this folder to a GitHub repo (branch `main`).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Pages → Custom domain:** `openinkhub.io` (a `CNAME` file is already emitted), then tick *Enforce HTTPS*.
4. At your DNS provider, point the apex domain to GitHub Pages:
   `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   (and `AAAA` → `2606:50c0:8000::153`, `…8001::153`, `…8002::153`, `…8003::153`); `www` → `CNAME <user>.github.io`.
5. After cut-over, resubmit `https://openinkhub.io/sitemap.xml` in Google Search Console.

## Editing content

* Page/post text: edit `content_html` in `content/pages/<slug>.json`. Head tags live under `head`.
* New page: add a JSON file with `path`, `url`, `type` (`page`/`post`), `title`, `head`, `content_html`.
* Re-sync from WordPress while it's still live: `pip install beautifulsoup4 && python tools/extract.py --assets`
  (this overwrites `content/pages/*.json` — don't run it after you've started editing there).

## Not carried over (WordPress-only features)

* `/feed/` RSS, `/wp-json/`, `/wp-admin/`, `?p=ID` short links, paginated archives (`/page/2/`).
* The contact page form: a static host can't process form posts — contact runs through phone, WhatsApp,
  email and the Calendly demo link. Plug in a form service (e.g. Formspree) if a form is needed.
