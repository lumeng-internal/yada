import { evaluateFn } from "../lib/cdp.mjs";
import { GateError, waitUntil } from "./runner.mjs";

export async function loadYada(cdp, path, createdTargetIds) {
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
      throw new GateError("SETUP_REQUIRED", "会议浏览器已加载其他版本的 ChatGPT Yada，无法自动用本轮 4.0.0 替换。");
    }
    if (existing.path && existing.path !== path) {
      throw new GateError("SETUP_REQUIRED", "会议浏览器已加载其他路径的 ChatGPT Yada，无法自动用本轮 dist_chrome 替换。");
    }
    try {
      await cdp.call("Extensions.uninstall", { id: existing.id });
    } catch {
      /* reload below */
    }
  }
  try {
    const loaded = await cdp.call("Extensions.loadUnpacked", { path });
    const id = loaded.id || loaded.extensionId || loaded;
    return {
      status: "PASS",
      id,
      name: "ChatGPT Yada",
      version: "4.0.0",
      temporaryLoaded: !existing,
      path
    };
  } catch (error) {
    const fallback = await findLoadedYada(cdp, createdTargetIds);
    if (fallback) return { status: "PASS", ...fallback };
    throw new GateError("SETUP_REQUIRED", `会议浏览器扩展调试协议不可用，无法自动加载 Yada。${error.message || ""}`.trim());
  }
}

async function findLoadedYada(cdp, createdTargetIds) {
  const targets = await cdp.listTargets();
  const workers = targets.filter((item) => String(item.url || "").startsWith("chrome-extension://") && String(item.url).includes("/background.js"));
  for (const sw of workers) {
    const id = String(sw.url).slice("chrome-extension://".length).split("/")[0];
    const manifestId = await cdp.createTarget(`chrome-extension://${id}/manifest.json`);
    createdTargetIds.add(manifestId);
    await cdp.attach(manifestId);
    const manifest = await cdp.evaluate(manifestId, `(() => {
      const text = document.body && document.body.innerText || "";
      try { return JSON.parse(text); } catch { return { name: document.title, version: null }; }
    })()`, { awaitPromise: false }).catch(() => null);
    await cdp.closeTarget(manifestId).catch(() => undefined);
    createdTargetIds.delete(manifestId);
    if (!manifest || manifest.name !== "ChatGPT Yada") continue;
    if (manifest.version !== "4.0.0") {
      throw new GateError("SETUP_REQUIRED", "会议浏览器已加载其他版本的 ChatGPT Yada，无法自动用本轮 4.0.0 替换。");
    }
    return { id, name: manifest.name, version: manifest.version, temporaryLoaded: false, path: null };
  }
  return null;
}

export async function uninstallTemporary(cdp, extension) {
  if (!extension?.temporaryLoaded || !extension.id) return;
  await cdp.call("Extensions.uninstall", { id: extension.id }).catch(() => undefined);
}

export const SESSION_STATUS = `async () => {
  try {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, loggedIn: Boolean(data && ((data.user && data.user.id) || data.accessToken)) };
  } catch {
    return { ok: false, loggedIn: false };
  }
}`;

export async function openChatHome(cdp, createdTargetIds) {
  const targetId = await cdp.createTarget("https://chatgpt.com/");
  createdTargetIds.add(targetId);
  await cdp.attach(targetId);
  const loggedIn = await waitUntil(async () => {
    const url = await targetUrl(cdp, targetId);
    if (!url.includes("chatgpt.com")) return null;
    const session = await evaluateFn(cdp, targetId, SESSION_STATUS).catch(() => null);
    return session?.loggedIn ? session : null;
  }, 20_000, "ChatGPT login").then(() => true).catch(() => false);
  return { targetId, loggedIn };
}

export async function targetUrl(cdp, targetId) {
  const targets = await cdp.listTargets();
  return String(targets.find((item) => item.targetId === targetId)?.url || "");
}
