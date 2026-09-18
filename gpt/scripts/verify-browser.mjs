#!/usr/bin/env node
import { createCdpClient, readJson } from "./lib/cdp.mjs";
import { runLocalFixtures } from "./lib/fixtures.mjs";

const created = new Set();
const version = await readJson("http://127.0.0.1:9222/json/version");
const cdp = createCdpClient(version.webSocketDebuggerUrl);
await cdp.connect();
try {
  const result = await runLocalFixtures(cdp, created);
  for (const check of result.checks) console.log(`PASS ${check}`);
  console.log(`browser verification passed (${result.checks.length} checks)`);
} finally {
  for (const id of created) await cdp.closeTarget(id).catch(() => undefined);
  cdp.close();
}
