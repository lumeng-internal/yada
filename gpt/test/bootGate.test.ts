import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationBootGate, BOOT_FALLBACK_MS } from "../src/core/bootGate";
import type { ConversationSync } from "../src/core/conversationSync";
import { OfficialNavigatorHydrator } from "../src/nativeNavigator/hydrator";
import { NATIVE_NAV_CHANNEL, emptyTransportState, type NativeTransportState } from "../src/nativeNavigator/protocol";
import type { ConversationSnapshot } from "../src/core/types";

function syncDouble(id = "current") {
  const state = { fulls: 0, usable: false, id, reading: false };
  const sync = {
    getActiveConversationId: () => state.id,
    hasUsableFullSnapshot: (conversationId?: string | null) => state.usable && (!conversationId || conversationId === state.id),
    isReading: () => state.reading,
    requestFull: async () => {
      state.reading = true;
      state.fulls += 1;
      state.usable = true;
      state.reading = false;
    },
    getSnapshot: () => null,
    subscribe: () => () => undefined
  };
  return { state, sync: sync as unknown as ConversationSync };
}

function historyResource(conversationId: string, endedAt: number, durationMs = 10): PerformanceResourceTiming {
  return {
    name: `https://chatgpt.com/backend-api/conversations/${conversationId}?num_turns=100`,
    responseEnd: endedAt - performance.timeOrigin,
    startTime: endedAt - performance.timeOrigin - durationMs
  } as PerformanceResourceTiming;
}

function initialState(conversationId: string, generation: number, endedAt: number, durationMs = 10): NativeTransportState {
  return {
    ...emptyTransportState(conversationId, generation),
    historyRequests: 1,
    requestInFlight: false,
    lastRequestKind: "initial",
    lastRequestAt: Math.round(endedAt),
    lastRequestDurationMs: durationMs
  };
}

function postState(state: NativeTransportState): void {
  window.dispatchEvent(new MessageEvent("message", {
    data: { channel: NATIVE_NAV_CHANNEL, kind: "state", state },
    origin: location.origin,
    source: window
  }));
}

function stubPerformanceObserver() {
  const instances: Array<{ disconnected: boolean }> = [];
  vi.stubGlobal("PerformanceObserver", class {
    disconnected = false;
    observe() {
      instances.push(this);
    }
    disconnect() {
      this.disconnected = true;
    }
  });
  return instances;
}

describe("conversation boot gate", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not read immediately, then reads once after the current initial resource and idle", async () => {
    vi.useFakeTimers();
    stubPerformanceObserver();
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    const endedAt = performance.timeOrigin + 40;
    const entry = historyResource("current", endedAt);
    performance.getEntriesByType = () => [entry];
    gate.arm("current");
    expect(state.fulls).toBe(0);
    expect(gate.isPending()).toBe(true);
    postState(initialState("current", 1, endedAt));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);
    expect(gate.isPending()).toBe(false);
    gate.arm("current");
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);
    gate.dispose();
  });

  it("ignores an older resource from the same conversation until the current initial arrives", async () => {
    vi.useFakeTimers();
    stubPerformanceObserver();
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    const stale = historyResource("current", performance.timeOrigin + 8);
    const currentEndedAt = performance.timeOrigin + 80;
    performance.getEntriesByType = () => [stale];
    gate.arm("current");
    postState(emptyTransportState("current", 3));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(0);
    const current = historyResource("current", currentEndedAt);
    performance.getEntriesByType = () => [stale, current];
    postState(initialState("current", 3, currentEndedAt));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);
    gate.dispose();
  });

  it("does not reuse the first visit resource after A → B → A", async () => {
    vi.useFakeTimers();
    stubPerformanceObserver();
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    const firstEndedAt = performance.timeOrigin + 30;
    const first = historyResource("current", firstEndedAt);
    performance.getEntriesByType = () => [first];
    gate.arm("current");
    postState(initialState("current", 1, firstEndedAt));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);

    state.usable = false;
    state.id = "other";
    gate.arm("other");
    postState(emptyTransportState("other", 2));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);

    state.usable = false;
    state.id = "current";
    gate.arm("current");
    postState(emptyTransportState("current", 3));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);

    const secondEndedAt = performance.timeOrigin + 90;
    const second = historyResource("current", secondEndedAt);
    performance.getEntriesByType = () => [first, second];
    postState(initialState("current", 3, secondEndedAt));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(2);
    gate.dispose();
  });

  it("uses MAIN lifecycle and the 15s fallback when PerformanceObserver is missing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("PerformanceObserver", undefined);
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    gate.arm("current");
    expect(state.fulls).toBe(0);
    postState(initialState("current", 1, performance.timeOrigin + 25));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.fulls).toBe(1);
    gate.dispose();

    const again = syncDouble();
    const waiting = new ConversationBootGate(again.sync);
    waiting.arm("current");
    await vi.advanceTimersByTimeAsync(BOOT_FALLBACK_MS - 1);
    expect(again.state.fulls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(again.state.fulls).toBe(1);
    waiting.dispose();
  });

  it("falls back once after 15 seconds and not while hidden", async () => {
    vi.useFakeTimers();
    stubPerformanceObserver();
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

  it("drops observers, timers, and idle work when the route changes before the fallback", async () => {
    vi.useFakeTimers();
    const observers = stubPerformanceObserver();
    const { state, sync } = syncDouble();
    const gate = new ConversationBootGate(sync);
    const endedAt = performance.timeOrigin + 40;
    performance.getEntriesByType = () => [historyResource("current", endedAt)];
    gate.arm("current");
    expect(observers.some((item) => !item.disconnected)).toBe(true);
    expect(gate.isPending()).toBe(true);
    gate.clear();
    expect(observers.every((item) => item.disconnected)).toBe(true);
    expect(gate.isPending()).toBe(false);
    postState(initialState("current", 1, endedAt));
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
