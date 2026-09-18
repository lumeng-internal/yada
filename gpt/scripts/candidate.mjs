#!/usr/bin/env node
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createCdpClient, readJson } from "./lib/cdp.mjs";
import { runLocalFixtures } from "./lib/fixtures.mjs";
import { zipDist, zipMatchesDist } from "./lib/pack.mjs";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..");
const distChrome = resolve(root, "dist_chrome");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const CDP_ORIGIN = "http://127.0.0.1:9222";
const createdTargetIds = new Set();
const originalTargetIds = new Set();
const registryPath = resolve(root, "artifacts/candidate/sample-registry.json");

const PAGE_FETCH = `async (path, jsonBody) => {
  const session = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.ok ? r.json() : null).catch(() => null);
  const headers = { Accept: "application/json" };
  if (session && typeof session.accessToken === "string") headers.Authorization = "Bearer " + session.accessToken;
  const account = (function accountId() {
    try {
      const raw = localStorage.getItem("_account");
      if (!raw) return null;
      if (/^account-[a-z0-9_-]+$/i.test(raw)) return raw;
      const walk = (value) => {
        if (!value || typeof value !== "object") return null;
        for (const key of ["accountId", "account_id", "currentAccountId", "current_account_id", "id"]) {
          const candidate = value[key];
          if (typeof candidate === "string" && /^account-[a-z0-9_-]+$/i.test(candidate)) return candidate;
        }
        for (const nested of Object.values(value)) {
          const found = walk(nested);
          if (found) return found;
        }
        return null;
      };
      return walk(JSON.parse(raw));
    } catch {
      return null;
    }
  })();
  if (account) headers["Chatgpt-Account-Id"] = account;
  const init = { credentials: "include", cache: "no-store", headers };
  if (jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
    init.method = "POST";
    init.body = JSON.stringify(jsonBody);
  }
  let response = await fetch(path, init);
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    response = await fetch(path, init);
  }
  const data = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, data };
}`;

const SESSION_STATUS = `async () => {
  const response = await fetch("/api/auth/session", { credentials: "include" });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, loggedIn: Boolean(data && ((data.user && data.user.id) || data.accessToken)) };
}`;

const LIST_ITEMS = `async (input) => {
  const result = await (${PAGE_FETCH})("/backend-api/conversations?offset=" + input.offset + "&limit=50&order=updated&is_archived=" + input.archived);
  const items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
  return items.map((item) => ({
    id: typeof item.id === "string" ? item.id : null,
    updateTime: item.update_time ?? null,
    origin: typeof item.conversation_origin === "string" ? item.conversation_origin : null,
    temporary: item.is_temporary_chat === true,
    gizmo: typeof item.gizmo_id === "string" && item.gizmo_id.length > 0
  }));
}`;

