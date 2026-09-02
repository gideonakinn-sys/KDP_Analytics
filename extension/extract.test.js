#!/usr/bin/env node
"use strict";
const assert = require("assert");
const X = require("./lib/extract.js");

let count = 0;
function ok(cond, msg) {
  count++;
  assert(cond, msg);
}

// price
ok(X.parsePriceText("$12.99") === 12.99, "usd price");
ok(X.parsePriceText("£9.99") === 9.99, "gbp price (numeric)");
ok(X.parsePriceText("") === null, "empty text -> null");
ok(X.parsePriceText("no price") === null, "no price");
// int
ok(X.parseIntText("1,234 ratings") === 1234, "int with comma");
ok(X.parseIntText("300 pages") === 300, "int plain");
// currency
ok(X.detectCurrency("£12.99").code === "GBP", "gbp cur");
ok(X.detectCurrency("C$19.99").code === "CAD", "cad cur");
ok(X.detectCurrency("¥1,200").code === "JPY", "jpy cur");
ok(X.detectCurrency("€9.49").code === "EUR", "eur cur");
ok(X.detectCurrency("$12.99").code === "USD", "usd cur");
// asin
ok(X.extractAsinFromUrl("https://www.amazon.com/dp/B0ABCDEFG1/ref=xx") === "B0ABCDEFG1", "url asin");
ok(X.extractAsinFromUrl("https://www.amazon.com/gp/product/B0ABCDEFG1") === "B0ABCDEFG1", "gp asin");
ok(X.extractAsinFromUrl("https://example.com/other") === "", "no asin");
// format
ok(X.formatFromText("Amazon Kindle Edition by Author") === "Kindle", "kindle fmt");
ok(X.formatFromText("Hardcover – June 2026") === "Hardcover", "hardcover fmt");
ok(X.formatFromText("Paperback – 320 pages") === "Paperback", "paperback fmt");
// details (BSR + category + print length)
const d = X.parseBsrDetails(" Best Sellers Rank: #12,345 in Books (See Top 100 in the last 30 days)   Print length : 320 pages ");
ok(d.bsr === 12345 && d.bsrCategory === "Books" && d.pageCount === 320, "bsr + length");
const d2 = X.parseBsrDetails('#987,654 in Kindle Store (See Top 100)  Print length 245 pages');
ok(d2.bsr === 987654 && d2.pageCount === 245, "bsr kindle + length no colon");
const d3 = X.parseBsrDetails("No rank here.");
ok(d3.bsr === null && d3.pageCount === null, "empty details");
// rating
ok(X.parseRating("4.6 out of 5 stars") === 4.6, "rating");

console.log("EXTRACT OK — " + count + " assertions passed");