import { QuotaLedger } from "../quota/ledger";
import { applyQuotaIcon, nextAlarmAt } from "../quota/iconState";
import { calculateQuotaSnapshot } from "../quota/calculator";
import { BACKFILL_KEY, type BackfillStatus, type QuotaBackfillState, type QuotaSnapshot, type WorkspaceKind } from "../quota/types";
import type { QuotaGetState, QuotaIngest, YadaRequest } from "../shared/messages";

const ALARM_NAME = "chatgpt-yada-quota-window";
const ledger = new QuotaLedger();

chrome.runtime.onInstalled.addListener(() => { void restore(); });
chrome.runtime.onStartup.addListener(() => { void restore(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes["chatgpt-yada:quota-ledger:v1"] || changes["chatgpt-yada:quota-state:v1"] || changes[BACKFILL_KEY]) {
    void restore();
  }
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
    if (tabId != null) await chrome.tabs.sendMessage(tabId, message);
    return getState({ type: "quota/get-state" });
  }
  if (message.type === "quota/backfill-status") {
    const backfill = await readBackfill();
    return { status: backfill.status, scannedCount: Object.keys(backfill.scanned).length };
  }
  if (message.type === "quota/backfill-progress") return getState({ type: "quota/get-state" });
  return { error: "unknown-message" };
}

async function ingest(message: QuotaIngest): Promise<{ snapshot: QuotaSnapshot | null }> {
  const snapshot = await ledger.ingest(message.events);
  if (snapshot) await publish(snapshot);
  return { snapshot };
}

async function getState(message: QuotaGetState): Promise<{ snapshot: QuotaSnapshot }> {
  const restored = await ledger.restore();
  const accountKey = message.accountKey ?? restored.state.lastSnapshot?.accountKey ?? "account-unknown:unknown";
  const workspaceKind: WorkspaceKind = message.workspaceKind ?? restored.state.lastSnapshot?.workspaceKind ?? "unknown";
  const backfill = await readBackfill();
  const snapshot = calculateQuotaSnapshot({
    accountKey,
    workspaceKind,
    events: restored.ledger.events,
    liveStartedAt: restored.state.liveStartedAt[accountKey],
    lastLiveAt: restored.state.lastLiveAt[accountKey],
    writeError: restored.state.writeError,
    backfillStatus: backfill.status
  });
  await publish(snapshot);
  return { snapshot };
}

async function restore(): Promise<void> {
  const restored = await ledger.restore();
  const last = restored.state.lastSnapshot;
  const accountKey = last?.accountKey ?? Object.keys(restored.state.liveStartedAt)[0] ?? "account-unknown:unknown";
  const backfill = await readBackfill();
  const snapshot = calculateQuotaSnapshot({
    accountKey,
    workspaceKind: last?.workspaceKind ?? "unknown",
    events: restored.ledger.events,
    liveStartedAt: restored.state.liveStartedAt[accountKey],
    lastLiveAt: restored.state.lastLiveAt[accountKey],
    writeError: restored.state.writeError,
    backfillStatus: backfill.status
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

async function readBackfill(): Promise<QuotaBackfillState> {
  const data = await chrome.storage.local.get(BACKFILL_KEY);
  const value = data[BACKFILL_KEY] as QuotaBackfillState | undefined;
  if (!value || value.version !== 1) {
    return { version: 1, status: "idle" as BackfillStatus, cutoffAt: 0, scanned: {}, cursorOffset: 0, updatedAt: 0 };
  }
  return value;
}
