# KDP Book Analytics — MVP

A single-file Streamlit app that estimates Amazon KDP book performance (sales, revenue, competition) from a public book URL or ASIN.

## Quick start

```bash
pip install -r requirements.txt
streamlit run kdp_analytics_app.py
```

## Features

- Parse Amazon product URLs or bare ASINs
- Best-effort live scrape with retries and clear failure reporting
- BSR-based sales estimation via log-log power-law interpolation
- KDP royalty estimates (Kindle 70%/35% tiers; print books use KDP's published fixed + per-page cost structure, page-count aware)
- Daily & monthly royalty estimates, plus gross revenue (list price × sales) for clarity
- Competition score gauge and sales estimate curve charts
- Keyword & related-search ranking (inferred from title/subtitle/category, plus live Amazon autocomplete suggestions)

## Scraping note

Amazon actively blocks automated scraping and its markup changes frequently. Live scraping is best-effort only — the app never attempts to bypass CAPTCHAs or bot detection.

The app **never fabricates data.** If a request is blocked (CAPTCHA / bot detection), times out, or the page layout can't be parsed, it reports the reason and shows no estimates. If a book scrapes fine but the list price can't be read, royalty and revenue figures show "—" until you enter a price in the sidebar. Hosting on shared IPs (e.g. Streamlit Community Cloud) is blocked far more often than scraping from your own machine.

## Chrome extension (no-scrape alternative)

`extension/` is a standalone MV3 Chrome extension that **bypasses Amazon blocking entirely**: instead of fetching Amazon over the network, a content script reads the already-loaded product page DOM in your browser (your real session/IP). A **native Chrome side panel** (resized/docked by Chrome, Amazon stays visible on the left) computes and displays everything in JavaScript. No server required.

### Load it
1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked**.
2. Select the `extension/` folder.
3. On an Amazon book page (`amazon.com/dp/…`), click the extension's toolbar icon to open the side panel. The icon only activates on Amazon pages; the panel auto-refreshes as you switch books/tabs.

Requires Chrome 114+ (for the Side Panel API).

### What it shows
Daily/monthly sales + royalty, BSR, gross revenue, competition score/bar, keywords + tags, and related searches (Amazon autocomplete, best-effort). List price, Format and Page count inputs at the top recalculate live and persist. Missing price → "—" (same no-fabricated-numbers rule as the app). Follows your OS light/dark theme.

### Print royalty needs a page count
Paperback/hardcover royalty = 60% of list − KDP's fixed + **per-page** print cost, so a page count is **required** for print books. If the count can't be read from the page, royalty shows **"—"** until you enter one (the auto-focus jumps to the Page count field). Kindle royalty ignores page count.

### Currencies
Price and royalty figures display in the page's currency (`$ £ € ¥ C$ A$`). Non-USD prices are converted to USD with **fixed approximate exchange rates** for the royalty math (labeled as such in the panel's "How is this estimated?" note); they are not silent dollar mis-labels.

### Parity guarantee
The JS engine (`extension/engine.js`) is a 1:1 port of the Python engine, verified by `extension/engine.test.js` against `extension/expected.json` (generated from the app by `extension/make_expected.py`). All numeric metrics match to `1e-9`; only the rounded keyword-relevance percentage can differ by ±1% at exact `.5` ties. Rebuild fixtures with:

```bash
python extension/make_expected.py
node extension/engine.test.js
```

Note: local "Load unpacked" use only. Public Chrome Web Store distribution risks Amazon ToS action.

## Revenue vs royalty

- **Royalty (your earnings)** = royalty per unit × units sold. This is what the "Daily/Monthly Royalty" metrics show.
- **Gross revenue** = list price × units sold (what Amazon collects). Shown in the Book Details table.
- Print royalty is page-count aware and page count is **required**: KDP's actual printing cost is `fixed cost + per-page cost` (e.g. paperback ≈ $1.00 + $0.012/page for 110–828 pages). If the scrape misses the count, royalty shows "—" until you enter one in the sidebar — the app never silently assumes a page count.

## Keywords & ranking

The app infers a book's ranking keywords from its title, subtitle and category breadcrumb (Amazon's strongest on-page indexing signals) and scores each term by source and relevance. It also pulls related searches from Amazon's public autocomplete endpoint — those reflect what shoppers type, not the book's backend KDP keywords (which Amazon doesn't expose publicly).

## Disclaimer

All sales and revenue figures are algorithmic estimates for informational/prototyping purposes. They are not sourced from Amazon's internal data and will not exactly match real payouts.