const READ_SUMMARY = `async (id) => {
  const fetchJson = ${PAGE_FETCH};
  const unwrap = (data) => data && data.conversation ? data.conversation : data;
  const hashText = async (message) => {
    const parts = message && message.content && Array.isArray(message.content.parts) ? message.content.parts : [];
    const text = parts.map((part) => typeof part === "string" ? part : "").join("\\n").replace(/\\s+/g, " ").trim().toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const summarizeMessages = async (conversation, messages) => {
    const origin = typeof conversation.conversation_origin === "string" ? conversation.conversation_origin : null;
    const model = typeof conversation.default_model_slug === "string" ? conversation.default_model_slug : "";
    const originKey = (origin || "").toLowerCase();
    const modelKey = model.toLowerCase();
    const users = [];
    for (const message of messages) {
      const role = message && message.author && message.author.role;
      if (role !== "user" || !message.id) continue;
      users.push({ id: message.id, hash: await hashText(message) });
    }
    const hashes = new Map();
    let duplicate = null;
    for (const user of users) {
      const prev = hashes.get(user.hash);
      if (prev && prev !== user.id) { duplicate = { a: prev, b: user.id, hash: user.hash }; break; }
      hashes.set(user.hash, user.id);
    }
    return {
      conversationId: conversation.id || conversation.conversation_id || id,
      updateTime: conversation.update_time || null,
      turnCount: users.length,
      userIds: users.map((item) => item.id),
      duplicate,
      origin,
      isWork: ["tpp", "flora", "codex"].includes(originKey) || modelKey.endsWith("-wm") || modelKey.includes("codex"),
      temporary: conversation.is_temporary_chat === true
    };
  };
  const summarizeMapping = async (conversation) => {
    const mapping = conversation.mapping || {};
    const messages = [];
    let cursor = conversation.current_node || conversation.current_node_id;
    const seen = new Set();
    while (cursor && mapping[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      if (mapping[cursor].message) messages.push(mapping[cursor].message);
      cursor = mapping[cursor].parent;
    }
    messages.reverse();
    return summarizeMessages(conversation, messages);
  };
  const pageUrl = (before) => {
    const path = before ? "/backend-api/conversations/" + encodeURIComponent(id) + "/messages" : "/backend-api/conversations/" + encodeURIComponent(id);
    return path + "?include_has_versions=true&num_turns=100" + (before ? "&before=" + encodeURIComponent(before) : "");
  };
  const firstRaw = await fetchJson(pageUrl(""));
  if (firstRaw.status === 429) return null;
  if (!firstRaw.ok || !firstRaw.data) return null;
  const first = unwrap(firstRaw.data);
  if (!Array.isArray(first.messages)) return summarizeMapping(first);
  let messages = first.messages.slice();
  let page = first.page_info || first.pageInfo || {};
  let cursor = (page.has_previous_page === true || page.hasPreviousPage === true) ? (page.start_cursor || page.startCursor || "") : "";
  const seen = new Set();
  let count = 1;
  while (cursor && count < 20) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const nextRaw = await fetchJson(pageUrl(cursor));
    if (nextRaw.status === 429 || !nextRaw.ok) break;
    const next = unwrap(nextRaw.data || {});
    if (!Array.isArray(next.messages)) break;
    messages = next.messages.concat(messages);
    page = next.page_info || next.pageInfo || {};
    cursor = (page.has_previous_page === true || page.hasPreviousPage === true) ? (page.start_cursor || page.startCursor || "") : "";
    count += 1;
  }
  const unique = [];
  const ids = new Set();
  for (const message of messages) {
    if (!message || !message.id || ids.has(message.id)) continue;
    ids.add(message.id);
    unique.push(message);
  }
  return summarizeMessages(first, unique);
}`;

