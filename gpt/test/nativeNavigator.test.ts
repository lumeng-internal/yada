import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationSync } from "../src/core/conversationSync";
import { HistoryChain, readHistoryMetadata } from "../src/nativeNavigator/metadata";
import { exposePaginationSentinel, readNativePrompts } from "../src/nativeNavigator/dom";
import {
  OfficialNavigatorHydrator,
  officialNavigatorReadiness
} from "../src/nativeNavigator/hydrator";
import {
  NATIVE_NAV_CHANNEL,
  PREPARE_HEARTBEAT_MS,
  PREPARE_LEASE_MS,
  acceptPrepareHandshake,
  applyPrepareHandshake,
  canExpandInitial,
  emptyHistory,
  emptyPrepareLease,
  expandHistoryRequest,
  historyRequest,
  isNativeHistoryState,
  isPrepareActive,
  parseParkHandshake,
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

function promptTurns(start: number, count: number): Array<{ id: string; author: { role: string } }> {
  const messages: Array<{ id: string; author: { role: string } }> = [];
  for (let index = start; index < start + count; index += 1) {
    messages.push({ id: `u${index}`, author: { role: "user" } });
    messages.push({ id: `a${index}`, author: { role: "assistant" } });
  }
  return messages;
}

function pagedConversation(
  id: string,
  start: number,
  count: number,
  previous: false | string
): Record<string, unknown> {
  return {
    id,
    current_node: "branch",
    messages: promptTurns(start, count),
    page_info: previous === false
      ? { has_previous_page: false }
      : { has_previous_page: true, start_cursor: previous }
  };
}

function officialNavigator(found: number, visible = found): HTMLElement {
  const main = document.createElement("main");
  const root = document.createElement("div");
  root.className = "x_convSearchResultHighlightRoot";
  const fixed = document.createElement("div");
  fixed.className = "fixed inset-e-4 top-1/2 z-20 -translate-y-1/2";
  for (let index = 0; index < found; index += 1) {
    const button = document.createElement("button");
    button.dataset.tocItemIndex = String(index);
    button.setAttribute("aria-label", `Prompt ${index + 1}`);
    if (index >= visible) {
      button.style.display = "none";
      Object.defineProperty(button, "getClientRects", { value: () => [] });
    }
    fixed.append(button);
  }
  root.append(fixed);
  main.append(root);
  document.body.append(main);
  return main;
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
    expect(historyRequest("/backend-api/conversation/init", undefined, PAGE)).toBeNull();
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
    expect(cloneInit.method).toBe("GET");
    expect("body" in cloneInit).toBe(false);

    expect(turnsParam(expandHistoryRequest(
      "https://chatgpt.com/backend-api/conversations/current?num_turns=20",
      undefined,
      PAGE
    )[0])).toBe("100");
    expect(turnsParam(expandHistoryRequest(
      "https://chatgpt.com/backend-api/conversations/current/messages?before=cursor-1",
      undefined,
      PAGE
    )[0])).toBe("100");
    expect(turnsParam(expandHistoryRequest(
      "https://chatgpt.com/backend-api/conversations/current/messages?before=cursor-1&num_turns=20",
      undefined,
      PAGE
    )[0])).toBe("100");

    const alreadyLarge = new Request("https://chatgpt.com/backend-api/conversations/current/messages?before=c&num_turns=200");
    expect(expandHistoryRequest(alreadyLarge, undefined, PAGE)[0]).toBe(alreadyLarge);

    const other = "https://chatgpt.com/backend-api/conversations/other?num_turns=20";
    expect(expandHistoryRequest(other, undefined, PAGE)[0]).toBe(other);
    const foreign = "https://example.com/backend-api/conversations/current?num_turns=20";
    expect(expandHistoryRequest(foreign, undefined, PAGE)[0]).toBe(foreign);
    const posted = "https://chatgpt.com/backend-api/conversations/current?num_turns=20";
    expect(expandHistoryRequest(posted, { method: "POST" }, PAGE)[0]).toBe(posted);
    const ordinary = "https://chatgpt.com/backend-api/conversation/current/upload";
    expect(expandHistoryRequest(ordinary, undefined, PAGE)[0]).toBe(ordinary);
  });

  it("keeps early expand on visible initial pages and older expand only in prepare mode", () => {
    const initial = "/backend-api/conversations/current?num_turns=20";
    const older = "/backend-api/conversations/current/messages?before=cursor-1&num_turns=20";
    const deepLink = `${PAGE}?message=m1`;

    expect(canExpandInitial(initial, undefined, PAGE, true)).toBe(true);
    expect(canExpandInitial(initial, undefined, PAGE, false)).toBe(false);
    expect(canExpandInitial(initial, undefined, deepLink, true)).toBe(false);
    expect(canExpandInitial(older, undefined, PAGE, true)).toBe(false);

    expect(shouldExpandHistoryRequest(initial, undefined, PAGE, { visible: true, prepareActive: false })).toBe(true);
    expect(shouldExpandHistoryRequest(older, undefined, PAGE, { visible: true, prepareActive: false })).toBe(false);
    expect(shouldExpandHistoryRequest(older, undefined, PAGE, { visible: true, prepareActive: true })).toBe(true);
    expect(shouldExpandHistoryRequest(initial, undefined, deepLink, { visible: true, prepareActive: false })).toBe(false);
    expect(shouldExpandHistoryRequest(older, undefined, PAGE, { visible: false, prepareActive: true })).toBe(true);
  });
});

