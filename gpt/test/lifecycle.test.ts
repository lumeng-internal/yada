import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationSync, SIGNAL_INSPECTION_DEBOUNCE_MS } from "../src/core/conversationSync";
import type { ConversationSnapshot } from "../src/core/types";
import { installNativeHistoryHook } from "../src/nativeNavigator/mainHook";
import {
  NATIVE_NAV_CHANNEL,
  parseRouteEvent,
  record
} from "../src/nativeNavigator/protocol";
import { PromptPanel, PROMPT_HOST_ID } from "../src/prompts/panel";
import { ACCOUNT_CACHE_TTL_MS, MODEL_LIMITS_CACHE_TTL_MS, readChatAccount, readModelLimits, resetPageClientCaches } from "../src/quota/pageClient";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import {
  HISTORY_LOCK_RETRY_MS,
  HISTORY_RECONCILE_LOCK,
  type HistoryLockManager,
  QuotaTracker,
  withHistoryReconcileLock
} from "../src/quota/tracker";
import { GPT6_PRO, SOL_PRO } from "../src/quota/vibebar/allowances";
import { STATE_KEY, type QuotaSnapshot } from "../src/quota/types";
import { QUOTA_POPOVER_HOST_ID, QuotaIndicator } from "../src/ui/quotaIndicator";
import { YadaToolbar } from "../src/ui/toolbar";
import * as conversationApi from "../src/conversation/fetchConversation";
import { linearConversation } from "./helpers";
import { normalizeConversation } from "../src/conversation/normalizeConversation";

const ROOT = resolve(import.meta.dirname, "..");

