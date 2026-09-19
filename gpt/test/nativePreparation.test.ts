import { afterEach, describe, expect, it } from "vitest";
import { turns } from "./navFixtures";
import {
  decideNativePreparation,
  hasNonEmptyMessageQuery,
  nativePrepKey,
  stripEmptyMessageQuery,
  withEmptyMessageTrigger,
  type NativePrepHost
} from "../src/navigation/nativePreparation";
import type { NativeCapabilitySnapshot } from "../src/navigation/nativeCapability";

function memoryHost(href: string): NativePrepHost & { href: string; store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    href,
    store,
    getSession(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null; },
    setSession(key, value) { store[key] = value; },
    locationHref() { return this.href; },
    assign(url) { this.href = url; },
    replaceUrl(url) { this.href = url; }
  };
}

const incomplete: NativeCapabilitySnapshot = {
  officialButtonCount: 0,
  officialComplete: false,
  slotCount: 0,
  slotsComplete: false,
  mountedUserCount: 5,
  generating: false,
  composerDraft: false
};

const complete: NativeCapabilitySnapshot = {
  ...incomplete,
  officialButtonCount: 150,
  officialComplete: true,
  mountedUserCount: 5
};

describe("native preparation", () => {
  it("attempts empty message preparation at most once and does not loop", () => {
    const memory = memoryHost("https://chatgpt.com/c/conversation-1");
    const items = turns(150);
    const first = decideNativePreparation("conversation-1", items, memory.href, incomplete, memory);
    expect(first.action).toBe("assign");
    expect(memory.store[nativePrepKey("conversation-1")]).toBe("attempted");

    const second = decideNativePreparation("conversation-1", items, "https://chatgpt.com/c/conversation-1", incomplete, memory);
    expect(second.action).toBe("none");
    expect(second.state).toBe("attempted");

    const trigger = first.action === "assign" ? first.url : "";
    const third = decideNativePreparation("conversation-1", items, trigger, incomplete, memory);
    expect(third.action).toBe("unsupported");

    const fourth = decideNativePreparation("conversation-1", items, trigger, incomplete, memory);
    expect(fourth.action).toBe("none");
    expect(fourth.state).toBe("unsupported");
  });

  it("marks ready and strips the empty query after a successful attempt", () => {
    const memory = memoryHost("https://chatgpt.com/c/conversation-1?model=auto");
    const items = turns(150);
    const first = decideNativePreparation("conversation-1", items, memory.href, incomplete, memory);
    expect(first.action).toBe("assign");
    if (first.action !== "assign") throw new Error("expected assign");
    const ready = decideNativePreparation("conversation-1", items, first.url, complete, memory);
    expect(ready.action).toBe("ready");
    if (ready.action !== "ready") throw new Error("expected ready");
    expect(ready.url.includes("message=")).toBe(false);
    expect(stripEmptyMessageQuery(first.url)).toBe(ready.url);
    expect(memory.store[nativePrepKey("conversation-1")]).toBe("ready");
    const again = decideNativePreparation("conversation-1", items, ready.url, incomplete, memory);
    expect(again.action).toBe("none");
  });

  it("does not overwrite a non-empty message deep link", () => {
    const href = "https://chatgpt.com/c/conversation-1?message=abc-123";
    expect(hasNonEmptyMessageQuery(href)).toBe(true);
    expect(withEmptyMessageTrigger(href)).toBeNull();
    const memory = memoryHost(href);
    const decision = decideNativePreparation("conversation-1", turns(150), href, incomplete, memory);
    expect(decision).toEqual({ action: "none", state: "unseen" });
    expect(memory.store[nativePrepKey("conversation-1")]).toBeUndefined();
  });

  it("does not prepare while generating or when the composer has a draft", () => {
    const memory = memoryHost("https://chatgpt.com/c/conversation-1");
    const items = turns(150);
    expect(decideNativePreparation("conversation-1", items, memory.href, { ...incomplete, generating: true }, memory).action).toBe("none");
    expect(decideNativePreparation("conversation-1", items, memory.href, { ...incomplete, composerDraft: true }, memory).action).toBe("none");
    expect(memory.store[nativePrepKey("conversation-1")]).toBeUndefined();
  });
});
