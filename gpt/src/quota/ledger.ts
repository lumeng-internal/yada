import { calculateQuotaSnapshot } from "./calculator";
import { EVENT_TTL_MS, LEDGER_KEY, MAX_EVENTS, STATE_KEY, type QuotaLedgerState, type QuotaPersistedState, type QuotaSnapshot, type QuotaSyncStatus, type QuotaUsageEvent } from "./types";
import { HISTORY_CACHE_KEY } from "./vibebar/historyReader";
import type { ChatGPTChatHistoryCache, ChatGPTChatModelLimit, ChatPlan } from "./vibebar/types";

export type QuotaStorage = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

const memoryFallback = new Map<string, unknown>();

export function createChromeQuotaStorage(): QuotaStorage {
  return {
    async get(keys) {
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        return Object.fromEntries(keys.map((key) => [key, memoryFallback.get(key)]));
      }
      return chrome.storage.local.get(keys);
    },
    async set(values) {
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        for (const [key, value] of Object.entries(values)) memoryFallback.set(key, value);
        return;
      }
      await chrome.storage.local.set(values);
    }
  };
}

export class QuotaLedger {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly storage: QuotaStorage = createChromeQuotaStorage()) {}

  ingest(events: readonly QuotaUsageEvent[], extras: {
    now?: number;
    plan?: ChatPlan;
    historyComplete?: boolean;
    syncStatus?: QuotaSyncStatus;
    lastHistorySuccessAt?: number;
    lastHistoryAttemptAt?: number;
    lastHistoryError?: string | null;
    historyCache?: ChatGPTChatHistoryCache;
    unclassifiedTurns?: number;
    limits?: readonly ChatGPTChatModelLimit[];
    workspaceKind?: QuotaSnapshot["workspaceKind"];
    accountKey?: string;
  } = {}): Promise<QuotaSnapshot | null> {
    return this.serialize(async () => {
      const { ledger, state } = await this.read();
      const byId = new Map(ledger.events.map((event) => [`${event.accountKey}:${event.id}`, event]));
      for (const event of events) {
        byId.set(`${event.accountKey}:${event.id}`, event);
      }
      ledger.events = prune([...byId.values()], extras.now ?? Date.now());
      const accountKey = extras.accountKey ?? events[0]?.accountKey ?? state.accountKey;
      if (accountKey !== state.accountKey) {
        state.lastSnapshot = undefined;
        state.historyComplete = false;
        state.syncStatus = "loading";
        state.lastHistorySuccessAt = undefined;
        state.lastHistoryAttemptAt = undefined;
        state.lastHistoryError = null;
        state.unclassifiedTurns = 0;
        state.plan = null;
      }
      if (extras.plan !== undefined) state.plan = extras.plan;
      if (extras.historyComplete !== undefined) state.historyComplete ||= extras.historyComplete;
      if (extras.syncStatus !== undefined) state.syncStatus = extras.syncStatus;
      if (state.historyComplete) state.syncStatus = "ready";
      if (extras.lastHistorySuccessAt !== undefined) state.lastHistorySuccessAt = extras.lastHistorySuccessAt;
      if (extras.lastHistoryAttemptAt !== undefined) state.lastHistoryAttemptAt = extras.lastHistoryAttemptAt;
      if (extras.lastHistoryError !== undefined) state.lastHistoryError = extras.lastHistoryError;
      if (extras.unclassifiedTurns !== undefined) state.unclassifiedTurns = extras.unclassifiedTurns;
      if (accountKey) state.accountKey = accountKey;
      const snapshot = accountKey
        ? calculateQuotaSnapshot({
          accountKey,
          plan: state.plan,
          workspaceKind: extras.workspaceKind ?? state.lastSnapshot?.workspaceKind ?? "personal",
          events: ledger.events,
          limits: extras.limits ?? state.lastSnapshot?.serverLimits,
          historyComplete: state.historyComplete,
          syncStatus: state.syncStatus,
          lastHistorySuccessAt: state.lastHistorySuccessAt,
          lastHistoryAttemptAt: state.lastHistoryAttemptAt,
          lastHistoryError: state.lastHistoryError,
          unclassifiedTurns: state.unclassifiedTurns,
          now: extras.now,
          writeError: state.writeError
        })
        : null;
      if (snapshot) state.lastSnapshot = snapshot;
      await this.write(ledger, state, extras.historyCache);
      return snapshot;
    });
  }

  async getSnapshot(
    accountKey: string,
    plan: ChatPlan,
    extras: {
      workspaceKind?: QuotaSnapshot["workspaceKind"];
      historyComplete?: boolean;
      syncStatus?: QuotaSyncStatus;
      unclassifiedTurns?: number;
      limits?: readonly ChatGPTChatModelLimit[];
      now?: number;
    } = {}
  ): Promise<QuotaSnapshot> {
    const { ledger, state } = await this.read();
    return calculateQuotaSnapshot({
      accountKey,
      plan: plan ?? (state.accountKey === accountKey ? state.plan : null),
      workspaceKind: extras.workspaceKind ?? (state.accountKey === accountKey ? state.lastSnapshot?.workspaceKind : undefined) ?? "personal",
      events: ledger.events,
      limits: extras.limits ?? (state.accountKey === accountKey ? state.lastSnapshot?.serverLimits : undefined),
      historyComplete: state.accountKey === accountKey && (extras.historyComplete ?? state.historyComplete),
      syncStatus: state.accountKey === accountKey ? extras.syncStatus ?? state.syncStatus : "loading",
      lastHistorySuccessAt: state.accountKey === accountKey ? state.lastHistorySuccessAt : undefined,
      lastHistoryAttemptAt: state.accountKey === accountKey ? state.lastHistoryAttemptAt : undefined,
      lastHistoryError: state.accountKey === accountKey ? state.lastHistoryError : null,
      unclassifiedTurns: state.accountKey === accountKey ? extras.unclassifiedTurns ?? state.unclassifiedTurns : 0,
      now: extras.now,
      writeError: state.writeError
    });
  }

  async restore(): Promise<{ ledger: QuotaLedgerState; state: QuotaPersistedState }> {
    return this.read();
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async read(): Promise<{ ledger: QuotaLedgerState; state: QuotaPersistedState }> {
    const data = await this.storage.get([LEDGER_KEY, STATE_KEY]);
    const rawLedger = data[LEDGER_KEY] as QuotaLedgerState | undefined;
    const validLedger = rawLedger?.version === 2 && Array.isArray(rawLedger.events) && rawLedger.events.every(isUsageEvent);
    return {
      ledger: parseLedger(data[LEDGER_KEY]),
      state: parseState(validLedger ? data[STATE_KEY] : undefined)
    };
  }

  private async write(ledger: QuotaLedgerState, state: QuotaPersistedState, cache?: ChatGPTChatHistoryCache): Promise<void> {
    try {
      const values: Record<string, unknown> = { [LEDGER_KEY]: ledger, [STATE_KEY]: state };
      if (cache && state.accountKey) {
        const data = await this.storage.get([HISTORY_CACHE_KEY]);
        values[HISTORY_CACHE_KEY] = { ...(data[HISTORY_CACHE_KEY] as object ?? {}), [state.accountKey]: cache };
      }
      state.writeError = undefined;
      await this.storage.set(values);
    } catch (error) {
      state.writeError = error instanceof Error ? error.message : "storage-write-failed";
      throw error;
    }
  }
}

