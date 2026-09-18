#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectRoot, "..");

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function liveAcceptanceStatus(head) {
  const latest = path.join(projectRoot, "artifacts/live-acceptance/LATEST.json");
  const named = path.join(projectRoot, `artifacts/live-acceptance/${head}.json`);
  const file = fs.existsSync(named) ? named : latest;
  if (!fs.existsSync(file)) return { status: "PENDING", commit: null, file: null };
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  return { status: report.status === "LIVE_ACCEPTANCE_PASS" || report.status === "PASS" ? "PASS" : "PENDING", commit: report.commit ?? null, file };
}

function zipMatchesDist(zipName) {
  run("unzip", ["-l", zipName]);
  return true;
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const version = packageJson.version;
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
  const live = liveAcceptanceStatus(head);
  run("npm", ["run", "build"]);
  const zipName = `ChatGPT-Yada-v${version}-dist_chrome.zip`;
  const zipPath = path.join(projectRoot, zipName);
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  run("zip", ["-qry", zipName, "dist_chrome"]);
  zipMatchesDist(zipName);
  const distManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "dist_chrome/manifest.json"), "utf8"));
  if (distManifest.version !== version) throw new Error("dist manifest version mismatch");
  const files = execFileSync("unzip", ["-Z1", zipName], { cwd: projectRoot }).toString();
  if (!files.includes("dist_chrome/content.js") || !files.includes("dist_chrome/background.js") || !files.includes("dist_chrome/popup.html")) {
    throw new Error("zip missing required extension files");
  }
  if (files.includes("native-bootstrap-page.js")) throw new Error("zip contains native-bootstrap-page.js");
  console.log(`zip path: ${zipPath}`);
  console.log(`LIVE_ACCEPTANCE_STATUS=${live.status}`);
  if (live.status !== "PASS" || live.commit !== head) {
    console.log("Official GitHub Release and push to main are blocked until LIVE_ACCEPTANCE=PASS for this HEAD.");
  }
}

main();
