import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSync } from "../src/core/conversationSync";
import type { ConversationSnapshot } from "../src/core/types";
import { exposePaginationSentinel, readNativePrompts } from "../src/nativeNavigator/dom";
import { OfficialNavigatorHydrator, officialNavigatorReadiness } from "../src/nativeNavigator/hydrator";
import {
  NATIVE_NAV_CHANNEL,
  PREPARE_HEARTBEAT_MS,
  PREPARE_LEASE_MS,
  acceptPrepareHandshake,
  applyPrepareHandshake,
  canExpandInitial,
  emptyPrepareLease,
  emptyTransportState,
  expandHistoryRequest,
  historyRequest,
  isNativeTransportState,
  isPrepareActive,
  parsePrepareHandshake,
  parseRouteEvent,
  record,
  requestCloneInit,
  shouldExpandHistoryRequest
} from "../src/nativeNavigator/protocol";

const PAGE = "https://chatgpt.com/c/current";

function turnsParam(value: RequestInfo | URL): string | null {
  const href = typeof value === "string" ? value : value instanceof Request ? value.url : String(value);
  return new URL(href, "https://chatgpt.com").searchParams.get("num_turns");
}

function visibleBox(element: HTMLElement, top = 10): void {
  const rectangle = {
    top,
    bottom: top + 20,
    left: 10,
    right: 110,
    width: 100,
    height: 20,
    x: 10,
    y: top,
    toJSON() {}
  };
  Object.defineProperty(element, "getClientRects", { configurable: true, value: () => [rectangle] });
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => rectangle });
}

function officialNavigator(found: number, visible = found): HTMLElement {
  const main = document.createElement("main");
  const root = document.createElement("div");
  root.className = "x_convSearchResultHighlightRoot";
  const fixed = document.createElement("div");
  fixed.className = "fixed inset-e-4 top-1/2 z-20 -translate-y-1/2";
  visibleBox(fixed);
  for (let index = 0; index < found; index += 1) {
    const button = document.createElement("button");
    button.dataset.tocItemIndex = String(index);
    button.setAttribute("aria-label", `Prompt ${index + 1}`);
    visibleBox(button, 10 + index);
    if (index >= visible) button.style.display = "none";
    fixed.append(button);
  }
  root.append(fixed);
  main.append(root);
  document.body.append(main);
  return main;
}

function mockSync(promptCount: number): ConversationSync {
  const snapshot = promptCount > 0
    ? ({ conversationId: "current", activeTurns: Array.from({ length: promptCount }, () => ({})) } as ConversationSnapshot)
    : null;
  return {
    subscribe(listener: (value: ConversationSnapshot | null) => void) {
      void listener(snapshot);
      return () => undefined;
    },
    getSnapshot() {
      return snapshot;
    }
  } as unknown as ConversationSync;
}

describe("native history request boundary", () => {
  it("recognizes only current-conversation same-origin GET history", () => {
    expect(historyRequest("/backend-api/conversations/current?num_turns=20", undefined, PAGE)).toMatchObject({
      conversationId: "current",
      kind: "initial",
      plural: true
    });
    expect(historyRequest("/backend-api/conversations/current/messages?before=cursor-1", undefined, PAGE)).toMatchObject({
      kind: "older",
      before: "cursor-1"
    });
    expect(historyRequest("/backend-api/conversation/current", undefined, PAGE)).toMatchObject({ plural: false });
    expect(historyRequest("/backend-api/conversations/other", undefined, PAGE)).toBeNull();
    expect(historyRequest("https://example.com/backend-api/conversations/current", undefined, PAGE)).toBeNull();
    expect(historyRequest("/backend-api/conversations/current", { method: "POST" }, PAGE)).toBeNull();
    expect(historyRequest("/backend-api/conversations/current?message_id=m1", undefined, PAGE)).toBeNull();
    expect(historyRequest("/backend-api/conversations/current/messages", undefined, PAGE)).toBeNull();
  });

  it("expands validated initial and older history requests without lowering a larger batch", () => {
    const request = new Request("https://chatgpt.com/backend-api/conversations/current?num_turns=20", {
      method: "GET",
      headers: { "X-Test": "kept" },
      credentials: "include"
    });
    const cloneInit = requestCloneInit(request);
    expect((cloneInit.headers as Headers).get("X-Test")).toBe("kept");
    expect(cloneInit.credentials).toBe("include");
    expect(cloneInit.signal).toBe(request.signal);
    expect("body" in cloneInit).toBe(false);

    expect(turnsParam(expandHistoryRequest(
      "https://chatgpt.com/backend-api/conversations/current?num_turns=20", undefined, PAGE
    )[0])).toBe("100");
    expect(turnsParam(expandHistoryRequest(
      "https://chatgpt.com/backend-api/conversations/current/messages?before=c&num_turns=20", undefined, PAGE
    )[0])).toBe("100");
    const alreadyLarge = new Request("https://chatgpt.com/backend-api/conversations/current/messages?before=c&num_turns=200");
    expect(expandHistoryRequest(alreadyLarge, undefined, PAGE)[0]).toBe(alreadyLarge);
  });

  it("keeps visible initial boost and prepare-only older boost", () => {
    const initial = "/backend-api/conversations/current?num_turns=20";
    const older = "/backend-api/conversations/current/messages?before=cursor-1&num_turns=20";
    expect(canExpandInitial(initial, undefined, PAGE, true)).toBe(true);
    expect(canExpandInitial(initial, undefined, PAGE, false)).toBe(false);
    expect(shouldExpandHistoryRequest(initial, undefined, PAGE, { visible: true, prepareActive: false })).toBe(true);
    expect(shouldExpandHistoryRequest(older, undefined, PAGE, { visible: true, prepareActive: false })).toBe(false);
    expect(shouldExpandHistoryRequest(older, undefined, PAGE, { visible: false, prepareActive: true })).toBe(true);
  });
});

