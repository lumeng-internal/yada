import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountMain,
  mountOfficialButtons,
  mountStableSlots,
  turns
} from "./navFixtures";
import {
  decideNativePreparation,
  hasNonEmptyMessageQuery,
  NativePreparationController,
  nativePrepKey,
  readNativePrepState,
  stripEmptyMessageQuery,
  withEmptyMessageTrigger,
  writeNativePrepState,
  type NativePrepHost
} from "../src/navigation/nativePreparation";
import type { NativeCapabilitySnapshot } from "../src/navigation/nativeCapability";

function memoryHost(href: string): NativePrepHost & { href: string; store: Record<string, string>; assigns: string[] } {
  const store: Record<string, string> = {};
  const assigns: string[] = [];
  return {
    href,
    store,
    assigns,
    getSession(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null; },
    setSession(key, value) { store[key] = value; },
    locationHref() { return this.href; },
    assign(url) {
      assigns.push(url);
      this.href = url;
    },
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

async function flushWaiter(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(16);
}

describe("native preparation decisions", () => {
  it("attempts empty message preparation at most once and waits instead of looping", () => {
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
    expect(third.action).toBe("wait");
    expect(third.state).toBe("attempted");
    expect(memory.store[nativePrepKey("conversation-1")]).toBe("attempted");

    const fourth = decideNativePreparation("conversation-1", items, trigger, incomplete, memory);
    expect(fourth.action).toBe("wait");
    expect(fourth.state).toBe("attempted");
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

describe("native preparation waiter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("becomes ready when official buttons appear after 500ms and strips the empty query", async () => {
    vi.useFakeTimers();
    mountMain();
    const memory = memoryHost("https://chatgpt.com/c/conversation-1?message=");
    writeNativePrepState("conversation-1", "attempted", memory);
    const controller = new NativePreparationController(memory);
    const items = turns(150);
    expect(controller.evaluate("conversation-1", items).action).toBe("wait");
    expect(controller.isWaiting()).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    mountOfficialButtons(150);
    await flushWaiter();

    expect(readNativePrepState("conversation-1", memory)).toBe("ready");
    expect(memory.href.includes("message=")).toBe(false);
    expect(controller.isWaiting()).toBe(false);
    expect(memory.assigns).toEqual([]);
    controller.dispose();
  });

  it("becomes ready when stable slots appear after 1500ms", async () => {
    vi.useFakeTimers();
    const scroller = mountMain();
    const memory = memoryHost("https://chatgpt.com/c/conversation-1?message=");
    writeNativePrepState("conversation-1", "attempted", memory);
    const controller = new NativePreparationController(memory);
    const items = turns(150);
    expect(controller.evaluate("conversation-1", items).action).toBe("wait");

    await vi.advanceTimersByTimeAsync(1_500);
    mountStableSlots(150, scroller);
    await flushWaiter();

    expect(readNativePrepState("conversation-1", memory)).toBe("ready");
    expect(controller.isWaiting()).toBe(false);
    controller.dispose();
  });

  it("marks unsupported after 3s if the skeleton never appears", async () => {
    vi.useFakeTimers();
    mountMain();
    const memory = memoryHost("https://chatgpt.com/c/conversation-1?message=");
    writeNativePrepState("conversation-1", "attempted", memory);
    const controller = new NativePreparationController(memory);
    expect(controller.evaluate("conversation-1", turns(150)).action).toBe("wait");

    await vi.advanceTimersByTimeAsync(2_999);
    expect(readNativePrepState("conversation-1", memory)).toBe("attempted");
    await vi.advanceTimersByTimeAsync(1);
    expect(readNativePrepState("conversation-1", memory)).toBe("unsupported");
    expect(controller.isWaiting()).toBe(false);
    expect(memory.assigns).toEqual([]);
    controller.dispose();
  });

  it("clears the old observer and timer on route switch without polluting the new conversation", async () => {
    vi.useFakeTimers();
    mountMain();
    const memory = memoryHost("https://chatgpt.com/c/conversation-1?message=");
    writeNativePrepState("conversation-1", "attempted", memory);
    const controller = new NativePreparationController(memory);
    expect(controller.evaluate("conversation-1", turns(150)).action).toBe("wait");
    expect(controller.waitingConversationId()).toBe("conversation-1");

    memory.href = "https://chatgpt.com/c/conversation-2";
    const next = controller.evaluate("conversation-2", turns(150));
    expect(next.action).toBe("assign");
    expect(controller.waitingConversationId()).toBeNull();
    expect(readNativePrepState("conversation-1", memory)).toBe("attempted");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(readNativePrepState("conversation-1", memory)).toBe("attempted");
    expect(readNativePrepState("conversation-2", memory)).toBe("attempted");
    controller.dispose();
  });

  it("dispose stops the observer and timer without leaking a later unsupported write", async () => {
    vi.useFakeTimers();
    mountMain();
    const memory = memoryHost("https://chatgpt.com/c/conversation-1?message=");
    writeNativePrepState("conversation-1", "attempted", memory);
    const controller = new NativePreparationController(memory);
    controller.evaluate("conversation-1", turns(150));
    expect(controller.hasActiveObserver()).toBe(true);
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    controller.dispose();
    expect(controller.isWaiting()).toBe(false);
    expect(controller.hasActiveObserver()).toBe(false);
    expect(disconnect).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(readNativePrepState("conversation-1", memory)).toBe("attempted");
  });

  it("assigns at most once for the same conversation", () => {
    vi.useFakeTimers();
    mountMain();
    const memory = memoryHost("https://chatgpt.com/c/conversation-1");
    const controller = new NativePreparationController(memory);
    const items = turns(150);
    expect(controller.evaluate("conversation-1", items).action).toBe("assign");
    expect(memory.assigns).toHaveLength(1);
    expect(controller.evaluate("conversation-1", items).action).toBe("wait");
    expect(controller.evaluate("conversation-1", items).action).toBe("wait");
    expect(memory.assigns).toHaveLength(1);
    controller.dispose();
  });
});
