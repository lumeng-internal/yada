import type { ApiConversation, ApiConversationMessage } from "../src/conversation/fetchConversation";

export function message(id: string, role: "user" | "assistant", text: string, extra: Partial<ApiConversationMessage> = {}): ApiConversationMessage {
  return {
    id,
    author: { role },
    recipient: "all",
    channel: role === "assistant" ? "final" : undefined,
    content: { content_type: "text", parts: [text] },
    create_time: 1_700_000_000,
    ...extra
  };
}

export function linearConversation(count: number, id = "conversation-1"): ApiConversation {
  const mapping: ApiConversation["mapping"] = { root: { id: "root", parent: "", children: count ? ["u0"] : [], message: null } };
  for (let i = 0; i < count; i++) {
    mapping[`u${i}`] = {
      id: `u${i}`,
      parent: i ? `a${i - 1}` : "root",
      children: [`a${i}`],
      message: message(`u${i}`, "user", i % 2 === 0 ? "identical user question" : `User ${i}`)
    };
    mapping[`a${i}`] = {
      id: `a${i}`,
      parent: `u${i}`,
      children: i === count - 1 ? [] : [`u${i + 1}`],
      message: {
        ...message(`a${i}`, "assistant", `Assistant ${i}`),
        metadata: { model_slug: i % 3 === 0 ? "gpt-6-pro" : i % 3 === 1 ? "gpt-5.6-sol-pro" : "gpt-5.4" }
      }
    };
  }
  return { id, current_node: count ? `a${count - 1}` : "root", mapping, title: "Fixture" };
}

export function branchedConversation(): ApiConversation {
  const base = linearConversation(1, "branched");
  base.mapping!["a-old"] = {
    id: "a-old",
    parent: "u0",
    children: [],
    message: {
      ...message("a-old", "assistant", "old branch"),
      metadata: { model_slug: "gpt-6-pro" }
    }
  };
  base.mapping!["u0"].children = ["a0", "a-old"];
  return base;
}
