import type { ConversationSync } from "../core/conversationSync";
import type { ConversationSnapshot } from "../core/types";
import { ChatGPTApiTimeoutError, chatgptApiJson, fetchConversation } from "../conversation/fetchConversation";
import { MESSAGE_TIMEOUT_MS, REFRESH_TIMEOUT_MS, sendRuntimeMessage, type QuotaIngest } from "../shared/messages";
import { withTimeout } from "../shared/timeout";
import { readChatAccount, readModelLimits, type ChatAccount } from "./pageClient";
import type { HistoryMaintenance, QuotaClassification, QuotaSnapshot, QuotaUsageEvent } from "./types";
import { createChromeHistoryStore, readChatHistory, RetryableHistoryTransportError } from "./vibebar/historyReader";
import type { ChatGPTChatHistoryCache, ChatGPTChatHistorySummary, ChatGPTChatTurn } from "./vibebar/types";

export const HISTORY_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const HISTORY_SLICE_DETAIL_BUDGET = 6;
const SLICE_IDLE_MS = 2_000;
const BUSY_RETRY_MS = 60_000;
export const MAX_TRANSIENT_RETRIES = 2;
const HISTORY_LIST_TIMEOUT_MS = 45_000;
export const HISTORY_RECONCILE_LOCK = "chatgpt-yada:quota-history-reconcile";
export const HISTORY_LOCK_RETRY_MS = 60_000;

export type HistoryReconcileLock = { name: string } | null;

export type HistoryLockManager = {
  request(
    name: string,
    options: { mode?: "exclusive" | "shared"; ifAvailable?: boolean },
    callback: (lock: HistoryReconcileLock) => Promise<void> | void
  ): Promise<void>;
};

export async function withHistoryReconcileLock(
  task: () => Promise<void>,
  locks?: HistoryLockManager | null
): Promise<"acquired" | "busy" | "unsupported"> {
  if (!locks) return "unsupported";
  let acquired = false;
  await locks.request(
    HISTORY_RECONCILE_LOCK,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) return;
      acquired = true;
      await task();
    }
  );
  return acquired ? "acquired" : "busy";
}

export async function requestHistoryList(path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return await chatgptApiJson(path, { signal }, { timeoutMs: HISTORY_LIST_TIMEOUT_MS });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    const message = error instanceof Error ? error.message : "";
    const status = Number(/API failed: (\d+)/.exec(message)?.[1] ?? 0);
    if (status === 401 || status === 403) throw Object.assign(new Error("login"), { name: "AbortError" });
    if ([408, 500, 502, 503, 504].includes(status)) throw new RetryableHistoryTransportError(`history ${status}`);
    if (status) throw new Error(`history ${status}`);
    if (error instanceof ChatGPTApiTimeoutError || error instanceof TypeError) {
      throw new RetryableHistoryTransportError("History list transport interrupted");
    }
    throw error;
  }
}

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
    || now - snapshot.lastHistorySuccessAt >= HISTORY_DAILY_INTERVAL_MS;
}

export class QuotaTracker {
  private unsubscribe: (() => void) | null = null;
  private ingestQueue: Promise<void> = Promise.resolve();
  private readonly history = createChromeHistoryStore();
  private disposed = false;
  private historyFlight: Promise<void> | null = null;
  private historyTimer = 0;
  private historyIdle = 0;
  private historyAbort: AbortController | null = null;
  private nextHistoryAt = 0;
  private forceMode: "daily" | "full" | null = null;
  private historyIdentity: string | null = null;
  private bypassCaches = false;
  private transientRetries = 0;
  private limitsFingerprint: string | null = null;
  private readonly locks: HistoryLockManager | null;
  private readonly blocked: () => boolean;

