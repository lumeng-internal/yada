import type { ConversationSync } from "../core/conversationSync";
import type { ConversationSnapshot } from "../core/types";
import { ChatGPTApiTimeoutError, chatgptApi, fetchConversation } from "../conversation/fetchConversation";
import { MESSAGE_TIMEOUT_MS, REFRESH_TIMEOUT_MS, sendRuntimeMessage, type QuotaIngest } from "../shared/messages";
import { withTimeout } from "../shared/timeout";
import { readChatAccount, readModelLimits, type ChatAccount } from "./pageClient";
import type { QuotaClassification, QuotaSnapshot, QuotaUsageEvent } from "./types";
import { createChromeHistoryStore, readChatHistory, RetryableHistoryTransportError } from "./vibebar/historyReader";
import type { ChatGPTChatHistorySummary, ChatGPTChatTurn } from "./vibebar/types";

const FIRST_HISTORY_DELAY_MS = 4_000;
const NEXT_HISTORY_SLICE_DELAY_MS = 1_500;
export const MAX_HISTORY_PASSES = 20;
export const MAX_TRANSIENT_RETRIES = 2;
export const HISTORY_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const HISTORY_LIST_TIMEOUT_MS = 45_000;

export async function requestHistoryList(path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await chatgptApi(path, { signal }, { timeoutMs: HISTORY_LIST_TIMEOUT_MS });
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error("login"), { name: "AbortError" });
    }
    if ([408, 500, 502, 503, 504].includes(response.status)) {
      throw new RetryableHistoryTransportError(`history ${response.status}`);
    }
    if (!response.ok) throw new Error(`history ${response.status}`);
    // Body transport interruptions are retryable; JSON SyntaxError and schema failures are not.
    return await response.json();
  } catch (error) {
    if (!signal?.aborted && (error instanceof ChatGPTApiTimeoutError || error instanceof TypeError)) {
      throw new RetryableHistoryTransportError("History list transport interrupted");
    }
    throw error;
  }
}

// Preserve the existing detail fetch/pagination behavior; only classify its transport failures.
export async function requestHistoryDetail(id: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await fetchConversation(id, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!signal?.aborted && (error instanceof TypeError || error instanceof ChatGPTApiTimeoutError
      || /API timed out|API failed: (408|500|502|503|504)\b/.test(message))) {
      throw new RetryableHistoryTransportError("History detail transport interrupted");
    }
    throw error;
  }
}

export function shouldReconcileHistory(snapshot: Pick<QuotaSnapshot, "historyComplete" | "lastHistorySuccessAt">, now: number): boolean {
  return !snapshot.historyComplete || !snapshot.lastHistorySuccessAt
    || now - snapshot.lastHistorySuccessAt >= HISTORY_RECONCILE_INTERVAL_MS;
}

export class QuotaTracker {
  private unsubscribe: (() => void) | null = null;
  private ingestQueue: Promise<void> = Promise.resolve();
  private readonly history = createChromeHistoryStore();
  private disposed = false;
  private historyFlight: Promise<void> | null = null;
  private historyTimer = 0;
  private historyAbort: AbortController | null = null;
  private nextHistoryAt = 0;
  private forceHistory = false;
  private historyIdentity: string | null = null;

