import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatGPTApiTimeoutError, chatgptApi } from "../src/conversation/fetchConversation";
import { historyNeedsAnotherPass, QuotaTracker, requestHistoryList } from "../src/quota/tracker";
import { createMemoryHistoryStore, readChatHistory } from "../src/quota/vibebar/historyReader";
import { QuotaLedger } from "../src/quota/ledger";
import type { ConversationSync } from "../src/core/conversationSync";
import type { ConversationListener, ConversationSnapshot } from "../src/core/types";
import type { QuotaIngest } from "../src/shared/messages";
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

  it.each(["timeout", "network", "body-network", 408, 500, 502, 503, 504])("marks %s as resumable", async (failure) => {
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
    expect(historyNeedsAnotherPass(summary)).toBe(true);
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
  vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(async (message: QuotaIngest) => {
    messages.push(message);
    return { snapshot: await ledger.ingest(message.events, message) };
  });
  let listener: ConversationListener = () => undefined;
  const sync = { subscribe(callback: ConversationListener) { listener = callback; return () => undefined; } };
  tracker = new QuotaTracker(sync as unknown as ConversationSync);
  tracker.mount();
  return { ledger, messages, ingestCurrent: (snapshot: ConversationSnapshot) => listener(snapshot) };
}

describe("quota tracker persistence and bounded recovery", () => {
  it("preserves history 33 on current ingestion with 1 and at backfill start", async () => {
    let listStarted = false;
    stubFetch(async (_path, init) => { listStarted = true; return pendingResponse(init?.signal); });
    const { ledger, ingestCurrent } = await mountTracker();
    await ledger.ingest([{ id: "history-turn", accountKey: "account", createdAt: NOW, model: "gpt-6-pro", classification: "personal" }], {
      accountKey: "account", plan: "pro", unclassifiedTurns: 33, historyComplete: true, syncStatus: "ready"
    });
    await ingestCurrent({
      conversationId: uuid(1), revision: 1, capturedAt: NOW, activeTurns: [],
      quotaTurns: [{ id: "current-turn", createdAt: NOW, model: "gpt-6-pro" }],
      quotaIsWork: false, quotaUnclassifiedTurns: 1, quotaOrigin: "chat", quotaTemporary: false
    });
    expect((await ledger.restore()).state.unclassifiedTurns).toBe(33);
    await vi.advanceTimersByTimeAsync(600);
    expect(listStarted).toBe(true);
    const restored = await ledger.restore();
    expect(restored.state).toMatchObject({ unclassifiedTurns: 33, syncStatus: "backfill", historyComplete: false });
    expect(restored.ledger.events.map((event) => event.id)).toEqual(["history-turn", "current-turn"]);
  });

  it("retries a timed-out archived request after 1.5 seconds and reaches ready", async () => {
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
    expect((await ledger.restore()).state).toMatchObject({ syncStatus: "ready", historyComplete: true });
  });

  it("stops at 20 passes under persistent timeouts without leaving a loading loop", async () => {
    let archivedCalls = 0;
    stubFetch(async (path, init) => {
      if (path.includes("is_archived=false")) return json({ items: [] });
      archivedCalls += 1;
      return pendingResponse(init?.signal);
    });
    const { ledger } = await mountTracker();
    await vi.advanceTimersByTimeAsync(4_000 + 20 * 45_000 + 19 * 1_500);
    expect(archivedCalls).toBe(20);
    expect((await ledger.restore()).state).toMatchObject({ syncStatus: "partial", historyComplete: false });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(archivedCalls).toBe(20);
  });

  it.each([401, 403, 404, "schema"])("stops the tracker after permanent %s failure", async (failure) => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return failure === "schema" ? json({}) : new Response(null, { status: failure });
    });
    const { ledger } = await mountTracker();
    await ledger.ingest([], { accountKey: "account", unclassifiedTurns: 33 });
    await vi.advanceTimersByTimeAsync(4_000);
    const { state } = await ledger.restore();
    expect(state.syncStatus).toBe(failure === 401 || failure === 403 ? "error" : "partial");
    if (state.syncStatus === "error") expect(state.unclassifiedTurns).toBe(33);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
  });
});
