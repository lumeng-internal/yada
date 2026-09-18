import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationRepository } from "../src/core/conversationRepository";
import { linearConversation, branchedConversation } from "./helpers";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

describe("ConversationRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one in-flight request across consumers", async () => {
    let reads = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/session")) return jsonResponse({});
      if (url.includes("include_full_conversation")) {
        reads += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return jsonResponse(linearConversation(4));
      }
      return new Response("nope", { status: 500 });
    });
    const repo = new ConversationRepository();
    const [a, b] = await Promise.all([repo.load("conversation-1"), repo.load("conversation-1")]);
    expect(reads).toBe(1);
    expect(a.revision).toBe(b.revision);
    expect(a.activeTurns).toHaveLength(4);
    expect(a.assistantEvents).toHaveLength(4);
    repo.dispose();
  });

  it("cancels the previous conversation when the route changes", async () => {
    const started: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/session")) return jsonResponse({});
      const id = decodeURIComponent(url.match(/\/conversation\/([^/?]+)/)?.[1] ?? "");
      started.push(id);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 80);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (init?.signal?.aborted) return new Response("aborted", { status: 499 });
      return jsonResponse(linearConversation(2, id));
    });
    const repo = new ConversationRepository();
    repo.setActiveConversation("first");
    await new Promise((resolve) => setTimeout(resolve, 10));
    repo.setActiveConversation("second");
    const snapshot = await repo.load("second");
    expect(snapshot.conversationId).toBe("second");
    expect(started[0]).toBe("first");
    repo.dispose();
  });

  it("keeps regenerate branch assistant events on the same snapshot revision", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/session")) return jsonResponse({});
      return jsonResponse(branchedConversation());
    });
    const repo = new ConversationRepository();
    const snapshot = await repo.load("branched");
    expect(snapshot.activeTurns).toHaveLength(1);
    expect(snapshot.assistantEvents.map((event) => event.assistantMessageId).sort()).toEqual(["a-old", "a0"]);
    expect(snapshot.activeTurns[0].assistantMessageId).toBe("a0");
    repo.dispose();
  });

  it("does not write conversation bodies to chrome.storage", async () => {
    const set = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { get: async () => ({}), set } } });
    vi.stubGlobal("fetch", async () => jsonResponse(linearConversation(3)));
    const repo = new ConversationRepository();
    await repo.load("conversation-1");
    expect(set).not.toHaveBeenCalled();
    repo.dispose();
  });
});
