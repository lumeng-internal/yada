import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

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

export async function runLocalFixtures(cdp, createdTargetIds) {
  const bundle = await build({
    plugins: [inlineCss],
    entryPoints: [resolve(root, "scripts/verify-features.ts")],
    bundle: true,
    write: false,
    format: "iife"
  });
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/test.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/test.js" ? bundle.outputFiles[0].text : "<!doctype html><meta charset=\"utf-8\"><title>Yada local verification</title><body><script src=\"/test.js\"></script></body>");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/c/fixture-1`;
  let targetId;
  try {
    targetId = await cdp.createTarget(url);
    createdTargetIds.add(targetId);
    await cdp.attach(targetId);
    const deadline = Date.now() + 90_000;
    let result;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        result = await cdp.evaluate(targetId, "globalThis.yadaVerification", { awaitPromise: false, timeoutMs: 3_000 });
        lastError = null;
      } catch (error) {
        lastError = String(error.message || error);
        result = null;
      }
      if (result?.done) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    if (!result?.done) throw new Error(`Fixture timeout: ${JSON.stringify({ result, lastError })}`);
    if (result.error) throw new Error(result.error);
    return { checks: result.checks ?? [], url };
  } finally {
    server.close();
  }
}