  constructor(
    private readonly sync: ConversationSync,
    options: { locks?: HistoryLockManager | null; blocked?: () => boolean } = {}
  ) {
    this.locks = options.locks !== undefined
      ? options.locks
      : (typeof navigator !== "undefined" && "locks" in navigator
        ? navigator.locks as HistoryLockManager
        : null);
    this.blocked = options.blocked ?? (() => false);
  }

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
    document.addEventListener("visibilitychange", this.onVisibility);
    this.scheduleSlice(SLICE_IDLE_MS);
  }

  async refreshCurrent(): Promise<void> {
    this.bypassCaches = true;
    try {
      await withTimeout(this.sync.requestFull("popup"), REFRESH_TIMEOUT_MS, "同步超时");
      await withTimeout(this.ingestQueue, MESSAGE_TIMEOUT_MS, "账本写入超时");
    } finally {
      this.forceMode = "full";
      this.transientRetries = 0;
      this.scheduleSlice(0);
      this.bypassCaches = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.historyAbort?.abort();
    this.clearSliceSchedule();
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onSnapshot(snapshot: ConversationSnapshot | null): void {
    const work = this.ingestQueue.then(() => this.writeLedger(snapshot));
    this.ingestQueue = work.catch(() => undefined);
  }

  private scheduleSlice(delayMs: number): void {
    if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
    this.clearSliceSchedule();
    const wait = Math.max(0, delayMs);
    if (wait > 0) {
      this.historyTimer = window.setTimeout(() => {
        this.historyTimer = 0;
        this.armIdleSlice();
      }, wait);
      return;
    }
    this.armIdleSlice();
  }

  private armIdleSlice(): void {
    if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
    if (this.historyIdle || this.historyTimer) return;
    const onIdle = (): void => {
      this.historyIdle = 0;
      this.historyTimer = 0;
      this.onSliceOpportunity();
    };
    if (typeof requestIdleCallback === "function") {
      this.historyIdle = requestIdleCallback(() => onIdle());
      return;
    }
    this.historyTimer = window.setTimeout(onIdle, 0);
  }

  private onSliceOpportunity(): void {
    if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
    if (!this.sliceIntended()) {
      if (this.nextHistoryAt > Date.now()) this.scheduleSlice(this.nextHistoryAt - Date.now());
      return;
    }
    if (this.blocked()) {
      this.scheduleSlice(BUSY_RETRY_MS);
      return;
    }
    this.startSlice();
  }

  private sliceIntended(): boolean {
    return this.forceMode != null || this.nextHistoryAt <= Date.now();
  }

  private clearSliceSchedule(): void {
    if (this.historyTimer) window.clearTimeout(this.historyTimer);
    this.historyTimer = 0;
    if (this.historyIdle && typeof cancelIdleCallback === "function") cancelIdleCallback(this.historyIdle);
    this.historyIdle = 0;
  }

  private startSlice(): void {
    if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
    if (this.blocked()) {
      this.scheduleSlice(BUSY_RETRY_MS);
      return;
    }
    const controller = new AbortController();
    this.historyAbort = controller;
    this.historyFlight = this.runLockedSlice(controller.signal)
      .catch(() => undefined)
      .finally(() => {
        this.historyAbort = null;
        this.historyFlight = null;
        if (this.disposed || document.visibilityState === "hidden") return;
        if (this.nextHistoryAt <= Date.now()) return;
        this.scheduleSlice(Math.max(SLICE_IDLE_MS, this.nextHistoryAt - Date.now()));
      });
  }

  private async runLockedSlice(signal: AbortSignal): Promise<void> {
    const result = await withHistoryReconcileLock(() => this.runSlice(signal), this.locks);
    if (result === "unsupported") {
      await this.runSlice(signal);
      return;
    }
    if (result === "busy") {
      this.nextHistoryAt = Date.now() + HISTORY_LOCK_RETRY_MS;
    }
  }

  private async runSlice(signal: AbortSignal): Promise<void> {
    const account = await readChatAccount(signal, { force: this.forceMode === "full" || this.bypassCaches });
    if (signal.aborted || this.disposed) return;
    if (!account.userId) throw new Error("login");
    const response = await sendRuntimeMessage<{ snapshot?: QuotaSnapshot; error?: string }>({
      type: "quota/get-state", accountKey: account.identity, plan: account.plan ?? undefined
    });
    if (!response.snapshot || response.error) throw new Error("quota state unavailable");
    const baseline = response.snapshot;
    const forced = this.forceMode;
    this.forceMode = null;
    const maintenance = baseline.historyMaintenance;
    const mode = forced ?? (maintenance?.pending ? maintenance.mode : !baseline.historyComplete ? "full" : "daily");
    const now = Date.now();
    if (!forced && !maintenance?.pending && !shouldReconcileHistory(baseline, now)) {
      this.nextHistoryAt = (baseline.lastHistorySuccessAt ?? now) + HISTORY_DAILY_INTERVAL_MS;
      return;
    }
    if (!forced && baseline.lastHistoryError && now < (baseline.lastHistoryAttemptAt ?? 0) + HISTORY_DAILY_INTERVAL_MS && !maintenance?.pending) {
      this.nextHistoryAt = (baseline.lastHistoryAttemptAt ?? now) + HISTORY_DAILY_INTERVAL_MS;
      return;
    }
    if (signal.aborted) return;
    this.historyIdentity = account.identity;
    const attemptAt = maintenance?.attemptStartedAt ?? now;
    if (!baseline.historyComplete) {
      await this.publish(account, { syncStatus: "backfill", lastHistoryAttemptAt: attemptAt });
    }
    try {
      let cache = structuredClone(await this.history.load(account.identity));
      const store = {
        load: async () => cache,
        save: async (next: ChatGPTChatHistoryCache) => { cache = next; }
      };
      const result = await readChatHistory({
        transport: { request: requestHistoryList },
        fetchDetail: requestHistoryDetail,
        store,
        identity: account.identity,
        now,
        signal,
        includeArchived: mode === "full",
        detailBudget: HISTORY_SLICE_DETAIL_BUDGET
      });
      if (signal.aborted || this.disposed) return;
      const summary = result.summary;
      if (summary.cancelled) throw new Error("login");
      if (summary.permanentFailures > 0) throw new Error("历史数据暂不完整");
      if (summary.retryableFailures > 0) {
        if (this.transientRetries >= MAX_TRANSIENT_RETRIES) throw new Error("历史接口暂不可用");
        this.transientRetries += 1;
        this.forceMode = mode;
        this.nextHistoryAt = Date.now() + SLICE_IDLE_MS;
        await this.persistProgress(account, cache, mode, attemptAt, baseline, false);
        return;
      }
      this.transientRetries = 0;
      if (summary.complete) {
        const successAt = Date.now();
        await this.publish(account, {
          events: toEvents(result.turns, account.identity, "personal"),
          historyCache: cache,
          historyComplete: true,
          syncStatus: "ready",
          unclassifiedTurns: summary.unclassifiedTurns,
          lastHistorySuccessAt: successAt,
          lastHistoryAttemptAt: attemptAt,
          lastHistoryError: null,
          historyMaintenance: maintenanceState(mode, attemptAt, successAt, baseline, false)
        });
        this.nextHistoryAt = successAt + HISTORY_DAILY_INTERVAL_MS;
        return;
      }
      if (summary.needsContinuation || historyNeedsAnotherPass(summary)) {
        await this.persistProgress(account, cache, mode, attemptAt, baseline, true);
        this.forceMode = mode;
        this.nextHistoryAt = Date.now() + SLICE_IDLE_MS;
        return;
      }
      throw new Error("历史数据暂不完整");
    } catch (error) {
      if (signal.aborted || this.disposed) return;
      await this.publish(account, {
        syncStatus: "error",
        lastHistoryAttemptAt: attemptAt,
        lastHistoryError: conciseError(error),
        historyMaintenance: maintenanceState(mode, attemptAt, baseline.lastHistorySuccessAt, baseline, false)
      });
      this.forceMode = null;
      this.nextHistoryAt = Date.now() + HISTORY_DAILY_INTERVAL_MS;
    }
  }

  private async persistProgress(
    account: ChatAccount,
    cache: ChatGPTChatHistoryCache,
    mode: "daily" | "full",
    attemptAt: number,
    baseline: QuotaSnapshot,
    pending: boolean
  ): Promise<void> {
    await this.publish(account, {
      historyCache: cache,
      historyMaintenance: maintenanceState(mode, attemptAt, baseline.lastHistorySuccessAt, baseline, pending)
    });
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
    const account = await readChatAccount(undefined, { force: this.bypassCaches });
    if (this.disposed || !account.userId) return;
    const accountChanged = this.historyIdentity !== null && this.historyIdentity !== account.identity;
    if (accountChanged) {
      this.historyAbort?.abort();
      this.limitsFingerprint = null;
      this.forceMode = "full";
      this.nextHistoryAt = 0;
    }
    this.historyIdentity = account.identity;
    const classification = classifySnapshot(snapshot);
    const events = snapshot.quotaIsWork ? [] : toEvents(snapshot.quotaTurns, account.identity, classification);
    const workspaceKind = snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal";
    await this.publish(account, { events, workspaceKind });
    if (accountChanged) this.scheduleSlice(SLICE_IDLE_MS);
    const limits = await readModelLimits(Date.now(), undefined, { force: this.bypassCaches });
    if (this.disposed) return;
    const fingerprint = JSON.stringify(limits);
    if (fingerprint === this.limitsFingerprint) return;
    this.limitsFingerprint = fingerprint;
    await this.publish(account, { limits, workspaceKind });
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      this.clearSliceSchedule();
      return;
    }
    if (!this.historyFlight) this.scheduleSlice(SLICE_IDLE_MS);
  };
}

function maintenanceState(
  mode: "daily" | "full",
  attemptStartedAt: number,
  successAt: number | undefined,
  baseline: QuotaSnapshot,
  pending: boolean
): HistoryMaintenance {
  return {
    pending,
    mode,
    attemptStartedAt,
    lastIncrementalSuccessAt: successAt,
    lastFullSuccessAt: mode === "full" && !pending ? successAt : baseline.historyMaintenance?.lastFullSuccessAt
  };
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
    && (summary.hitDetailBudget || summary.hitDeadline || summary.needsContinuation === true);
}
