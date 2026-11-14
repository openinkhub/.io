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

Reading the report: **"fixes applied"** are problems the build already corrected; **warnings** are what is left. Other build-time fixes:

- meta descriptions over 160 characters are cut at the last full sentence (`metaDescriptionLength`); titles under 30 characters get the site name (`titleSiteName`)
- pages and guides with no image in their content get a branded title card (`tools/covers.mjs`, written to `static/images/pages/`)
- service pages with fewer than 3 internal links get a "Related services" list, picked from `related_services` in `rules.json`
- legal pages listed under `legal` in `rules.json` report marketing checks (keyphrase, images, FAQs…) as n/a
- `node tools/readability-runs.mjs /path-prefix/` shows which sentences trigger the "consecutive sentences" check

The build also writes `_redirects` (Squirrly redirects), `_headers` (security headers, noindex for /admin), `llms.txt` and a robots.txt that disallows `/admin/`.

**/admin** (https://openinkhub.io/admin/) shows the report by section — Pages, Blog posts, SEO city guides, Categories/tags/archives — with SEO and readability scores, the full checklist per page, a Google result preview, the fixes applied and a CSV download. It is protected by **Cloudflare Access**: only `info@openinkhub.io` can sign in (one-time code sent by email).

Core Web Vitals (LCP, INP, CLS, TTFB, FCP) are measured only when a PageSpeed Insights key is provided: `PSI_API_KEY=... npm run audit` (add it as a Cloudflare Pages environment variable to measure on every deploy).

## Website development guides (17 published pages)

Hub pages for content-plan clusters C02–C18 ("openink website dev page.xlsx"), linked from the grid on `/website-design-agency/`.

- Definitions (URL, title, description, keyphrase, related terms, FAQs, status): `content/articles/website-development.json`
- Page text: `content/articles/website-development/<slug>.html`
- The 120 article briefs and 61 PAA questions from the plan: `content/articles/website-development-briefs.json`
  (in the source sheet, the "AEO Direct Answer" column for C17 and C18 is shifted one row; flagged as `answer_needs_review`)

Edit a page's HTML or FAQs, then `npm run articles && npm test`. Set `"status": "draft"` to unpublish (noindex, unlinked).

### Content-plan articles (the 120 briefs)

`tools/brief-posts.mjs` (`npm run brief-posts`) publishes briefs as blog posts in the Blogs category:

- a brief is published when it has `"status": "published"`, `slug`, `description`, `faqs` ([question, answer] pairs) and a body at
  `content/articles/website-development-posts/<slug>.html`; optional `seo_title` (when the sheet title is over 60 chars) and
  `keyphrase` (natural form of the sheet keyword)
- each post gets a generated 1200×630 cover at `static/images/articles/<slug>.svg`, BlogPosting + breadcrumb schema and FAQ schema
- the hub page named in the brief lists its articles under "Articles on this topic"; related posts prefer the same hub/cluster
- the audit reports them as their own section, "Website development articles"

## Page standards applied to every page (build time)

| Rule (rules.json -> autofix) | What it does | Where |
|---|---|---|
| `simpleWords` | "optimization", "generative", "artificial intelligence" become plain words or SEO/AEO/GEO/AIO/AI, except inside each page's keyphrases | `tools/content-rules.mjs` |
| `longParagraphs` | splits paragraphs over 120 words; link-only "paragraphs" become a chip list | `tools/content-rules.mjs` |
| `titleYear` | adds "(2026)" to every title within 60 characters; hand-written exceptions in `titleYear.overrides` | `rules.json` |
| `topicKits` | adds what a page lacks: "How to choose" numbered guide, evaluation table, named tools, key numbers with sources | `content/seo/kits.json` |
| `cardLayout` | every H2 section is a card like the home page; "Label: text" lists become card grids | `tools/layout.mjs` |
| `plainFaq` | FAQs shown open (no click-to-expand), with FAQPage schema | `tools/layout.mjs` |
| `linkText` | bare-URL, "click here" and image-only links get the target page's name; "… →" links become buttons | `tools/layout.mjs` |
| `copyEdits`, `summaries`, `faqAdditions` | wording edits, "In summary" sections and extra FAQs for imported pages | `content/seo/copy-edits.json`, `summaries.json`, `faqs.json` |
| `shortSentences` | splits sentences over 16 words at natural clause breaks (`;`, dash, `, but`, `, so`, `, while`, `, which…`, `, and <subject>`) | `tools/content-rules.mjs` |
| `realHeadings` | WordPress pseudo-headings (bold-only or short Title Case lines) become real H3s; H4–H6 section headings become H3 | `tools/content-rules.mjs` |


Link check: `npm run check-links` (part of `npm test`) verifies every internal link, CTA, in-page anchor, redirect target, phone/email link, link text and image alt text on the built site; `npm run check-links -- --external` also requests every external URL.

Readability is scored on prose (sentences of 6+ words); menu labels, table cells and button text are left out. Pages that keep their original live URL report the slug check as "kept".


Helpers (run after `npm run build`, then build again): `node tools/suggest-transitions.mjs` adds connector words on pages under 20%; `node tools/fix-repeats.mjs` breaks repeated sentence starts; `node tools/transition-gaps.mjs /path/` and `node tools/readability-runs.mjs /path/` show the details.

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