describe("prepare lease and transport protocol", () => {
  it("activates, heartbeats, expires, and rejects mismatched context", () => {
    const handshake = parsePrepareHandshake({
      kind: "prepare", enabled: true, conversationId: "current", generation: 3
    });
    expect(acceptPrepareHandshake(handshake!, { conversationId: "current", generation: 3 })).toBe(true);
    expect(acceptPrepareHandshake(handshake!, { conversationId: "other", generation: 3 })).toBe(false);
    const started = applyPrepareHandshake(handshake!, 1_000);
    expect(isPrepareActive(started, 1_000 + 4_000, "current", 3)).toBe(true);
    expect(isPrepareActive(started, 1_000 + PREPARE_LEASE_MS, "current", 3)).toBe(false);
    const heartbeat = applyPrepareHandshake(handshake!, 1_000 + PREPARE_HEARTBEAT_MS);
    expect(isPrepareActive(heartbeat, 1_000 + PREPARE_HEARTBEAT_MS + PREPARE_LEASE_MS - 1, "current", 3)).toBe(true);
    expect(isPrepareActive(emptyPrepareLease(), 8_000, "current", 3)).toBe(false);
  });

  it("validates only lightweight request lifecycle state", () => {
    const state = {
      ...emptyTransportState("current", 2),
      revision: 4,
      historyRequests: 3,
      olderRequests: 2,
      requestInFlight: true,
      lastRequestKind: "older" as const
    };
    expect(isNativeTransportState(state)).toBe(true);
    expect(isNativeTransportState({ ...state, olderRequests: 4 })).toBe(false);
    expect(isNativeTransportState({ ...state, lastRequestError: "capture-unavailable" })).toBe(false);
    expect(parseRouteEvent({ kind: "route", conversationId: "current", generation: 1 }))
      .toEqual({ conversationId: "current", generation: 1 });
  });
});

