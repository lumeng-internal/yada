import type { ConversationSync } from "../core/conversationSync";
import type { ConversationSnapshot } from "../core/types";
import { chatgptApi, fetchConversation } from "../conversation/fetchConversation";
import { MESSAGE_TIMEOUT_MS, REFRESH_TIMEOUT_MS, sendRuntimeMessage } from "../shared/messages";
import { withTimeout } from "../shared/timeout";
import { readChatAccount, readModelLimits, type ChatAccount } from "./pageClient";
import type { QuotaClassification, QuotaSyncStatus, QuotaUsageEvent } from "./types";
import { createChromeHistoryStore, readChatHistory } from "./vibebar/historyReader";
import type { ChatGPTChatHistorySummary, ChatGPTChatTurn } from "./vibebar/types";

const FIRST_HISTORY_DELAY_MS = 4_000;
const NEXT_HISTORY_SLICE_DELAY_MS = 1_500;
const MAX_HISTORY_PASSES = 20;

export class QuotaTracker {
  private unsubscribe: (() => void) | null = null;
  private ingestQueue: Promise<void> = Promise.resolve();
  private readonly history = createChromeHistoryStore();
  private disposed = false;
  private historyFlight: Promise<void> | null = null;
  private historyTimer = 0;
  private historyAbort: AbortController | null = null;
  private historyIdentity: string | null = null;
  private historyPass = 0;
  private historyStopped = false;
  private historyResumePending = false;
  private lastAccount: ChatAccount | null = null;

