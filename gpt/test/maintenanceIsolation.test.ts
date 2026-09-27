import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationSync } from "../src/core/conversationSync";
import type { ConversationSnapshot } from "../src/core/types";
import { OfficialNavigatorHydrator } from "../src/nativeNavigator/hydrator";
import { emptyTransportState } from "../src/nativeNavigator/protocol";
import { QuotaLedger } from "../src/quota/ledger";
import { HISTORY_DAILY_INTERVAL_MS, QuotaTracker } from "../src/quota/tracker";
import type { QuotaGetState, QuotaIngest } from "../src/shared/messages";
import { linearConversation } from "./helpers";
import { normalizeConversation } from "../src/conversation/normalizeConversation";

vi.mock("../src/quota/pageClient", () => ({
  readChatAccount: vi.fn(async () => ({ identity: "account", userId: "user", accountId: null, plan: "pro" })),
  readModelLimits: vi.fn(async () => [])
}));

const NOW = 1_800_000_000_000;
const json = (value: unknown) => new Response(JSON.stringify(value));

function snapshotFor(id: string, count = 2): ConversationSnapshot {
  return {
    conversationId: id,
    revision: 0,
    capturedAt: Date.now(),
    activeTurns: normalizeConversation(linearConversation(count, id)),
    quotaTurns: [],
    quotaIsWork: false,
    quotaUnclassifiedTurns: 0,
    quotaOrigin: "chat",
    quotaTemporary: false
  };
}

describe("navigator waiting does not block quota maintenance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    history.replaceState({}, "", "/c/current");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lets a due history slice start while the hydrator is waiting without preparing", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") return Promise.resolve(json({}));
      calls += 1;
      return Promise.resolve(json({ items: [] }));
    }));
    vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(async (message: QuotaIngest | QuotaGetState) => {
      if (message.type === "quota/get-state") return { snapshot: await ledger.getSnapshot(message.accountKey!, message.plan ?? "pro") };
      return { snapshot: await ledger.ingest(message.events, message) };
    });
    const ledger = new QuotaLedger();
    await ledger.ingest([{
      id: "history-turn",
      accountKey: "account",
      createdAt: NOW,
      model: "gpt-6-pro",
      classification: "personal"
    }], {
      accountKey: "account",
      plan: "pro",
      unclassifiedTurns: 1,
      historyComplete: true,
      syncStatus: "ready",
      lastHistorySuccessAt: NOW - HISTORY_DAILY_INTERVAL_MS
    });

    const hydrator = new OfficialNavigatorHydrator({
      subscribe(listener: (snapshot: ConversationSnapshot | null) => void) {
        listener({ ...snapshotFor("current", 10) });
        return () => undefined;
      },
      getSnapshot: () => snapshotFor("current", 10)
    } as unknown as ConversationSync);
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyTransportState>;
      connected: boolean;
      awaitingSnapshot: boolean;
      evaluate(): Promise<void>;
    };
    internals.state = emptyTransportState("current", 1);
    internals.connected = true;
    internals.awaitingSnapshot = false;
    await internals.evaluate();
    expect(hydrator.isMaintenanceBlocked()).toBe(false);

    const tracker = new QuotaTracker({
      requestSync: async () => undefined,
      requestFull: async () => undefined,
      subscribe: () => () => undefined
    } as unknown as ConversationSync, {
      locks: null,
      blocked: () => hydrator.isMaintenanceBlocked()
    });
    tracker.mount();
    await vi.advanceTimersByTimeAsync(4_000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(calls).toBeGreaterThan(0);
    expect(hydrator.isMaintenanceBlocked()).toBe(false);
    tracker.dispose();
    hydrator.dispose();
  });
});
