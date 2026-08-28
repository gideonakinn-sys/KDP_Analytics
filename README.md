# KDP Book Analytics — MVP

A single-file Streamlit app that estimates Amazon KDP book performance (sales, revenue, competition) from a public book URL or ASIN.

## Quick start

```bash
pip install -r requirements.txt
streamlit run kdp_analytics_app.py
```

## Features

- Parse Amazon product URLs or bare ASINs
- Best-effort live scrape with graceful fallback to deterministic demo data
- BSR-based sales estimation via log-log power-law interpolation
- KDP royalty estimates (Kindle 70%/35% tiers; print books use KDP's published fixed + per-page cost structure, page-count aware)
- Daily & monthly royalty estimates, plus gross revenue (list price × sales) for clarity
- Competition score gauge and sales estimate curve charts
- Keyword & related-search ranking (inferred from title/subtitle/category, plus live Amazon autocomplete suggestions)

## Scraping note

Amazon actively blocks automated scraping and its markup changes frequently. Live scraping is best-effort only — the app never attempts to bypass CAPTCHAs or bot detection. If a request is blocked, use demo mode or enter price/format manually in the sidebar.

When a live scrape finds BSR but misses the list price, the app applies a format-default price (Kindle $9.99, Paperback $12.99, Hardcover $24.99) so monthly revenue is still estimated. Enter a list price in the sidebar for accurate royalty calculations.

## Revenue vs royalty

- **Royalty (your earnings)** = royalty per unit × units sold. This is what the "Daily/Monthly Royalty" metrics show.
- **Gross revenue** = list price × units sold (what Amazon collects). Shown in the Book Details table.
- Print royalty is page-count aware: KDP's actual printing cost is `fixed cost + per-page cost` (e.g. paperback ≈ $1.00 + $0.012/page for 110–828 pages). Enter a page count in the sidebar if the scrape misses it.

## Keywords & ranking

The app infers a book's ranking keywords from its title, subtitle and category breadcrumb (Amazon's strongest on-page indexing signals) and scores each term by source and relevance. It also pulls related searches from Amazon's public autocomplete endpoint — those reflect what shoppers type, not the book's backend KDP keywords (which Amazon doesn't expose publicly).

## Disclaimer

All sales and revenue figures are algorithmic estimates for informational/prototyping purposes. They are not sourced from Amazon's internal data and will not exactly match real payouts.
