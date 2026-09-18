// Dependency-free local Chrome fixture runner; no external sites, accounts, or workflows.
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync("node", ["scripts/verify-gate.mjs"], { cwd: root, stdio: "inherit" });

const inlineCss = { name: "inline-css", setup(buildApi) {
  buildApi.onResolve({ filter: /\.css(\?inline)?$/ }, (args) => ({
    path: resolve(args.resolveDir, args.path.replace(/\?inline$/, "")),
    namespace: "inline-css"
  }));
  buildApi.onLoad({ filter: /.*/, namespace: "inline-css" }, async (args) => ({
    contents: await readFile(args.path, "utf8"),
    loader: "text"
  }));
} };
const bundle = await build({
  plugins: [inlineCss],
  entryPoints: [resolve(root, "scripts/verify-features.ts")],
  bundle: true,
  write: false,
  format: "iife",
  alias: { "@": resolve(root, "vendor/luna-navigation/src") }
});
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/test.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/test.js" ? bundle.outputFiles[0].text : "<!doctype html><meta charset=\"utf-8\"><title>Yada local verification</title><body><script src=\"/test.js\"></script></body>");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const profile = await mkdtemp(resolve(root, ".verify-browser-"));
let browser, socket;
try {
  browser = spawn(process.env.YADA_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1280,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((done, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Chrome startup timed out")), 15000);
    browser.once("error", reject);
    browser.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        done(match[1]);
      }
    });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      message.error ? callback.reject(message.error) : callback.resolve(message.result);
    }
  };
  const call = (method, params = {}, sessionId) => new Promise((done, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: done, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/c/fixture-1` }, sessionId);
  const deadline = Date.now() + 180000;
  let result;
  while (Date.now() < deadline) {
    const state = await call("Runtime.evaluate", { expression: "globalThis.yadaVerification", returnByValue: true }, sessionId);
    result = state.result?.value;
    if (result?.done) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!result?.done) throw new Error(`Fixture timeout: ${JSON.stringify(result)}`);
  for (const check of result.checks) console.log(`PASS ${check}`);
  if (result.error) throw new Error(result.error);
  console.log(`browser verification passed (${result.checks.length} checks)`);
} finally {
  socket?.close();
  browser?.kill();
  if (browser && browser.exitCode === null) await new Promise((done) => { browser.once("exit", done); setTimeout(done, 3000); });
  server.close();
  await rm(profile, { recursive: true, force: true });
}
