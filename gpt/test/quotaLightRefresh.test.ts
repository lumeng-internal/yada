import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConversationSync } from "../src/core/conversationSync";
import type { ConversationListener, ConversationSnapshot } from "../src/core/types";
import { getConversationIdFromUrl, isChatGptConversationPage } from "../src/platform/chatgptAdapter";
import { QuotaLedger } from "../src/quota/ledger";
import { HISTORY_LOCK_RETRY_MS, HISTORY_RECONCILE_LOCK, QuotaTracker, type HistoryLockManager } from "../src/quota/tracker";
import type { QuotaSnapshot } from "../src/quota/types";
import type { QuotaGetState, QuotaIngest } from "../src/shared/messages";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import { linearConversation } from "./helpers";
import { GPT6_PRO } from "../src/quota/vibebar/allowances";

vi.mock("../src/platform/chatgptAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/platform/chatgptAdapter")>();
  return {
    ...actual,
    isChatGptConversationPage: vi.fn(() => false),
    getConversationIdFromUrl: vi.fn(() => null)
  };
});

vi.mock("../src/quota/pageClient", () => ({
  readChatAccount: vi.fn(async () => ({ identity: "account", userId: "user", accountId: null, plan: "pro" })),
  readModelLimits: vi.fn(async () => [])
}));

const NOW = 1_800_000_000_000;
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
let tracker: QuotaTracker | undefined;

function json(value: unknown) {
  return new Response(JSON.stringify(value));
}

function quotaSnapshot(extras: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
  const snapshot = calculateQuotaSnapshot({
    accountKey: "account",
    plan: "pro",
    workspaceKind: "personal",
    events: [{ id: "g0", accountKey: "account", createdAt: NOW, model: GPT6_PRO, classification: "personal" }],
    historyComplete: extras.historyComplete ?? true,
    syncStatus: extras.syncStatus,
    unclassifiedTurns: extras.historyComplete === false ? 1 : 0,
    now: NOW,
    lastHistorySuccessAt: extras.lastHistorySuccessAt ?? (extras.historyComplete === false ? undefined : NOW),
    lastHistoryError: extras.lastHistoryError
  });
  return Object.assign(snapshot, extras);
}

function conversationSnapshot(): ConversationSnapshot {
  return {
    conversationId: CONVERSATION_ID,
    revision: 1,
    capturedAt: NOW,
    activeTurns: [],
    quotaTurns: [{ id: "current-turn", createdAt: NOW, model: GPT6_PRO }],
    quotaIsWork: false,
    quotaUnclassifiedTurns: 0,
    quotaOrigin: "chat",
    quotaTemporary: false,
    coverage: "full"
  };
}

async function snapshotFor(count: number, id = CONVERSATION_ID): Promise<ConversationSnapshot> {
  const { parseConversation } = await import("../src/quota/vibebar/conversationParser");
  const { normalizeConversation } = await import("../src/conversation/normalizeConversation");
  const conversation = linearConversation(count, id);
  const parsed = await parseConversation(conversation, id, NOW, 0);
  return {
    conversationId: id,
    revision: 0,
    capturedAt: NOW,
    activeTurns: normalizeConversation(conversation),
    quotaTurns: parsed.turns,
    quotaIsWork: parsed.isWork,
    quotaUnclassifiedTurns: parsed.unclassifiedTurns,
    quotaOrigin: "chat",
    quotaTemporary: false,
    coverage: "full"
  };
}

function mockConversationPage(id = CONVERSATION_ID): void {
  vi.mocked(isChatGptConversationPage).mockReturnValue(true);
  vi.mocked(getConversationIdFromUrl).mockReturnValue(id);
}

type SyncMock = {
  requestRecent: ReturnType<typeof vi.fn>;
  requestFull: ReturnType<typeof vi.fn>;
  hasUsableFullSnapshot: ReturnType<typeof vi.fn>;
  getActiveConversationId: ReturnType<typeof vi.fn>;
  getLastError: ReturnType<typeof vi.fn>;
  subscribe: (callback: ConversationListener) => () => void;
  listener: ConversationListener;
};

