import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationSync } from "../src/core/conversationSync";
import type { ConversationSnapshot } from "../src/core/types";
import { linearConversation } from "./helpers";
import { normalizeConversation } from "../src/conversation/normalizeConversation";

function snapshotFor(id: string, count = 2): ConversationSnapshot {
  const conversation = linearConversation(count, id);
  return {
    conversationId: id,
    revision: 0,
    capturedAt: Date.now(),
    activeTurns: normalizeConversation(conversation),
    quotaTurns: [],
    quotaIsWork: false,
    quotaUnclassifiedTurns: 0,
    quotaOrigin: "chat",
    quotaTemporary: false
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("ConversationSync", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("merges many sync requests into one in-flight read", async () => {
    let reads = 0;
    const gate = deferred<void>();
    const sync = new ConversationSync({
      async readConversation(id) {
        reads += 1;
        await gate.promise;
        return snapshotFor(id);
      }
    });
    const published: Array<string | null> = [];
    sync.subscribe((snapshot) => { published.push(snapshot?.conversationId ?? null); });
    sync.setActiveConversation("conversation-1");
    const requests = [
      sync.requestSync("a"),
      sync.requestSync("b"),
      sync.requestSync("c"),
      sync.requestSync("d"),
      sync.requestSync("e"),
      sync.requestSync("f"),
      sync.requestSync("g"),
      sync.requestSync("h"),
      sync.requestSync("i"),
      sync.requestSync("j")
    ];
    await flushMicrotasks();
    expect(reads).toBe(1);
    gate.resolve();
    await Promise.all(requests);
    expect(reads).toBe(1);
    expect(sync.getSnapshot()?.conversationId).toBe("conversation-1");
    expect(published.filter((id) => id === "conversation-1")).toHaveLength(1);
    sync.dispose();
  });

  it("runs one trailing read when a change arrives during the current read", async () => {
    let reads = 0;
    const first = deferred<void>();
    const second = deferred<void>();
    const sync = new ConversationSync({
      async readConversation(id) {
        reads += 1;
        await (reads === 1 ? first.promise : second.promise);
        return snapshotFor(id, reads);
      }
    });
    sync.setActiveConversation("conversation-1");
    const firstRun = sync.requestSync("first");
    await flushMicrotasks();
    expect(reads).toBe(1);
    const trailing = sync.requestSync("dirty");
    first.resolve();
    await flushMicrotasks();
    expect(reads).toBe(2);
    second.resolve();
    await Promise.all([firstRun, trailing]);
    expect(reads).toBe(2);
    expect(sync.getSnapshot()?.activeTurns).toHaveLength(2);
    sync.dispose();
  });

  it("does not publish an aborted generation after a route change", async () => {
    const first = deferred<ConversationSnapshot>();
    const second = deferred<ConversationSnapshot>();
    let reads = 0;
    const sync = new ConversationSync({
      readConversation(id, signal) {
        reads += 1;
        return new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          if (signal?.aborted) abort();
          signal?.addEventListener("abort", abort, { once: true });
          (id === "first" ? first.promise : second.promise).then(resolve, reject);
        });
      }
    });
    const published: string[] = [];
    sync.subscribe((snapshot) => {
      if (snapshot) published.push(snapshot.conversationId);
    });
    sync.setActiveConversation("first");
    await flushMicrotasks();
    sync.setActiveConversation("second");
    first.resolve(snapshotFor("first", 3));
    await flushMicrotasks();
    second.resolve(snapshotFor("second", 1));
    await flushMicrotasks(8);
    expect(published).not.toContain("first");
    expect(sync.getSnapshot()?.conversationId).toBe("second");
    expect(new Set(published)).toEqual(new Set(["second"]));
    sync.dispose();
  });

  it("waits for ledger listeners before manual refresh returns", async () => {
    const ledger = deferred<void>();
    let released = false;
    const sync = new ConversationSync({
      async readConversation(id) {
        return snapshotFor(id);
      }
    });
    sync.subscribe(async (snapshot) => {
      if (!snapshot) return;
      await ledger.promise;
      released = true;
    });
    sync.setActiveConversation("conversation-1");
    const refresh = sync.requestSync("popup");
    await flushMicrotasks();
    expect(released).toBe(false);
    ledger.resolve();
    await refresh;
    expect(released).toBe(true);
    sync.dispose();
  });

  it("does not start a full conversation read for ordinary DOM mutations", async () => {
    let reads = 0;
    const sync = new ConversationSync({
      async readConversation(id) {
        reads += 1;
        return snapshotFor(id);
      }
    });
    document.body.innerHTML = `<main><div data-message-author-role="assistant" data-message-id="a0">ok</div></main>`;
    sync.mountPageObserver(document.body);
    sync.setActiveConversation("conversation-1");
    await sync.requestSync("init");
    const afterFirst = reads;
    for (let i = 0; i < 100; i++) {
      const node = document.createElement("button");
      node.textContent = `menu-${i}`;
      document.body.append(node);
      node.dispatchEvent(new Event("mouseover", { bubbles: true }));
    }
    await flushMicrotasks(8);
    expect(reads).toBe(afterFirst);
    sync.dispose();
  });

  it("syncs once when streaming ends and ignores already seen assistant ids", async () => {
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
    document.body.append(assistant);
    sync.mountPageObserver(document.body);
    sync.setActiveConversation("conversation-1");
    await sync.requestSync("init");
    const afterFirst = reads;
    assistant.dataset.isStreaming = "true";
    await flushMicrotasks(6);
    expect(reads).toBe(afterFirst);
    assistant.dataset.isStreaming = "false";
    await flushMicrotasks(6);
    expect(reads).toBe(afterFirst + 1);
    assistant.dataset.isStreaming = "false";
    await flushMicrotasks(6);
    expect(reads).toBe(afterFirst + 1);
    sync.dispose();
  });

  it("does not retry a failed read and keeps the last good snapshot", async () => {
    let reads = 0;
    const sync = new ConversationSync({
      async readConversation(id) {
        reads += 1;
        if (reads === 1) return snapshotFor(id, 2);
        throw new Error("not ready");
      }
    });
    sync.setActiveConversation("conversation-1");
    await sync.requestSync("init");
    expect(sync.getSnapshot()?.activeTurns).toHaveLength(2);
    await sync.requestSync("refresh");
    expect(reads).toBe(2);
    expect(sync.getSnapshot()?.activeTurns).toHaveLength(2);
    expect(sync.getLastError()?.message).toBe("not ready");
    sync.dispose();
  });

  it("publishes unavailable once when the first read fails", async () => {
    let reads = 0;
    const published: Array<string | null> = [];
    const sync = new ConversationSync({
      async readConversation() {
        reads += 1;
        throw new Error("down");
      }
    });
    sync.subscribe((snapshot) => { published.push(snapshot?.conversationId ?? null); });
    sync.setActiveConversation("conversation-1");
    await sync.requestSync("init");
    expect(reads).toBe(1);
    expect(sync.getSnapshot()).toBeNull();
    expect(published.includes(null)).toBe(true);
    sync.dispose();
  });
});
