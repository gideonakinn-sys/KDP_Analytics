// Shared, dependency-free extraction helpers (Node-testable). Used by the
// content script (via window.KDPExtract) so DOM parsing stays thin.
(function (root) {
  "use strict";

  function parsePriceText(t) {
    var m = String(t || "").match(/[\d,]+\.\d{2}/);
    if (m) return parseFloat(m[0].replace(/,/g, ""));
    m = String(t || "").match(/\$?\s*([\d,]+)(?:\s|$|[^\d.])/);
    if (m) return parseFloat(m[1].replace(/,/g, ""));
    return null;
  }

  function parseIntText(t) {
    var m = String(t || "").match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
  }

  function detectCurrency(symbolText) {
    var t = symbolText || "";
    if (/C\$|CA\$|CAD/i.test(t)) return { code: "CAD", symbol: "C$" };
    if (/A\$|AU\$|AUD/i.test(t)) return { code: "AUD", symbol: "A$" };
    if (/£/.test(t)) return { code: "GBP", symbol: "£" };
    if (/€/.test(t)) return { code: "EUR", symbol: "€" };
    if (/¥/.test(t)) return { code: "JPY", symbol: "¥" };
    if (/\$/.test(t)) return { code: "USD", symbol: "$" };
    return { code: "USD", symbol: "$" };
  }

  function extractAsinFromUrl(url) {
    var m = String(url || "").match(
      /(?:\/dp\/|\/gp\/product\/|\/product\/|\/gp\/aw\/d\/|\?asin=)([A-Z0-9]{10})/i
    );
    if (m) return m[1].toUpperCase();
    return "";
  }

  // Format from the first chunk of page text ("kindle"/"hardcover" keywords).
  function formatFromText(lower20k) {
    var t = String(lower20k || "").toLowerCase();
    if (t.indexOf("kindle") !== -1) return "Kindle";
    if (t.indexOf("hardcover") !== -1) return "Hardcover";
    return "Paperback";
  }

  // BSR, category and print length from the detail-bullets text.
  function parseBsrDetails(detailsText) {
    var out = { bsr: null, bsrCategory: null, pageCount: null };
    if (!String(detailsText || "").trim()) return out;
    var m = String(detailsText).match(/#([\d,]+)\s+in\s+([A-Za-z0-9&.'-]+(?:\s+[A-Za-z0-9&.'-]+){0,3})/);
    if (m) {
      out.bsr = parseIntText(m[1]);
      out.bsrCategory = (m[2] || "").trim();
    }
    var pl = String(detailsText).match(/print\s*length\s*:?\s*([\d,]+)\s*(?:pages?|\b)/i);
    if (pl) out.pageCount = parseIntText(pl[1]);
    return out;
  }

  // Rating ("4.5 out of 5") and review count ("1,234 ratings") parse helpers.
  function parseRating(text) {
    var m = String(text || "").match(/([\d.]+) out of 5/);
    return m ? parseFloat(m[1]) : null;
  }

  var api = {
    parsePriceText: parsePriceText,
    parseIntText: parseIntText,
    detectCurrency: detectCurrency,
    extractAsinFromUrl: extractAsinFromUrl,
    formatFromText: formatFromText,
    parseBsrDetails: parseBsrDetails,
    parseRating: parseRating,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.KDPExtract = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);