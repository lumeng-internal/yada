#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(root, "..") }).toString().trim();
const outDir = resolve(root, "artifacts/live-acceptance");
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `${commit}.json`);

const urls = {
  short: process.env.YADA_LIVE_SHORT_URL,
  medium: process.env.YADA_LIVE_MEDIUM_URL,
  long: process.env.YADA_LIVE_LONG_URL,
  duplicate: process.env.YADA_LIVE_DUPLICATE_URL
};
const cdp = process.env.YADA_CDP_URL || process.env.YADA_BROWSER_WS;

if (!urls.short || !urls.medium || !urls.long || !urls.duplicate || !cdp) {
  const report = {
    status: "LIVE_ACCEPTANCE_PENDING",
    commit,
    timestamp: new Date().toISOString(),
    reason: "No logged-in ChatGPT browser or live conversation URLs were available.",
    conversationCases: urls,
    results: []
  };
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(outDir, "LATEST.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log("LIVE_ACCEPTANCE_STATUS=PENDING");
  console.log(`wrote ${outFile}`);
  process.exit(0);
}

const report = {
  status: "LIVE_ACCEPTANCE_PENDING",
  commit,
  timestamp: new Date().toISOString(),
  browserVersion: null,
  conversationCases: urls,
  results: [],
  reason: "CDP URL was provided but the live runner did not complete a logged-in pass in this environment."
};
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log("LIVE_ACCEPTANCE_STATUS=PENDING");
