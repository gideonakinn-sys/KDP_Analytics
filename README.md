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
Price and royalty figures display in the page's currency (`$ £ € ¥ C$ A$`). **Kindle royalty tiers now use the marketplace's local band** (e.g. $/£/€ 2.99–9.99) plus a local per-MB delivery fee, so a £9.99 book gets its correct 70% rate. Print royalty routes through the USD-anchored engine with fixed approximate FX (labeled as such in the panel's "How is this estimated?" note).

### Formatter tab
The panel's **Formatter** tab typesets your manuscript to each platform (all client-side, offline):

- **Kindle / Apple Books** → reflowable **EPUB**: 0.2″ first-line indent, single spacing, **justified** text with CSS hyphens, a visible **Contents** page + hyperlinked NCX TOC + EPUB3 `nav`, title/copyright pages, EPUBCheck-clean structure, `ibooks`/`dcterms` metadata.
- **KDP Paperback / Hardcover** → print **PDF** (pdfmake + embedded serif font): chosen trim (6×9 default), 0.75″ outer/top/bottom margins, **two-pass gutter** (actual page count), **running heads** (title/author alternating), page numbers, chapter breaks, **real page-numbered TOC**, min/max page warnings (PB 24–825, HC 75–550).
- **Any target** → a real **.docx** (Word Heading styles + searchable navigation), not an HTML stub.
- **Input**: paste text or Markdown (paste-only — no file upload). Chapters auto-detect from `Chapter N`, `Part`, `Prologue`, `Introduction`, etc. and Markdown `#`/`##` headings.
- **AI mode**: the "Copy AI prompt" button copies a typesetter prompt + your manuscript; run it in any AI, then paste the returned semantic HTML into **AI-formatted HTML** mode. Pasting HTML-like text auto-switches the mode for you. Your inputs auto-save as a draft across restarts.
- **In-text markup**: `*italic*`, `_italic_`, `**bold**`, `__bold__`; **scene breaks** = a line of `* * *` / `***` / `#` / `- - -`, or three blank lines (rendered as a centered dinkus with no indent on the next paragraph).
- **Chapter headings**: `Chapter 1: Title`, `Part I — Title`, `Prologue: …` render the number/label prominently (h1, centered) with the title beneath it (h2, centered, tight number→title spacing); bare titles (no chapter tag) render as a single h1. **In-chapter subheaders** (`## Heading`, `### Heading`, or AI-HTML `<h3>/<h4>`) render as left-aligned, bold h3 and appear **nested** in the EPUB TOC (multi-level nav/NCX), as Heading3 in DOCX, and as a `chapterSubheader` in PDF — they never start a new page. EPUB body text uses a 1.2em indent, no paragraph spacing, `line-height: 1.4`, and dark-theme-safe colors.
- **Options**: subtitle, auto copyright, trim size + line spacing (print only), a **Justify body text** toggle for EPUB, and **metadata** (ISBN, Publisher, Edition/year) that flows into the EPUB OPF and the copyright page.
- **Cover image** (optional, image-only): embedded as the EPUB cover (`cover.xhtml` + `cover-image` OPF item) and as a full-bleed front cover page in the print PDF. DOCX stays text-only.
- **Input** starts from a clear choice: **✍️ Paste my manuscript** (raw/Markdown) or **🤖 Let AI structure it** (a 3-step guide: paste → copy prompt → paste the AI's HTML). A dismissible first-run tip and a **Try an example** button get new users going instantly.
- Print PDF is justified but not hyphenated (pdfmake limitation) — finish from the `.docx` for print-final hyphenation.
- After Format, a **Structure** panel lists detected chapters → subheaders → paragraph/scene-break/quote counts, so you can verify what was parsed (the summary is dismissible with ✕; it reappears on each Format).
- The formatter's heavy libraries (JSZip/pdfmake/fonts, ~3.2 MB) are **lazy-loaded** on the first Formatter-tab open, so Analytics-only use stays light.

Formatting & extraction tests: `node extension/formatter.test.js` · `node extension/extract.test.js`

### AI-assisted formatting (bring-your-own-AI)
For the most professional structure, let an LLM prepare the manuscript:

1. Paste your manuscript into the **Raw text / Markdown** input.
2. Click **Copy AI prompt** — it copies a typesetter prompt + your manuscript.
3. Run it in any AI (Claude/ChatGPT/Gemini) — it returns **one semantic HTML document** (`<h1 class="book-title">`, `<section class="chapter">`, `<div class="scene">`, `<blockquote>`, `<em>/<strong>`, `.dedication/.epigraph`, `.frontmatter/.backmatter` …).
4. Switch input type to **AI-formatted HTML**, paste the result, **Format**, export.

The extension parses only that controlled schema (never executes anything the AI emits) and maps it to the same EPUB/DOCX/PDF pipeline — including the new paragraph kinds (blockquote → indented quote; dedication/epigraph → centered italic).

Formatting tests: `node extension/formatter.test.js`

### Parity guarantee
The JS engine (`extension/engine.js`) is a 1:1 port of the Python engine, verified by `extension/engine.test.js` against `extension/expected.json` (generated from the app by `extension/make_expected.py`). All numeric metrics match to `1e-9`; only the rounded keyword-relevance percentage can differ by ±1% at exact `.5` ties. Rebuild fixtures with:

```bash
python extension/make_expected.py
node extension/engine.test.js
```

Distribution note: the extension is published on the Chrome Web Store as **Bookmata** (see the release section below). It reads the Amazon page you're already viewing and computes locally — it never attempts to bypass CAPTCHAs, scrape accounts, or access paid data. Keep store description wording free of "bypass/unlock/rank boost/scrape" to stay clear of policy review friction.

## Revenue vs royalty

- **Royalty (your earnings)** = royalty per unit × units sold. This is what the "Daily/Monthly Royalty" metrics show.
- **Gross revenue** = list price × units sold (what Amazon collects). Shown in the Book Details table.
- Print royalty is page-count aware and page count is **required**: KDP's actual printing cost is `fixed cost + per-page cost` (e.g. paperback ≈ $1.00 + $0.012/page for 110–828 pages). If the scrape misses the count, royalty shows "—" until you enter one in the sidebar — the app never silently assumes a page count.

## Keywords & ranking

The app infers a book's ranking keywords from its title, subtitle and category breadcrumb (Amazon's strongest on-page indexing signals) and scores each term by source and relevance. It also pulls related searches from Amazon's public autocomplete endpoint — those reflect what shoppers type, not the book's backend KDP keywords (which Amazon doesn't expose publicly).

## Disclaimer

All sales and revenue figures are algorithmic estimates for informational/prototyping purposes. They are not sourced from Amazon's internal data and will not exactly match real payouts.

## Chrome Web Store release

The extension is published as **Bookmata**. Everything needed to ship is in the repo:

- `PRIVACY.md` — required privacy policy (host it via this repo's GitHub Pages and paste the URL into the store).
- `docs/publish.md` — the complete listing copy (title, summary, description, permissions justification, data-safety answers) and the Unlisted-first submission runbook.
- `screenshots/` — offline mockups of the Analytics & Formatter views for store screenshots (see `HOW-TO.md`).
- Build & verify the store package:

```bash
python extension/make_dist.py    # -> dist/bookmata-1.0.0.zip (runtime files only)
node extension/check_store.js    # -> STORE CHECK OK (32 checks)
```

Distribution note: the store package is a clean whitelist (no tests/fixtures/dev scripts). Bump `manifest.json` `version` and rebuild for each release. Local "Load unpacked" still works from `extension/` for testing.