describe("prepare lease", () => {
  it("activates, heartbeats, expires, and rejects mismatched context", () => {
    const handshake = parsePrepareHandshake({
      kind: "prepare",
      enabled: true,
      conversationId: "current",
      generation: 3
    });
    expect(handshake).toEqual({ enabled: true, conversationId: "current", generation: 3 });
    expect(acceptPrepareHandshake(handshake!, { conversationId: "current", generation: 3 })).toBe(true);
    expect(acceptPrepareHandshake(handshake!, { conversationId: "other", generation: 3 })).toBe(false);
    expect(acceptPrepareHandshake(handshake!, { conversationId: "current", generation: 4 })).toBe(false);

    const started = applyPrepareHandshake(handshake!, 1_000);
    expect(started).toEqual({
      enabled: true,
      conversationId: "current",
      generation: 3,
      until: 1_000 + PREPARE_LEASE_MS
    });
    expect(isPrepareActive(started, 1_000 + 4_000, "current", 3)).toBe(true);
    expect(isPrepareActive(started, 1_000 + PREPARE_LEASE_MS, "current", 3)).toBe(false);
    expect(isPrepareActive(started, 2_000, "other", 3)).toBe(false);

    const heartbeat = applyPrepareHandshake(handshake!, 1_000 + PREPARE_HEARTBEAT_MS);
    expect(isPrepareActive(heartbeat, 1_000 + PREPARE_HEARTBEAT_MS + PREPARE_LEASE_MS - 1, "current", 3)).toBe(true);

    const stopped = applyPrepareHandshake({ ...handshake!, enabled: false }, 8_000);
    expect(stopped.enabled).toBe(false);
    expect(isPrepareActive(stopped, 8_000, "current", 3)).toBe(false);
    expect(isPrepareActive(emptyPrepareLease(), 8_000, "current", 3)).toBe(false);
    expect(isNativeHistoryState({ ...emptyHistory("current"), boosted: true })).toBe(true);
    expect(isNativeHistoryState({ ...emptyHistory("current"), boosted: "yes" })).toBe(false);
    expect(parseRouteEvent({
      channel: NATIVE_NAV_CHANNEL, kind: "route", conversationId: "current", generation: 1
    })).toEqual({ conversationId: "current", generation: 1 });
    expect(parseParkHandshake({
      kind: "park", conversationId: "current", generation: 1
    })).toEqual({ conversationId: "current", generation: 1 });
  });
});

