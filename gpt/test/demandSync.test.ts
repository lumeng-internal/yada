import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationSync } from "../src/core/conversationSync";
import { mergeRecentSnapshot } from "../src/conversation/mergeRecent";
import { normalizeConversation } from "../src/conversation/normalizeConversation";
import { parseConversation } from "../src/quota/vibebar/conversationParser";
import type { ConversationSnapshot } from "../src/core/types";
import { linearConversation } from "./helpers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function snapshotFor(count: number, id = "conversation-1"): Promise<ConversationSnapshot> {
  const conversation = linearConversation(count, id);
  const now = Date.now();
  const parsed = await parseConversation(conversation, id, now, 0);
  return {
    conversationId: id,
    revision: 0,
    capturedAt: now,
    activeTurns: normalizeConversation(conversation),
    quotaTurns: parsed.turns,
    quotaIsWork: parsed.isWork,
    quotaUnclassifiedTurns: parsed.unclassifiedTurns,
    quotaOrigin: "chat",
    quotaTemporary: false,
    coverage: "full"
  };
}

describe("recent and full conversation demand", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("reads only the recent tail after a full baseline when an answer finishes", async () => {
    vi.useFakeTimers();
    const full = await snapshotFor(2);
    const recent = await snapshotFor(3);
    recent.coverage = "recent";
    let fullReads = 0;
    let recentReads = 0;
    const sync = new ConversationSync({
      async readConversation() { fullReads += 1; return full; },
      async readRecentConversation() { recentReads += 1; return recent; }
    });
    const assistant = document.createElement("div");
    assistant.dataset.messageAuthorRole = "assistant";
    assistant.dataset.messageId = "a0";
    document.body.append(assistant);
    sync.mountPageObserver(document.body);
    sync.setActiveConversation("conversation-1");
    await sync.requestFull("boot");
    expect(fullReads).toBe(1);
    assistant.dataset.isStreaming = "true";
    await vi.advanceTimersByTimeAsync(300);
    assistant.dataset.isStreaming = "false";
    await vi.advanceTimersByTimeAsync(300);
    expect(recentReads).toBe(1);
    expect(fullReads).toBe(1);
    expect(sync.getSnapshot()?.activeTurns).toHaveLength(3);
    expect(sync.getSnapshot()?.quotaTurns).toHaveLength(3);
    sync.dispose();
  });

  it("replaces a regenerated tail without adding a second quota event", async () => {
    const full = await snapshotFor(2);
    const recent = await snapshotFor(2);
    recent.coverage = "recent";
    recent.activeTurns[1] = { ...recent.activeTurns[1]!, assistantMessageId: "a-new", assistantMarkdown: "replaced" };
    const merged = await mergeRecentSnapshot(full, recent);
    expect(merged?.activeTurns).toHaveLength(2);
    expect(merged?.activeTurns[1]?.assistantMessageId).toBe("a-new");
    expect(merged?.quotaTurns).toHaveLength(2);
  });

  it("replaces an edited tail when an earlier user id still anchors it", async () => {
    const full = await snapshotFor(3);
    const recent = await snapshotFor(3);
    recent.coverage = "recent";
    recent.activeTurns = recent.activeTurns.slice(1).map((turn, index) => index === 0
      ? turn
      : { ...turn, userMessageId: "u-edited", assistantMessageId: "a-edited" });
    const merged = await mergeRecentSnapshot(full, recent);
    expect(merged?.activeTurns.map((turn) => turn.userMessageId)).toEqual(["u0", "u1", "u-edited"]);
  });

  it("does not guess when the recent tail has no anchor and schedules one full read", async () => {
    vi.useFakeTimers();
    const full = await snapshotFor(2);
    const recent = await snapshotFor(1, "conversation-1");
    recent.activeTurns = recent.activeTurns.map((turn) => ({ ...turn, userMessageId: "u-foreign", assistantMessageId: "a-foreign" }));
    recent.coverage = "recent";
    let fullReads = 0;
    const sync = new ConversationSync({
      async readConversation() { fullReads += 1; return full; },
      async readRecentConversation() { return recent; }
    });
    sync.setActiveConversation("conversation-1");
    await sync.requestFull("boot");
    await sync.requestRecent("streaming-end");
    expect(sync.getSnapshot()?.activeTurns).toHaveLength(2);
    expect(sync.hasUsableFullSnapshot()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fullReads).toBe(2);
    sync.dispose();
  });

  it("does not reread when a known assistant node is mounted again", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const sync = new ConversationSync({
      async readConversation(id) {
        reads += 1;
        return snapshotFor(1, id);
      },
      readRecentConversation: null
    });
    const assistant = document.createElement("div");
    assistant.dataset.messageAuthorRole = "assistant";
    assistant.dataset.messageId = "known";
    document.body.append(assistant);
    sync.mountPageObserver(document.body);
    sync.setActiveConversation("conversation-1");
    assistant.remove();
    document.body.append(assistant);
    await vi.advanceTimersByTimeAsync(300);
    expect(reads).toBe(0);
    sync.dispose();
  });

  it("shares one in-flight recent read and trails at most one full", async () => {
    const gate = deferred<void>();
    let recentReads = 0;
    let fullReads = 0;
    const sync = new ConversationSync({
      async readConversation(id) {
        fullReads += 1;
        return snapshotFor(2, id);
      },
      async readRecentConversation(id) {
        recentReads += 1;
        await gate.promise;
        return snapshotFor(2, id);
      }
    });
    sync.setActiveConversation("conversation-1");
    await sync.requestFull("boot");
    const first = sync.requestRecent("streaming-end");
    const second = sync.requestRecent("new-assistant");
    await Promise.resolve();
    expect(recentReads).toBe(1);
    const trailing = sync.requestFull("copy");
    gate.resolve();
    await first;
    await second;
    await trailing;
    expect(recentReads).toBe(1);
    expect(fullReads).toBe(2);
    sync.dispose();
  });

  it("lets one listener fail without blocking another", async () => {
    let seen = false;
    const sync = new ConversationSync({
      async readConversation(id) { return snapshotFor(1, id); }
    });
    sync.subscribe(() => { throw new Error("listener failed"); });
    sync.subscribe((snapshot) => { if (snapshot) seen = true; });
    sync.setActiveConversation("conversation-1");
    await sync.requestFull("boot");
    expect(seen).toBe(true);
    sync.dispose();
  });
});
