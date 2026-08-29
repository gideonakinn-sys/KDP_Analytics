#!/usr/bin/env node
"use strict";
/* Chrome Web Store readiness checks for the built dist/bookmata package. */
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "dist", "bookmata");
const failures = [];
let checks = 0;

function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}

function has(p) {
  return fs.existsSync(p);
}

if (!has(path.join(APP, "manifest.json"))) {
  console.error("dist not built — run: python extension/make_dist.py");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(APP, "manifest.json"), "utf8"));

// --- basics ---
ok(manifest.manifest_version === 3, "manifest_version is 3");
ok(typeof manifest.name === "string" && manifest.name.length > 0 && manifest.name.length <= 75, "name 1..75 chars");
ok(typeof manifest.description === "string" && manifest.description.length > 0 && manifest.description.length <= 132,
  `description <= 132 chars (got ${manifest.description.length})`);
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), "version is semantic (x.y.z)");

// --- all referenced files exist in dist ---
function inApp(rel) {
  ok(has(path.join(APP, rel)), `missing file: ${rel}`);
}
manifest.icon && Object.values(manifest.icon || {}).forEach(inApp);
manifest.action && manifest.action.default_icon && Object.values(manifest.action.default_icon).forEach(inApp);
manifest.side_panel && inApp(manifest.side_panel.default_path);
manifest.background && inApp(manifest.background.service_worker);
(manifest.content_scripts || []).forEach((cs) => (cs.js || []).forEach(inApp));

// --- CSP: default only (no override; no remote exec) ---
ok(!manifest.content_security_policy, "default CSP (no content_security_policy override)");

// --- no remote code / assets in the entry HTML ---
const html = path.join(APP, "sidepanel.html");
if (has(html)) {
  const src = fs.readFileSync(html, "utf8");
  const remote = (src.match(/(?:src|href)\s*=\s*["'](?:https?:)?\/\//gi) || []).length;
  ok(remote === 0, "sidepanel.html has no remote script/link URLs");
  const localRefs = Array.from(src.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)).map((m) => m[1])
    .filter((u) => !u.startsWith("#") && !u.startsWith("data:"));
  localRefs.forEach((rel) => inApp(rel));
}

// --- store-required icon sizes ---
["16", "48", "128"].forEach((s) => ok(has(path.join(APP, "icons", `icon${s}.png`)), `icon${s}.png present`));

// --- dev files must NOT ship ---
["expected.json", "engine.test.js", "formatter.test.js", "make_dist.py", "make_icons.py", "make_expected.py", "make_vfs.py"].forEach((f) => {
  ok(!has(path.join(APP, f)), `dev file must not ship: ${f}`);
});

// --- language / sane fixups ---
ok(manifest.name === "Bookmata", "store name is Bookmata");

if (failures.length === 0) {
  console.log(`STORE CHECK OK — ${checks} checks passed`);
} else {
  console.error(`STORE CHECK FAILED — ${failures.length} problem(s):`);
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}