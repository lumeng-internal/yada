import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import {
  combineTextAndAttachments,
  extractApiAttachments,
  noTextPlaceholder
} from "./attachmentSummary";
import { fetchCurrentConversation, type ApiConversation, type ApiConversationMessage, type ApiConversationNode } from "./fetchConversation";
import type { YadaAttachment, YadaConversationSnapshot, YadaTurn } from "./types";

type MessagePayload = {
  messageId?: string;
  createdAt?: number;
  markdown: string;
  preview: string;
  attachments: YadaAttachment[];
};

type LoadSnapshotOptions = {
  conversationId?: string | null;
  signal?: AbortSignal;
};

export async function loadCurrentConversationSnapshot(options: LoadSnapshotOptions = {}): Promise<YadaConversationSnapshot> {
  const conversationId = options.conversationId ?? getConversationIdFromUrl();
  if (!conversationId) throw new Error("No active ChatGPT conversation");

  const conversation = await fetchCurrentConversation(conversationId, options.signal);
  if (!conversation) throw new Error("ChatGPT conversation was not returned");

  const turns = normalizeConversation(conversation);
  return {
    conversationId: conversation.id ?? conversationId,
    source: "api-full",
    turns,
    capturedAt: Date.now(),
    apiTurnsLength: turns.length,
    domTurnsLength: 0,
    usingCachedApiTurns: false,
    lastStableTurnsLength: turns.length
  };
}

export function normalizeConversation(conversation: ApiConversation): YadaTurn[] {
  const nodes = getCurrentBranchNodes(conversation);
  const turns: YadaTurn[] = [];
  let pendingUser: MessagePayload | null = null;

  for (const node of nodes) {
    const message = node.message;
    if (!message || shouldSkipMessage(message)) continue;

    const role = readRole(message);
    if (role !== "user" && role !== "assistant") continue;

    const payload = extractMessagePayload(message);
    if (!payload.markdown) continue;

    if (role === "user") {
      if (pendingUser) {
        turns.push(makeTurn(turns.length, pendingUser, null));
      }
      pendingUser = payload;
      continue;
    }

    if (!pendingUser) continue;
    turns.push(makeTurn(turns.length, pendingUser, payload));
    pendingUser = null;
  }

  if (pendingUser) {
    turns.push(makeTurn(turns.length, pendingUser, null));
  }

  return turns;
}

function getCurrentBranchNodes(conversation: ApiConversation): ApiConversationNode[] {
  const mapping = conversation.mapping ?? {};
  const startNodeId = conversation.current_node
    ?? Object.values(mapping).find((node) => !node.children || node.children.length === 0)?.id;
  const result: ApiConversationNode[] = [];
  const seen = new Set<string>();
  let currentNodeId = startNodeId;

  while (currentNodeId && !seen.has(currentNodeId)) {
    seen.add(currentNodeId);
    const node = mapping[currentNodeId];
    if (!node) break;
    if (node.parent === undefined && !node.message) break;
    result.unshift(node);
    currentNodeId = node.parent;
  }

  return result;
}

function makeTurn(index: number, user: MessagePayload, assistant: MessagePayload | null): YadaTurn {
  return {
    id: user.messageId ?? assistant?.messageId ?? `api-turn-${index + 1}`,
    index,
    globalIndex: index,
    displayNumber: index + 1,
    renderedLocalIndex: null,
    userMessageId: user.messageId,
    assistantMessageId: assistant?.messageId,
    userCreatedAt: user.createdAt,
    assistantCreatedAt: assistant?.createdAt,
    userMarkdown: user.markdown,
    assistantMarkdown: assistant?.markdown ?? "",
    userPreview: user.preview,
    assistantPreview: assistant?.preview ?? "",
    attachments: [...user.attachments, ...(assistant?.attachments ?? [])]
  };
}

function shouldSkipMessage(message: ApiConversationMessage): boolean {
  if (!message.content) return true;

  const role = readRole(message);
  if (role === "system" || role === "tool") return true;

  const recipient = message.recipient;
  if (recipient && recipient !== "all") return true;

  const channel = message.channel;
  if (channel && channel !== "final") return true;

  const metadata = message.metadata ?? {};
  if (
    metadata.is_visually_hidden_from_conversation === true
    || metadata.is_hidden === true
    || metadata.hidden === true
  ) {
    return true;
  }

  const contentType = readString(message.content, "content_type");
  return contentType === "thoughts"
    || contentType === "reasoning_recap"
    || contentType === "model_editable_context"
    || contentType === "user_editable_context";
}

function extractMessagePayload(message: ApiConversationMessage): MessagePayload {
  const attachments = extractApiAttachments(message as Record<string, unknown>);
  const markdown = combineTextAndAttachments(extractApiMarkdown(message), attachments) || noTextPlaceholder();

  return {
    messageId: message.id,
    createdAt: message.create_time,
    markdown,
    preview: makePreview(markdown),
    attachments
  };
}

function extractApiMarkdown(message: ApiConversationMessage): string {
  const content = message.content;
  if (!content) return "";

  const contentType = readString(content, "content_type");
  if (contentType === "text") {
    return normalizeMarkdown(joinStringParts(content.parts));
  }

  if (contentType === "multimodal_text") {
    return normalizeMarkdown(extractMultimodalText(content.parts));
  }

  if (contentType === "code") {
    const language = readString(content, "language") ?? "";
    const text = readString(content, "text") ?? "";
    return text ? `\`\`\`${language}\n${text}\n\`\`\`` : "";
  }

  if (contentType === "execution_output") {
    const text = readString(content, "text") ?? "";
    return text ? `Result:\n\`\`\`\n${text}\n\`\`\`` : "";
  }

  if (contentType === "tether_quote") {
    const title = readString(content, "title") ?? "";
    const text = readString(content, "text") ?? "";
    return normalizeMarkdown(`> ${title || text}`);
  }

  if (contentType === "tether_browsing_display") {
    const result = readString(content, "result") ?? readString(content, "summary") ?? "";
    return normalizeMarkdown(result);
  }

  return "";
}

function extractMultimodalText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";

  return parts.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    const contentType = readString(record, "content_type") ?? readString(record, "type") ?? "";
    if (contentType.includes("image") || contentType.includes("file")) return "";
    return readString(record, "text")
      ?? readString(record, "content")
      ?? readString(record, "markdown")
      ?? "";
  }).filter(Boolean).join("\n\n");
}

function joinStringParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => typeof part === "string" ? part : "").filter(Boolean).join("\n\n");
}

function readRole(message: ApiConversationMessage): string | undefined {
  return message.author?.role;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makePreview(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, "[代码块]")
    .replace(/[#*_>`~-]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain.length > 180 ? `${plain.slice(0, 179)}…` : plain;
}
