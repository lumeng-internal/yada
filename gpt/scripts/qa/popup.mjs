import { evaluateFn } from "../lib/cdp.mjs";
import { waitUntil } from "./runner.mjs";

function flattenStorage(storage) {
  const raw = storage?.data ?? storage?.items ?? storage ?? {};
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value && typeof value === "object" && "value" in value ? value.value : value]));
}

export async function livePopup(cdp, extensionId, createdTargetIds) {
  const popupId = await cdp.createTarget(`chrome-extension://${extensionId}/popup.html`);
  createdTargetIds.add(popupId);
  await cdp.attach(popupId);
  const state = await waitUntil(async () => {
    const current = await evaluateFn(cdp, popupId, `() => document.getElementById("app")?.dataset?.state || ""`);
    return current === "ready" || current === "error" ? current : null;
  }, 15_000, "popup timeout");
  if (state === "error") {
    const text = await evaluateFn(cdp, popupId, `() => document.getElementById("app")?.innerText || ""`);
    throw new Error(`popup error: ${text}`);
  }
  const ui = await evaluateFn(cdp, popupId, `() => {
    const root = document.getElementById("app");
    const text = root?.innerText || "";
    return {
      state: root?.dataset?.state || "",
      remaining: text.includes("预计剩余"),
      personal: text.includes("只统计个人 Chat"),
      work: text.includes("不统计 Work 和 Codex"),
      rings: Boolean(document.querySelector("canvas"))
    };
  }`);
  if (ui.state !== "ready" || !ui.remaining || !ui.personal || !ui.work || !ui.rings) {
    throw new Error(`popup missing required copy: ${JSON.stringify(ui)}`);
  }
  return { status: "PASS", popupId, state: "ready", remaining: ui.remaining, personal: ui.personal, work: ui.work, rings: ui.rings };
}

export async function livePrivacy(cdp, extensionId, popupTargetId) {
  let storage = {};
  try {
    storage = await cdp.call("Extensions.getStorageItems", { id: extensionId, storageArea: "local" });
  } catch {
    if (popupTargetId) {
      storage = await cdp.evaluate(popupTargetId, "(async () => chrome.storage.local.get(null))()");
    }
  }
  const values = flattenStorage(storage);
  const promptKey = "chatgpt-yada:prompt-library:v1";
  const scanned = Object.fromEntries(Object.entries(values).filter(([key]) => key !== promptKey && !key.includes("prompt-library")));
  const blob = JSON.stringify(scanned).toLowerCase();
  const leak = ["usermarkdown", "assistantmarkdown", "accesstoken", "authorization", "cookie", "prompt text", "response text", "content body"]
    .filter((item) => blob.includes(item));
  if (leak.length) throw new Error(`quota storage leaked ${leak.join(",")}`);
  if (blob.includes("current_node") || blob.includes("\"mapping\"")) throw new Error("quota storage contains full conversation JSON");
  return { status: "PASS", ok: true, scannedKeys: Object.keys(scanned) };
}
