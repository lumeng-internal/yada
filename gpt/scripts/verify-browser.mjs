// Dependency-free local Chrome fixture runner; no external sites, accounts, or workflows.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
execFileSync('git', ['diff', '--exit-code', 'a4bc0c56908df1e2643e1adb76c897f119891df2', '--', '../claude', '../gemini'], { cwd: root });
console.log('PASS claude/ and gemini/ unchanged from 2.1.1 baseline');
const inlineCss = { name: 'inline-css', setup(build) { build.onLoad({ filter: /\.css$/ }, async ({ path }) => ({ contents: await readFile(path.replace(/\?inline$/, ''), 'utf8'), loader: 'text' })); } };
const bundle = await build({ plugins: [inlineCss], entryPoints: [resolve(root, 'scripts/verify-features.ts')], bundle: true, write: false, format: 'iife' });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><title>Yada local verification</title><body><script src="/test.js"></script></body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(resolve(root, '.verify-browser-'));
let browser, socket;
try {
  browser = spawn(process.env.YADA_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
    browser.once('error', reject);
    browser.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); message.error ? callback.reject(message.error) : callback.resolve(message.result); } };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/c/fixture-1` }, sessionId);
  const deadline = Date.now() + 120000;
  let result;
  while (Date.now() < deadline) {
    const state = await call('Runtime.evaluate', { expression: 'globalThis.yadaVerification', returnByValue: true }, sessionId);
    result = state.result?.value;
    if (result?.done) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!result?.done) throw new Error(`Fixture timeout: ${JSON.stringify(result)}`);
  for (const check of result.checks) console.log(`PASS ${check}`);
  if (result.error) throw new Error(result.error);
  console.log(`browser verification passed (${result.checks.length} checks)`);
} finally {
  socket?.close(); browser?.kill();
  if (browser && browser.exitCode === null) await new Promise(resolve => { browser.once('exit', resolve); setTimeout(resolve, 3000); });
  server.close(); await rm(profile, { recursive: true, force: true });
}