export function prune(events: QuotaUsageEvent[], now: number): QuotaUsageEvent[] {
  const kept = events
    .filter((event) => now - event.createdAt <= EVENT_TTL_MS)
    .sort((a, b) => a.createdAt - b.createdAt);
  return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
}

function parseLedger(value: unknown): QuotaLedgerState {
  if (!value || typeof value !== "object") return { version: 2, events: [] };
  const record = value as QuotaLedgerState;
  if (record.version !== 2 || !Array.isArray(record.events)) return { version: 2, events: [] };
  return {
    version: 2,
    events: record.events.filter(isUsageEvent)
  };
}

function parseState(value: unknown): QuotaPersistedState {
  if (!value || typeof value !== "object") return { version: 2, plan: null, historyComplete: false, syncStatus: "loading", unclassifiedTurns: 0 };
  const record = value as QuotaPersistedState;
  if (record.version !== 2) return parseState(undefined);
  return {
    version: 2,
    accountKey: record.accountKey,
    plan: record.plan === "pro" || record.plan === "prolite" ? record.plan : null,
    historyComplete: record.historyComplete === true,
    syncStatus: isSyncStatus(record.syncStatus)
      ? record.syncStatus
      : record.historyComplete === true
        ? "ready"
        : "partial",
    lastHistorySuccessAt: validTime(record.lastHistorySuccessAt),
    lastHistoryAttemptAt: validTime(record.lastHistoryAttemptAt),
    lastHistoryError: typeof record.lastHistoryError === "string" ? record.lastHistoryError : null,
    unclassifiedTurns: record.unclassifiedTurns ?? 0,
    writeError: record.writeError,
    lastSnapshot: record.lastSnapshot
  };
}

function isSyncStatus(value: unknown): value is QuotaSyncStatus {
  return value === "loading" || value === "backfill" || value === "ready" || value === "partial" || value === "error";
}

function validTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isUsageEvent(event: unknown): event is QuotaUsageEvent {
  if (!event || typeof event !== "object") return false;
  const value = event as QuotaUsageEvent;
  return typeof value.id === "string" && typeof value.accountKey === "string"
    && typeof value.model === "string" && Number.isFinite(value.createdAt)
    && ["personal", "work", "unknown", "temporary"].includes(value.classification);
}
