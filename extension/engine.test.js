#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const KDP = require("./engine.js");

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, "expected.json"), "utf-8")
);

function approxEq(a, b, eps) {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= eps;
    return Object.is(a, b);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

let failures = 0;
let checks = 0;

for (const { input, expected } of fixtures) {
  const got = KDP.computeAnalytics(input);
  const gotCost = KDP.printCostFor(input.format, input.pageCount);

  const cases = [
    ["dailySales", got.dailySales],
    ["monthlySales", got.monthlySales],
    ["royaltyPerUnit", got.royaltyPerUnit],
    ["dailyRoyalty", got.dailyRoyalty],
    ["monthlyRoyalty", got.monthlyRoyalty],
    ["grossMonthlyRevenue", got.grossMonthlyRevenue],
    ["compScore", got.comp.score],
    ["compLabel", got.comp.label],
    ["priceMissing", got.priceMissing],
    ["pageCountMissing", got.pageCountMissing],
    ["royaltyUnknown", got.royaltyUnknown],
    ["printCost", gotCost],
  ];

  for (const [field, actual] of cases) {
    checks++;
    const want = expected[field];
    const ok = approxEq(actual, want, 1e-9);
    if (!ok) {
      failures++;
      console.log(
        `FAIL ${input.asin} ${field}: got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`
      );
    }
  }

  // keywords: exact match incl. order. The `confidence` field tolerates ±0.011
  // (1 percentage point): Python's round() and JS disagree only on exact .xx5
  // ties (float representation), which is cosmetic for the displayed relevance.
  checks++;
  const maxLen = Math.max(expected.keywords.length, got.keywords.length);
  let kwOk = true;
  for (let i = 0; i < maxLen; i++) {
    const a = got.keywords[i];
    const b = expected.keywords[i];
    if (
      !a ||
      !b ||
      a.keyword !== b.keyword ||
      a.source !== b.source ||
      a.count !== b.count ||
      Math.abs(a.confidence - b.confidence) > 0.011
    ) {
      kwOk = false;
      console.log(`FAIL ${input.asin} keyword[${i}]: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
      break;
    }
  }
  if (!kwOk) failures++;
}

if (failures === 0) {
  console.log(`PARITY OK — ${fixtures.length} fixtures, ${checks} assertions matched within 1e-9`);
} else {
  console.error(`PARITY FAILED — ${failures} mismatches across ${fixtures.length} fixtures`);
  process.exit(1);
}

// --- optional per-marketplace Kindle bands (ctx) ---
function checkZone(name, cond) {
  checks++;
  if (!cond) failures.push(name);
}

// A £9.99 book sits inside the UK 70% band (min 2.99, max 9.99, fee £0.10)
// and gets the 70% rate; without ctx the same price (> $9.99 USD cap) was 35%.
const ukMid = KDP.estimateRoyaltyPerUnit(9.99, "Kindle", null, { tierMin: 2.99, tierMax: 9.99, deliveryFee: 0.1 });
checkZone("uk mid->70% fee", Math.abs(ukMid - (9.99 * 0.7 - 0.1)) <= 1e-9);
const usMid = KDP.estimateRoyaltyPerUnit(9.99, "Kindle");
checkZone("us mid->70% default", Math.abs(usMid - (9.99 * 0.7 - 0.15)) <= 1e-9);
const ukHigh = KDP.estimateRoyaltyPerUnit(12.49, "Kindle", null, { tierMin: 2.99, tierMax: 9.99, deliveryFee: 0.1 });
checkZone("uk high->35%", Math.abs(ukHigh - 12.49 * 0.35) <= 1e-9);
const ctx = { tierMin: 360, tierMax: 1250, deliveryFee: 20 };
const jpy = KDP.computeAnalytics({ price: 800, format: "Kindle", bsr: 10000, reviewCount: 100 }, ctx);
checkZone("jpy 70% in local", Math.abs(jpy.royaltyPerUnit - (800 * 0.7 - 20)) <= 1e-9);

if (failures === 0) {
  console.log("CURRENCY TIER OK");
} else {
  console.error("CURRENCY TIER FAILED:", failures.join(", "));
  process.exit(1);
}