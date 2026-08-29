# Privacy Policy — Bookmata

**Effective date:** 29 August 2026

Bookmata ("the extension") is a Chrome sidebar extension that (1) estimates
Amazon KDP book sales, royalty and competition from a book page you're already
viewing, and (2) typesets a manuscript you paste into EPUB, DOCX, or print PDF.

This policy explains what the extension does with data. **Short version: it
collects no personal data, stores everything on your device, and never sends
your manuscript anywhere on your behalf.**

## What Bookmata reads

- **Your open Amazon page:** While you are on an Amazon product page
  (`amazon.com`, `.co.uk`, `.ca`, `.com.au`, `.de`, `.co.jp`), a content script
  reads the fields of *that page you have already loaded* — title, price,
  rating, review count, Best Sellers Rank, print length, category — to compute
  estimates **locally in your browser**. It does not browse on your behalf, does
  not submit search queries, does not access your account, and does not read
  other tabs or pages.
- **Content you paste:** The Formatter only processes text/HTML you paste or
  type into the extension. It does not pull manuscripts from anywhere.

## What is stored, and where

- Analytics overrides (price / format / page count) and your formatter working
  draft are saved **only** in `chrome.storage.local` on your device so your work
  survives a browser restart. Nothing is uploaded to a server by the extension.
- Uninstalling the extension (or clearing Chrome Extension data) removes
  everything.

## Outbound requests

The **only** network request Bookmata makes is to Amazon's own public search
autocomplete endpoint (`completion.amazon.com`) to show "related searches" for
the book you're viewing. It sends a short prefix of that book's title to
Amazon. No other requests are made.

## AI formatting

The Formatter offers a "Copy AI prompt" button. That workflow copies a prompt
**to your clipboard**. If you then run that prompt (which may include your
manuscript) in an AI service, you are doing so **on your own account with the
provider of your choosing**. Bookmata itself does not call any AI service and
never transmits your manuscript.

## Third parties, trackers, remote code

- No analytics, no advertising, no trackers, no third-party SDKs.
- All code is packaged with the extension; nothing is loaded from remote
  servers at runtime (connection is default CSP, no remote scripts).
- The bundled libraries (JSZip, pdfmake, font assets) run entirely offline.

## Permissions explained

| Permission | Why |
|---|---|
| `sidePanel` | The extension's primary UI is Chrome's native side panel. |
| `activeTab` | Lets Bookmata know which page you're on so the toolbar icon only activates on Amazon book pages. |
| `storage` | Persists your local overrides and formatter draft on your device. |
| `completion.amazon.com` host access | Fetches "related searches" suggestions for the book you're viewing. |

## Contact

Questions or concerns: open an issue on the project's GitHub repository
(`gideonakinn-sys/KDP_Analytics`).

We may update this policy; changes will be reflected on this page with a new
effective date.
