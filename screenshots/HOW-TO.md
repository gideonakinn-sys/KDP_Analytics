# Capturing Chrome Web Store screenshots

The store wants **1280×800** (or 640×400) screenshots; add at least 1, ideally 3.

## Option A — offline mockups (fast, reproducible)
The `screenshots/` folder has two standalone pages that render Bookmata's UI with the real panel CSS:

- `screenshots/analytics.html`
- `screenshots/formatter.html`

1. Open one in Chrome (double-click the file → `file://`).
2. Press **F12** → **Ctrl+Shift+M** (device toolbar) or resize to **1280×800**.
3. Screenshot the whole page:
   - Windows: **Win+Shift+S** (region), or DevTools → **⋮ → Capture full size screenshot**.
4. Crop to 1280×800 if needed.

## Option B — the real extension (most accurate)
1. `chrome://extensions` → **Developer mode** → **Load unpacked** → select `extension/`.
2. Resize your window so the step is ≥1280 wide, open a real Amazon book, click the Bookmata toolbar icon.
3. Screenshot the book page **plus** the side panel together (that's the authentic look).
4. Also open the **Formatter** tab with a sample manuscript and capture.

## Store requirements
- Recommended 1280×800; 640×400 also accepted.
- Save as **PNG or JPG**, < 2 MB each.
- Don't include personal/account info in the captures.