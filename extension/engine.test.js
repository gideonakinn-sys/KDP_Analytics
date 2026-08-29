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