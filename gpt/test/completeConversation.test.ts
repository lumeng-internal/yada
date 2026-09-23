import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCompleteConversation,
  shouldFallbackToLegacyConversation
} from "../src/conversation/completeConversation";
import { linearConversation } from "./helpers";

describe("completeConversation transport ownership", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it("uses a 30-second default request timeout", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      const abort = (): void => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      init?.signal?.addEventListener("abort", abort, { once: true });
    })) as typeof fetch;
    const pending = fetchCompleteConversation("id", {});
    let settled = false;
    void pending.catch(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10_500);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(19_500);
    await expect(pending).rejects.toThrow(/timed out/);
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
    expect(shouldFallbackToLegacyConversation(new Error("Conversation API returned invalid JSON"))).toBe(false);
  });

  it("times out when response.json never finishes and does not use a legacy endpoint", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    vi.spyOn(Response.prototype, "json").mockImplementation(() => new Promise(() => undefined));
    const pending = fetchCompleteConversation("id", {}, undefined, { requestTimeoutMs: 50, rateLimitWaitMs: 0 });
    const check = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(49);
    await vi.advanceTimersByTimeAsync(1);
    await check;
    expect(urls).toHaveLength(1);
    expect(urls.some((url) => url.includes("include_full_conversation"))).toBe(false);
  });

  it("aborts while the body is still being read", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    vi.spyOn(Response.prototype, "json").mockImplementation(() => new Promise(() => undefined));
    const pending = fetchCompleteConversation("id", {}, controller.signal, { requestTimeoutMs: 30_000 });
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await check;
  });

  it("does not retry a 500 forever", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("no", { status: 500 });
    }) as typeof fetch;
    await expect(fetchCompleteConversation("id", {}, undefined, { requestTimeoutMs: 50, rateLimitWaitMs: 0 }))
      .rejects.toThrow(/API failed: 500/);
    expect(urls).toHaveLength(1);
  });

  it("returns a slow but complete response", async () => {
    vi.useFakeTimers();
    const conversation = linearConversation(1, "id");
    globalThis.fetch = vi.fn(async () => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify(conversation), { status: 200 })), 80);
    })) as typeof fetch;
    const pending = fetchCompleteConversation("id", {}, undefined, { requestTimeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(80);
    await expect(pending).resolves.toMatchObject({ id: "id" });
  });

  it("removes the external abort listener after the request settles", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(linearConversation(1, "id")), { status: 200 })) as typeof fetch;
    await fetchCompleteConversation("id", {}, controller.signal, { requestTimeoutMs: 500 });
    expect(remove).toHaveBeenCalled();
  });
});