class SetupRequired extends Error {
  constructor(message) { super(message); this.status = "SETUP_REQUIRED"; }
}
class Busy extends Error {
  constructor(message) { super(message); this.status = "BUSY"; }
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function meetingBusy() {
  const locks = [
    resolve("/Volumes/AutomationData/10_Workspace/Codex/meeting-organizer-2/runtime/.meeting-organizer-2/v3.3/run.lock"),
    resolve("/Volumes/AutomationData/20_Codex/meeting-organizer-2/runtime/.meeting-organizer-2/v3.3/run.lock")
  ];
  for (const file of locks) {
    if (!existsSync(file)) continue;
    try {
      const lock = JSON.parse(readFileSync(file, "utf8"));
      if (pidAlive(lock.pid)) return true;
    } catch {
      return true;
    }
  }
  const heartbeats = [
    resolve("/Volumes/AutomationData/10_Workspace/Codex/course-gpt-batch-runner/data/iflyrec_course_asset_collector/data/downloads/.meeting-organizer-2/v3.3/heartbeat.json"),
    resolve("/Volumes/AutomationData/10_Workspace/Codex/course-gpt-batch-runner/runtime/runs/background/heartbeat.json")
  ];
  for (const file of heartbeats) {
    if (!existsSync(file)) continue;
    try {
      const beat = JSON.parse(readFileSync(file, "utf8"));
      const stage = String(beat.stage || beat.currentStage || "").toUpperCase();
      if (!pidAlive(beat.pid)) continue;
      if (stage && stage !== "CLOSED" && stage !== "COMPLETED") return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function evaluateFn(cdp, targetId, fn, arg) {
  const expression = arg === undefined ? `(${fn})()` : `(${fn})(${JSON.stringify(arg)})`;
  return cdp.evaluate(targetId, expression);
}

async function waitFor(cdp, targetId, fn, message, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluateFn(cdp, targetId, fn).catch(() => null);
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`${message}: ${JSON.stringify(last)}`);
}

function sampleTypeFor(count) {
  if (count >= 100) return "long";
  if (count >= 30 && count <= 50) return "medium";
  if (count >= 12 && count <= 24) return "short";
  return null;
}

async function createChatTarget(cdp) {
  const targetId = await cdp.createTarget("https://chatgpt.com/");
  createdTargetIds.add(targetId);
  await cdp.attach(targetId);
  await waitFor(
    cdp,
    targetId,
    `() => location.hostname.includes("chatgpt.com") && document.readyState === "complete"`,
    "ChatGPT did not load"
  );
  return targetId;
}

async function main() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
  const report = {
    commit,
    version,
    timestamp: new Date().toISOString(),
    check: null,
    build: null,
    fixture: null,
    browser: { product: null, version: null, debuggerPort: 9222 },
    extension: { id: null, temporaryLoaded: false, version: null },
    samples: { short: null, medium: null, long: null, duplicate: null },
    live: { short: null, medium: null, long: null, duplicate: null, cancel: null, smoke: null },
    quota: { plan: null, historyStatus: null, classifiedTurns: null, unclassifiedTurns: null },
    popup: null,
    privacy: null,
    zip: { path: null, sha256: null, distMatchesZip: null },
    overall: null
  };
  mkdirSync(resolve(root, "artifacts/candidate"), { recursive: true });
  let cdp;
  let extensionId = null;
  let temporaryLoaded = false;

  const finish = (status, message) => {
    report.overall = status;
    const out = resolve(root, `artifacts/candidate/${commit}.json`);
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    if (message) console.error(message);
    console.log(`CANDIDATE=${status}`);
    console.log(`wrote ${out}`);
    return status === "PASS" ? 0 : status === "FAIL" ? 1 : 2;
  };

  try {
    if (meetingBusy()) throw new Busy("会议浏览器正在执行会议任务，本次验收未运行。");

    run("npm", ["run", "check"]);
    report.check = "PASS";
    run("npm", ["run", "build"]);
    report.build = "PASS";

    let versionInfo;
    try {
      versionInfo = await readJson(`${CDP_ORIGIN}/json/version`);
    } catch {
      throw new SetupRequired("会议浏览器当前没有运行，请先启动现有会议浏览器。");
    }
    cdp = createCdpClient(versionInfo.webSocketDebuggerUrl);
    await cdp.connect();
    const browserVersion = await cdp.call("Browser.getVersion");
    report.browser.product = browserVersion.product || versionInfo.Browser;
    report.browser.version = (browserVersion.product || versionInfo.Browser || "").replace(/^.*\//, "");
    const product = `${report.browser.product} ${versionInfo["User-Agent"] || ""}`;
    if (!/Chrome/i.test(product)) throw new SetupRequired("9222 不是预期的会议 Chrome / Chrome for Testing。");

    const existing = await cdp.listTargets();
    if (!existing.length) throw new SetupRequired("会议浏览器当前没有运行，请先启动现有会议浏览器。");
    for (const target of existing) originalTargetIds.add(target.targetId);

    report.fixture = "running";
    const fixtures = await runLocalFixtures(cdp, createdTargetIds);
    report.fixture = { ok: true, checks: fixtures.checks.length };

    const extensions = await loadYada(cdp, distChrome);
    extensionId = extensions.id;
    temporaryLoaded = extensions.temporaryLoaded;
    report.extension = { id: extensionId, temporaryLoaded, version: extensions.version };
    if (extensions.name !== "ChatGPT Yada" || extensions.version !== "4.0.0") {
      throw new Error(`Yada identity mismatch: ${extensions.name} ${extensions.version}`);
    }

    const chatTarget = await cdp.createTarget("https://chatgpt.com/");
    createdTargetIds.add(chatTarget);
    await cdp.attach(chatTarget);
    await waitFor(cdp, chatTarget, `() => location.hostname.includes("chatgpt.com") && document.readyState === "complete"`, "ChatGPT did not load");
    const session = await evaluateFn(cdp, chatTarget, SESSION_STATUS);
    if (!session?.loggedIn) throw new SetupRequired("会议浏览器当前 ChatGPT 登录已失效。");
    await waitFor(
      cdp,
      chatTarget,
      `async () => {
        const items = await (${LIST_ITEMS})({ archived: false, offset: 0 });
        return Array.isArray(items) && items.length > 0;
      }`,
      "ChatGPT conversation list was empty",
      20000
    );

    const samples = await discoverSamples(cdp, chatTarget);
    report.samples = {
      short: compactSample(samples.short),
      medium: compactSample(samples.medium),
      long: compactSample(samples.long),
      duplicate: compactSample(samples.duplicate)
    };
    report.discovery = samples.discovery || null;
    let missingSample = !samples.long
      ? "当前 ChatGPT 账号缺少 100+ 轮测试对话。"
      : !samples.duplicate
        ? "当前 ChatGPT 账号缺少：同一对话中有两条相同提问的真实样本。"
        : !samples.short
          ? "当前 ChatGPT 账号缺少 12～24 轮测试对话。"
          : !samples.medium
            ? "当前 ChatGPT 账号缺少 30～50 轮测试对话。"
            : null;

    if (!missingSample) {
      report.live.short = await liveNav(cdp, chatTarget, extensionId, samples.short, "short");
      report.live.medium = await liveNav(cdp, chatTarget, extensionId, samples.medium, "medium");
      report.live.long = await liveNav(cdp, chatTarget, extensionId, samples.long, "long");
      report.live.duplicate = await liveDuplicate(cdp, chatTarget, samples.duplicate);
      report.live.cancel = await liveCancel(cdp, chatTarget, samples.long);
    } else {
      const smokeIds = [...new Set([...(samples.personalIds || []), samples.best?.conversationId, samples.fallback?.conversationId].filter(Boolean))];
      let smokeError = null;
      for (const conversationId of smokeIds) {
        const liveTarget = await createChatTarget(cdp);
        try {
          report.live.smoke = await liveSmoke(cdp, liveTarget, { conversationId, turnCount: 0, userIds: [] });
          smokeError = null;
          break;
        } catch (error) {
          smokeError = error;
        }
      }
      if (smokeError) throw smokeError;
    }

    for (const id of samples.personalIds || []) {
      const summary = await readSummary(cdp, chatTarget, id);
      if (!summary) continue;
      absorbSample(samples, summary);
    }
    report.samples = {
      short: compactSample(samples.short),
      medium: compactSample(samples.medium),
      long: compactSample(samples.long),
      duplicate: compactSample(samples.duplicate)
    };
    if (!samples.long) missingSample = "当前 ChatGPT 账号缺少 100+ 轮测试对话。";
    else if (!samples.duplicate) missingSample = "当前 ChatGPT 账号缺少：同一对话中有两条相同提问的真实样本。";
    else if (!samples.short) missingSample = "当前 ChatGPT 账号缺少 12～24 轮测试对话。";
    else if (!samples.medium) missingSample = "当前 ChatGPT 账号缺少 30～50 轮测试对话。";
    else missingSample = null;

    if (!missingSample && !report.live.long) {
      report.live.short = await liveNav(cdp, chatTarget, extensionId, samples.short, "short");
      report.live.medium = await liveNav(cdp, chatTarget, extensionId, samples.medium, "medium");
      report.live.long = await liveNav(cdp, chatTarget, extensionId, samples.long, "long");
      report.live.duplicate = await liveDuplicate(cdp, chatTarget, samples.duplicate);
      report.live.cancel = await liveCancel(cdp, chatTarget, samples.long);
    }

    report.quota = await liveQuota(cdp, chatTarget);
    const popup = await livePopup(cdp, extensionId);
    report.popup = popup.ui;
    report.privacy = popup.privacy;

    if (missingSample) throw new SetupRequired(missingSample);
    report.overall = "PASS";
  } catch (error) {
    const status = error.status === "SETUP_REQUIRED" || error.status === "BUSY" ? error.status : "FAIL";
    report.overall = status;
    report.error = error.message;
    return await finalize(cdp, report, finish, extensionId, temporaryLoaded, status, error.message);
  }
  return finalize(cdp, report, finish, extensionId, temporaryLoaded, "PASS");
}

function flattenStorage(storage) {
  const raw = storage?.data ?? storage?.items ?? storage ?? {};
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value && typeof value === "object" && "value" in value ? value.value : value]));
}

