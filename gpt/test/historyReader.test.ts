import { describe, expect, it, vi } from "vitest";
import { createMemoryHistoryStore, readChatHistory } from "../src/quota/vibebar/historyReader";
import { identity } from "../src/quota/vibebar/conversationParser";
import { historyNeedsAnotherPass } from "../src/quota/tracker";
import { linearConversation } from "./helpers";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function recentConversation(id: string) {
  const detail = linearConversation(1, id);
  for (const node of Object.values(detail.mapping ?? {})) {
    if (node.message) node.message.create_time = NOW / 1000;
  }
  return { ...detail, conversation_id: id, conversation_origin: "chat" };
}

describe("history reader", () => {
  it("reads archived false then true, stops at seven days, and skips unchanged revisions", async () => {
    const store = createMemoryHistoryStore();
    const calls: string[] = [];
    const fresh = uuid(1);
    const old = uuid(2);
    const work = uuid(3);
    const cached = uuid(4);
    const cachedKey = await identity(cached);
    await store.save({
      conversations: {
        [cachedKey]: { updatedAt: NOW - 1000, turns: [{ id: "chat-cached", createdAt: NOW - 1000, model: "gpt-6-pro" }], isWork: false, unclassifiedTurns: 0 }
      }
    }, "account");
    const result = await readChatHistory({
      now: NOW,
      identity: "account",
      store,
      transport: {
        async request(path) {
          calls.push(path);
          if (path.includes("is_archived=false") && path.includes("offset=0")) {
            return {
              items: [
                { id: fresh, update_time: NOW / 1000, conversation_origin: "chat" },
                { id: cached, update_time: (NOW - 1000) / 1000, conversation_origin: "chat" },
                { id: work, update_time: NOW / 1000, conversation_origin: "tpp" },
                { id: old, update_time: (NOW - 8 * DAY) / 1000, conversation_origin: "chat" }
              ],
              total: 4
            };
          }
          if (path.includes("is_archived=true")) {
            return { items: [], total: 0 };
          }
          if (path.endsWith(`/conversation/${fresh}`)) {
            return { ...linearConversation(1, fresh), conversation_id: fresh, conversation_origin: "chat" };
          }
          throw new Error(path);
        }
      }
    });
    expect(calls.filter((path) => path.includes("/conversation/")).sort()).toEqual([
      `/backend-api/conversation/${fresh}`
    ]);
    expect(result.summary.excludedWorkConversations).toBe(1);
    expect(result.summary.complete).toBe(true);
    expect(result.turns.some((turn) => turn.id === "chat-cached")).toBe(true);
  });

  it("marks incomplete when the detail budget is exceeded", async () => {
    const items = Array.from({ length: 26 }, (_, i) => ({
      id: uuid(i + 10),
      update_time: NOW / 1000,
      conversation_origin: "chat"
    }));
    const result = await readChatHistory({
      now: NOW,
      identity: "account",
      store: createMemoryHistoryStore(),
      detailBudget: 24,
      transport: {
        async request(path) {
          if (path.includes("/conversations?")) {
            if (path.includes("is_archived=false") && path.includes("offset=0")) return { items, total: 26 };
            return { items: [], total: 0 };
          }
          const id = path.split("/").at(-1)!;
          return { ...linearConversation(1, id), conversation_id: id, conversation_origin: "chat" };
        }
      }
    });
    expect(result.summary.hitDetailBudget).toBe(true);
    expect(result.summary.complete).toBe(false);
    expect(result.summary.failedConversations).toBeGreaterThan(0);
  });

  it("converges across bounded passes by reusing the persistent detail cache", async () => {
    const store = createMemoryHistoryStore();
    const items = Array.from({ length: 26 }, (_, i) => ({
      id: uuid(i + 100),
      update_time: NOW / 1000,
      conversation_origin: "chat"
    }));
    const details: string[] = [];
    const read = () => readChatHistory({
      now: NOW,
      identity: "account",
      store,
      detailBudget: 24,
      transport: {
        async request(path) {
          if (path.includes("is_archived=false")) return { items, total: items.length };
          if (path.includes("is_archived=true")) return { items: [], total: 0 };
          throw new Error(path);
        }
      },
      async fetchDetail(id) {
        details.push(id);
        return recentConversation(id);
      }
    });

    const first = await read();
    expect(historyNeedsAnotherPass(first.summary)).toBe(true);
    expect(first.summary.hitDetailBudget).toBe(true);
    expect(first.summary.complete).toBe(false);
    expect(details).toHaveLength(24);

    const second = await read();
    expect(historyNeedsAnotherPass(second.summary)).toBe(false);
    expect(second.summary.complete).toBe(true);
    expect(second.turns).toHaveLength(26);
    expect(details).toHaveLength(26);
  });

  it("stops at the 25 second deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = await readChatHistory({
        now: NOW,
        identity: "account",
        store: createMemoryHistoryStore(),
        clock: () => Date.now(),
        transport: {
          async request(path) {
            vi.advanceTimersByTime(26_000);
            if (path.includes("/conversations?")) return { items: [{ id: uuid(1), update_time: NOW / 1000, conversation_origin: "chat" }], total: 1 };
            return {};
          }
        }
      });
      expect(result.summary.hitDeadline).toBe(true);
      expect(result.summary.complete).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips temporary chats and still scans the archived stream", async () => {
    const calls: string[] = [];
    const result = await readChatHistory({
      now: NOW,
      identity: "account",
      store: createMemoryHistoryStore(),
      transport: {
        async request(path) {
          calls.push(path);
          if (path.includes("is_archived=false")) {
            return {
              items: [{ id: uuid(9), update_time: NOW / 1000, conversation_origin: "chat", is_temporary_chat: true }],
              total: 1
            };
          }
          if (path.includes("is_archived=true")) return { items: [], total: 0 };
          throw new Error(path);
        }
      }
    });
    expect(calls.some((path) => path.includes("is_archived=true"))).toBe(true);
    expect(result.turns).toHaveLength(0);
    expect(result.summary.complete).toBe(true);
  });

  it("does not stop a full page when list total undercounts, and uses fetchDetail", async () => {
    const details: string[] = [];
    const page0 = Array.from({ length: 50 }, (_, i) => ({
      id: uuid(i + 1),
      update_time: NOW / 1000,
      conversation_origin: "chat"
    }));
    const page1 = [{ id: uuid(80), update_time: NOW / 1000, conversation_origin: "chat" }];
    const result = await readChatHistory({
      now: NOW,
      identity: "account",
      store: createMemoryHistoryStore(),
      detailBudget: 2,
      transport: {
        async request(path) {
          if (path.includes("is_archived=false") && path.includes("offset=0")) {
            return { items: page0, total: 2 };
          }
          if (path.includes("is_archived=false") && path.includes("offset=50")) {
            return { items: page1, total: 2 };
          }
          if (path.includes("is_archived=true")) return { items: [], total: 0 };
          throw new Error(path);
        }
      },
      async fetchDetail(id) {
        details.push(id);
        return { ...linearConversation(1, id), conversation_id: id, conversation_origin: "chat" };
      }
    });
    expect(details).toEqual([uuid(1), uuid(2)]);
    expect(result.summary.hitDetailBudget).toBe(true);
    expect(result.summary.complete).toBe(false);
  });
});
