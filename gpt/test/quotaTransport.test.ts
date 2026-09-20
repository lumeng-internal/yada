import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readChatAccount } from "../src/quota/pageClient";
import * as historyReader from "../src/quota/vibebar/historyReader";
import * as conversationApi from "../src/conversation/fetchConversation";
import { ChatGPTApiTimeoutError, chatgptApi } from "../src/conversation/fetchConversation";
import { historyNeedsAnotherPass, QuotaTracker, requestHistoryList, requestHistoryDetail, HISTORY_RECONCILE_INTERVAL_MS, shouldReconcileHistory } from "../src/quota/tracker";
import { createMemoryHistoryStore, readChatHistory } from "../src/quota/vibebar/historyReader";
import { QuotaLedger } from "../src/quota/ledger";
import type { ConversationSync } from "../src/core/conversationSync";
import type { ConversationListener, ConversationSnapshot } from "../src/core/types";
import type { QuotaIngest, QuotaGetState } from "../src/shared/messages";
import { HISTORY_CACHE_KEY } from "../src/quota/vibebar/historyReader";
import { linearConversation } from "./helpers";

vi.mock("../src/quota/pageClient", () => ({
  readChatAccount: vi.fn(async () => ({ identity: "account", userId: "user", accountId: null, plan: "pro" })),
  readModelLimits: vi.fn(async () => [])
}));

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const json = (value: unknown) => new Response(JSON.stringify(value));
let tracker: QuotaTracker | undefined;

function stubFetch(handler: (path: string, init?: RequestInit) => Promise<Response>) {
  return vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/auth/session") return Promise.resolve(json({}));
    return handler(path, init);
  }));
}

function pendingResponse(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => {
  tracker?.dispose();
  tracker = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("quota history transport contract", () => {
  it("keeps the default API timeout at 15 seconds and history list at 45 seconds", async () => {
    stubFetch(async (_path, init) => pendingResponse(init?.signal));
    const ordinary = chatgptApi("/backend-api/conversation/init");
    const ordinaryCheck = expect(ordinary).rejects.toBeInstanceOf(ChatGPTApiTimeoutError);
    await vi.advanceTimersByTimeAsync(14_999);
    let settled = false;
    void ordinary.catch(() => { settled = true; });
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await ordinaryCheck;

    const history = requestHistoryList("/backend-api/conversations?is_archived=true");
    const historyCheck = expect(history).rejects.toThrow("History list transport interrupted");
    settled = false;
    void history.catch(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await historyCheck;
  });

  it("completes both streams when the final empty archived list takes 28.875 seconds", async () => {
    let archivedStarted = false;
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: uuid(i + 1), update_time: (i < 4 ? NOW : NOW - 8 * DAY) / 1000
    }));
    const fetchDetail = vi.fn(async (id: string) => {
      const detail = linearConversation(1, id);
      for (const node of Object.values(detail.mapping ?? {})) {
        if (node.message) node.message.create_time = NOW / 1000;
      }
      return { ...detail, conversation_id: id, conversation_origin: "chat" };
    });
    stubFetch(async (path, init) => {
      if (path.includes("is_archived=false")) return json({ items, total: 50 });
      archivedStarted = true;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(json({ total: 0, items: [] })), 28_875);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });
    const pending = readChatHistory({
      now: NOW, identity: "account", store: createMemoryHistoryStore(),
      transport: { request: requestHistoryList }, fetchDetail
    });
    await vi.waitFor(() => expect(archivedStarted).toBe(true));
    await vi.advanceTimersByTimeAsync(28_875);
    const result = await pending;
    expect(fetchDetail).toHaveBeenCalledTimes(4);
    expect(result.turns).toHaveLength(4);
    expect(result.summary).toMatchObject({
      complete: true, failedConversations: 0, retryableFailures: 0,
      permanentFailures: 0, hitDetailBudget: false, hitDeadline: false, cancelled: false
    });
    expect(historyNeedsAnotherPass(result.summary)).toBe(false);
  });

  it.each(["timeout", "network", "body-network", 408, 500, 502, 503, 504])("marks %s as transport retry, not a data-progress pass", async (failure) => {
    stubFetch(async (path, init) => {
      if (path.includes("is_archived=false")) return json({ items: [] });
      if (failure === "timeout") return pendingResponse(init?.signal);
      if (failure === "network") throw new TypeError("Failed to fetch");
      if (failure === "body-network") {
        const response = json({});
        vi.spyOn(response, "json").mockRejectedValue(new TypeError("Connection interrupted"));
        return response;
      }
      return new Response(null, { status: failure as number });
    });
    const pending = readChatHistory({
      now: NOW, identity: "account", store: createMemoryHistoryStore(), transport: { request: requestHistoryList }
    });
    await vi.advanceTimersByTimeAsync(45_000);
    const { summary } = await pending;
    expect(summary).toMatchObject({ complete: false, retryableFailures: 1, permanentFailures: 0 });
    expect(historyNeedsAnotherPass(summary)).toBe(false);
  });

  it.each([401, 403, 400, 404, 429, "json", "schema", "identity"])("does not resume %s failures", async (failure) => {
    stubFetch(async () => {
      if (failure === "json") return new Response("not JSON");
      if (failure === "schema") return json({ items: null });
      if (failure === "identity") return json({ items: [{ id: "invalid", update_time: NOW / 1000 }] });
      return new Response(null, { status: failure as number });
    });
    const { summary } = await readChatHistory({
      now: NOW, identity: "account", store: createMemoryHistoryStore(), transport: { request: requestHistoryList }
    });
    expect(summary.complete).toBe(false);
    expect(summary.retryableFailures).toBe(0);
    expect(historyNeedsAnotherPass(summary)).toBe(false);
    // Budget exhaustion must not mask a permanent failure.
    expect(historyNeedsAnotherPass({ ...summary, hitDetailBudget: true, hitDeadline: true })).toBe(false);
  });

  it.each([new TypeError("network"), new Error("ChatGPT conversation API timed out"), new Error("ChatGPT conversation API failed: 503")])("classifies detail transport failures without changing the detail reader", async error => {
    vi.spyOn(conversationApi, "fetchConversation").mockRejectedValueOnce(error);
    await expect(requestHistoryDetail(uuid(1))).rejects.toBeInstanceOf(historyReader.RetryableHistoryTransportError);
  });

  it("keeps caller cancellation distinct from a retryable timeout", async () => {
    stubFetch(async (_path, init) => pendingResponse(init?.signal));
    const controller = new AbortController();
    const pending = requestHistoryList("/backend-api/conversations", controller.signal);
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await check;
  });
});

