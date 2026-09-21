# Schema Markup & E-E-A-T Auditor

A free tool that audits any article URL's Schema.org structured data (Article/NewsArticle/BlogPosting) and E-E-A-T signals — built to demonstrate the technical SEO / AI-search discoverability skill set (llms.txt, schemas, EEAT, GEO).

Live at: `https://amantalwar.com/schema-markup`

## How it works

- **`index.html` / `assets/`** — static frontend. Paste a URL, it calls the PHP proxy, parses the returned HTML client-side with `DOMParser`, extracts `<script type="application/ld+json">` blocks, and checks them against a rule set built directly from [Google's Article structured data docs](https://developers.google.com/search/docs/appearance/structured-data/article).
- **`api/fetch.php`** — a small server-side proxy that fetches the target URL (avoids browser CORS restrictions) with SSRF protections: blocks private/reserved IP ranges, restricts to http/https, caps redirects and response size, and only accepts `Access-Control-Allow-Origin` from your own domain.
- If a URL can't be fetched (bot-blocked, login wall, etc.), there's a "paste HTML source" fallback that skips the proxy entirely.

Everything important about the checks (required vs. recommended) is sourced from Google's own documentation — the tool explicitly notes that Google states **no Article property is strictly required**, only recommended.

## Self-hosting

Requires a web server with PHP 7.4+ (cURL extension enabled) — `api/fetch.php` does the server-side fetch so the browser doesn't hit CORS restrictions. No build step; just serve the files as-is.

- Update the `$allowedOrigins` array near the top of `api/fetch.php` to whitelist your own domain(s).
- If a target URL can't be fetched (bot-blocked, login wall, etc.), the "paste HTML source" fallback in the UI works client-side only, with no dependency on the PHP proxy.

## Notes / future improvements

- No Core Web Vitals check in v1 (would require a Google PageSpeed Insights API key).
- No rate limiting on `fetch.php` — fine for a low-traffic portfolio tool, but add one (e.g. simple IP-based throttling) if it gets meaningful traffic, since it's a public URL fetcher.
- Only Article-family schema is audited. Could extend to Product, LocalBusiness, FAQPage, etc. following the same pattern in `assets/script.js`.

## License

MIT — see [LICENSE](LICENSE).
