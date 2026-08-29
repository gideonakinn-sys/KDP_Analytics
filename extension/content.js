// KDP Book Analytics — content script.
// Reads the already-loaded Amazon product page DOM (so nothing is fetched
// over the network and Amazon has nothing to block) and serves the data to
// the side panel on request. No UI is injected into the page.
//
// Responds to {type: "get-book-data"} with:
//   { data: <BookData|null>, reason: "ok"|"no-product"|"unparseable", url }
(() => {
  "use strict";

  const PRICE_SELECTORS = [
    ".a-price .a-offscreen",
    "#corePrice_feature_div .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "span[data-a-color='price'] .a-offscreen",
    "#kindle-price",
    "#ebook-price",
    "#price",
  ];

  function parsePriceText(t) {
    let m = String(t || "").match(/[\d,]+\.\d{2}/);
    if (m) return parseFloat(m[0].replace(/,/g, ""));
    m = String(t || "").match(/\$?\s*([\d,]+)(?:\s|$|[^\d.])/);
    if (m) return parseFloat(m[1].replace(/,/g, ""));
    return null;
  }

  function parseIntText(t) {
    const m = String(t || "").match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
  }

  function detectCurrency(symbolText) {
    const t = symbolText || "";
    if (/C\$|CA\$|CAD/i.test(t)) return { code: "CAD", symbol: "C$" };
    if (/A\$|AU\$|AUD/i.test(t)) return { code: "AUD", symbol: "A$" };
    if (/£/.test(t)) return { code: "GBP", symbol: "£" };
    if (/€/.test(t)) return { code: "EUR", symbol: "€" };
    if (/¥/.test(t)) return { code: "JPY", symbol: "¥" };
    if (/\$/.test(t)) return { code: "USD", symbol: "$" };
    return { code: "USD", symbol: "$" };
  }

  function extractAsin() {
    const m = (location.href || "").match(
      /(?:\/dp\/|\/gp\/product\/|\/product\/|\/gp\/aw\/d\/|\?asin=)([A-Z0-9]{10})/i
    );
    if (m) return m[1].toUpperCase();
    const el = document.querySelector("input[name='ASIN'], input[name='asin']");
    const v = el && el.value;
    if (v && /^[A-Z0-9]{10}$/i.test(v)) return v.toUpperCase();
    return "";
  }

  function extractPageData() {
    const txt = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "");

    const title = txt(document.querySelector("#productTitle"));
    if (!title) return { data: null, reason: "no-product" };

    let price = null;
    let currency = { code: "USD", symbol: "$" };
    for (const sel of PRICE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        const raw = txt(el);
        price = parsePriceText(raw);
        if (price) {
          currency = detectCurrency(raw);
          break;
        }
      }
    }

    let rating = null;
    const ratingEl = document.querySelector("span.a-icon-alt");
    if (ratingEl) {
      const m = txt(ratingEl).match(/([\d.]+) out of 5/);
      if (m) rating = parseFloat(m[1]);
    }
    let reviewCount = null;
    const reviewsEl = document.querySelector("#acrCustomerReviewText");
    if (reviewsEl) reviewCount = parseIntText(txt(reviewsEl));

    let bsr = null;
    let bsrCategory = null;
    const detailEl =
      document.querySelector("#detailBullets_feature_div") ||
      document.querySelector("#productDetails_detailBullets_sections1");
    const detailsText = detailEl ? (detailEl.textContent || "").replace(/\s+/g, " ") : "";
    if (detailsText) {
      const m = detailsText.match(/#([\d,]+)\s+in\s+([A-Za-z0-9 &.']+)/);
      if (m) {
        bsr = parseIntText(m[1]);
        bsrCategory = (m[2] || "").trim();
      }
    }

    // Print length: scan every plausible details container, accept
    // "Print length: N pages" / "Print length N pages" / "Print length N".
    let pageCount = null;
    const PAGE_CONTAINERS = [
      "#detailBullets_feature_div",
      "#productDetails_detailBullets_sections1",
      "#productDetails_techSpec_section_1",
      "#productDetailsTable",
      "#productDetails_expanderTables",
    ];
    for (const sel of PAGE_CONTAINERS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const m = (el.textContent || "")
        .replace(/\s+/g, " ")
        .match(/print\s*length\s*:?\s*([\d,]+)\s*(?:pages?)(?:\s|$)/i);
      if (m) {
        pageCount = parseIntText(m[1]);
        if (pageCount !== null) break;
      }
    }

    if (bsr === null) return { data: null, reason: "unparseable" };

    const crumbs = [];
    const crumbEl = document.querySelector("#wayfinding-breadcrumbs_feature_div");
    if (crumbEl) {
      crumbEl.querySelectorAll("li").forEach((li) => {
        const t = txt(li);
        if (t) crumbs.push(t);
      });
    }

    const pageText = (document.body.innerText || "").slice(0, 20000).toLowerCase();
    let format = "Paperback";
    if (/kindle/.test(pageText)) format = "Kindle";
    else if (/hardcover/.test(pageText)) format = "Hardcover";

    return {
      data: {
        asin: extractAsin(),
        title,
        subtitle: txt(document.querySelector("#productSubtitle")),
        author: txt(document.querySelector(".author .a-link-normal, #bylineInfo")) || "Unknown",
        format,
        price: price || 0,
        currency,
        rating: rating || 0,
        reviewCount: reviewCount || 0,
        bsr,
        bsrCategory: bsrCategory || "Books",
        pageCount,
        categories: crumbs,
      },
      reason: "ok",
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "get-book-data") {
      const r = extractPageData();
      sendResponse({ data: r.data, reason: r.reason, url: location.href });
    }
    return false; // sync response
  });
})();