async function mountTracker() {
  const ledger = new QuotaLedger();
  const messages: QuotaIngest[] = [];
  vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(async (message: QuotaIngest | QuotaGetState) => {
    if (message.type === "quota/get-state") return { snapshot: await ledger.getSnapshot(message.accountKey!, message.plan ?? "pro") };
    messages.push(message);
    return { snapshot: await ledger.ingest(message.events, message) };
  });
  let listener: ConversationListener = () => undefined;
  const sync = { requestSync: vi.fn(async () => undefined), subscribe(callback: ConversationListener) { listener = callback; return () => undefined; } };
  tracker = new QuotaTracker(sync as unknown as ConversationSync);
  tracker.mount();
  return { ledger, messages, ingestCurrent: (snapshot: ConversationSnapshot) => listener(snapshot) };
}

async function seed(ledger: QuotaLedger, successAt = NOW) {
  await ledger.ingest([{ id: "history-turn", accountKey: "account", createdAt: NOW, model: "gpt-6-pro", classification: "personal" }], {
    accountKey: "account", plan: "pro", unclassifiedTurns: 33, historyComplete: true, syncStatus: "ready",
    lastHistorySuccessAt: successAt
  });
}

describe("quota tracker last-good lifecycle", () => {
  it("uses the exact 10 minute freshness boundary", () => {
    const baseline = { historyComplete: true, lastHistorySuccessAt: NOW };
    expect(shouldReconcileHistory(baseline, NOW + 599_999)).toBe(false);
    expect(shouldReconcileHistory(baseline, NOW + 600_000)).toBe(true);
    expect(shouldReconcileHistory({ historyComplete: true }, NOW)).toBe(true);
  });

  it("fresh mount/reload does not scan, live delta persists, and the due timer refreshes", async () => {
    let calls = 0;
    stubFetch(async () => { calls++; return json({ items: [] }); });
    const { ledger, ingestCurrent } = await mountTracker();
    await seed(ledger);
    await ingestCurrent({
      conversationId: uuid(1), revision: 1, capturedAt: NOW, activeTurns: [],
      quotaTurns: [{ id: "current-turn", createdAt: NOW, model: "gpt-6-pro" }],
      quotaIsWork: false, quotaUnclassifiedTurns: 1, quotaOrigin: "chat", quotaTemporary: false
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls).toBe(0);
    expect((await ledger.restore()).state).toMatchObject({ unclassifiedTurns: 33, syncStatus: "ready", historyComplete: true });
    expect((await ledger.getSnapshot("account", "pro")).gpt6ProWeekly?.estimatedRemaining).toBe(198);
    tracker!.dispose();
    await mountTracker();
    await vi.advanceTimersByTimeAsync(595_999);
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect((await ledger.restore()).state.lastHistorySuccessAt).toBe(NOW + 600_000);
  });

  it("stale refresh starts and fails without downgrading or losing last-good numbers", async () => {
    let calls = 0;
    stubFetch(async (_path, init) => { calls++; return pendingResponse(init?.signal); });
    const { ledger, messages } = await mountTracker();
    await seed(ledger, NOW - HISTORY_RECONCILE_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await ledger.restore()).state).toMatchObject({ historyComplete: true, syncStatus: "ready", unclassifiedTurns: 33 });
    await vi.advanceTimersByTimeAsync(3 * 45_000 + 1_500 + 5_000);
    expect(calls).toBe(3); // Original attempt + at most two transient retries.
    const { state } = await ledger.restore();
    expect(state).toMatchObject({ historyComplete: true, syncStatus: "ready", lastHistorySuccessAt: NOW - 600_000, lastHistoryAttemptAt: NOW + 4_000, unclassifiedTurns: 33 });
    expect(state.lastHistoryError).toBeTruthy();
    expect((await ledger.getSnapshot("account", "pro")).gpt6ProWeekly?.estimatedRemaining).toBe(199);
    expect(messages.every(message => message.historyComplete !== false)).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(3);
  });

  it("retries transient archived failure after 1.5 seconds and creates first baseline", async () => {
    let archivedCalls = 0;
    stubFetch(async (path, init) => {
      if (path.includes("is_archived=true") && ++archivedCalls === 1) return pendingResponse(init?.signal);
      return json({ items: [] });
    });
    const { ledger } = await mountTracker();
    await vi.advanceTimersByTimeAsync(4_000 + 45_000);
    expect((await ledger.restore()).state.syncStatus).toBe("backfill");
    await vi.advanceTimersByTimeAsync(1_499);
    expect(archivedCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(archivedCalls).toBe(2);
    expect((await ledger.restore()).state).toMatchObject({ syncStatus: "ready", historyComplete: true, lastHistorySuccessAt: NOW + 50_500, lastHistoryError: null });
  });

  it("manual refresh ignores a fresh TTL while retaining the baseline", async () => {
    let calls = 0;
    stubFetch(async (_path, init) => { calls++; return pendingResponse(init?.signal); });
    const { ledger } = await mountTracker();
    await seed(ledger);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls).toBe(0);
    await tracker!.refreshCurrent();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect((await ledger.restore()).state).toMatchObject({ historyComplete: true, syncStatus: "ready" });
  });

  it("honors manual force even while a fresh mount is still checking identity", async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(readChatAccount).mockImplementationOnce(async () => {
      await waiting;
      return { identity: "account", userId: "user", accountId: null, plan: "pro" };
    });
    let calls = 0;
    stubFetch(async () => { calls++; return json({ items: [] }); });
    const { ledger } = await mountTracker();
    await seed(ledger);
    await vi.advanceTimersByTimeAsync(4_000);
    await tracker!.refreshCurrent();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect((await ledger.restore()).state.lastHistorySuccessAt).toBe(NOW + 4_000);
  });

  it("does not spin a forced timer when account identity is temporarily unavailable", async () => {
    vi.mocked(readChatAccount).mockResolvedValueOnce({ identity: "unknown", userId: null, accountId: null, plan: null });
    let calls = 0;
    stubFetch(async () => { calls++; return json({ items: [] }); });
    const { ledger } = await mountTracker();
    await seed(ledger);
    await tracker!.refreshCurrent();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(0);
    expect((await ledger.restore()).state).toMatchObject({ historyComplete: true, lastHistorySuccessAt: NOW });
  });

  it("pauses hidden pages, resumes stale on visibility, and does nothing expensive while fresh", async () => {
    let calls = 0;
    stubFetch(async () => { calls++; return json({ items: [] }); });
    const { ledger } = await mountTracker();
    await seed(ledger);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls).toBe(0);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
  });

  it("stages partial slices and commits cache, events and success metadata in one write", async () => {
    const items = Array.from({ length: 26 }, (_, i) => ({ id: uuid(i + 1), update_time: NOW / 1000 }));
    let listCalls = 0;
    stubFetch(async path => {
      listCalls++;
      return json({ items: path.includes("is_archived=false") ? items : [] });
    });
    const details = vi.spyOn(conversationApi, "fetchConversation").mockImplementation(async id => {
      const detail = linearConversation(1, id);
      for (const node of Object.values(detail.mapping ?? {})) if (node.message) node.message.create_time = NOW / 1000;
      return { ...detail, conversation_origin: "chat" };
    });
    const { ledger } = await mountTracker();
    await seed(ledger, NOW - 600_000);
    const writes = vi.spyOn(chrome.storage.local, "set");
    await vi.advanceTimersByTimeAsync(4_000);
    // WebCrypto hashing uses a real microtask/task; give the reader time without consuming the slice timer.
    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect((await chrome.storage.local.get(HISTORY_CACHE_KEY))[HISTORY_CACHE_KEY]).toBeUndefined();
    expect((await ledger.restore()).ledger.events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.waitFor(async () => expect((await ledger.restore()).state.lastHistorySuccessAt).toBeGreaterThan(NOW));
    const commit = writes.mock.calls.map(call => call[0]).find(value => value[HISTORY_CACHE_KEY]);
    expect(Object.keys(commit!)).toEqual(expect.arrayContaining([HISTORY_CACHE_KEY, "chatgpt-yada:quota-ledger:v2", "chatgpt-yada:quota-state:v2"]));
    expect(details).toHaveBeenCalledTimes(26);
    expect((await ledger.restore()).ledger.events).toHaveLength(27);
  });

  it.each([0, 1])("requires real progress and caps data passes at 20 (progress=%s)", async conversationsFetched => {
    const reader = vi.spyOn(historyReader, "readChatHistory").mockResolvedValue({
      turns: [], summary: {
        queriedAt: NOW, observedFrom: NOW - 7 * DAY, complete: false, conversationsRead: 0,
        conversationsFetched, excludedWorkConversations: 0, unclassifiedTurns: 0,
        failedConversations: 1, retryableFailures: 0, permanentFailures: 0,
        cancelled: false, hitDetailBudget: true, hitDeadline: false
      }
    });
    const { ledger } = await mountTracker();
    await vi.advanceTimersByTimeAsync(4_000 + 20 * 1_500);
    expect(reader).toHaveBeenCalledTimes(conversationsFetched ? 20 : 1);
    expect((await ledger.restore()).state).toMatchObject({ historyComplete: false, syncStatus: "error" });
  });

  it("aborts a running reconcile only on dispose, not on hidden", async () => {
    stubFetch(async (_path, init) => pendingResponse(init?.signal));
    const { ledger } = await mountTracker();
    await seed(ledger, NOW - 600_000);
    await vi.advanceTimersByTimeAsync(4_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await ledger.restore()).state).toMatchObject({ historyComplete: true, syncStatus: "ready", lastHistorySuccessAt: NOW - 600_000 });
    tracker!.dispose();
    await vi.advanceTimersByTimeAsync(1);
    expect((await chrome.storage.local.get(HISTORY_CACHE_KEY))[HISTORY_CACHE_KEY]).toBeUndefined();
  });

  it.each([401, 403, 404, "schema"])("ends first sync on permanent %s failure and retries only later", async failure => {
    let calls = 0;
    stubFetch(async () => { calls++; return failure === "schema" ? json({}) : new Response(null, { status: failure }); });
    const { ledger } = await mountTracker();
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await ledger.restore()).state).toMatchObject({ historyComplete: false, syncStatus: "error" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
  });
});
