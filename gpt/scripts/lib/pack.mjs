import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

export function walkFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function distFileMap(distDir) {
  return Object.fromEntries(walkFiles(distDir).map((path) => [relative(distDir, path).replaceAll("\\", "/"), sha256File(path)]));
}

export function zipDist({ projectRoot, zipName, distDir = "dist_chrome" }) {
  const version = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).version;
  const source = JSON.parse(readFileSync(resolve(projectRoot, "manifest.json"), "utf8")).version;
  const built = JSON.parse(readFileSync(resolve(projectRoot, distDir, "manifest.json"), "utf8")).version;
  const lock = JSON.parse(readFileSync(resolve(projectRoot, "package-lock.json"), "utf8"));
  if (version !== source || version !== built || version !== lock.version || version !== lock.packages[""].version
    || zipName !== `ChatGPT-Yada-v${version}-official-only-UNVERIFIED.zip`) {
    throw new Error("package / lock / manifest / dist / ZIP version mismatch");
  }
  const zipPath = resolve(projectRoot, zipName);
  if (existsSync(zipPath)) throw new Error("Test package already exists; do not overwrite a versioned artifact");
  execFileSync("zip", ["-qry", zipName, distDir], { cwd: projectRoot });
  const listing = execFileSync("unzip", ["-Z1", zipName], { cwd: projectRoot }).toString();
  if (!listing.includes(`${distDir}/native-navigator-main.js`) || !listing.includes(`${distDir}/content.js`) || !listing.includes(`${distDir}/background.js`) || !listing.includes(`${distDir}/popup.html`)) {
    throw new Error("zip missing required extension files");
  }
  if (!listing.includes(`${distDir}/LICENSE`) || !listing.includes(`${distDir}/NOTICE.md`) || !listing.includes(`${distDir}/THIRD_PARTY_NOTICES.md`)) {
    throw new Error("zip missing license files");
  }
  if (listing.includes("native-bootstrap-page.js")) throw new Error("zip contains native-bootstrap-page.js");
  return { zipPath, sha256: sha256File(zipPath) };
}

export function zipMatchesDist(projectRoot, zipName, distDir = resolve(projectRoot, "dist_chrome")) {
  const extractDir = resolve(projectRoot, "artifacts/package/.zip-compare");
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  execFileSync("unzip", ["-q", zipName, "-d", extractDir], { cwd: projectRoot });
  const zipped = distFileMap(resolve(extractDir, "dist_chrome"));
  const dist = distFileMap(distDir);
  const keys = new Set([...Object.keys(zipped), ...Object.keys(dist)]);
  const mismatches = [...keys].filter((key) => zipped[key] !== dist[key]);
  rmSync(extractDir, { recursive: true, force: true });
  return { matches: mismatches.length === 0, mismatches };
}
