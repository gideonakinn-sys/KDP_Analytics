# Publishing Bookmata to the Chrome Web Store

Everything you'll paste into the store dashboard, plus the exact submission steps.

## 1. Create the developer account (one-time)

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account you want as publisher.
2. Enable **2-Step Verification** (required).
3. Pay the **one-time $5 developer registration fee**.
4. You'll be asked for **publisher identity** — individual is fine.

## 2. Build the loadable package

```bash
python extension/make_dist.py     # -> dist/bookmata/ + dist/bookmata-1.0.0.zip
node extension/check_store.js     # -> STORE CHECK OK (32 checks)
```

Upload **`dist/bookmata-1.0.0.zip`** (manifest.json sits at the zip root).
Bump `extension/manifest.json` `version` and rebuild each release.

## 3. Listing text

**Title**
```
Bookmata
```

**Summary** (≤132 chars)
```
Estimate Amazon KDP sales, royalty and competition from the open book page, and typeset manuscripts to EPUB, DOCX and print PDF.
```

**Description**
```
Bookmata is a two-in-one publishing workspace in Chrome's side panel.

📊 ANALYTICS
On any Amazon book page, click the Bookmata icon and the dock opens — Amazon stays on the left, your numbers on the right. It estimates daily/monthly sales, daily/monthly royalty, gross revenue, niche competition and keyword relevance from the page you're already looking at, and recalculates instantly when you change the price, format or page count. Currency-aware ($ £ € ¥ C$ A$), print royalty is page-count accurate, and the app never fabricates missing values.

✍️ FORMATTER
Typeset your manuscript to a publishing platform without leaving the browser:
- Kindle & Apple Books → reflowable EPUB (EPUBCheck-clean structure, NCX + nav TOC, visible Contents page, justified text, scene breaks, *italics*/**bold**)
- KDP Paperback & Hardcover → print PDF (chosen trim, KDP gutter by page count, running heads, page numbers, real page-numbered TOC)
- Word → a real .docx with genuine Heading styles
- Optional AI-assisted structure: copy a ready-made typesetter prompt, run it in any AI, paste the returned semantic HTML, and let Bookmata produce the final files
Includes auto-detection of AI-HTML pastes, live word count, and automatic draft saving.

Privacy-first: everything computes locally. No account, no telemetry; the only outbound call is Amazon's own autocomplete endpoint for "related searches". Your manuscript is never sent anywhere by the extension.
```

**Category:** Productivity

**Single purpose statement**
```
Analyze Amazon KDP book performance from the page you're viewing and typeset manuscripts to EPUB / DOCX / print PDF.
```

**Permissions justification** (paste into the listing's permission section)
- `sidePanel` — the extension's UI is Chrome's native side panel.
- `activeTab` — detects which page you're on so the icon activates only on Amazon book pages.
- `storage` — saves your price/format overrides and formatter draft locally.
- Host access to `completion.amazon.com` — shows "related searches" for the book you're viewing (Amazon's own autocomplete endpoint).

## 4. Privacy & data safety

- **Privacy policy URL:** host `PRIVACY.md` via this repo's GitHub Pages:
  1. Repo Settings → **Pages** → Source: **Deploy from a branch**, branch `master`, folder `/ (root)`.
  2. After it publishes, set the URL to:
     `https://gideonakinn-sys.github.io/KDP_Analytics/PRIVACY.md`
  3. Paste that URL into the store's **Privacy policy** field.

- **Data safety form:**
  - **Does your product collect or transmit user data?** No personal/account data. Local-only storage. (Note: it makes one call to Amazon's autocomplete for related searches — describe under "network."
  - **Data handling:** All "storage" contexts → **local device only**.
  - **Listing:** "This product does not collect, transmit, or sell user data."

## 5. Screenshots

- Recommended: 1280×800 PNG/JPG. See `screenshots/HOW-TO.md`.
- Capture at least the **Analytics** dock on a book page and the **Formatter** tab (use `screenshots/analytics.html` / `formatter.html` if you can't run a real page).

## 6. Icons & extras

- `extension/icons/icon128.png` serves as the store icon (128×128).
- Optional listed in "More": website = `https://github.com/gideonakinn-sys/KDP_Analytics`.

## 7. Submit — Unlisted first

1. Upload the zip, fill the listing, mark **Unlisted**.
2. Submit for review (automated + sometimes manual; can take days–weeks).
3. Once approved, test the installed copy, then flip to **Public**.

Notes
- Google's automated review can flag eco/system extensions over wording; keep the description free of "bypass", "unlock", "rank boost", or "scrape".
- Each new version must be re-submitted; keep `make_dist.py` + `check_store.js` as your release gate.
- The side panel only enables on Amazon domains by design — reviewers should see that stated in the description.