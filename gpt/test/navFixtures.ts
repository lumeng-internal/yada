import { normalizeConversation } from "../src/conversation/normalizeConversation";
import type { ConversationSnapshot } from "../src/core/types";
import type { YadaTurn } from "../src/conversation/types";
import { linearConversation } from "./helpers";

export function snapshotFromTurns(turns: YadaTurn[], conversationId = "conversation-1"): ConversationSnapshot {
  return {
    conversationId,
    revision: 1,
    capturedAt: Date.now(),
    activeTurns: turns,
    quotaTurns: [],
    quotaIsWork: false,
    quotaUnclassifiedTurns: 0,
    quotaOrigin: "chat",
    quotaTemporary: false
  };
}

export function turns(count: number, conversationId = "conversation-1"): YadaTurn[] {
  return normalizeConversation(linearConversation(count, conversationId));
}

export function mountMain(): HTMLElement {
  document.body.innerHTML = "";
  const main = document.createElement("main");
  const conversation = document.createElement("div");
  conversation.dataset.conversationId = "conversation-1";
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  scroller.style.height = "400px";
  main.append(conversation, scroller);
  document.body.append(main);
  return scroller;
}

export function mountUserMessages(ids: string[], parent?: HTMLElement): void {
  const host = parent ?? document.querySelector("main") ?? mountMain();
  for (const id of ids) {
    if (host.querySelector(`[data-message-id="${id}"]`)) continue;
    const node = document.createElement("div");
    node.dataset.messageAuthorRole = id.startsWith("u") ? "user" : "assistant";
    node.dataset.messageId = id;
    node.textContent = id;
    host.append(node);
  }
}

export function mountOfficialButtons(count: number, onClick?: (index: number, button: HTMLButtonElement) => void): HTMLButtonElement[] {
  const main = document.querySelector("main") ?? mountMain().closest("main")!;
  const root = document.createElement("div");
  root.className = "qMYqUG_convSearchResultHighlightRoot";
  const fixed = document.createElement("div");
  fixed.className = "fixed inset-e-4 top-1/2 z-20 -translate-y-1/2";
  const buttons: HTMLButtonElement[] = [];
  for (let index = 0; index < count; index += 1) {
    const button = document.createElement("button");
    button.dataset.tocItemIndex = String(index);
    button.setAttribute("aria-label", `Prompt ${index + 1}`);
    button.setAttribute("aria-description", `Prompt ${index + 1}`);
    button.addEventListener("click", () => onClick?.(index, button));
    fixed.append(button);
    buttons.push(button);
  }
  root.append(fixed);
  main.append(root);
  return buttons;
}

export function mountStableSlots(count: number, parent?: HTMLElement): HTMLElement[] {
  const host = parent ?? document.querySelector("main") ?? mountMain();
  const list = document.createElement("div");
  const slots: HTMLElement[] = [];
  for (let index = 0; index < count; index += 1) {
    const user = document.createElement("div");
    user.dataset.turnIdContainer = `u${index}`;
    user.dataset.messageAuthorRole = "user";
    const assistant = document.createElement("div");
    assistant.dataset.turnIdContainer = `a${index}`;
    assistant.dataset.messageAuthorRole = "assistant";
    list.append(user, assistant);
    slots.push(user, assistant);
  }
  host.append(list);
  return slots;
}

export function installScrollTopCounter(element: HTMLElement): { writes: number } {
  const counter = { writes: 0 };
  let value = 0;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get() { return value; },
    set(next: number) {
      counter.writes += 1;
      value = next;
    }
  });
  return counter;
}

export function setElementRect(element: HTMLElement, rect: { top: number; height?: number; width?: number }): void {
  const height = rect.height ?? 40;
  const width = rect.width ?? 40;
  const top = rect.top;
  const box = {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    toJSON() { return {}; }
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => box
  });
}

export function outOfViewportRect(element: HTMLElement): void {
  setElementRect(element, { top: 8_000 });
}

export function inViewportRect(element: HTMLElement): void {
  setElementRect(element, { top: 0 });
}