function compactSample(sample) {
  if (!sample) return null;
  return {
    conversationId: sample.conversationId,
    update_time: sample.updateTime,
    turnCount: sample.turnCount,
    sampleType: sample.sampleType,
    hash: sample.duplicate?.hash ?? null
  };
}

async function finalize(cdp, report, finish, extensionId, temporaryLoaded, status, message) {
  try {
    for (const id of createdTargetIds) {
      if (originalTargetIds.has(id)) continue;
      await cdp?.closeTarget(id).catch(() => undefined);
    }
    if (temporaryLoaded && extensionId) {
      await cdp?.call("Extensions.uninstall", { id: extensionId }).catch(() => undefined);
    }
  } finally {
    cdp?.close();
  }
  run("npm", ["run", "build"]);
  const zipName = status === "PASS" ? `ChatGPT-Yada-v${version}-dist_chrome.zip` : `ChatGPT-Yada-v${version}-UNVERIFIED.zip`;
  if (status === "PASS") {
    const unverified = resolve(root, `ChatGPT-Yada-v${version}-UNVERIFIED.zip`);
    if (existsSync(unverified)) rmSync(unverified);
  }
  const zipped = zipDist({ projectRoot: root, zipName });
  const compared = zipMatchesDist(root, zipName);
  report.zip = { path: zipped.zipPath, sha256: zipped.sha256, distMatchesZip: compared.matches };
  if (status === "PASS" && !compared.matches) {
    report.overall = "FAIL";
    return finish("FAIL", `ZIP 与 dist_chrome 不一致: ${compared.mismatches.join(", ")}`);
  }
  report.overall = status;
  return finish(status, message);
}