describe("history metadata chain", () => {
  it("closes a short conversation from a complete initial page", () => {
    const initial = readHistoryMetadata(pagedConversation("current", 0, 30, false), "current");
    const chain = new HistoryChain();
    chain.accept(initial!, null);
    expect(initial!.messages).toHaveLength(60);
    expect(chain.boundary).toBe("complete");
    expect(chain.pages).toBe(1);
    expect(chain.prompts).toBe(30);
    expect(chain.cursor).toBeNull();
  });

  it("loads a 120-prompt conversation with one older page", () => {
    const initial = readHistoryMetadata(pagedConversation("current", 20, 100, "cursor-a"), "current");
    const older = readHistoryMetadata(pagedConversation("current", 0, 20, false), "current");
    const chain = new HistoryChain();
    chain.accept(initial!, null);
    expect(chain.boundary).toBe("more");
    expect(chain.cursor).toBe("cursor-a");
    expect(chain.prompts).toBe(100);
    chain.accept(older!, "cursor-a");
    expect(chain.boundary).toBe("complete");
    expect(chain.pages).toBe(2);
    expect(chain.prompts).toBe(120);
  });

  it("loads a 280-prompt conversation across three pages", () => {
    const initial = readHistoryMetadata(pagedConversation("current", 180, 100, "cursor-a"), "current");
    const olderA = readHistoryMetadata(pagedConversation("current", 80, 100, "cursor-b"), "current");
    const olderB = readHistoryMetadata(pagedConversation("current", 0, 80, false), "current");
    const chain = new HistoryChain();
    chain.accept(initial!, null);
    chain.accept(olderA!, "cursor-a");
    expect(chain.boundary).toBe("more");
    expect(chain.cursor).toBe("cursor-b");
    expect(chain.prompts).toBe(200);
    chain.accept(olderB!, "cursor-b");
    expect(chain.boundary).toBe("complete");
    expect(chain.pages).toBe(3);
    expect(chain.prompts).toBe(280);
    expect(chain.identities.size).toBe(560);
  });

  it("keeps the verified cursor chain when a later page stalls, then recovers", () => {
    const chain = new HistoryChain();
    chain.accept({
      messages: [{ id: "u2", prompt: true }],
      boundary: "more",
      cursor: "cursor-a",
      branch: "branch"
    }, null);
    chain.accept({
      messages: [{ id: "u1", prompt: true }],
      boundary: "more",
      cursor: "cursor-b",
      branch: "branch"
    }, "cursor-a");
    expect(chain.boundary).toBe("more");
    expect(chain.cursor).toBe("cursor-b");
    expect(chain.pages).toBe(2);

    chain.accept({
      messages: [{ id: "u1", prompt: true }],
      boundary: "more",
      cursor: "cursor-b",
      branch: "branch"
    }, "cursor-b");
    expect(chain.issue).toBe("stalled");
    expect(chain.boundary).toBe("more");
    expect(chain.cursor).toBe("cursor-b");
    expect(chain.pages).toBe(2);
    expect([...chain.identities.keys()]).toEqual(["u2", "u1"]);

    chain.clearTransientStalled();
    expect(chain.issue).toBeNull();
    chain.accept({
      messages: [{ id: "u0", prompt: true }],
      boundary: "complete",
      cursor: null,
      branch: "branch"
    }, "cursor-b");
    expect(chain.boundary).toBe("complete");
    expect(chain.issue).toBeNull();
    expect(chain.prompts).toBe(3);
  });

  it("fails closed on an unlinked cursor or selected-branch change", () => {
    const unlinked = new HistoryChain();
    unlinked.accept({ messages: [{ id: "u2", prompt: true }], boundary: "more", cursor: "cursor-b", branch: "a" }, null);
    unlinked.accept({ messages: [{ id: "u1", prompt: true }], boundary: "complete", cursor: null, branch: "a" }, "cursor-c");
    expect(unlinked.issue).toBe("unlinked");
    expect(unlinked.boundary).toBe("unknown");
    expect(unlinked.cursor).toBe("cursor-b");

    const mismatched = new HistoryChain();
    mismatched.accept({ messages: [{ id: "u2", prompt: true }], boundary: "more", cursor: "cursor-b", branch: "a" }, null);
    mismatched.accept({ messages: [{ id: "u1", prompt: true }], boundary: "complete", cursor: null, branch: "b" }, "cursor-b");
    expect(mismatched.issue).toBe("unlinked");
    expect(mismatched.boundary).toBe("unknown");
  });
});

