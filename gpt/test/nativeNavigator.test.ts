import { afterEach, describe, expect, it } from "vitest";
import { HistoryChain, readHistoryMetadata } from "../src/nativeNavigator/metadata";
import { exposePaginationSentinel, readNativePrompts } from "../src/nativeNavigator/dom";
import { expandInitialHistoryRequest, historyRequest, requestCloneInit } from "../src/nativeNavigator/protocol";

describe("native history request boundary", () => {
  it("recognizes only current-conversation same-origin GET history", () => {
    const page = "https://chatgpt.com/c/current";
    expect(historyRequest("/backend-api/conversations/current?num_turns=20", undefined, page)).toMatchObject({
      conversationId: "current",
      kind: "initial",
      plural: true
    });
    expect(historyRequest("/backend-api/conversations/current/messages?before=cursor-1", undefined, page)).toMatchObject({
      kind: "older",
      before: "cursor-1"
    });
    expect(historyRequest("/backend-api/conversation/current", undefined, page)).toMatchObject({ plural: false });
    expect(historyRequest("/backend-api/conversations/other", undefined, page)).toBeNull();
    expect(historyRequest("https://example.com/backend-api/conversations/current", undefined, page)).toBeNull();
    expect(historyRequest("/backend-api/conversations/current", { method: "POST" }, page)).toBeNull();
    expect(historyRequest("/backend-api/conversations/current?message_id=m1", undefined, page)).toBeNull();
    expect(historyRequest("/backend-api/conversations/current/messages", undefined, page)).toBeNull();
    expect(historyRequest("/backend-api/conversation/init", undefined, page)).toBeNull();
  });

  it("raises num_turns to 100, preserves Request init fields, and respects deep links", () => {
    const request = new Request("https://chatgpt.com/backend-api/conversations/current?num_turns=20", {
      method: "GET",
      headers: { "X-Test": "kept" },
      credentials: "include"
    });
    const cloneInit = requestCloneInit(request);
    expect((cloneInit.headers as Headers).get("X-Test")).toBe("kept");
    expect(cloneInit.credentials).toBe("include");
    expect(cloneInit.signal).toBe(request.signal);

    const [expanded] = expandInitialHistoryRequest(
      "https://chatgpt.com/backend-api/conversations/current?num_turns=20",
      undefined,
      "https://chatgpt.com/c/current"
    );
    expect(new URL(String(expanded)).searchParams.get("num_turns")).toBe("100");

    const larger = new Request("https://chatgpt.com/backend-api/conversations/current?num_turns=150");
    expect(expandInitialHistoryRequest(larger, undefined, "https://chatgpt.com/c/current")[0]).toBe(larger);
    expect(expandInitialHistoryRequest(request, undefined, "https://chatgpt.com/c/current?message=m1")[0]).toBe(request);
  });
});

describe("history metadata chain", () => {
  it("requires a cursor-linked path to an explicit root", () => {
    const first = readHistoryMetadata({
      id: "current",
      current_node: "a2",
      messages: [
        { id: "u2", author: { role: "user" }, content: { parts: ["private body"] } },
        { id: "a2", author: { role: "assistant" }, content: { parts: ["private reply"] } }
      ],
      page_info: { has_previous_page: true, start_cursor: "cursor-1" }
    }, "current");
    const older = readHistoryMetadata({
      id: "current",
      current_node: "a2",
      messages: [
        { id: "u1", author: { role: "user" } },
        { id: "a1", author: { role: "assistant" } }
      ],
      page_info: { has_previous_page: false }
    }, "current");
    expect(first).toBeTruthy();
    expect(older).toBeTruthy();
    expect(JSON.stringify(first)).not.toContain("private body");
    expect(JSON.stringify(first)).not.toContain("private reply");

    const chain = new HistoryChain();
    chain.accept(first!, null);
    expect(chain.boundary).toBe("more");
    expect(chain.cursor).toBe("cursor-1");
    chain.accept(older!, "cursor-1");
    expect(chain.boundary).toBe("complete");
    expect(chain.pages).toBe(2);
    expect(chain.identities.size).toBe(4);
    expect(chain.prompts).toBe(2);
  });

  it("fails closed on an unlinked or repeated cursor", () => {
    const chain = new HistoryChain();
    chain.accept({
      messages: [{ id: "u2", prompt: true }],
      boundary: "more",
      cursor: "cursor-1",
      branch: "branch"
    }, null);
    chain.accept({
      messages: [{ id: "u1", prompt: true }],
      boundary: "more",
      cursor: "cursor-1",
      branch: "branch"
    }, "cursor-1");
    expect(chain.issue).toBe("stalled");

    const other = new HistoryChain();
    other.accept({ messages: [], boundary: "more", cursor: "cursor-1", branch: "a" }, null);
    other.accept({ messages: [], boundary: "complete", cursor: null, branch: "b" }, "wrong-cursor");
    expect(other.issue).toBe("unlinked");
    expect(other.boundary).toBe("unknown");
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
    const main = document.createElement("main");
    const root = document.createElement("div");
    root.className = "x_convSearchResultHighlightRoot";
    const fixed = document.createElement("div");
    fixed.className = "fixed inset-e-4 top-1/2 z-20 -translate-y-1/2";
    for (let index = 0; index < 3; index += 1) {
      const button = document.createElement("button");
      button.dataset.tocItemIndex = String(index);
      button.setAttribute("aria-label", `Prompt ${index + 1}`);
      fixed.append(button);
    }
    root.append(fixed);
    main.append(root);
    document.body.append(main);
    expect(readNativePrompts().found).toBe(3);
    expect(document.querySelector("[data-yada-navigator]")).toBeNull();
  });
});
