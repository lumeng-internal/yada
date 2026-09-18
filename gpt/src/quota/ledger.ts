import { calculateQuotaSnapshot } from "./calculator";
import { EVENT_TTL_MS, LEDGER_KEY, MAX_EVENTS, STATE_KEY, type QuotaLedgerState, type QuotaPersistedState, type QuotaSnapshot, type QuotaUsageEvent } from "./types";
import type { ChatGPTChatModelLimit, ChatPlan } from "./vibebar/types";

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
      if (extras.plan !== undefined) state.plan = extras.plan;
      if (extras.historyComplete !== undefined) state.historyComplete = extras.historyComplete;
      if (extras.unclassifiedTurns !== undefined) state.unclassifiedTurns = extras.unclassifiedTurns;
      if (accountKey) state.accountKey = accountKey;
      const snapshot = accountKey
        ? calculateQuotaSnapshot({
          accountKey,
          plan: state.plan,
          workspaceKind: extras.workspaceKind ?? "personal",
          events: ledger.events,
          limits: extras.limits,
          historyComplete: state.historyComplete,
          unclassifiedTurns: state.unclassifiedTurns,
          now: extras.now,
          writeError: state.writeError
        })
        : null;
      if (snapshot) state.lastSnapshot = snapshot;
      await this.write(ledger, state);
      return snapshot;
    });
  }

  async getSnapshot(
    accountKey: string,
    plan: ChatPlan,
    extras: {
      workspaceKind?: QuotaSnapshot["workspaceKind"];
      historyComplete?: boolean;
      unclassifiedTurns?: number;
      limits?: readonly ChatGPTChatModelLimit[];
      now?: number;
    } = {}
  ): Promise<QuotaSnapshot> {
    const { ledger, state } = await this.read();
    return calculateQuotaSnapshot({
      accountKey,
      plan: plan ?? state.plan,
      workspaceKind: extras.workspaceKind ?? "personal",
      events: ledger.events,
      limits: extras.limits,
      historyComplete: extras.historyComplete ?? state.historyComplete,
      unclassifiedTurns: extras.unclassifiedTurns ?? state.unclassifiedTurns,
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
    return {
      ledger: parseLedger(data[LEDGER_KEY]),
      state: parseState(data[STATE_KEY])
    };
  }

  private async write(ledger: QuotaLedgerState, state: QuotaPersistedState): Promise<void> {
    try {
      await this.storage.set({ [LEDGER_KEY]: ledger, [STATE_KEY]: state });
      state.writeError = undefined;
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
    events: record.events.filter((event) => event && typeof event.id === "string" && typeof event.accountKey === "string" && typeof event.model === "string")
  };
}

function parseState(value: unknown): QuotaPersistedState {
  if (!value || typeof value !== "object") return { version: 2, plan: null, historyComplete: false, unclassifiedTurns: 0 };
  const record = value as QuotaPersistedState;
  return {
    version: 2,
    accountKey: record.accountKey,
    plan: record.plan === "pro" || record.plan === "prolite" ? record.plan : null,
    historyComplete: record.historyComplete === true,
    unclassifiedTurns: record.unclassifiedTurns ?? 0,
    writeError: record.writeError,
    lastSnapshot: record.lastSnapshot
  };
}