async function mountTracker(options: {
  locks?: HistoryLockManager | null;
  blocked?: () => boolean;
  sync?: Partial<SyncMock>;
} = {}) {
  const ledger = new QuotaLedger();
  const messages: QuotaIngest[] = [];
  vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(async (message: QuotaIngest | QuotaGetState) => {
    if (message.type === "quota/get-state") {
      return { snapshot: await ledger.getSnapshot(message.accountKey ?? "account", message.plan ?? "pro") };
    }
    messages.push(message);
    return { snapshot: await ledger.ingest(message.events, message) };
  });
  let listener: ConversationListener = () => undefined;
  const sync = {
    requestRecent: vi.fn(async () => undefined),
    requestFull: vi.fn(async () => undefined),
    hasUsableFullSnapshot: vi.fn(() => false),
    getActiveConversationId: vi.fn(() => CONVERSATION_ID),
    getLastError: vi.fn(() => null),
    subscribe(callback: ConversationListener) {
      listener = callback;
      return () => undefined;
    },
    ...options.sync
  };
  tracker = new QuotaTracker(sync as unknown as ConversationSync, {
    locks: options.locks !== undefined ? options.locks : null,
    blocked: options.blocked
  });
  tracker.mount();
  return {
    ledger,
    messages,
    sync,
    publish: (snapshot: ConversationSnapshot | null) => listener(snapshot)
  };
}

async function seed(ledger: QuotaLedger, extras: Parameters<QuotaLedger["ingest"]>[1] = {}) {
  await ledger.ingest(
    [{ id: "history-turn", accountKey: "account", createdAt: NOW, model: GPT6_PRO, classification: "personal" }],
    {
      accountKey: "account",
      plan: "pro",
      unclassifiedTurns: 0,
      historyComplete: true,
      syncStatus: "ready",
      lastHistorySuccessAt: NOW,
      ...extras
    }
  );
}

async function flushIdle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("quota inline light refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(isChatGptConversationPage).mockReturnValue(false);
    vi.mocked(getConversationIdFromUrl).mockReturnValue(null);
  });

  afterEach(() => {
    tracker?.dispose();
    tracker = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses recent when a full baseline exists and waits for ingest before resolving", async () => {
    mockConversationPage();
    const { sync, publish, ledger } = await mountTracker();
    await seed(ledger);
    sync.hasUsableFullSnapshot.mockReturnValue(true);
    let ingestStarted = false;
    sync.requestRecent.mockImplementation(async () => {
      ingestStarted = true;
      publish(conversationSnapshot());
    });
    const pending = tracker!.refreshCurrentLight(quotaSnapshot());
    await Promise.resolve();
    expect(sync.requestRecent).toHaveBeenCalledTimes(1);
    expect(sync.requestRecent).toHaveBeenCalledWith("quota-inline-refresh");
    expect(sync.requestFull).not.toHaveBeenCalled();
    await pending;
    expect(ingestStarted).toBe(true);
    expect((await ledger.restore()).ledger.events.some((event) => event.id === "current-turn")).toBe(true);
  });

  it("falls back to one full read when recent cannot be merged", async () => {
    mockConversationPage();
    const { sync, publish } = await mountTracker();
    sync.hasUsableFullSnapshot
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValue(false);
    sync.requestRecent.mockResolvedValue(undefined);
    sync.requestFull.mockImplementation(async () => {
      publish(conversationSnapshot());
    });
    await tracker!.refreshCurrentLight(quotaSnapshot());
    expect(sync.requestRecent).toHaveBeenCalledTimes(1);
    expect(sync.requestFull).toHaveBeenCalledTimes(1);
    expect(sync.requestFull).toHaveBeenCalledWith("quota-inline-refresh-fallback");
  });

  it("reads full once when there is no baseline", async () => {
    mockConversationPage();
    const { sync, publish } = await mountTracker();
    sync.hasUsableFullSnapshot.mockReturnValue(false);
    sync.requestFull.mockImplementation(async () => {
      publish(conversationSnapshot());
    });
    await tracker!.refreshCurrentLight(quotaSnapshot({ historyComplete: false }));
    expect(sync.requestRecent).not.toHaveBeenCalled();
    expect(sync.requestFull).toHaveBeenCalledTimes(1);
    expect(sync.requestFull).toHaveBeenCalledWith("quota-inline-refresh");
  });

  it("does not read conversation APIs off a conversation page", async () => {
    const { sync, ledger } = await mountTracker();
    await seed(ledger);
    const before = (await ledger.restore()).state.lastHistorySuccessAt;
    await tracker!.refreshCurrentLight(quotaSnapshot());
    expect(sync.requestRecent).not.toHaveBeenCalled();
    expect(sync.requestFull).not.toHaveBeenCalled();
    expect((await ledger.restore()).state.lastHistorySuccessAt).toBe(before);
  });

  it("reuses one in-flight light refresh promise", async () => {
    mockConversationPage();
    const { sync } = await mountTracker();
    sync.hasUsableFullSnapshot.mockReturnValue(true);
    let release!: () => void;
    sync.requestRecent.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = tracker!.refreshCurrentLight(quotaSnapshot());
    const second = tracker!.refreshCurrentLight(quotaSnapshot());
    expect(second).toBe(first);
    await Promise.resolve();
    expect(sync.requestRecent).toHaveBeenCalledTimes(1);
    expect(sync.requestFull).not.toHaveBeenCalled();
    release();
    await first;
    await second;
    expect(sync.requestRecent).toHaveBeenCalledTimes(1);
  });

  it("aborts a stale light refresh when the route changes", async () => {
    mockConversationPage();
    const { sync } = await mountTracker();
    sync.hasUsableFullSnapshot.mockReturnValue(true);
    sync.requestRecent.mockImplementation(async () => {
      sync.getActiveConversationId.mockReturnValue("other-conversation");
    });
    await expect(tracker!.refreshCurrentLight(quotaSnapshot())).rejects.toMatchObject({ name: "AbortError" });
    expect(sync.requestFull).not.toHaveBeenCalled();
  });

  it("returns ingest failure without clearing last-good events", async () => {
    mockConversationPage();
    const { sync, publish, ledger } = await mountTracker();
    await seed(ledger);
    sync.hasUsableFullSnapshot.mockReturnValue(true);
    vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(async (message: QuotaIngest | QuotaGetState) => {
      if (message.type === "quota/get-state") {
        return { snapshot: await ledger.getSnapshot("account", "pro") };
      }
      return { error: "ledger failed" };
    });
    sync.requestRecent.mockImplementation(async () => {
      publish(conversationSnapshot());
    });
    await expect(tracker!.refreshCurrentLight(quotaSnapshot())).rejects.toThrow("ledger failed");
    expect((await ledger.restore()).ledger.events.some((event) => event.id === "history-turn")).toBe(true);
  });

  it("does not change lastHistorySuccessAt and does not pretend history is complete", async () => {
    mockConversationPage();
    const { sync, publish, ledger } = await mountTracker();
    await seed(ledger, { lastHistorySuccessAt: NOW - 3_600_000, lastHistoryError: "历史读取失败" });
    sync.hasUsableFullSnapshot.mockReturnValue(true);
    sync.requestRecent.mockImplementation(async () => {
      publish(conversationSnapshot());
    });
    await tracker!.refreshCurrentLight(quotaSnapshot({
      historyComplete: true,
      lastHistorySuccessAt: NOW - 3_600_000,
      lastHistoryError: "历史读取失败"
    }));
    const state = (await ledger.restore()).state;
    expect(state.lastHistorySuccessAt).toBe(NOW - 3_600_000);
    expect(state.lastHistoryError).toBe("历史读取失败");
    expect(state.historyComplete).toBe(true);
  });
});