describe("official navigator readiness", () => {
  it("treats a visible official navigator as ready even when counts differ", () => {
    expect(officialNavigatorReadiness({ found: 149, visible: 12 }, 0)).toBe("ready-complete");
    expect(officialNavigatorReadiness({ found: 12, visible: 0 }, 0)).toBe("hidden");
    expect(officialNavigatorReadiness({ found: 0, visible: 0 }, 1_000)).toBe("waiting-native");
    expect(officialNavigatorReadiness({ found: 0, visible: 0 }, 2_500)).toBe("loaded-no-native");
  });
});

describe("host DOM ownership", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("temporarily exposes one sentinel and restores only its owned styles", () => {
    const scroller = document.createElement("div");
    const sentinel = document.createElement("div");
    sentinel.dataset.testid = "conversation-pagination-sentinel";
    sentinel.style.top = "12px";
    Object.defineProperty(sentinel, "getClientRects", { value: () => [{ width: 1, height: 1 }] });
    Object.defineProperty(sentinel, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 1, left: 0, right: 1, width: 1, height: 1, x: 0, y: 0, toJSON() {} })
    });
    scroller.append(sentinel);
    document.body.append(scroller);
    const exposure = exposePaginationSentinel(scroller);
    expect(exposure).toBeTruthy();
    expect(sentinel.style.getPropertyValue("position")).toBe("sticky");
    expect(sentinel.style.getPropertyPriority("position")).toBe("important");
    exposure?.release();
    expect(sentinel.style.getPropertyValue("position")).toBe("");
    expect(sentinel.style.getPropertyValue("top")).toBe("12px");
  });

  it("recognizes the MIT-referenced official prompt structure without creating a Yada navigator", () => {
    officialNavigator(3);
    expect(readNativePrompts().found).toBe(3);
    expect(document.querySelector("[data-yada-navigator]")).toBeNull();
  });
});

describe("prepare session interruption", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("stops the current preparation and clears prepare on user input", () => {
    const posted: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => {
      posted.push(data);
    });
    const hydrator = new OfficialNavigatorHydrator({
      subscribe: () => () => undefined
    } as unknown as ConversationSync);
    hydrator.mount();
    const internals = hydrator as unknown as {
      state: ReturnType<typeof emptyHistory>;
      operation: AbortController | null;
      prepareEnabled: boolean;
    };
    internals.state = emptyHistory("current", 4);
    internals.prepareEnabled = true;
    const controller = new AbortController();
    internals.operation = controller;

    window.dispatchEvent(new Event("wheel"));
    expect(controller.signal.aborted).toBe(true);
    const stop = posted.map((item) => record(item)).find((item) => item?.kind === "prepare");
    expect(stop).toMatchObject({
      channel: NATIVE_NAV_CHANNEL,
      kind: "prepare",
      enabled: false,
      conversationId: "current",
      generation: 4
    });
    expect(internals.prepareEnabled).toBe(false);
    hydrator.dispose();
  });

  it("lets pointer, key, and touch input release the current session", () => {
    for (const type of ["pointerdown", "keydown", "touchstart"]) {
      const posted: unknown[] = [];
      const spy = vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => {
        posted.push(data);
      });
      const hydrator = new OfficialNavigatorHydrator({
        subscribe: () => () => undefined
      } as unknown as ConversationSync);
      hydrator.mount();
      const internals = hydrator as unknown as {
        state: ReturnType<typeof emptyHistory>;
        operation: AbortController | null;
        prepareEnabled: boolean;
      };
      internals.state = emptyHistory("current", 1);
      internals.prepareEnabled = true;
      const controller = new AbortController();
      internals.operation = controller;
      window.dispatchEvent(new Event(type));
      expect(controller.signal.aborted, type).toBe(true);
      expect(posted.map((item) => record(item)).some((item) => item?.kind === "prepare" && item.enabled === false), type).toBe(true);
      hydrator.dispose();
      spy.mockRestore();
    }
  });
});