describe("official Navigator contract", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/c/current");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never reports ready when expectedPrompts is zero", () => {
    expect(officialNavigatorReadiness({ found: 33, visible: 33 }, 0, 2)).toBe("waiting");
  });

  it("keeps a count mismatch recoverable", () => {
    expect(officialNavigatorReadiness({ found: 33, visible: 33 }, 36, 2)).toBe("incomplete");
  });

  it("requires two stable matching checks", async () => {
    officialNavigator(36);
    const hydrator = new OfficialNavigatorHydrator(mockSync(36));
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyTransportState>;
      connected: boolean;
      evaluate(): Promise<void>;
      stableCheckedAt: number;
      readyStableChecks: number;
      phase: string;
    };
    internals.state = emptyTransportState("current", 1);
    internals.connected = true;
    await internals.evaluate();
    expect(internals.readyStableChecks).toBe(1);
    expect(internals.phase).not.toBe("ready");
    expect(hydrator.isHeavyWorkArmed()).toBe(true);
    internals.stableCheckedAt -= 301;
    await internals.evaluate();
    expect(internals.readyStableChecks).toBe(2);
    expect(internals.phase).toBe("ready");
    expect(hydrator.isHeavyWorkArmed()).toBe(false);
    expect(hydrator.isParked()).toBe(true);
    hydrator.dispose();
  });

  it("keeps expected zero in waiting even with visible official buttons", async () => {
    officialNavigator(33);
    const hydrator = new OfficialNavigatorHydrator(mockSync(0));
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyTransportState>;
      connected: boolean;
      evaluate(): Promise<void>;
      phase: string;
    };
    internals.state = emptyTransportState("current", 1);
    internals.connected = true;
    await internals.evaluate();
    expect(internals.phase).toBe("waiting");
    expect(hydrator.isHeavyWorkArmed()).toBe(true);
    hydrator.dispose();
  });

  it("wakes sleeping work on a later same-conversation transport event", () => {
    const hydrator = new OfficialNavigatorHydrator(mockSync(2));
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyTransportState>;
      context: string;
      sleep(reason: string): void;
      phase: string;
    };
    internals.state = emptyTransportState("current", 1);
    internals.context = "current:1";
    internals.sleep("http-error");
    expect(internals.phase).toBe("sleeping");
    const incoming = { ...emptyTransportState("current", 1), revision: 1, historyRequests: 1, lastRequestKind: "initial" as const };
    window.dispatchEvent(new MessageEvent("message", {
      data: { channel: NATIVE_NAV_CHANNEL, kind: "state", state: incoming },
      origin: location.origin,
      source: window
    }));
    expect(internals.phase).toBe("waiting");
    expect(hydrator.isHeavyWorkArmed()).toBe(true);
    hydrator.dispose();
  });

  it("sleeps, rather than stopping, when an exposed sentinel produces no request for 12 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
    const main = document.createElement("main");
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(scroller, "clientTop", { configurable: true, value: 0 });
    visibleBox(scroller, 0);
    const message = document.createElement("div");
    message.dataset.messageAuthorRole = "user";
    visibleBox(message, 100);
    const sentinel = document.createElement("div");
    sentinel.dataset.testid = "conversation-pagination-sentinel";
    visibleBox(sentinel, 80);
    scroller.append(message, sentinel);
    main.append(scroller);
    document.body.append(main);

    const hydrator = new OfficialNavigatorHydrator(mockSync(2));
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyTransportState>;
      connected: boolean;
      context: string;
      launchAttempt(): Promise<void>;
      phase: string;
      sleepReason: string | null;
    };
    internals.state = { ...emptyTransportState("current", 1), boosted: true };
    internals.connected = true;
    internals.context = "current:1";
    const attempt = internals.launchAttempt();
    await vi.advanceTimersByTimeAsync(12_100);
    await attempt;
    expect(internals.phase).toBe("sleeping");
    expect(internals.sleepReason).toBe("no-host-request");
    expect(hydrator.isHeavyWorkArmed()).toBe(false);
    hydrator.dispose();
  });

  it("stops only when a real active budget is exhausted and route reset re-arms", async () => {
    const hydrator = new OfficialNavigatorHydrator(mockSync(2));
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyTransportState>;
      connected: boolean;
      activeMs: number;
      phase: string;
      evaluate(): Promise<void>;
    };
    internals.state = emptyTransportState("current", 1);
    internals.connected = true;
    internals.activeMs = 60_000;
    await internals.evaluate();
    expect(internals.phase).toBe("stopped");
    expect(hydrator.isHeavyWorkArmed()).toBe(false);
    hydrator.resetRoute();
    expect(internals.phase).toBe("waiting");
    expect(internals.activeMs).toBe(0);
    expect(hydrator.isHeavyWorkArmed()).toBe(true);
    hydrator.dispose();
  });
});

describe("host DOM ownership", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("temporarily exposes one sentinel and restores only owned styles", () => {
    const scroller = document.createElement("div");
    const sentinel = document.createElement("div");
    sentinel.dataset.testid = "conversation-pagination-sentinel";
    sentinel.style.top = "12px";
    visibleBox(sentinel);
    scroller.append(sentinel);
    document.body.append(scroller);
    const exposure = exposePaginationSentinel(scroller);
    expect(exposure).toBeTruthy();
    expect(sentinel.style.getPropertyValue("position")).toBe("sticky");
    exposure?.release();
    expect(sentinel.style.getPropertyValue("position")).toBe("");
    expect(sentinel.style.getPropertyValue("top")).toBe("12px");
  });

  it("rejects official controls hidden by an ancestor", () => {
    const main = officialNavigator(3);
    expect(readNativePrompts()).toMatchObject({ found: 3, visible: 3 });
    main.style.display = "none";
    expect(readNativePrompts()).toMatchObject({ found: 0, visible: 0 });
    expect(document.querySelector("[data-yada-navigator]")).toBeNull();
  });
});

describe("prepare session interruption", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/c/current");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("stops the current preparation and clears prepare on user input", () => {
    const posted: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => { posted.push(data); });
    const hydrator = new OfficialNavigatorHydrator(mockSync(1));
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyTransportState>;
      operation: AbortController | null;
      prepareEnabled: boolean;
    };
    internals.state = emptyTransportState("current", 4);
    internals.prepareEnabled = true;
    const controller = new AbortController();
    internals.operation = controller;
    window.dispatchEvent(new Event("wheel"));
    expect(controller.signal.aborted).toBe(true);
    expect(posted.map((item) => record(item)).some((item) => item?.kind === "prepare" && item.enabled === false)).toBe(true);
    expect(internals.prepareEnabled).toBe(false);
    hydrator.dispose();
  });
});
