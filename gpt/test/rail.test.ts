import { describe, expect, it } from "vitest";
import { normalizeConversation } from "../src/conversation/normalizeConversation";
import { branchedConversation, linearConversation, message } from "./helpers";
import { RailView } from "../src/rail/view";

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
