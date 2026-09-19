import { afterEach, describe, expect, it } from "vitest";
import { ConversationSync } from "../src/core/conversationSync";
import { normalizeConversation } from "../src/conversation/normalizeConversation";
import type { NavigatorController } from "../src/navigation/navigatorController";
import type { NavigationResult } from "../src/navigation/types";
import { YadaRailController } from "../src/rail/controller";
import { RailView } from "../src/rail/view";
import { branchedConversation, linearConversation, message } from "./helpers";
import { snapshotFromTurns } from "./navFixtures";

describe("navigation data from ConversationSnapshot.activeTurns", () => {
  it.each([18, 50, 150, 300])("creates %s rail ticks from API turns", (count) => {
    const turns = normalizeConversation(linearConversation(count));
    expect(turns).toHaveLength(count);
    expect(new Set(turns.map((turn) => turn.userMessageId)).size).toBe(count);
  });

  it("keeps all ticks when the DOM only mounted 5 turns", () => {
    const turns = normalizeConversation(linearConversation(50));
    document.body.innerHTML = `<main>${[0, 1, 2, 3, 4].map((i) => `<div data-message-author-role="user" data-message-id="u${i}"></div>`).join("")}</main>`;
    expect(turns).toHaveLength(50);
    expect(document.querySelectorAll('[data-message-author-role="user"]')).toHaveLength(5);
  });

  it("gives identical bodies different message ids", () => {
    const turns = normalizeConversation(linearConversation(4));
    expect(turns[0].userMarkdown).toBe(turns[2].userMarkdown);
    expect(turns[0].userMessageId).not.toBe(turns[2].userMessageId);
  });

  it("appends a new tick after N+1", () => {
    const first = normalizeConversation(linearConversation(18));
    const next = normalizeConversation(linearConversation(19));
    expect(next).toHaveLength(first.length + 1);
    expect(next.at(-1)?.userMessageId).toBe("u18");
  });

  it("renders one rail host for a conversation switch", () => {
    const view = new RailView(() => undefined);
    view.setTurns(normalizeConversation(linearConversation(8, "a")));
    view.setTurns(normalizeConversation(linearConversation(3, "b")));
    expect(document.querySelectorAll("#chatgpt-yada-rail-host")).toHaveLength(1);
    expect(view.host.shadowRoot?.querySelectorAll("button.mark")).toHaveLength(3);
    view.dispose();
  });

  it("marks the target tick pending without a floating 定位中 label", () => {
    const view = new RailView(() => undefined);
    view.setTurns(normalizeConversation(linearConversation(8)));
    view.setActive(3);
    view.setPending(0);
    const root = view.host.shadowRoot!;
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(root.querySelector('[data-pending="true"]')?.getAttribute("data-index")).toBe("0");
    expect(root.querySelector('[data-active="true"]')?.getAttribute("data-index")).toBe("3");
    expect(root.querySelector(".mark")?.textContent).not.toContain("定位中");
    view.dispose();
  });

  it("keeps the active branch after a regenerated answer", () => {
    const turns = normalizeConversation(branchedConversation());
    expect(turns).toHaveLength(1);
    expect(turns[0].assistantMessageId).toBe("a0");
  });

  it("skips tool and reasoning messages in the rail branch", () => {
    const conversation = linearConversation(1);
    conversation.mapping!["tool"] = {
      id: "tool",
      parent: "u0",
      message: { ...message("tool", "assistant", "tool"), author: { role: "tool" } }
    };
    conversation.mapping!["reason"] = {
      id: "reason",
      parent: "u0",
      message: { ...message("reason", "assistant", "thought"), channel: "reasoning", content: { content_type: "thoughts", parts: ["hidden"] } }
    };
    expect(normalizeConversation(conversation).map((turn) => turn.assistantMessageId)).toEqual(["a0"]);
  });
});

describe("rail pending and active freeze", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps active frozen until navigation succeeds", async () => {
    const items = normalizeConversation(linearConversation(8));
    let release!: (result: NavigationResult) => void;
    const pending = new Promise<NavigationResult>((resolve) => {
      release = resolve;
    });
    const navigator = {
      navigateTo: async () => pending,
      cancel() {},
      mount() {},
      currentTurns: () => items,
      lastDiagnostics: () => null,
      dispose() {}
    } as unknown as NavigatorController;
    const snapshot = snapshotFromTurns(items);
    const sync = new ConversationSync({ readConversation: async () => snapshot });
    const main = document.createElement("main");
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.style.height = "400px";
    const node = document.createElement("div");
    node.dataset.messageAuthorRole = "user";
    node.dataset.messageId = "u7";
    scroller.append(node);
    main.append(scroller);
    document.body.append(main);

    const controller = new YadaRailController(sync, navigator);
    controller.mount();
    sync.setActiveConversation("conversation-1");
    await sync.requestSync("test");

    const root = document.getElementById("chatgpt-yada-rail-host")!.shadowRoot!;
    root.querySelectorAll<HTMLButtonElement>("button.mark")[0]!.click();
    await Promise.resolve();
    expect(root.querySelector('[data-pending="true"]')?.getAttribute("data-index")).toBe("0");
    const activeBefore = root.querySelector('[data-active="true"]')?.getAttribute("data-index") ?? "-1";
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(root.querySelector('[data-pending="true"]')?.getAttribute("data-index")).toBe("0");
    expect(root.querySelector('[data-active="true"]')?.getAttribute("data-index") ?? "-1").toBe(activeBefore);

    release({ ok: true, path: "direct" });
    await pending;
    await Promise.resolve();
    expect(root.querySelector('[data-pending="true"]')).toBeNull();
    expect(root.querySelector('[data-active="true"]')?.getAttribute("data-index")).toBe("0");
    controller.dispose();
  });

  it("clears pending on cancel without a failure style", async () => {
    const items = normalizeConversation(linearConversation(8));
    let release!: (result: NavigationResult) => void;
    const pending = new Promise<NavigationResult>((resolve) => {
      release = resolve;
    });
    const navigator = {
      navigateTo: async () => pending,
      cancel() {},
      mount() {},
      currentTurns: () => items,
      lastDiagnostics: () => null,
      dispose() {}
    } as unknown as NavigatorController;
    const snapshot = snapshotFromTurns(items);
    const sync = new ConversationSync({ readConversation: async () => snapshot });
    document.body.innerHTML = "<main></main>";
    const controller = new YadaRailController(sync, navigator);
    controller.mount();
    sync.setActiveConversation("conversation-1");
    await sync.requestSync("test");
    const root = document.getElementById("chatgpt-yada-rail-host")!.shadowRoot!;
    root.querySelectorAll<HTMLButtonElement>("button.mark")[0]!.click();
    await Promise.resolve();
    release({ ok: false, status: "cancelled" });
    await pending;
    await Promise.resolve();
    expect(root.querySelector('[data-pending="true"]')).toBeNull();
    expect(root.querySelector('[data-failed="true"]')).toBeNull();
    controller.dispose();
  });
});
