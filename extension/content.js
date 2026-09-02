// KDP Book Analytics — content script.
// Reads the already-loaded Amazon product page DOM (so nothing is fetched
// over the network and Amazon has nothing to block) and serves the data to
// the side panel on request. No UI is injected into the page.
//
// Parsing helpers live in lib/extract.js (loaded first as window.KDPExtract)
// so the same extraction logic is Node-testable (extract.test.js).
//
// Responds to {type: "get-book-data"} with:
//   { data: <BookData|null>, reason: "ok"|"no-product"|"unparseable", url }
(() => {
  "use strict";
  const E = (typeof window !== "undefined" && window.KDPExtract) || null;

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
  const PAGE_CONTAINERS = [
    "#detailBullets_feature_div",
    "#productDetails_detailBullets_sections1",
    "#productDetails_techSpec_section_1",
    "#productDetailsTable",
    "#productDetails_expanderTables",
  ];

  function extractAsin() {
    const urlAsin = E ? E.extractAsinFromUrl(location.href) : "";
    if (urlAsin) return urlAsin;
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
        price = E ? E.parsePriceText(raw) : null;
        if (price) {
          currency = E ? E.detectCurrency(raw) : currency;
          break;
        }
      }
    }

    let rating = null;
    const ratingEl = document.querySelector("span.a-icon-alt");
    if (ratingEl) rating = E ? E.parseRating(txt(ratingEl)) : null;
    let reviewCount = null;
    const reviewsEl = document.querySelector("#acrCustomerReviewText");
    if (reviewsEl) reviewCount = E ? E.parseIntText(txt(reviewsEl)) : null;

    let bsr = null;
    let bsrCategory = null;
    let pageCount = null;
    const detailEl =
      document.querySelector("#detailBullets_feature_div") ||
      document.querySelector("#productDetails_detailBullets_sections1");
    const detailsText = detailEl ? (detailEl.textContent || "").replace(/\s+/g, " ") : "";
    if (detailsText && E) {
      const d = E.parseBsrDetails(detailsText);
      bsr = d.bsr;
      bsrCategory = d.bsrCategory;
      pageCount = d.pageCount;
    }
    if (pageCount === null && E) {
      for (const sel of PAGE_CONTAINERS) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const d = E.parseBsrDetails((el.textContent || "").replace(/\s+/g, " "));
        if (d.pageCount !== null) {
          pageCount = d.pageCount;
          break;
        }
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
    const format = E ? E.formatFromText(pageText) : "Paperback";

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