async function loadYada(cdp, path) {
  let list;
  try {
    list = await cdp.call("Extensions.getExtensions");
  } catch {
    list = null;
  }
  const extensions = Array.isArray(list) ? list : list?.extensions ?? [];
  const existing = extensions.find((item) => item.name === "ChatGPT Yada" || item.path === path);
  if (existing) {
    if (existing.version && existing.version !== "4.0.0") {
      throw new SetupRequired("会议浏览器已加载其他版本的 ChatGPT Yada，无法自动用本轮 4.0.0 替换。");
    }
    return { id: existing.id, name: existing.name || "ChatGPT Yada", version: existing.version || "4.0.0", temporaryLoaded: false, path: existing.path };
  }
  try {
    const loaded = await cdp.call("Extensions.loadUnpacked", { path });
    const id = loaded.id || loaded.extensionId || loaded;
    return { id, name: "ChatGPT Yada", version: "4.0.0", temporaryLoaded: true, path };
  } catch (error) {
    const fallback = await findLoadedYada(cdp);
    if (fallback) return fallback;
    throw new SetupRequired(`会议浏览器扩展调试协议不可用，无法自动加载 Yada。${error.message || ""}`.trim());
  }
}

async function findLoadedYada(cdp) {
  const targets = await cdp.listTargets();
  const sw = targets.find((item) => String(item.url || "").startsWith("chrome-extension://") && String(item.url).includes("/background.js"));
  if (!sw) return null;
  const id = String(sw.url).slice("chrome-extension://".length).split("/")[0];
  const manifestId = await cdp.createTarget(`chrome-extension://${id}/manifest.json`);
  createdTargetIds.add(manifestId);
  await cdp.attach(manifestId);
  const manifest = await cdp.evaluate(manifestId, `(() => {
    const text = document.body && document.body.innerText || "";
    try { return JSON.parse(text); } catch { return { name: document.title, version: null, raw: text.slice(0, 200) }; }
  })()`, { awaitPromise: false }).catch(() => null);
  if (!manifest || manifest.name !== "ChatGPT Yada") return null;
  if (manifest.version !== "4.0.0") {
    throw new SetupRequired("会议浏览器已加载其他版本的 ChatGPT Yada，无法自动用本轮 4.0.0 替换。");
  }
  return { id, name: manifest.name, version: manifest.version, temporaryLoaded: false, path: null };
}

function absorbSample(found, summary) {
  if (!summary || summary.isWork || summary.temporary) return false;
  if (!found.best || summary.turnCount > found.best.turnCount) found.best = summary;
  const type = sampleTypeFor(summary.turnCount);
  if (type && !found[type]) found[type] = { ...summary, sampleType: type };
  if (summary.duplicate && !found.duplicate) found.duplicate = { ...summary, sampleType: "duplicate" };
  return Boolean(found.short && found.medium && found.long && found.duplicate);
}

async function discoverSamples(cdp, targetId) {
  const queued = [];
  for (const archived of [false, true]) {
    for (let page = 0; page < 4; page++) {
      const items = await evaluateFn(cdp, targetId, LIST_ITEMS, { archived, offset: page * 50 });
      if (!Array.isArray(items) || !items.length) break;
      queued.push(...items);
    }
  }
  const personal = [];
  const usable = [];
  for (const item of queued) {
    const origin = typeof item.origin === "string" ? item.origin : "";
    if (["tpp", "flora", "codex"].includes(origin.toLowerCase()) || item.temporary === true) continue;
    if (typeof item.id !== "string") continue;
    usable.push(item);
    if (!item.gizmo) personal.push(item);
  }
  const smokeItem = personal[0] || usable[0];
  const found = {
    short: null,
    medium: null,
    long: null,
    duplicate: null,
    best: smokeItem
      ? { conversationId: smokeItem.id, updateTime: smokeItem.updateTime, turnCount: 0, sampleType: "best", userIds: [] }
      : null,
    fallback: smokeItem
      ? { conversationId: smokeItem.id, updateTime: smokeItem.updateTime, turnCount: 0, sampleType: "fallback", userIds: [] }
      : null,
    discovery: { listed: queued.length, personal: personal.length, gizmos: usable.length - personal.length },
    personalIds: personal.map((item) => item.id)
  };
  writeRegistry(found);
  return found;
}