function snapshotFor(id: string): ConversationSnapshot {
  return {
    conversationId: id,
    revision: 0,
    capturedAt: Date.now(),
    activeTurns: normalizeConversation(linearConversation(1, id)),
    quotaTurns: [],
    quotaIsWork: false,
    quotaUnclassifiedTurns: 0,
    quotaOrigin: "chat",
    quotaTemporary: false
  };
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

describe("source lifecycle invariants", () => {
  it("removes permanent RAF route polling, duplicate response parsing, and app hostGuard", () => {
    expect(existsSync(resolve(ROOT, "src/utils/route.ts"))).toBe(false);
    const content = readFileSync(resolve(ROOT, "src/content.ts"), "utf8");
    const toolbar = readFileSync(resolve(ROOT, "src/ui/toolbar.ts"), "utf8");
    const mainHook = readFileSync(resolve(ROOT, "src/nativeNavigator/mainHook.ts"), "utf8");
    expect(content).not.toMatch(/observeRouteChange|requestAnimationFrame|hostGuard/);
    expect(content).not.toMatch(/this\.dispose\(\);\s*this\.mount\(\)/);
    expect(toolbar).not.toMatch(/observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true/);
    expect(mainHook).toMatch(/kind:\s*"route"/);
    expect(mainHook).not.toMatch(/response\.clone|\.body\?*\.getReader|TextDecoder|JSON\.parse|captureActive/);
    expect(existsSync(resolve(ROOT, "src/nativeNavigator/metadata.ts"))).toBe(false);
  });
});

describe("MAIN route and transport lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses route messages", () => {
    expect(parseRouteEvent({
      channel: NATIVE_NAV_CHANNEL, kind: "route", conversationId: "b", generation: 2
    })).toEqual({ conversationId: "b", generation: 2 });
    expect(parseRouteEvent({ kind: "state" })).toBeNull();
  });

  it("emits one route event on conversation change and none for the same conversation", () => {
    const dom = new JSDOM("<!doctype html>", { url: "https://chatgpt.com/c/aaa" });
    const win = dom.window as unknown as Window;
    const routes: Array<{ conversationId: unknown; generation: unknown }> = [];
    const post = vi.spyOn(win, "postMessage").mockImplementation((data: unknown) => {
      const message = record(data);
      if (message?.kind === "route") routes.push({ conversationId: message.conversationId, generation: message.generation });
    });
    installNativeHistoryHook(win);
    win.history.pushState({}, "", "/c/bbb");
    win.history.replaceState({}, "", "/c/ccc");
    win.history.replaceState({}, "", "/c/ccc");
    expect(routes).toEqual([
      { conversationId: "bbb", generation: 1 },
      { conversationId: "ccc", generation: 2 }
    ]);
    post.mockRestore();
  });

  it("does not clone, parse, or consume a 10.5-second successful history response", async () => {
    vi.useFakeTimers();
    const dom = new JSDOM("<!doctype html>", { url: "https://chatgpt.com/c/aaa" });
    const win = dom.window as unknown as Window & { fetch: typeof fetch };
    const response = json({ id: "aaa", ok: true });
    const clone = vi.spyOn(response, "clone");
    const parse = vi.spyOn(response, "json");
    const reader = vi.spyOn(response.body!, "getReader");
    let original!: Promise<Response>;
    const native = vi.fn(() => {
      original = new Promise<Response>((resolve) => setTimeout(() => resolve(response), 10_500));
      return original;
    });
    win.fetch = native as unknown as typeof fetch;
    const states: Array<Record<string, unknown>> = [];
    vi.spyOn(win, "postMessage").mockImplementation((data: unknown) => {
      const message = record(data);
      if (message?.kind === "state" && record(message.state)) states.push(record(message.state)!);
    });
    installNativeHistoryHook(win);
    const pagePromise = win.fetch("/backend-api/conversations/aaa?num_turns=20");
    expect(pagePromise).toBe(original);
    expect(states.at(-1)).toMatchObject({ historyRequests: 1, requestInFlight: true, lastRequestKind: "initial" });
    await vi.advanceTimersByTimeAsync(10_500);
    const pageResponse = await pagePromise;
    await flush(4);
    expect(clone).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
    expect(pageResponse.bodyUsed).toBe(false);
    expect(states.at(-1)).toMatchObject({
      requestInFlight: false,
      lastHttpStatus: 200,
      lastRequestDurationMs: 10_500,
      lastRequestError: null
    });
    await expect(pageResponse.json()).resolves.toEqual({ id: "aaa", ok: true });
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationSync debounce", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("coalesces rapid mutations into one inspection and one streaming-end sync", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const sync = new ConversationSync({
      async readConversation(id) {
        reads += 1;
        return snapshotFor(id);
      }
    });
    const assistant = document.createElement("div");
    assistant.dataset.messageAuthorRole = "assistant";
    assistant.dataset.messageId = "a0";
    assistant.dataset.isStreaming = "true";
    document.body.append(assistant);
    sync.mountPageObserver(document.body);
    sync.setActiveConversation("conversation-1");
    await sync.requestSync("init");
    const afterFirst = reads;
    for (let i = 0; i < 40; i++) {
      const node = document.createElement("span");
      node.textContent = `token-${i}`;
      assistant.append(node);
    }
    await flush();
    expect(reads).toBe(afterFirst);
    assistant.dataset.isStreaming = "false";
    const extra = document.createElement("div");
    extra.dataset.messageAuthorRole = "assistant";
    extra.dataset.messageId = "a1";
    document.body.append(extra);
    await vi.advanceTimersByTimeAsync(SIGNAL_INSPECTION_DEBOUNCE_MS - 1);
    await flush();
    expect(reads).toBe(afterFirst);
    await vi.advanceTimersByTimeAsync(1);
    await flush(8);
    expect(reads).toBe(afterFirst + 1);
    sync.dispose();
  });
});

