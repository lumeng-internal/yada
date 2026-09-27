import { afterEach, describe, expect, it } from "vitest";
import {
  collectCompletedAssistantIds,
  collectPageMessages,
  conversationScroller,
  findNativeActionGroup,
  isGenerating,
  readOfficialNavigator,
  readingPositionDrift,
  saveReadingPosition,
  stableLayoutAvailable
} from "../src/platform/pageFacts";

function box(element: HTMLElement, rect: { top: number; left: number; width: number; height: number }): void {
  const rectangle = {
    top: rect.top,
    left: rect.left,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() {}
  };
  Object.defineProperty(element, "getClientRects", { configurable: true, value: () => [rectangle] });
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => rectangle });
}

const originalComputed = window.getComputedStyle;

describe("unified page facts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.getComputedStyle = originalComputed;
  });

  it("reads a new-structure assistant from the container id, using H4 only as a role clue", () => {
    document.body.innerHTML = `
      <main>
        <article data-turn-id="turn-assistant-1">
          <h4>ChatGPT</h4>
          <div>hello</div>
        </article>
      </main>
    `;
    const messages = collectPageMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: "turn-assistant-1", role: "assistant" });
    expect(collectCompletedAssistantIds()).toEqual(["turn-assistant-1"]);
  });

  it("does not treat missing old role attributes as generation complete while the stop button is present", () => {
    document.body.innerHTML = `
      <main>
        <article data-turn-id="turn-assistant-1">
          <h4>ChatGPT</h4>
        </article>
        <button data-testid="stop-button">Stop</button>
      </main>
    `;
    expect(isGenerating()).toBe(true);
    expect(collectCompletedAssistantIds()).toEqual([]);
  });

  it("finds a reverse scroller with negative scrollTop and overflow-anchor none", () => {
    const main = document.createElement("main");
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2400 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: -120 });
    Object.defineProperty(scroller, "clientTop", { configurable: true, value: 0 });
    const style = {
      overflowY: "auto",
      overflowAnchor: "none",
      visibility: "visible",
      display: "block",
      opacity: "1"
    } as CSSStyleDeclaration;
    Object.defineProperty(scroller, "style", { configurable: true, value: new Proxy(scroller.style, {
      get(target, property) {
        if (property in style) return style[property as keyof CSSStyleDeclaration];
        return Reflect.get(target, property);
      }
    }) });
    viSpyComputed(scroller, style);
    const article = document.createElement("article");
    article.dataset.turnId = "turn-1";
    article.innerHTML = "<h4>ChatGPT</h4>";
    box(article, { top: 80, left: 40, width: 400, height: 80 });
    box(scroller, { top: 0, left: 0, width: 800, height: 600 });
    scroller.append(article);
    main.append(scroller);
    document.body.append(main);
    expect(conversationScroller()).toBe(scroller);
    expect(stableLayoutAvailable()).toBe(true);
    const position = saveReadingPosition();
    expect(position?.identity).toEqual({ attribute: "data-turn-id", value: "turn-1" });
    box(article, { top: 92, left: 40, width: 400, height: 80 });
    expect(readingPositionDrift(position!)).toBe(12);
  });

  it("keeps the legacy official navigator contract", () => {
    const main = document.createElement("main");
    const root = document.createElement("div");
    root.className = "x_convSearchResultHighlightRoot";
    const fixed = document.createElement("div");
    fixed.className = "fixed inset-e-4 top-1/2 z-20 -translate-y-1/2";
    box(fixed, { top: 10, left: 10, width: 100, height: 80 });
    for (let index = 0; index < 3; index += 1) {
      const button = document.createElement("button");
      button.dataset.tocItemIndex = String(index);
      button.setAttribute("aria-label", `Prompt ${index + 1}`);
      box(button, { top: 10 + index * 12, left: 10, width: 12, height: 12 });
      fixed.append(button);
    }
    root.append(fixed);
    main.append(root);
    document.body.append(main);
    expect(readOfficialNavigator()).toMatchObject({ found: 3, visible: 3, available: true });
  });

  it("recognizes indexed official navigation without the five old layout classes", () => {
    const rail = document.createElement("nav");
    rail.style.position = "fixed";
    viSpyComputed(rail, { position: "fixed", overflowY: "visible", visibility: "visible", display: "block", opacity: "1" } as CSSStyleDeclaration);
    box(rail, { top: 80, left: innerWidth - 40, width: 24, height: 200 });
    for (let index = 0; index < 4; index += 1) {
      const button = document.createElement("button");
      button.dataset.tocItemIndex = String(index);
      button.setAttribute("aria-label", `Prompt ${index + 1}`);
      box(button, { top: 90 + index * 16, left: innerWidth - 36, width: 12, height: 12 });
      rail.append(button);
    }
    document.body.append(rail);
    expect(readOfficialNavigator()).toMatchObject({ found: 4, visible: 4, available: true });
  });

  it("crosses span.contents to the real header action layout container", () => {
    const header = document.createElement("header");
    header.id = "page-header";
    const row = document.createElement("div");
    row.id = "conversation-header-actions";
    const wrap = document.createElement("span");
    wrap.className = "contents";
    viSpyComputed(wrap, { display: "contents", overflowY: "visible", visibility: "visible", opacity: "1" } as CSSStyleDeclaration);
    const share = document.createElement("button");
    share.setAttribute("aria-label", "分享");
    box(share, { top: 12, left: innerWidth - 80, width: 28, height: 28 });
    const more = document.createElement("button");
    more.setAttribute("aria-label", "更多");
    box(more, { top: 12, left: innerWidth - 44, width: 28, height: 28 });
    wrap.append(share, more);
    row.append(wrap);
    header.append(row);
    document.body.append(header);
    expect(findNativeActionGroup()?.container).toBe(row);
    expect(findNativeActionGroup()?.container).not.toBe(wrap);
  });

  it("accepts a single unlabeled header icon when the known action container is present", () => {
    const header = document.createElement("header");
    header.id = "page-header";
    const row = document.createElement("div");
    row.id = "conversation-header-actions";
    const more = document.createElement("button");
    const icon = document.createElement("svg");
    more.append(icon);
    box(more, { top: 12, left: innerWidth - 44, width: 28, height: 28 });
    row.append(more);
    header.append(row);
    document.body.append(header);
    expect(findNativeActionGroup()).toEqual({ container: row, buttons: [more] });
  });
});

function viSpyComputed(element: HTMLElement, style: CSSStyleDeclaration): void {
  const original = window.getComputedStyle;
  const spy = (node: Element): CSSStyleDeclaration => node === element ? style : original.call(window, node);
  window.getComputedStyle = spy as typeof window.getComputedStyle;
}