async function readSummary(cdp, targetId, id) {
  return evaluateFn(cdp, targetId, READ_SUMMARY, id);
}

function writeRegistry(found) {
  mkdirSync(resolve(root, "artifacts/candidate"), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify({
    samples: {
      short: compactSample(found.short),
      medium: compactSample(found.medium),
      long: compactSample(found.long),
      duplicate: compactSample(found.duplicate),
      best: compactSample(found.best ? { ...found.best, sampleType: found.best.sampleType || "best" } : null)
    }
  }, null, 2)}\n`);
}

async function openConversation(cdp, targetId, conversationId) {
  const dest = `https://chatgpt.com/c/${conversationId}`;
  const href = await evaluateFn(cdp, targetId, `() => location.href`).catch(() => "");
  if (!String(href).includes("chatgpt.com")) {
    await cdp.navigate(targetId, "https://chatgpt.com/");
    await waitFor(cdp, targetId, `() => location.hostname.includes("chatgpt.com") && document.readyState === "complete"`, "ChatGPT home did not load", 20000);
  }
  await cdp.evaluate(targetId, `location.assign(${JSON.stringify(dest)})`, { awaitPromise: false }).catch(() => undefined);
  await waitFor(
    cdp,
    targetId,
    `() => location.pathname.includes(${JSON.stringify(`/c/${conversationId}`)}) && document.readyState === "complete"`,
    "ChatGPT conversation page did not load",
    30000
  );
  await waitFor(
    cdp,
    targetId,
    `() => document.getElementById("chatgpt-yada-rail-host")`,
    "Yada rail did not mount",
    20000
  );
  const usersReady = await waitFor(
    cdp,
    targetId,
    `() => document.querySelectorAll('[data-message-author-role="user"][data-message-id]').length > 0`,
    "ChatGPT did not render user turns",
    30000
  ).catch(async (error) => {
    const diag = await evaluateFn(cdp, targetId, `() => ({
      href: location.href,
      users: document.querySelectorAll('[data-message-author-role="user"][data-message-id]').length,
      roles: document.querySelectorAll("[data-message-author-role]").length,
      rail: Boolean(document.getElementById("chatgpt-yada-rail-host")),
      text: (document.body && document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 180)
    })`).catch(() => null);
    throw new Error(`${error.message}: ${JSON.stringify(diag)}`);
  });
  if (!usersReady) throw new Error("ChatGPT did not render user turns");
  await waitFor(
    cdp,
    targetId,
    `() => document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelectorAll("button.mark").length > 0`,
    "ConversationSync did not fill the rail",
    30000
  );
}

async function liveSmoke(cdp, targetId, sample) {
  await openConversation(cdp, targetId, sample.conversationId);
  const railCount = await evaluateFn(cdp, targetId, `() => document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelectorAll("button.mark").length ?? 0`);
  if (railCount < 1) throw new Error("smoke: rail did not render any turns");
  if (sample.turnCount > 0 && railCount !== sample.turnCount) {
    throw new Error(`smoke: API turns ${sample.turnCount} != rail ${railCount}`);
  }
  await evaluateFn(cdp, targetId, `(index) => document.getElementById("chatgpt-yada-rail-host").shadowRoot.querySelectorAll("button.mark")[index].click()`, railCount - 1);
  await sleep(1200);
  const visible = await evaluateFn(cdp, targetId, `() => {
    const status = document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[role="status"]')?.textContent || "";
    const users = [...document.querySelectorAll('[data-message-author-role="user"][data-message-id]')];
    const inView = users.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > 80 && rect.top < innerHeight - 40;
    });
    return { ok: Boolean(inView) && status !== "定位失败", status, userId: inView && inView.dataset ? inView.dataset.messageId : null };
  }`);
  if (!visible?.ok) throw new Error(`smoke jump failed: ${JSON.stringify(visible)}`);
  return { ok: true, railCount, turnCount: sample.turnCount || railCount };
}

