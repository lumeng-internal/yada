import { calculateQuotaSnapshot } from "./calculator";
import { EVENT_TTL_MS, LEDGER_KEY, MAX_EVENTS, STATE_KEY, type QuotaLedgerState, type QuotaPersistedState, type QuotaSnapshot, type QuotaUsageEvent } from "./types";

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

  ingest(events: readonly QuotaUsageEvent[], now = Date.now()): Promise<QuotaSnapshot | null> {
    return this.serialize(async () => {
      const { ledger, state } = await this.read();
      const byId = new Map(ledger.events.map((event) => [`${event.accountKey}:${event.id}`, event]));
      for (const event of events) {
        const key = `${event.accountKey}:${event.id}`;
        if (!byId.has(key)) byId.set(key, event);
      }
      ledger.events = prune([...byId.values()], now);
      const accountKey = events[0]?.accountKey;
      if (accountKey) {
        state.liveStartedAt[accountKey] ??= now;
        state.lastLiveAt[accountKey] = now;
      }
      const snapshot = accountKey
        ? calculateQuotaSnapshot({
          accountKey,
          workspaceKind: events[0]?.workspaceKind ?? "unknown",
          events: ledger.events,
          now,
          liveStartedAt: state.liveStartedAt[accountKey],
          lastLiveAt: state.lastLiveAt[accountKey],
          writeError: state.writeError,
          backfillStatus: "idle"
        })
        : null;
      if (snapshot) state.lastSnapshot = snapshot;
      await this.write(ledger, state);
      return snapshot;
    });
  }

  async getSnapshot(accountKey: string, workspaceKind: QuotaSnapshot["workspaceKind"], backfillStatus: QuotaSnapshot["backfillStatus"] = "idle", now = Date.now()): Promise<QuotaSnapshot> {
    const { ledger, state } = await this.read();
    return calculateQuotaSnapshot({
      accountKey,
      workspaceKind,
      events: ledger.events,
      now,
      liveStartedAt: state.liveStartedAt[accountKey],
      lastLiveAt: state.lastLiveAt[accountKey],
      writeError: state.writeError,
      backfillStatus
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
    .filter((event) => now - event.occurredAt <= EVENT_TTL_MS)
    .sort((a, b) => a.occurredAt - b.occurredAt);
  return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
}

function parseLedger(value: unknown): QuotaLedgerState {
  if (!value || typeof value !== "object") return { version: 1, events: [] };
  const record = value as QuotaLedgerState;
  if (record.version !== 1 || !Array.isArray(record.events)) return { version: 1, events: [] };
  return {
    version: 1,
    events: record.events.filter((event) => event && typeof event.id === "string" && typeof event.accountKey === "string")
  };
}

function parseState(value: unknown): QuotaPersistedState {
  if (!value || typeof value !== "object") return { version: 1, liveStartedAt: {}, lastLiveAt: {} };
  const record = value as QuotaPersistedState;
  return {
    version: 1,
    liveStartedAt: record.liveStartedAt ?? {},
    lastLiveAt: record.lastLiveAt ?? {},
    writeError: record.writeError,
    lastSnapshot: record.lastSnapshot
  };
}
