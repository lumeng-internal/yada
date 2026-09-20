import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCompleteConversation,
  shouldFallbackToLegacyConversation
} from "../src/conversation/completeConversation";

describe("completeConversation transport ownership", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not fall back after a timeout", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return await new Promise<Response>((_, reject) => {
        const abort = (): void => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }) as typeof fetch;
    await expect(fetchCompleteConversation("id", {}, undefined, { requestTimeoutMs: 20, rateLimitWaitMs: 0 }))
      .rejects.toThrow(/timed out/);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("include_has_versions");
    expect(urls.some((url) => url.includes("include_full_conversation"))).toBe(false);
  });

  it("retries 429 once and does not fall back to legacy endpoints", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("no", { status: 429 });
    }) as typeof fetch;
    await expect(fetchCompleteConversation("id", {}, undefined, { requestTimeoutMs: 100, rateLimitWaitMs: 0 }))
      .rejects.toThrow(/API failed: 429/);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes("include_has_versions"))).toBe(true);
    expect(urls.some((url) => url.includes("include_full_conversation"))).toBe(false);
  });

  it("falls back only when the paginated shape is incompatible", async () => {
    expect(shouldFallbackToLegacyConversation(new Error("Paginated conversation API returned no messages"))).toBe(true);
    expect(shouldFallbackToLegacyConversation(new Error("ChatGPT conversation API timed out"))).toBe(false);
    expect(shouldFallbackToLegacyConversation(new Error("ChatGPT conversation API failed: 429"))).toBe(false);
    expect(shouldFallbackToLegacyConversation(new Error("ChatGPT conversation API failed: 500"))).toBe(false);
  });
});