async function liveNav(cdp, targetId, _extensionId, sample, kind) {
  await openConversation(cdp, targetId, sample.conversationId);
  const railCount = await evaluateFn(cdp, targetId, `() => document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelectorAll("button.mark").length ?? 0`);
  if (railCount !== sample.turnCount) throw new Error(`${kind}: API turns ${sample.turnCount} != rail ${railCount}`);
  const result = { ok: true, railCount, clicks: [] };
  if (kind !== "long") return result;
  const indexes = [0, Math.floor((sample.userIds.length - 1) / 2), sample.userIds.length - 1];
  for (const index of indexes) {
    const userId = sample.userIds[index];
    await evaluateFn(cdp, targetId, `(index) => document.getElementById("chatgpt-yada-rail-host").shadowRoot.querySelectorAll("button.mark")[index].click()`, index);
    await sleep(1200);
    const check = await evaluateFn(cdp, targetId, `(id) => {
      const node = document.querySelector('[data-message-id="' + id + '"]');
      const status = document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[role="status"]')?.textContent || "";
      const active = document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[data-active="true"]');
      const activeIndex = active ? Number(active.dataset.index) : -1;
      if (!node) return { ok: false, reason: "not-rendered", status };
      const rect = node.getBoundingClientRect();
      const inView = rect.bottom > 80 && rect.top < innerHeight - 40;
      return { ok: inView && status !== "定位失败", inView, status, activeIndex, id };
    }`, userId);
    await sleep(1000);
    const again = await evaluateFn(cdp, targetId, `(id) => {
      const node = document.querySelector('[data-message-id="' + id + '"]');
      if (!node) return { ok: false };
      const rect = node.getBoundingClientRect();
      return { ok: rect.bottom > 80 && rect.top < innerHeight - 40, top: rect.top };
    }`, userId);
    if (!check?.ok || !again?.ok) throw new Error(`${kind} jump failed at ${index}: ${JSON.stringify({ check, again })}`);
    result.clicks.push({ index, userId, activeIndex: check.activeIndex });
  }
  return result;
}

async function liveDuplicate(cdp, targetId, sample) {
  await openConversation(cdp, targetId, sample.conversationId);
  const ids = [sample.duplicate.a, sample.duplicate.b];
  const landed = [];
  for (const id of ids) {
    const index = sample.userIds.indexOf(id);
    if (index < 0) throw new Error("duplicate sample missing user id");
    await evaluateFn(cdp, targetId, `(index) => document.getElementById("chatgpt-yada-rail-host").shadowRoot.querySelectorAll("button.mark")[index].click()`, index);
    await sleep(1200);
    const visible = await evaluateFn(cdp, targetId, `(id) => {
      const node = document.querySelector('[data-message-id="' + id + '"]');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return rect.bottom > 80 && rect.top < innerHeight - 40 ? id : null;
    }`, id);
    if (visible !== id) throw new Error(`duplicate click did not land on ${id}`);
    landed.push(id);
  }
  if (landed[0] === landed[1]) throw new Error("duplicate clicks landed on the same message");
  return { ok: true, landed };
}

async function liveCancel(cdp, targetId, sample) {
  await openConversation(cdp, targetId, sample.conversationId);
  await evaluateFn(cdp, targetId, `() => document.getElementById("chatgpt-yada-rail-host").shadowRoot.querySelectorAll("button.mark")[0].click()`);
  await sleep(80);
  await evaluateFn(cdp, targetId, `() => window.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }))`);
  await sleep(400);
  const status = await evaluateFn(cdp, targetId, `() => document.getElementById("chatgpt-yada-rail-host")?.shadowRoot?.querySelector('[role="status"]')?.textContent || ""`);
  const first = await evaluateFn(cdp, targetId, scrollTopExpr());
  await sleep(1500);
  const second = await evaluateFn(cdp, targetId, scrollTopExpr());
  if (status === "定位失败") throw new Error("cancel showed 定位失败");
  if (Math.abs((second ?? 0) - (first ?? 0)) > 24) throw new Error(`scroll continued after cancel: ${first} -> ${second}`);
  return { ok: true, cancelled: true, status, scrollTop: second };
}

function scrollTopExpr() {
  return `() => {
    const nodes = [...document.querySelectorAll("div, main, section")];
    const scroll = nodes.find((node) => node.scrollHeight > node.clientHeight + 200 && getComputedStyle(node).overflowY !== "visible");
    return scroll ? Math.round(scroll.scrollTop) : Math.round(window.scrollY);
  }`;
}

