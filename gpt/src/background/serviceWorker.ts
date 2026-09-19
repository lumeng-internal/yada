import { QuotaLedger } from "../quota/ledger";
import { applyQuotaIcon, nextAlarmAt } from "../quota/iconState";
import { calculateQuotaSnapshot } from "../quota/calculator";
import { STATE_KEY, type QuotaSnapshot } from "../quota/types";
import type { QuotaGetState, QuotaIngest, YadaRequest } from "../shared/messages";
import { REFRESH_TIMEOUT_MS } from "../shared/messages";
import { withTimeout } from "../shared/timeout";

const ALARM_NAME = "chatgpt-yada-quota-window";
const ledger = new QuotaLedger();

chrome.runtime.onInstalled.addListener(() => { void restore(); });
chrome.runtime.onStartup.addListener(() => { void restore(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes["chatgpt-yada:quota-ledger:v2"] || changes[STATE_KEY]) void restore();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void restore();
});
chrome.runtime.onMessage.addListener((message: YadaRequest, _sender, sendResponse) => {
  void handle(message).then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
  return true;
});

async function handle(message: YadaRequest): Promise<unknown> {
  if (message.type === "quota/ingest") return ingest(message);
  if (message.type === "quota/get-state") return getState(message);
  if (message.type === "quota/refresh-current") {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId == null) throw new Error("没有可刷新的 ChatGPT 标签页");
    const result = await withTimeout(
      Promise.resolve(chrome.tabs.sendMessage(tabId, message)),
      REFRESH_TIMEOUT_MS,
      "刷新超时，后台未响应"
    ) as { ok?: boolean; error?: string } | undefined;
    if (result?.error) throw new Error(result.error);
    return getState({ type: "quota/get-state" });
  }
  return { error: "unknown-message" };
}

async function ingest(message: QuotaIngest): Promise<{ snapshot: QuotaSnapshot | null }> {
  const snapshot = await ledger.ingest(message.events, {
    plan: message.plan,
    historyComplete: message.historyComplete,
    unclassifiedTurns: message.unclassifiedTurns,
    limits: message.limits,
    workspaceKind: message.workspaceKind,
    accountKey: message.accountKey
  });
  if (snapshot) await publish(snapshot);
  return { snapshot };
}

async function getState(message: QuotaGetState): Promise<{ snapshot: QuotaSnapshot }> {
  const restored = await ledger.restore();
  const accountKey = message.accountKey ?? restored.state.accountKey ?? restored.state.lastSnapshot?.accountKey ?? "chat-unknown";
  const snapshot = calculateQuotaSnapshot({
    accountKey,
    plan: message.plan ?? restored.state.plan,
    workspaceKind: restored.state.lastSnapshot?.workspaceKind ?? "personal",
    events: restored.ledger.events,
    historyComplete: restored.state.historyComplete,
    unclassifiedTurns: restored.state.unclassifiedTurns,
    writeError: restored.state.writeError
  });
  await publish(snapshot);
  return { snapshot };
}

async function restore(): Promise<void> {
  const restored = await ledger.restore();
  const last = restored.state.lastSnapshot;
  const snapshot = calculateQuotaSnapshot({
    accountKey: last?.accountKey ?? restored.state.accountKey ?? "chat-unknown",
    plan: restored.state.plan,
    workspaceKind: last?.workspaceKind ?? "personal",
    events: restored.ledger.events,
    historyComplete: restored.state.historyComplete,
    unclassifiedTurns: restored.state.unclassifiedTurns,
    writeError: restored.state.writeError
  });
  await publish(snapshot);
}

async function publish(snapshot: QuotaSnapshot): Promise<void> {
  await applyQuotaIcon(snapshot);
  const when = nextAlarmAt(snapshot);
  if (when) await chrome.alarms.create(ALARM_NAME, { when });
  try {
    await chrome.runtime.sendMessage({ type: "quota/storage-changed", snapshot });
  } catch {
    // popup may be closed
  }
}
