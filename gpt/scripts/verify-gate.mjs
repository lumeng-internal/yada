import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync("git", ["diff", "--exit-code", "a4bc0c56908df1e2643e1adb76c897f119891df2", "--", "../claude", "../gemini"], { cwd: root });
console.log("PASS claude/ and gemini/ unchanged from 2.1.1 baseline");

const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const lockVersion = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")).packages[""].version;
const distVersion = JSON.parse(readFileSync(resolve(root, "dist_chrome/manifest.json"), "utf8")).version;
if (manifest.version !== packageVersion || lockVersion !== packageVersion || distVersion !== packageVersion) throw new Error(`manifest version ${manifest.version}`);
if (manifest.background?.service_worker !== "background.js") throw new Error("background service worker missing");
if (manifest.action?.default_popup !== "popup.html") throw new Error("popup missing");
if (!manifest.permissions?.includes("storage") || !manifest.permissions?.includes("alarms") || !manifest.permissions?.includes("activeTab")) {
  throw new Error("manifest permissions must include storage, alarms, activeTab");
}
const forbiddenPermissions = ["debugger", "webRequest", "cookies", "identity"];
if (manifest.permissions.some((item) => forbiddenPermissions.includes(item))) throw new Error("forbidden permission present");
const scripts = (manifest.content_scripts ?? []).flatMap((item) => item.js ?? []);
const mainHook = (manifest.content_scripts ?? []).find((item) =>
  item.world === "MAIN" && item.run_at === "document_start" && item.js?.includes("native-navigator-main.js")
);
if (!scripts.includes("content.js") || !mainHook || scripts.includes("native-bootstrap-page.js")) {
  throw new Error("content scripts must include content.js and a document_start MAIN native navigator hook");
}
if (existsSync(resolve(root, "src/nativeBootstrap")) || existsSync(resolve(root, "public/native-bootstrap-page.js"))) {
  throw new Error("nativeBootstrap files still exist");
}
if (existsSync(resolve(root, "vendor/luna-navigation"))) {
  throw new Error("vendor/luna-navigation must be removed from production");
}
console.log(`PASS version ${packageVersion} consistent; isolated content, document_start MAIN hook, background, and popup`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const src = walk(resolve(root, "src"))
  .filter((path) => [".ts", ".js", ".html", ".css"].includes(extname(path)))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
for (const [pattern, label] of [
  [/native-bootstrap-page/, "native-bootstrap-page"],
  [/NativeBootstrapController/, "NativeBootstrapController"],
  [/HistoryTracker/, "HistoryTracker"],
  [/导航准备中/, "导航准备中"],
  [/导航未完整/, "导航未完整"],
  [/YadaRailController|NativeNavigationPort|jumpStableSlot/, "retired Yada navigation"],
  [/OfficialNavigationVisibilityController|NativePreparationController/, "retired official-navigation controls"],
  [/PREVIEW_KEY|data-preview-mode|previewAssistant/, "retired preview mode"],
  [/data-yada-navigator|chatgpt-yada-rail-host/, "second navigator host"],
  [/searchVirtualPrompt|jumpVirtual/, "Luna virtual search"],
  [/luna-navigation/, "luna-navigation"]
]) {
  if (pattern.test(src)) throw new Error(`production source still contains ${label}`);
}
for (const retired of ["src/navigation", "src/rail", "scripts/candidate.mjs", "scripts/verify-browser.mjs", "scripts/verify-features.ts", "scripts/qa"]) {
  if (existsSync(resolve(root, retired))) throw new Error(`retired path still exists: ${retired}`);
}
console.log("PASS retired rail, preview, direct/stable navigation, and browser-candidate paths are absent");