async function liveQuota(cdp, targetId) {
  await cdp.navigate(targetId, "https://chatgpt.com/");
  await waitFor(cdp, targetId, `() => location.hostname.includes("chatgpt.com")`, "chatgpt home");
  const usage = await evaluateFn(cdp, targetId, `async () => {
    const result = await (${PAGE_FETCH})("/backend-api/wham/usage");
    const plan = result.data && typeof result.data.plan_type === "string" ? result.data.plan_type : null;
    return { ok: result.ok, plan };
  }`);
  const init = await evaluateFn(cdp, targetId, `async () => {
    const result = await (${PAGE_FETCH})("/backend-api/conversation/init", {
      conversation_id: null,
      gizmo_id: null,
      requested_default_model: null,
      system_hints: [],
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezone_offset_min: -Math.round(new Date().getTimezoneOffset())
    });
    const rows = Array.isArray(result.data && result.data.model_limits) ? result.data.model_limits : [];
    return { ok: result.ok, models: rows.map((row) => row && row.model_slug).filter(Boolean) };
  }`);
  const deadline = Date.now() + 26_000;
  let ledger = { historyComplete: false, classifiedTurns: 0, unclassifiedTurns: 0 };
  while (Date.now() < deadline) {
    ledger = await evaluateFn(cdp, targetId, `async () => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
      const data = await chrome.storage.local.get(["chatgpt-yada:quota-state:v2", "chatgpt-yada:quota-ledger:v2"]);
      const state = data["chatgpt-yada:quota-state:v2"] || {};
      const events = data["chatgpt-yada:quota-ledger:v2"]?.events;
      return {
        historyComplete: state.historyComplete === true,
        classifiedTurns: Array.isArray(events) ? events.length : 0,
        unclassifiedTurns: state.unclassifiedTurns ?? 0
      };
    }`).catch(() => null) || ledger;
    if (ledger && (ledger.historyComplete || ledger.classifiedTurns > 0)) break;
    await sleep(500);
  }
  const plan = usage?.plan === "pro" || usage?.plan === "prolite" ? usage.plan : usage?.plan ? "other" : null;
  return {
    plan,
    historyStatus: ledger.historyComplete ? "complete" : "incomplete",
    classifiedTurns: ledger.classifiedTurns,
    unclassifiedTurns: ledger.unclassifiedTurns,
    modelLimitsOk: Boolean(init?.ok || init?.models),
    knownProSlugs: ["gpt-6-pro", "gpt-5-6-pro"]
  };
}

async function livePopup(cdp, extensionId) {
  const popupId = await cdp.createTarget(`chrome-extension://${extensionId}/popup.html`);
  createdTargetIds.add(popupId);
  await cdp.attach(popupId);
  await waitFor(cdp, popupId, `() => Boolean(document.getElementById("app")?.textContent)`, "popup did not render", 15000);
  const ui = await evaluateFn(cdp, popupId, `() => {
    const text = document.getElementById("app")?.innerText || "";
    return {
      remaining: text.includes("预计剩余"),
      personal: text.includes("只统计个人 Chat"),
      work: text.includes("不统计 Work 和 Codex"),
      rings: Boolean(document.querySelector("canvas")),
      text
    };
  }`);
  if (!ui.remaining || !ui.personal || !ui.work || !ui.rings) throw new Error(`popup missing required copy: ${JSON.stringify(ui)}`);
  let storage = {};
  try {
    storage = await cdp.call("Extensions.getStorageItems", { id: extensionId, storageArea: "local" });
  } catch {
    storage = await cdp.evaluate(popupId, "(async () => chrome.storage.local.get(null))()");
  }
  const values = flattenStorage(storage);
  const promptKey = "chatgpt-yada:prompt-library:v1";
  const scanned = Object.fromEntries(Object.entries(values).filter(([key]) => key !== promptKey && !key.includes("prompt-library")));
  const blob = JSON.stringify(scanned).toLowerCase();
  const leak = ["usermarkdown", "assistantmarkdown", "accesstoken", "authorization", "cookie", "prompt text", "response text", "content body"]
    .filter((item) => blob.includes(item));
  if (leak.length) throw new Error(`quota storage leaked ${leak.join(",")}`);
  if (blob.includes("current_node") || blob.includes("\"mapping\"")) throw new Error("quota storage contains full conversation JSON");
  return {
    ui: { remaining: ui.remaining, personal: ui.personal, work: ui.work, rings: ui.rings },
    privacy: { ok: true, scannedKeys: Object.keys(scanned) }
  };
}

const code = await main();
process.exit(code);
