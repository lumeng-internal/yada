import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipDist, zipMatchesDist } from "./lib/pack.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")).version;
const zipName = `ChatGPT-Yada-v${version}-official-only-UNVERIFIED.zip`;
const artifact = zipDist({ projectRoot, zipName });
const comparison = zipMatchesDist(projectRoot, zipName);
if (!comparison.matches) throw new Error(`ZIP differs from dist: ${comparison.mismatches.join(", ")}`);
console.log(JSON.stringify({ ...artifact, version, distMatchesZip: true }, null, 2));