  constructor(private readonly sync: ConversationSync) {}

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
    document.addEventListener("visibilitychange", this.onVisibility);
    this.scheduleHistory(FIRST_HISTORY_DELAY_MS);
  }

  async refreshCurrent(): Promise<void> {
    await withTimeout(this.sync.requestSync("popup"), REFRESH_TIMEOUT_MS, "同步超时");
    await withTimeout(this.ingestQueue, MESSAGE_TIMEOUT_MS, "账本写入超时");
    this.historyStopped = false;
    this.historyResumePending = false;
    this.scheduleHistory(0);
  }

  dispose(): void {
    this.disposed = true;
    this.historyAbort?.abort();
    this.historyAbort = null;
    this.historyResumePending = false;
    window.clearTimeout(this.historyTimer);
    this.historyTimer = 0;
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onSnapshot(snapshot: ConversationSnapshot | null): Promise<void> {
    const work = this.writeLedger(snapshot);
    this.ingestQueue = this.ingestQueue.then(() => work, () => work);
    if (snapshot && !this.historyStopped) this.scheduleHistory(600);
    return work;
  }

  private scheduleHistory(delayMs: number): void {
    if (this.disposed || this.historyStopped || this.historyFlight || document.visibilityState === "hidden") return;
    window.clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => {
      this.historyTimer = 0;
      this.startHistoryScan();
    }, Math.max(0, delayMs));
  }

  private startHistoryScan(): void {
    if (this.disposed || this.historyStopped || this.historyFlight || document.visibilityState === "hidden") return;
    const controller = new AbortController();
    this.historyAbort = controller;
    this.historyFlight = this.scanHistory(controller.signal)
      .catch((error) => this.handleHistoryError(error, controller.signal))
      .finally(() => {
        if (this.historyAbort === controller) this.historyAbort = null;
        this.historyFlight = null;
        if (this.historyResumePending) {
          this.historyResumePending = false;
          this.scheduleHistory(NEXT_HISTORY_SLICE_DELAY_MS);
        }
      });
  }

  private async scanHistory(signal: AbortSignal): Promise<void> {
    const account = await readChatAccount(signal);
    if (signal.aborted || this.disposed) return;
    this.lastAccount = account;
    if (this.historyIdentity !== account.identity) {
      this.historyIdentity = account.identity;
      this.historyPass = 0;
      this.historyStopped = false;
      this.historyResumePending = false;
    }
    this.historyPass += 1;
    await this.publishHistoryState(account, [], "backfill", false, 0, null);

    const result = await readChatHistory({
      transport: {
        async request(path, requestSignal) {
          const response = await chatgptApi(path, { signal: requestSignal });
          if (response.status === 401 || response.status === 403) {
            throw Object.assign(new Error("login"), { name: "AbortError" });
          }
          if (!response.ok) throw new Error(`history ${response.status}`);
          return response.json();
        }
      },
      fetchDetail: (id, requestSignal) => fetchConversation(id, requestSignal),
      store: this.history,
      identity: account.identity,
      now: Date.now(),
      signal
    });
    if (signal.aborted || this.disposed) return;
    if (result.summary.cancelled) throw new Error("login");

    const resumable = historyNeedsAnotherPass(result.summary) && this.historyPass < MAX_HISTORY_PASSES;
    const status: QuotaSyncStatus = result.summary.complete
      ? "ready"
      : resumable
        ? "backfill"
        : "partial";
    await this.publishHistoryState(
      account,
      result.turns,
      status,
      result.summary.complete,
      result.summary.unclassifiedTurns,
      null
    );
    if (resumable) this.historyResumePending = true;
    else this.historyStopped = true;
  }

  private async handleHistoryError(error: unknown, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.disposed) return;
    this.historyStopped = true;
    this.historyResumePending = false;
    const account = this.lastAccount;
    if (!account) return;
    const message = conciseError(error);
    await this.publishHistoryState(account, [], "error", false, 0, message).catch(() => undefined);
  }

  private async publishHistoryState(
    account: ChatAccount,
    turns: readonly ChatGPTChatTurn[],
    syncStatus: QuotaSyncStatus,
    historyComplete: boolean,
    unclassifiedTurns: number,
    historyError: string | null
  ): Promise<void> {
    const events = toEvents(turns, account.identity, "personal");
    await sendRuntimeMessage({
      type: "quota/ingest",
      events,
      plan: account.plan,
      unclassifiedTurns,
      historyComplete,
      syncStatus,
      historyError,
      workspaceKind: "personal",
      accountKey: account.identity
    });
  }

  private async writeLedger(snapshot: ConversationSnapshot | null): Promise<void> {
    if (this.disposed || !snapshot) return;
    const account = await readChatAccount();
    this.lastAccount = account;
    const limits = await readModelLimits();
    const classification = classifySnapshot(snapshot);
    const events = snapshot.quotaIsWork
      ? []
      : toEvents(snapshot.quotaTurns, account.identity, classification);
    await sendRuntimeMessage({
      type: "quota/ingest",
      events,
      plan: account.plan,
      unclassifiedTurns: snapshot.quotaUnclassifiedTurns,
      workspaceKind: snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal",
      limits,
      historyComplete: undefined,
      accountKey: account.identity
    });
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      this.historyAbort?.abort();
      window.clearTimeout(this.historyTimer);
      this.historyTimer = 0;
      return;
    }
    if (!this.historyStopped) {
      if (this.historyFlight) this.historyResumePending = true;
      else this.scheduleHistory(RECOVERY_DELAY_MS);
    }
  };
}

const RECOVERY_DELAY_MS = 600;

function classifySnapshot(snapshot: ConversationSnapshot): QuotaClassification {
  if (snapshot.quotaIsWork) return "work";
  if (snapshot.quotaTemporary) return "temporary";
  if (snapshot.quotaOrigin && snapshot.quotaOrigin !== "chat" && snapshot.quotaOrigin !== "chatgpt") return "unknown";
  return "personal";
}

function toEvents(
  turns: readonly ChatGPTChatTurn[],
  accountKey: string,
  classification: QuotaClassification
): QuotaUsageEvent[] {
  return turns.map((turn) => ({
    id: turn.id,
    accountKey,
    createdAt: turn.createdAt,
    model: turn.model,
    classification
  }));
}

function conciseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/login/i.test(message)) return "ChatGPT 登录状态不可用";
  if (/timeout|timed out|超时/i.test(message)) return "历史读取超时";
  if (/history \d+/.test(message)) return "历史接口暂不可用";
  return "历史读取失败";
}

export function historyNeedsAnotherPass(summary: ChatGPTChatHistorySummary): boolean {
  return !summary.complete && !summary.cancelled && (summary.hitDetailBudget || summary.hitDeadline);
}
