import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist_chrome");

if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const inlineCss = {
  name: "inline-css",
  setup(buildApi) {
    buildApi.onResolve({ filter: /\.css(\?inline)?$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?inline$/, "")),
      namespace: "inline-css"
    }));
    buildApi.onLoad({ filter: /.*/, namespace: "inline-css" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text"
    }));
  }
};

await esbuild.build({
  absWorkingDir: root,
  entryPoints: {
    content: "src/content.ts",
    background: "src/background/serviceWorker.ts",
    popup: "src/popup/popup.ts"
  },
  bundle: true,
  format: "iife",
  charset: "utf8",
  platform: "browser",
  target: ["chrome120"],
  outdir,
  metafile: true,
  alias: {
    "@": resolve(root, "vendor/luna-navigation/src")
  },
  plugins: [inlineCss],
  logLevel: "info"
}).then((result) => {
  const artifacts = resolve(root, "artifacts/build");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(resolve(artifacts, "metafile.json"), `${JSON.stringify(result.metafile, null, 2)}\n`);
});

cpSync(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));
cpSync(resolve(root, "src/popup/popup.css"), resolve(outdir, "popup.css"));
cpSync(resolve(root, "src/popup/index.html"), resolve(outdir, "popup.html"));
for (const file of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
  const from = resolve(root, file);
  if (existsSync(from)) cpSync(from, resolve(outdir, file));
}

const built = JSON.parse(readFileSync(resolve(outdir, "manifest.json"), "utf8"));
if (built.version !== "4.0.0") throw new Error(`dist manifest version is ${built.version}`);
if (!existsSync(resolve(outdir, "content.js")) || !existsSync(resolve(outdir, "background.js")) || !existsSync(resolve(outdir, "popup.html"))) {
  throw new Error("extension outputs missing");
}
if (existsSync(resolve(outdir, "content.css"))) {
  throw new Error("content.css must be inlined into content.js");
}
const content = readFileSync(resolve(outdir, "content.js"), "utf8");
if (content.includes("native-bootstrap-page") || content.includes("NativeBootstrapController")) {
  throw new Error("built content.js contains native bootstrap");
}
console.log("build ok: dist_chrome/{content.js,background.js,popup.js,popup.html,popup.css,manifest.json}");
