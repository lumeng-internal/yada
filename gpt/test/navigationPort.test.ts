import { describe, expect, it, vi } from "vitest";
import { NavigationPort } from "../src/navigation/navigationPort";
import { tryOfficialFastPath } from "../src/navigation/officialFastPath";
import { linearConversation } from "./helpers";
import { normalizeConversation } from "../src/conversation/normalizeConversation";

function mountMessages(ids: string[]): HTMLElement {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  container.style.height = "400px";
  for (const id of ids) {
    const node = document.createElement("div");
    node.dataset.messageAuthorRole = id.startsWith("u") ? "user" : "assistant";
    node.dataset.messageId = id;
    node.textContent = id;
    container.append(node);
  }
  document.body.innerHTML = "";
  const main = document.createElement("main");
  main.append(container);
  document.body.append(main);
  return container;
}

describe("NavigationPort", () => {
  it("jumps directly when the target user message is already rendered", async () => {
    mountMessages(["u0", "a0", "u1", "a1"]);
    const port = new NavigationPort();
    const turns = normalizeConversation(linearConversation(2));
    const result = await port.navigateTo("u0", turns, "conversation-1");
    expect(result.ok).toBe(true);
    expect(result.path).toBe("direct");
    port.dispose();
  });

  it("uses the official fast path only when button count matches activeTurns", () => {
    history.replaceState({}, "", "/c/conversation-1");
    const nav = document.createElement("div");
    const clicks: number[] = [];
    for (let i = 0; i < 3; i++) {
      const button = document.createElement("button");
      button.setAttribute("data-toc-item-index", String(i));
      button.addEventListener("click", () => clicks.push(i));
      nav.append(button);
    }
    document.body.append(nav);
    expect(tryOfficialFastPath(1, 3, "conversation-1")).toBe(true);
    expect(clicks).toEqual([1]);
    expect(tryOfficialFastPath(1, 18, "conversation-1")).toBe(false);
  });

  it("does not confirm a target by duplicate prompt text", async () => {
    mountMessages(["u0", "u2"]);
    const port = new NavigationPort();
    const turns = normalizeConversation(linearConversation(4));
    expect(turns[0].userMarkdown).toBe(turns[2].userMarkdown);
    const result = await port.navigateTo(turns[2].userMessageId!, turns, "conversation-1");
    expect(result.ok).toBe(true);
    expect(document.querySelector('[data-message-id="u2"]')).toBeTruthy();
    port.dispose();
  });

  it("cancels the first jump when a second tick is clicked", async () => {
    mountMessages(["u0"]);
    const port = new NavigationPort();
    const turns = normalizeConversation(linearConversation(2));
    const first = port.navigateTo("u1", turns, "conversation-1");
    const second = await port.navigateTo("u0", turns, "conversation-1");
    const firstResult = await first;
    expect(firstResult.status).toBe("cancelled");
    expect(second.ok).toBe(true);
    port.dispose();
  });

  it("cancels on wheel and does not auto-restart", async () => {
    mountMessages([]);
    const port = new NavigationPort();
    const turns = normalizeConversation(linearConversation(8));
    vi.spyOn(window, "setTimeout");
    const pending = port.navigateTo("u0", turns, "conversation-1");
    window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    const result = await pending;
    expect(result.status).toBe("cancelled");
    port.dispose();
  });
});