  constructor(private readonly sync: ConversationSync) {}

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
    document.addEventListener("visibilitychange", this.onVisibility);
    this.scheduleHistory(FIRST_HISTORY_DELAY_MS);
  }

  async refreshCurrent(): Promise<void> {
    try {
      await withTimeout(this.sync.requestSync("popup"), REFRESH_TIMEOUT_MS, "同步超时");
      await withTimeout(this.ingestQueue, MESSAGE_TIMEOUT_MS, "账本写入超时");
    } finally {
      // A current-conversation failure must not prevent the explicitly requested history refresh.
      this.nextHistoryAt = 0;
      this.forceHistory = true;
      this.scheduleHistory(0);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.historyAbort?.abort();
    window.clearTimeout(this.historyTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onSnapshot(snapshot: ConversationSnapshot | null): Promise<void> {
    const work = this.ingestQueue.then(() => this.writeLedger(snapshot));
    this.ingestQueue = work.catch(() => undefined);
    return this.ingestQueue;
  }

  private scheduleHistory(delayMs: number): void {
    if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
    window.clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => this.startHistoryScan(), Math.max(0, delayMs));
  }

  private startHistoryScan(): void {
    if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
    const controller = new AbortController();
    this.historyAbort = controller;
    this.historyFlight = this.scanHistory(controller.signal)
      .catch(() => { this.forceHistory = false; this.nextHistoryAt = Date.now() + HISTORY_RECONCILE_INTERVAL_MS; })
      .finally(() => {
        this.historyAbort = null;
        this.historyFlight = null;
        this.scheduleHistory(this.forceHistory ? 0 : Math.max(600, this.nextHistoryAt - Date.now()));
      });
  }

  private async scanHistory(signal: AbortSignal): Promise<void> {
    const account = await readChatAccount(signal);
    if (signal.aborted || this.disposed) return;
    // Temporary auth/network failure is not an account change.
    if (!account.userId) throw new Error("login");
    const response = await sendRuntimeMessage<{ snapshot?: QuotaSnapshot; error?: string }>({
      type: "quota/get-state", accountKey: account.identity, plan: account.plan ?? undefined
    });
    if (!response.snapshot || response.error) throw new Error("quota state unavailable");
    const baseline = response.snapshot;
    const force = this.forceHistory;
    this.forceHistory = false;
    if (!force && !shouldReconcileHistory(baseline, Date.now())) {
      this.nextHistoryAt = baseline.lastHistorySuccessAt! + HISTORY_RECONCILE_INTERVAL_MS;
      return;
    }
    const retryDue = (baseline.lastHistoryAttemptAt ?? 0) + HISTORY_RECONCILE_INTERVAL_MS;
    if (!force && baseline.lastHistoryError && Date.now() < retryDue) {
      this.nextHistoryAt = retryDue;
      return;
    }
    if (signal.aborted) return;
    this.historyIdentity = account.identity;
    const attemptAt = Date.now();
    try {
      await this.publish(account, {
        syncStatus: baseline.historyComplete ? "ready" : "backfill",
        lastHistoryAttemptAt: attemptAt
      });
      // Progressive slices share a private staging cache. Only a complete result is committed.
      let cache = structuredClone(await this.history.load(account.identity));
      const store = {
        load: async () => cache,
        save: async (next: typeof cache) => { cache = next; }
      };
      let dataPass = 1;
      let retries = 0;
      while (!signal.aborted) {
        const result = await readChatHistory({
          transport: { request: requestHistoryList },
          fetchDetail: requestHistoryDetail,
          store, identity: account.identity, now: Date.now(), signal
        });
        if (signal.aborted || this.disposed) return;
        const summary = result.summary;
        if (summary.cancelled) throw new Error("login");
        if (summary.complete) {
          const successAt = Date.now();
          await this.publish(account, {
            events: toEvents(result.turns, account.identity, "personal"),
            historyCache: cache, historyComplete: true, syncStatus: "ready",
            unclassifiedTurns: summary.unclassifiedTurns,
            lastHistorySuccessAt: successAt, lastHistoryAttemptAt: attemptAt, lastHistoryError: null
          });
          this.nextHistoryAt = successAt + HISTORY_RECONCILE_INTERVAL_MS;
          return;
        }
        if (summary.permanentFailures > 0) throw new Error("历史数据暂不完整");
        if (summary.retryableFailures > 0) {
          if (retries >= MAX_TRANSIENT_RETRIES) throw new Error("历史接口暂不可用");
          await pause(retries++ === 0 ? 1_500 : 5_000, signal);
        } else if (historyNeedsAnotherPass(summary) && dataPass < MAX_HISTORY_PASSES) {
          dataPass += 1;
          await pause(NEXT_HISTORY_SLICE_DELAY_MS, signal);
        } else {
          throw new Error("历史数据暂不完整");
        }
      }
    } catch (error) {
      if (signal.aborted || this.disposed) return;
      await this.publish(account, {
        syncStatus: "error", lastHistoryAttemptAt: attemptAt, lastHistoryError: conciseError(error)
      });
      this.nextHistoryAt = Date.now() + HISTORY_RECONCILE_INTERVAL_MS;
    }
  }

  private async publish(account: ChatAccount, extras: Partial<QuotaIngest>): Promise<void> {
    const response = await sendRuntimeMessage<{ error?: string }>({
      type: "quota/ingest", events: [], plan: account.plan ?? undefined,
      accountKey: account.identity, ...extras
    });
    if (response?.error) throw new Error(response.error);
  }

  private async writeLedger(snapshot: ConversationSnapshot | null): Promise<void> {
    if (this.disposed || !snapshot) return;
    const account = await readChatAccount();
    if (this.disposed || !account.userId) return;
    const accountChanged = this.historyIdentity !== null && this.historyIdentity !== account.identity;
    if (accountChanged) {
      this.historyAbort?.abort();
      this.nextHistoryAt = 0;
    }
    this.historyIdentity = account.identity;
    const classification = classifySnapshot(snapshot);
    const events = snapshot.quotaIsWork ? [] : toEvents(snapshot.quotaTurns, account.identity, classification);
    // Publish live turns before the optional model-limit request can delay them.
    await this.publish(account, {
      events, workspaceKind: snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal"
    });
    if (accountChanged) this.scheduleHistory(0);
    const limits = await readModelLimits();
    if (!this.disposed) await this.publish(account, { limits,
      workspaceKind: snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal"
    });
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      this.historyAbort?.abort();
      window.clearTimeout(this.historyTimer);
      return;
    }
    this.scheduleHistory(0);
  };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { window.clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = window.setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

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
  return !summary.complete && !summary.cancelled && summary.permanentFailures === 0
    && summary.retryableFailures === 0 && summary.conversationsFetched > 0
    && (summary.hitDetailBudget || summary.hitDeadline);
}
