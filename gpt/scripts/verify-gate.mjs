import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync("git", ["diff", "--exit-code", "a4bc0c56908df1e2643e1adb76c897f119891df2", "--", "../claude", "../gemini"], { cwd: root });
console.log("PASS claude/ and gemini/ unchanged from 2.1.1 baseline");

const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
if (manifest.version !== "4.0.0") throw new Error(`manifest version ${manifest.version}`);
if (manifest.background?.service_worker !== "background.js") throw new Error("background service worker missing");
if (manifest.action?.default_popup !== "popup.html") throw new Error("popup missing");
if (!manifest.permissions?.includes("storage") || !manifest.permissions?.includes("alarms") || !manifest.permissions?.includes("activeTab")) {
  throw new Error("manifest permissions must include storage, alarms, activeTab");
}
const forbiddenPermissions = ["debugger", "webRequest", "cookies", "identity"];
if (manifest.permissions.some((item) => forbiddenPermissions.includes(item))) throw new Error("forbidden permission present");
const scripts = (manifest.content_scripts ?? []).flatMap((item) => item.js ?? []);
if (!scripts.includes("content.js") || scripts.includes("native-bootstrap-page.js")) {
  throw new Error("content scripts must include content.js and must not include native-bootstrap-page.js");
}
if (existsSync(resolve(root, "src/nativeBootstrap")) || existsSync(resolve(root, "public/native-bootstrap-page.js"))) {
  throw new Error("nativeBootstrap files still exist");
}
if (existsSync(resolve(root, "vendor/luna-navigation"))) {
  throw new Error("vendor/luna-navigation must be removed from production");
}
console.log("PASS manifest 4.0.0 has content, background, popup, and no native-bootstrap-page.js");

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
  [/waiting-native|waiting-dom/, "native wait states"],
  [/searchVirtualPrompt|jumpVirtual/, "Luna virtual search"],
  [/luna-navigation/, "luna-navigation"]
]) {
  if (pattern.test(src)) throw new Error(`production source still contains ${label}`);
}
console.log("PASS native bootstrap failure path is absent");
