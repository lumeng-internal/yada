import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationBootGate, BOOT_FALLBACK_MS } from "../src/core/bootGate";
import type { ConversationSync } from "../src/core/conversationSync";
import { OfficialNavigatorHydrator } from "../src/nativeNavigator/hydrator";
import { NATIVE_NAV_CHANNEL, emptyTransportState } from "../src/nativeNavigator/protocol";
import type { ConversationSnapshot } from "../src/core/types";

function syncDouble(id = "current") {
  const state = { fulls: 0, usable: false, id };
  const sync = {
    getActiveConversationId: () => state.id,
    hasUsableFullSnapshot: () => state.usable,
    requestFull: async () => { state.fulls += 1; state.usable = true; },
    getSnapshot: () => null,
    subscribe: () => () => undefined
  };
  return { state, sync: sync as unknown as ConversationSync };
}

describe("conversation boot gate", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not read immediately, then reads once after transfer and idle", async () => {
    vi.useFakeTimers();
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    gate.arm("current");
    expect(state.fulls).toBe(0);
    const entry = { name: "https://chatgpt.com/backend-api/conversations/current?num_turns=100", responseEnd: 10 } as PerformanceEntry;
    performance.getEntriesByType = () => [entry];
    gate.arm("current");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);
    gate.arm("current");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);
    gate.dispose();
  });

  it("falls back once after 15 seconds and not while hidden", async () => {
    vi.useFakeTimers();
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    gate.arm("current");
    await vi.advanceTimersByTimeAsync(BOOT_FALLBACK_MS);
    expect(state.fulls).toBe(0);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    gate.arm("current");
    await vi.advanceTimersByTimeAsync(BOOT_FALLBACK_MS - 1);
    expect(state.fulls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.fulls).toBe(1);
    await vi.advanceTimersByTimeAsync(BOOT_FALLBACK_MS);
    expect(state.fulls).toBe(1);
    gate.dispose();
  });

  it("drops observers when the route changes before the fallback", async () => {
    vi.useFakeTimers();
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    gate.arm("current");
    gate.clear();
    await vi.advanceTimersByTimeAsync(BOOT_FALLBACK_MS);
    expect(state.fulls).toBe(0);
    gate.dispose();
  });
});

describe("navigator heavy work waits for prompts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
  });

  it("keeps the heavy observer off until a positive snapshot arrives", () => {
    history.replaceState({}, "", "/c/current");
    let listener: ((snapshot: ConversationSnapshot | null) => void) | null = null;
    const sync = {
      subscribe(callback: (snapshot: ConversationSnapshot | null) => void) {
        listener = callback;
        callback(null);
        return () => undefined;
      },
      getSnapshot: () => null
    } as unknown as ConversationSync;
    const hydrator = new OfficialNavigatorHydrator(sync);
    hydrator.mount();
    expect(hydrator.isHeavyWorkArmed()).toBe(false);
    window.dispatchEvent(new MessageEvent("message", {
      data: { channel: NATIVE_NAV_CHANNEL, kind: "state", state: emptyTransportState("current", 1) },
      origin: location.origin,
      source: window
    }));
    expect(hydrator.isHeavyWorkArmed()).toBe(false);
    listener?.({
      conversationId: "current",
      revision: 1,
      capturedAt: 1,
      activeTurns: [{ id: "t" }, { id: "u" }],
      quotaTurns: [],
      quotaIsWork: false,
      quotaUnclassifiedTurns: 0,
      quotaOrigin: "chat",
      quotaTemporary: false
    } as ConversationSnapshot);
    expect(hydrator.isHeavyWorkArmed()).toBe(true);
    hydrator.dispose();
  });
});
