#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const bumpTypes = new Set(["patch", "minor", "major"]);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

const requiredVersionFiles = ["package.json", "manifest.json"];
const jsonVersionFiles = ["package-lock.json"];
const textVersionFiles = [
  "README.md",
  "docs/FINAL_REPORT.md",
  "docs/TEST_CHECKLIST.md",
  "RELEASE_NOTES.md",
  "docs/RELEASE_NOTES.md",
  "src/lib/version-history.ts",
  "src/lib/version-history.js",
];

const defaultMessages = {
  patch: "小改 / bugfix / 交互修复发布。",
  minor: "新增完整 release 自动化能力。",
  major: "架构大改 / 破坏兼容发布。",
};

function usage() {
  console.error("Usage: node scripts/release.mjs <patch|minor|major> [--dry-run] [--message <text>]");
}

function parseArgs(argv) {
  let bumpType = "";
  let dryRun = false;
  const messageParts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--message" || arg === "-m") {
      const message = argv[index + 1];
      if (!message) {
        throw new Error("Missing value for --message.");
      }
      messageParts.push(message);
      index += 1;
      continue;
    }

    if (arg.startsWith("--message=")) {
      messageParts.push(arg.slice("--message=".length));
      continue;
    }

    if (!bumpType && bumpTypes.has(arg)) {
      bumpType = arg;
      continue;
    }

    if (bumpType && !arg.startsWith("--")) {
      messageParts.push(arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!bumpType) {
    throw new Error("Missing release type.");
  }

  return {
    bumpType,
    dryRun,
    changeMessage: messageParts.join(" ").trim() || defaultMessages[bumpType],
  };
}

