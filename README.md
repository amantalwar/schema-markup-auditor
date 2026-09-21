# Schema Markup & E-E-A-T Auditor

A free tool that audits any article URL's Schema.org structured data (Article/NewsArticle/BlogPosting) and E-E-A-T signals — built to demonstrate the technical SEO / AI-search discoverability skill set (llms.txt, schemas, EEAT, GEO).

Live at: `https://amantalwar.com/schema-markup`

## How it works

- **`index.html` / `assets/`** — static frontend. Paste a URL, it calls the PHP proxy, parses the returned HTML client-side with `DOMParser`, extracts `<script type="application/ld+json">` blocks, and checks them against a rule set built directly from [Google's Article structured data docs](https://developers.google.com/search/docs/appearance/structured-data/article).
- **`api/fetch.php`** — a small server-side proxy that fetches the target URL (avoids browser CORS restrictions) with SSRF protections: blocks private/reserved IP ranges, restricts to http/https, caps redirects and response size, and only accepts `Access-Control-Allow-Origin` from your own domain.
- If a URL can't be fetched (bot-blocked, login wall, etc.), there's a "paste HTML source" fallback that skips the proxy entirely.

Everything important about the checks (required vs. recommended) is sourced from Google's own documentation — the tool explicitly notes that Google states **no Article property is strictly required**, only recommended.

## Deploying to Namecheap (cPanel) at amantalwar.com/schema-markup

1. Log into cPanel → **File Manager**.
2. Navigate to `public_html`.
3. Create a new folder named `schema-markup`.
4. Upload the contents of this repo into that folder, so the structure on the server is:
   ```
   public_html/schema-markup/index.html
   public_html/schema-markup/assets/style.css
   public_html/schema-markup/assets/script.js
   public_html/schema-markup/api/fetch.php
   ```
   (Drag-and-drop upload works in File Manager, or use an FTP client with the credentials from cPanel → FTP Accounts.)
5. Confirm PHP is enabled for the domain: cPanel → **Select PHP Version** (any PHP 7.4+ is fine — the script uses only core PHP + cURL).
6. Visit `https://amantalwar.com/schema-markup` — it should load immediately, no build step needed.

### CORS allow-list

`api/fetch.php` only allows requests from `https://amantalwar.com` and `https://www.amantalwar.com` (see the `$allowedOrigins` array near the top). If you ever move the tool to another domain or subdomain, update that list.

## Linking it from your homepage

Add a link/button on amantalwar.com pointing to `/schema-markup`, e.g.:

```html
<a href="/schema-markup">Free Tool: Schema Markup & E-E-A-T Auditor</a>
```

## Publishing to GitHub (portfolio piece)

```bash
git init
git add .
git commit -m "Initial commit: Schema Markup & E-E-A-T Auditor"
```

Then create an empty repo on GitHub (e.g. `schema-markup-auditor`) and:

```bash
git remote add origin https://github.com/<your-username>/schema-markup-auditor.git
git branch -M main
git push -u origin main
```

Keep this repo in sync manually — pushing to GitHub does **not** auto-deploy to Namecheap. Re-upload changed files via File Manager/FTP after each update (or set up an FTP-deploy GitHub Action later if you want that automated).

## Notes / future improvements

- No Core Web Vitals check in v1 (would require a Google PageSpeed Insights API key).
- No rate limiting on `fetch.php` — fine for a low-traffic portfolio tool, but add one (e.g. simple IP-based throttling) if it gets meaningful traffic, since it's a public URL fetcher.
- Only Article-family schema is audited. Could extend to Product, LocalBusiness, FAQPage, etc. following the same pattern in `assets/script.js`.

## License

MIT — see [LICENSE](LICENSE).