describe("light refresh history repair scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(isChatGptConversationPage).mockReturnValue(false);
    vi.mocked(getConversationIdFromUrl).mockReturnValue(null);
  });

  afterEach(() => {
    tracker?.dispose();
    tracker = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("schedules a full idle repair when history is incomplete and does not wait for it", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return json({ items: [] });
    }));
    const { ledger } = await mountTracker();
    const pending = tracker!.refreshCurrentLight(quotaSnapshot({ historyComplete: false }));
    await pending;
    expect(calls).toBe(0);
    expect((tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode).toBe("full");
    await vi.advanceTimersByTimeAsync(0);
    await flushIdle();
    expect(calls).toBeGreaterThan(0);
  });

  it("schedules a daily idle repair when the last history error is set", async () => {
    let paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return json({ items: [] });
    }));
    const { ledger } = await mountTracker();
    await seed(ledger, { lastHistoryError: "历史读取失败" });
    await tracker!.refreshCurrentLight(quotaSnapshot({
      historyComplete: true,
      lastHistoryError: "历史读取失败"
    }));
    expect((tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode).toBe("daily");
    await vi.advanceTimersByTimeAsync(0);
    await flushIdle();
    expect(paths.some((path) => path.includes("is_archived=false"))).toBe(true);
    expect(paths.some((path) => path.includes("is_archived=true"))).toBe(false);
  });

  it("does not schedule history repair when history is healthy", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return json({ items: [] });
    }));
    const { ledger } = await mountTracker();
    await seed(ledger);
    await tracker!.refreshCurrentLight(quotaSnapshot());
    expect((tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode).toBeNull();
    await vi.advanceTimersByTimeAsync(4_000);
    await flushIdle();
    expect(calls).toBe(0);
  });

  it("does not let daily repair downgrade an existing full force", async () => {
    const { ledger } = await mountTracker();
    await seed(ledger);
    (tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode = "full";
    await tracker!.refreshCurrentLight(quotaSnapshot({
      historyComplete: true,
      lastHistoryError: "历史读取失败"
    }));
    expect((tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode).toBe("full");
  });

  it("does not start a second history flight", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return json({ items: [] });
    }));
    const { ledger } = await mountTracker();
    await seed(ledger, { lastHistoryError: "历史读取失败" });
    (tracker as unknown as { historyFlight: Promise<void> | null }).historyFlight = Promise.resolve();
    await tracker!.refreshCurrentLight(quotaSnapshot({
      historyComplete: true,
      lastHistoryError: "历史读取失败"
    }));
    expect((tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode).toBe("daily");
    await vi.advanceTimersByTimeAsync(4_000);
    await flushIdle();
    expect(calls).toBe(0);
    expect((tracker as unknown as { historyFlight: Promise<void> | null }).historyFlight).toBeTruthy();
  });

  it("keeps a full repair intent across a busy web lock", async () => {
    let held = true;
    const locks: HistoryLockManager = {
      async request(_name, options, callback) {
        if (held && options.ifAvailable) {
          await callback(null);
          return;
        }
        await callback({ name: HISTORY_RECONCILE_LOCK });
      }
    };
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return json({ items: [] });
    }));
    await mountTracker({ locks });
    await tracker!.refreshCurrentLight(quotaSnapshot({ historyComplete: false }));
    await vi.advanceTimersByTimeAsync(0);
    await flushIdle();
    expect((tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode).toBe("full");
    expect(paths.some((path) => path.includes("conversations"))).toBe(false);
    held = false;
    await vi.advanceTimersByTimeAsync(HISTORY_LOCK_RETRY_MS);
    await flushIdle();
    expect(paths.some((path) => path.includes("is_archived=true"))).toBe(true);
  });

  it("still executes the repair through requestIdleCallback", async () => {
    let queued: IdleRequestCallback | undefined;
    const idle = vi.fn((cb: IdleRequestCallback) => {
      queued = cb;
      return 21;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return json({ items: [] });
    }));
    await mountTracker();
    await tracker!.refreshCurrentLight(quotaSnapshot({ historyComplete: false }));
    expect(idle).toHaveBeenCalled();
    expect(calls).toBe(0);
    queued?.({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    await flushIdle();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(calls).toBeGreaterThan(0);
  });
});