function readJson(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function writeJson(relativePath, value) {
  const fullPath = path.join(projectRoot, relativePath);
  fs.writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function assertSemver(version, label) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${label} version must use MAJOR.MINOR.PATCH. Found: ${version}`);
  }
}

function bumpVersion(version, bumpType) {
  const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10));

  if (bumpType === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }

  if (bumpType === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major + 1}.0.0`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncVersionText(content, oldVersion, newVersion) {
  const escaped = escapeRegExp(oldVersion);
  return content
    .replace(new RegExp(`v${escaped}`, "g"), `v${newVersion}`)
    .replace(new RegExp(`V${escaped}`, "g"), `V${newVersion}`)
    .replace(new RegExp(`(["'\`])${escaped}\\1`, "g"), (_match, quote) => `${quote}${newVersion}${quote}`);
}

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function changelogEntry({ newVersion, bumpType, changeMessage, zipName }) {
  return [
    `## v${newVersion} - ${today()}`,
    "",
    `- 版本类型：${bumpType.toUpperCase()}`,
    `- 变更说明：${changeMessage}`,
    `- 构建产物：${zipName}`,
    "",
  ].join("\n");
}

function nextChangelogContent({ oldContent, entry }) {
  if (!oldContent.trim()) {
    return `# Changelog\n\n${entry}`;
  }

  const normalized = oldContent.endsWith("\n") ? oldContent : `${oldContent}\n`;
  const lines = normalized.split("\n");

  if (lines[0]?.startsWith("# ")) {
    const rest = lines.slice(1).join("\n").trimStart();
    return `${lines[0]}\n\n${entry}${rest ? `\n${rest}` : ""}`;
  }

  return `${entry}\n${normalized}`;
}

function formatBytes(bytes) {
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${bytes} bytes (${kib.toFixed(1)} KiB)`;
  }
  return `${bytes} bytes (${(kib / 1024).toFixed(2)} MiB)`;
}

function printList(label, values) {
  console.log(`${label}:`);
  if (values.length === 0) {
    console.log("- none");
    return;
  }
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(`Required command not found: ${command}. Install it and rerun the release.`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function planRelease() {
  const { bumpType, dryRun, changeMessage } = parseArgs(process.argv.slice(2));

  for (const file of requiredVersionFiles) {
    if (!exists(file)) {
      throw new Error(`Missing required version file: ${file}`);
    }
  }

  const packageJson = readJson("package.json");
  const manifestJson = readJson("manifest.json");
  const oldVersion = packageJson.version;
  const manifestVersion = manifestJson.version;

  assertSemver(oldVersion, "package.json");
  assertSemver(manifestVersion, "manifest.json");

  const warnings = [];
  if (oldVersion !== manifestVersion) {
    warnings.push(`package.json version (${oldVersion}) and manifest.json version (${manifestVersion}) differ; package.json wins.`);
  }

  const newVersion = bumpVersion(oldVersion, bumpType);
  const zipName = `ChatGPT-Yada-v${newVersion}-dist_chrome.zip`;
  const zipPath = path.join(projectRoot, zipName);
  const plannedFiles = new Set(["package.json", "manifest.json", "CHANGELOG.md"]);

  for (const file of jsonVersionFiles) {
    if (exists(file)) {
      plannedFiles.add(file);
    }
  }

  for (const file of textVersionFiles) {
    if (exists(file)) {
      plannedFiles.add(file);
    }
  }

  return {
    bumpType,
    dryRun,
    changeMessage,
    oldVersion,
    manifestVersion,
    newVersion,
    zipName,
    zipPath,
    packageJson,
    manifestJson,
    warnings,
    plannedFiles: [...plannedFiles],
  };
}

function applyRelease(plan) {
  const updatedFiles = [];

  const writeIfChanged = (relativePath, nextContent) => {
    const fullPath = path.join(projectRoot, relativePath);
    const previousContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
    if (previousContent !== nextContent) {
      fs.writeFileSync(fullPath, nextContent);
      updatedFiles.push(relativePath);
    }
  };

  const packageJson = { ...plan.packageJson, version: plan.newVersion };
  writeJson("package.json", packageJson);
  updatedFiles.push("package.json");

  const manifestJson = { ...plan.manifestJson, version: plan.newVersion };
  writeJson("manifest.json", manifestJson);
  updatedFiles.push("manifest.json");

  if (exists("package-lock.json")) {
    const packageLock = readJson("package-lock.json");
    packageLock.version = plan.newVersion;
    if (packageLock.packages?.[""]) {
      packageLock.packages[""].version = plan.newVersion;
    }
    writeJson("package-lock.json", packageLock);
    updatedFiles.push("package-lock.json");
  }

  for (const file of textVersionFiles) {
    if (!exists(file)) {
      continue;
    }
    const fullPath = path.join(projectRoot, file);
    const current = fs.readFileSync(fullPath, "utf8");
    const next = syncVersionText(current, plan.oldVersion, plan.newVersion);
    writeIfChanged(file, next);
  }

  const changelogPath = path.join(projectRoot, "CHANGELOG.md");
  const currentChangelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "";
  const entry = changelogEntry(plan);
  writeIfChanged("CHANGELOG.md", nextChangelogContent({ oldContent: currentChangelog, entry }));

  return [...new Set(updatedFiles)];
}

function main() {
  let plan;
  try {
    plan = planRelease();
  } catch (error) {
    usage();
    console.error(error.message);
    process.exit(1);
  }

  const repoRoot = path.resolve(projectRoot, "..");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  const liveFile = path.join(projectRoot, `artifacts/live-acceptance/${head}.json`);
  const live = fs.existsSync(liveFile) ? JSON.parse(fs.readFileSync(liveFile, "utf8")) : null;
  const livePass = live && (live.status === "LIVE_ACCEPTANCE_PASS" || live.status === "PASS") && live.commit === head;
  if (!livePass) {
    console.error("Official release blocked: LIVE_ACCEPTANCE must be PASS for the current HEAD.");
    console.error("A test-branch zip can still be created with `npm run release` / `node scripts/pack.mjs`.");
    console.error("LIVE_ACCEPTANCE_STATUS=PENDING");
    process.exit(2);
  }

  for (const warning of plan.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (plan.dryRun) {
    console.log("Release dry run");
    console.log(`oldVersion: ${plan.oldVersion}`);
    console.log(`newVersion: ${plan.newVersion}`);
    console.log(`bumpType: ${plan.bumpType.toUpperCase()}`);
    printList("wouldUpdateFiles", plan.plannedFiles);
    console.log("wouldBuild: true");
    console.log(`wouldZipPath: ${plan.zipPath}`);
    return;
  }

  const updatedFiles = applyRelease(plan);

  console.log("Running build...");
  run("npm", ["run", "build"]);

  if (!exists("dist_chrome")) {
    throw new Error("Build completed, but dist_chrome was not found.");
  }

  if (fs.existsSync(plan.zipPath)) {
    fs.rmSync(plan.zipPath);
  }

  console.log("Creating release zip...");
  run("zip", ["-qry", plan.zipName, "dist_chrome"]);

  const zipStats = fs.statSync(plan.zipPath);

  console.log("");
  console.log("Release summary");
  console.log(`oldVersion: ${plan.oldVersion}`);
  console.log(`newVersion: ${plan.newVersion}`);
  console.log(`bumpType: ${plan.bumpType.toUpperCase()}`);
  printList("updatedFiles", updatedFiles);
  console.log("build result: passed");
  console.log(`zip path: ${plan.zipPath}`);
  console.log(`zip size: ${formatBytes(zipStats.size)}`);
  console.log("Edge load path: dist_chrome");
  console.log(`archive path: ${plan.zipName}`);
}

main();
