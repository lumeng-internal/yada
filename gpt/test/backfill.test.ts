import { describe, expect, it, vi } from "vitest";
import { HistoryBackfill } from "../src/quota/historyBackfill";
import { BACKFILL_KEY } from "../src/quota/types";

describe("history backfill", () => {
  it("stops at the seven-day cutoff and does not rescan completed conversations", async () => {
    const now = Date.now();
    const calls: string[] = [];
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/backend-api/conversations?")) {
        return new Response(JSON.stringify({
          items: [
            { id: "fresh", update_time: now / 1000 },
            { id: "old", update_time: (now - 8 * 24 * 60 * 60 * 1000) / 1000 }
          ]
        }));
      }
      if (url.includes("/conversation/fresh")) {
        return new Response(JSON.stringify({
          id: "fresh",
          current_node: "a0",
          mapping: {
            u0: { id: "u0", message: { id: "u0", author: { role: "user" }, content: { content_type: "text", parts: ["hi"] } } },
            a0: { id: "a0", parent: "u0", message: { id: "a0", author: { role: "assistant" }, channel: "final", content: { content_type: "text", parts: ["ok"] }, metadata: { model_slug: "gpt-6-pro" } } }
          }
        }));
      }
      return new Response("nope", { status: 500 });
    });
    const send = vi.fn(async () => ({}));
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: send },
      storage: {
        local: {
          async get() { return {}; },
          async set() { return; }
        }
      }
    });
    const backfill = new HistoryBackfill();
    const status = await backfill.run();
    expect(["complete", "paused", "unavailable", "error"]).toContain(status);
    expect(calls.some((url) => url.includes("/conversation/old"))).toBe(false);
  });

  it("marks unavailable when the conversation list API is missing", async () => {
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: async () => ({}) },
      storage: { local: { get: async () => ({}), set: async () => undefined } }
    });
    const status = await new HistoryBackfill().run();
    expect(status).toBe("unavailable");
    expect(BACKFILL_KEY).toBe("chatgpt-yada:quota-backfill:v1");
  });
});