describe("popup heavy refresh regression and upstream icon", () => {
  afterEach(() => {
    tracker?.dispose();
    tracker = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps popup refreshCurrent on the full current-conversation path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { sync } = await mountTracker();
    await tracker!.refreshCurrent();
    expect(sync.requestFull).toHaveBeenCalledWith("popup");
    expect(sync.requestRecent).not.toHaveBeenCalled();
    expect((tracker as unknown as { forceMode: "daily" | "full" | null }).forceMode).toBe("full");
  });

  it("does not mention quota/refresh-current in the inline indicator", () => {
    const source = readFileSync(join(process.cwd(), "src/ui/quotaIndicator.ts"), "utf8");
    expect(source).not.toContain("quota/refresh-current");
    expect(source).not.toMatch(/\bsetInterval\b|\brequestAnimationFrame\b/);
    expect(source).toContain("currentColor");
    expect(source).toContain("aria-hidden");
  });

  it("records a single inlined Heroicons path without a runtime dependency", () => {
    const notice = readFileSync(join(process.cwd(), "NOTICE.md"), "utf8");
    const third = readFileSync(join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf8");
    const pkg = readFileSync(join(process.cwd(), "package.json"), "utf8");
    expect(pkg).not.toMatch(/heroicons/);
    expect(notice).toContain("0435d4ca364a608cc75e2f8683d374e55abbae26");
    expect(notice).toContain("optimized/24/outline/arrow-path.svg");
    expect(notice).toContain("MIT");
    expect(third).toContain("tailwindlabs/heroicons");
    expect(third).toContain("0435d4ca364a608cc75e2f8683d374e55abbae26");
  });

  it("an explicit full cancels the idle merge fallback", async () => {
    vi.useFakeTimers();
    const full = await snapshotFor(2);
    const recent = await snapshotFor(1, CONVERSATION_ID);
    recent.activeTurns = recent.activeTurns.map((turn) => ({
      ...turn,
      userMessageId: "u-foreign",
      assistantMessageId: "a-foreign"
    }));
    recent.coverage = "recent";
    let fullReads = 0;
    const sync = new ConversationSync({
      async readConversation() {
        fullReads += 1;
        return structuredClone(full);
      },
      async readRecentConversation() {
        return structuredClone(recent);
      }
    });
    sync.setActiveConversation(CONVERSATION_ID);
    await sync.requestFull("boot");
    await sync.requestRecent("quota-inline-refresh");
    expect(sync.hasUsableFullSnapshot()).toBe(false);
    await sync.requestFull("quota-inline-refresh-fallback");
    expect(fullReads).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fullReads).toBe(2);
    sync.dispose();
  });
});