describe("toolbar and lazy panels", () => {
  let toolbar: YadaToolbar | null = null;
  afterEach(() => {
    toolbar?.dispose();
    toolbar = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("re-attaches the toolbar when the header is replaced without a body subtree observer", async () => {
    vi.useFakeTimers();
    const header = document.createElement("header");
    header.id = "page-header";
    const actions = document.createElement("div");
    actions.id = "conversation-header-actions";
    header.append(actions);
    document.body.append(header);
    toolbar = new YadaToolbar();
    toolbar.mount();
    const host = document.getElementById("chatgpt-yada-toolbar-host")!;
    expect(host.parentElement).toBe(actions);
    const replacement = document.createElement("div");
    replacement.id = "conversation-header-actions";
    header.replaceChild(replacement, actions);
    await vi.advanceTimersByTimeAsync(200);
    expect(host.parentElement).toBe(replacement);
    const article = document.createElement("article");
    article.textContent = "stream";
    document.body.append(article);
    await vi.advanceTimersByTimeAsync(200);
    expect(host.parentElement).toBe(replacement);
  });

  it("creates PromptPanel on first click and detaches document listeners on close", async () => {
    toolbar = new YadaToolbar();
    toolbar.mount();
    expect(document.getElementById(PROMPT_HOST_ID)).toBeNull();
    const button = document.getElementById("chatgpt-yada-toolbar-host")!.shadowRoot!.querySelector<HTMLButtonElement>("[data-prompts]")!;
    button.click();
    await vi.waitFor(() => expect(document.getElementById(PROMPT_HOST_ID)).toBeTruthy());
    const panel = (toolbar as unknown as { prompts: PromptPanel }).prompts;
    expect(panel.documentListenersAttached()).toBe(true);
    panel.close();
    expect(panel.documentListenersAttached()).toBe(false);
    expect(document.getElementById(PROMPT_HOST_ID)?.hidden).toBe(true);
    button.click();
    await vi.waitFor(() => expect(panel.documentListenersAttached()).toBe(true));
  });
});

describe("quota popover lazy and hidden dirty", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("creates the portal on first click and paints hidden storage changes only after visible", async () => {
    vi.useFakeTimers();
    const first = calculateQuotaSnapshot({
      accountKey: "account", plan: "pro", workspaceKind: "personal",
      events: Array.from({ length: 10 }, (_, i) => ({
        id: `g${i}`, accountKey: "account", createdAt: 1, model: GPT6_PRO, classification: "personal" as const
      })),
      historyComplete: true, unclassifiedTurns: 0, now: 1_800_000_000_000, lastHistorySuccessAt: 1_800_000_000_000
    });
    const second = calculateQuotaSnapshot({
      accountKey: "account", plan: "pro", workspaceKind: "personal",
      events: Array.from({ length: 80 }, (_, i) => ({
        id: `g${i}`, accountKey: "account", createdAt: 1, model: GPT6_PRO, classification: "personal" as const
      })),
      historyComplete: true, unclassifiedTurns: 0, now: 1_800_000_000_000, lastHistorySuccessAt: 1_800_000_000_000
    });
    const send = vi.fn(async () => ({ snapshot: first }));
    const host = document.createElement("div");
    const button = document.createElement("button");
    button.append(document.createElement("canvas"));
    host.append(button);
    document.body.append(host);
    const indicator = new QuotaIndicator(button, { send });
    await flush();
    expect(document.getElementById(QUOTA_POPOVER_HOST_ID)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    send.mockResolvedValue({ snapshot: second });
    await chrome.storage.local.set({ [STATE_KEY]: { version: 2 } });
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush(8);
    expect(send).toHaveBeenCalledTimes(2);
    button.click();
    expect(document.getElementById(QUOTA_POPOVER_HOST_ID)).toBeTruthy();
    indicator.close();
    indicator.dispose();
  });

  it("renders the healthy three-bucket details without disclaimer copy", async () => {
    const now = 1_800_000_000_000;
    const snapshot: QuotaSnapshot = calculateQuotaSnapshot({
      accountKey: "account",
      plan: "pro",
      workspaceKind: "personal",
      events: [
        ...Array.from({ length: 28 }, (_, i) => ({
          id: `g${i}`, accountKey: "account", createdAt: now, model: GPT6_PRO, classification: "personal" as const
        })),
        ...Array.from({ length: 41 }, (_, i) => ({
          id: `s${i}`, accountKey: "account", createdAt: now, model: SOL_PRO, classification: "personal" as const
        }))
      ],
      historyComplete: true,
      unclassifiedTurns: 0,
      now,
      lastHistorySuccessAt: now
    });
    snapshot.gpt6ProWeekly = { ...snapshot.gpt6ProWeekly!, estimatedRemaining: 172, limit: 200, remainingRatio: 172 / 200 };
    snapshot.solProDaily = { ...snapshot.solProDaily!, estimatedRemaining: 129, limit: 170, remainingRatio: 129 / 170 };
    snapshot.combinedDaily = { ...snapshot.combinedDaily!, estimatedRemaining: 158, limit: 200, remainingRatio: 158 / 200 };
    const host = document.createElement("div");
    const button = document.createElement("button");
    button.append(document.createElement("canvas"));
    host.append(button);
    document.body.append(host);
    const indicator = new QuotaIndicator(button, { send: async () => ({ snapshot }) });
    await flush();
    button.click();
    const text = document.getElementById(QUOTA_POPOVER_HOST_ID)?.shadowRoot?.textContent ?? "";
    expect(text).toContain("Pro 模型额度");
    expect(text).toContain("GPT-6 Pro");
    expect(text).toContain("7days");
    expect(text).toContain("86%");
    expect(text).toContain("预计剩余 172 / 200");
    expect(text).toContain("GPT-5.6 Sol Pro");
    expect(text).toContain("24h");
    expect(text).toContain("76%");
    expect(text).toContain("预计剩余 129 / 170");
    expect(text).toContain("GPT-6 Pro+5.6 Sol Pro");
    expect(text).toContain("79%");
    expect(text).toContain("预计剩余 158 / 200");
    expect(text).toContain("上次完整同步：刚刚");
    expect(text).not.toContain("本地估算，不是 ChatGPT 官方余额");
    expect(text).not.toContain("只统计个人 Chat，不统计 Work 和 Codex");
    expect(text).not.toContain("历史同步完整");
    indicator.dispose();
  });
});

describe("history reconcile lock", () => {
  it("lets the first caller run and later ifAvailable callers skip without error", async () => {
    let heldCount = 0;
    const locks: HistoryLockManager = {
      async request(_name, options, callback) {
        if (heldCount > 0 && options.ifAvailable) {
          await callback(null);
          return;
        }
        heldCount += 1;
        try {
          await callback({ name: HISTORY_RECONCILE_LOCK });
        } finally {
          heldCount -= 1;
        }
      }
    };
    let release!: () => void;
    let ran = 0;
    const first = withHistoryReconcileLock(async () => {
      ran += 1;
      await new Promise<void>((resolve) => { release = resolve; });
    }, locks);
    await flush(4);
    expect(ran).toBe(1);
    expect(await withHistoryReconcileLock(async () => { ran += 1; }, locks)).toBe("busy");
    expect(ran).toBe(1);
    release();
    await first;
    expect(await withHistoryReconcileLock(async () => { ran += 1; }, locks)).toBe("acquired");
    expect(ran).toBe(2);
    expect(HISTORY_LOCK_RETRY_MS).toBe(60_000);
  });
});

describe("page client caches", () => {
  afterEach(() => {
    resetPageClientCaches();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reuses account and model-limit fetches within TTL and bypasses on force", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const api = vi.spyOn(conversationApi, "chatgptApi").mockImplementation(async (path) => {
      if (path.includes("/api/auth/session")) return json({ user: { id: "user-1" } });
      if (path.includes("/backend-api/wham/usage")) return json({ plan_type: "pro" });
      return json({ model_limits: [] });
    });
    vi.spyOn(conversationApi, "getChatGptAccountId").mockReturnValue("account-abc");
    await readChatAccount();
    await readChatAccount();
    expect(api.mock.calls.filter((call) => String(call[0]).includes("/api/auth/session"))).toHaveLength(1);
    await readChatAccount(undefined, { now: 1_800_000_000_000 + ACCOUNT_CACHE_TTL_MS + 1 });
    expect(api.mock.calls.filter((call) => String(call[0]).includes("/api/auth/session"))).toHaveLength(2);
    api.mockClear();
    await readModelLimits(1_800_000_000_000);
    await readModelLimits(1_800_000_000_000 + MODEL_LIMITS_CACHE_TTL_MS - 1);
    expect(api.mock.calls.filter((call) => String(call[0]).includes("/conversation/init"))).toHaveLength(1);
    await readModelLimits(1_800_000_000_000 + MODEL_LIMITS_CACHE_TTL_MS + 1);
    expect(api.mock.calls.filter((call) => String(call[0]).includes("/conversation/init"))).toHaveLength(2);
    api.mockClear();
    await readChatAccount(undefined, { force: true });
    await readModelLimits(Date.now(), undefined, { force: true });
    expect(api.mock.calls.filter((call) => String(call[0]).includes("/api/auth/session"))).toHaveLength(1);
    expect(api.mock.calls.filter((call) => String(call[0]).includes("/conversation/init"))).toHaveLength(1);
  });

  it("invalidates account cache when cheap accountId changes", async () => {
    const api = vi.spyOn(conversationApi, "chatgptApi").mockImplementation(async (path) => {
      if (path.includes("/api/auth/session")) return json({ user: { id: "user-1" } });
      if (path.includes("/backend-api/wham/usage")) return json({ plan_type: "pro" });
      return json({ model_limits: [] });
    });
    const accountId = vi.spyOn(conversationApi, "getChatGptAccountId");
    accountId.mockReturnValue("account-one");
    await readChatAccount();
    accountId.mockReturnValue("account-two");
    await readChatAccount();
    expect(api.mock.calls.filter((call) => String(call[0]).includes("/api/auth/session"))).toHaveLength(2);
  });
});

describe("QuotaTracker hidden start vs running scan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not start a new scan while hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return json({ items: [] });
    }));
    const sync = { requestSync: vi.fn(async () => undefined), subscribe() { return () => undefined; } };
    const tracker = new QuotaTracker(sync as unknown as ConversationSync, { locks: null });
    tracker.mount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(0);
    tracker.dispose();
  });
});
