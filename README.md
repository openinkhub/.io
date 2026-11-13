# openinkhub.io — static site

A fast, static rebuild of openinkhub.io (previously WordPress + Elementor), deployed with **Cloudflare Pages**.
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
| `tools/build.mjs` | `npm run build` — generates `dist/` (Node 18+, zero dependencies) |
| `tools/verify.mjs` | `npm run verify` — fails if any original URL or SEO tag is missing/changed in `dist/` |
| `tools/serve.mjs` | `npm run preview` — local preview of `dist/` with the same URL handling as the live host |
| `tools/extract.py` | One-time Python crawler that pulled the live WordPress site into `content/` |
| `.github/workflows/verify.yml` | Safety check on every push/PR: builds and verifies all original URLs + SEO tags (no deploy) |

## Local

```bash
npm run build      # -> dist/
npm run verify     # check all 154 original URLs + SEO tags
npm run preview    # http://localhost:8080
```

Any host that runs `npm run build` works: publish directory is `dist`. There are no dependencies to install.

## Deploy (Cloudflare Pages)

Cloudflare Pages builds and publishes the site automatically on every push to `main`.

**Build settings** (Workers & Pages → the project → Settings → Build):

| Setting | Value |
|---|---|
| Framework preset | `None` |
| Build command | `npm test` (build + URL/SEO check, so a broken build never goes live) |
| Build output directory | `dist` |
| Root directory | *(empty)* |
| Environment variable | `NODE_VERSION` = `20` (optional) |

**Custom domain:** the project → **Custom domains** → add `openinkhub.io` and `www.openinkhub.io`.
If the domain's DNS is on Cloudflare, the records are created for you; otherwise follow the CNAME
instructions Cloudflare shows. Check the `*.pages.dev` preview before switching the domain.

**After cut-over:** resubmit `https://openinkhub.io/sitemap.xml` in Google Search Console.

Cloudflare Pages serves `dist/404.html` for unknown URLs and redirects `/page` to `/page/`,
matching the original WordPress URLs. (`dist/CNAME` is only used by GitHub Pages and is harmless here.)

## SEO city guides (category "SEO", 100 posts)

The 100 posts under `/category/seo-agency-by-city/` are written per city in `content/city-posts/*.json`
(local economy, localities, search behaviour, SEO/AEO/GEO/AIO angles, FAQs, nearby cities).
URLs, publish dates and authors are unchanged; titles, descriptions, body and JSON-LD
(Article, FAQPage, Service with areaServed, BreadcrumbList) are generated from those files.

```bash
npm run city-posts   # write the city files into content/pages/*.json
npm run dupcheck     # pairwise duplicate-content report (npm test fails above 25%)
```

Edit a city in `content/city-posts/`, then run `npm run city-posts && npm test`.

## SEO checklist, automatic fixes and /admin report

Every build runs the full SEO checklist (70 checks from the "WP SEO Plugin" spec) and applies safe fixes automatically.

| File | Role |
|---|---|
| `content/seo/rules.json` | **All SEO rules**: thresholds, weights, report sections, critical checks, and which auto-fixes are on |
| `content/seo/squirrly.json` | Imported Squirrly data: focus keyphrases, per-URL settings, 16 redirects (2 looping ones skipped) |
| `tools/seo-fix.mjs` | Auto-fixes: meta description, Open Graph, Twitter card, excerpt, missing JSON-LD (Organization, WebSite, Breadcrumb, Article/BlogPosting, Person, FAQPage), archive/tag headings, image alt + width/height |
| `tools/seo-audit.mjs` | The checklist; writes `dist/admin/report.json`, `report.csv` and the `/admin` dashboard; fails the build on critical issues |
| `tools/import-squirrly.mjs` | Re-import a Squirrly backup: `npm run import-squirrly -- path/to/export.jsonl.gz` |

The build also writes `_redirects` (Squirrly redirects), `_headers` (security headers, noindex for /admin), `llms.txt` and a robots.txt that disallows `/admin/`.

**/admin** (https://openinkhub.io/admin/) shows the report by section — Pages, Blog posts, SEO city guides, Categories/tags/archives — with SEO and readability scores, the full checklist per page, a Google result preview, the fixes applied and a CSV download. It is protected by **Cloudflare Access**: only `info@openinkhub.io` can sign in (one-time code sent by email).

Core Web Vitals (LCP, INP, CLS, TTFB, FCP) are measured only when a PageSpeed Insights key is provided: `PSI_API_KEY=... npm run audit` (add it as a Cloudflare Pages environment variable to measure on every deploy).

## Website development guides (17 pages)

Defined in `content/articles/website-development.json` and linked from the grid on `/website-design-agency/`.
Each guide has its final URL, title, meta description, keyphrase and a suggested outline. Drafts are built but
`noindex, nofollow`, left out of sitemaps, llms.txt and the SEO audit, and shown as "Coming soon" (not linked).

To publish a guide: add its content as `body_html` (and optional `faqs`), set `"status": "published"`, then

```bash
npm run articles && npm test
```

The page becomes indexable, joins the sitemap and llms.txt, is audited, and its hub card links to it.

## Content removals and plain-language edits

`content/seo/removals.json` removes or replaces sections of imported WordPress pages (e.g. placeholder case studies,
a duplicated article) and `content/seo/plain-language.json` holds readability rewrites. Both are applied at build time;
the original imported pages in `content/pages` are not modified.

## Editing content

* Page/post text: edit `content_html` in `content/pages/<slug>.json`. Head tags live under `head`.
* New page: add a JSON file with `path`, `url`, `type` (`page`/`post`), `title`, `head`, `content_html`.
* Re-sync from WordPress while it's still live: `pip install beautifulsoup4 && python tools/extract.py --assets`
  (this overwrites `content/pages/*.json` — don't run it after you've started editing there).

## Not carried over (WordPress-only features)

* `/feed/` RSS, `/wp-json/`, `/wp-admin/`, `?p=ID` short links, paginated archives (`/page/2/`).
* The contact page form: a static host can't process form posts — contact runs through phone, WhatsApp,
  email and the Calendly demo link. Plug in a form service (e.g. Formspree) if a form is needed.
