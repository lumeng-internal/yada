import type { AssistantUsageEventCandidate, WorkspaceKind } from "../core/types";
import type { ApiConversation, ApiConversationMessage } from "./fetchConversation";

const SKIP_CONTENT_TYPES = new Set([
  "thoughts",
  "reasoning_recap",
  "model_editable_context",
  "user_editable_context",
  "reasoning"
]);

export function extractAssistantUsageEvents(
  conversation: ApiConversation,
  observedAt = Date.now()
): AssistantUsageEventCandidate[] {
  const conversationId = conversation.id ?? conversation.conversation_id ?? "";
  const workspaceKind = inferConversationWorkspaceKind(conversation);
  const seen = new Set<string>();
  const events: AssistantUsageEventCandidate[] = [];

  const consider = (message: ApiConversationMessage | null | undefined): void => {
    if (!message || typeof message.id !== "string" || !message.id) return;
    if (seen.has(message.id)) return;
    if (!isCountableAssistant(message)) return;
    seen.add(message.id);
    events.push({
      assistantMessageId: message.id,
      conversationId,
      createdAt: normalizeCreatedAt(message.create_time),
      observedAt,
      modelSlug: readModelSlug(message),
      status: "final",
      workspaceKind
    });
  };

  if (conversation.mapping) {
    for (const node of Object.values(conversation.mapping)) {
      consider(node.message);
    }
  }
  if (Array.isArray(conversation.messages)) {
    for (const message of conversation.messages) consider(message);
  }

  return events;
}

export function inferConversationWorkspaceKind(conversation: ApiConversation): WorkspaceKind {
  const record = conversation as ApiConversation & Record<string, unknown>;
  const raw = [
    record.workspace_id,
    record.workspaceId,
    record.workspace_type,
    record.workspaceType,
    record.is_workspace,
    record.isWorkspace
  ];
  for (const value of raw) {
    const kind = classifyWorkspaceValue(value);
    if (kind !== "unknown") return kind;
  }
  return "unknown";
}

function isCountableAssistant(message: ApiConversationMessage): boolean {
  const role = message.author?.role;
  if (role !== "assistant") return false;

  const recipient = message.recipient;
  if (recipient && recipient !== "all") return false;

  const channel = message.channel;
  if (channel && channel !== "final") return false;

  const metadata = message.metadata ?? {};
  if (
    metadata.is_visually_hidden_from_conversation === true
    || metadata.is_hidden === true
    || metadata.hidden === true
  ) {
    return false;
  }

  const contentType = typeof message.content?.content_type === "string"
    ? String(message.content.content_type)
    : "";
  if (SKIP_CONTENT_TYPES.has(contentType) || contentType.includes("reasoning")) return false;
  if (contentType === "thoughts" || contentType === "code" && metadata.is_reasoning === true) return false;

  return true;
}

function readModelSlug(message: ApiConversationMessage): string | null {
  const metadata = message.metadata ?? {};
  const keys = [
    "model_slug",
    "model",
    "default_model_slug",
    "model_id",
    "slug"
  ];
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeCreatedAt(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function classifyWorkspaceValue(value: unknown): WorkspaceKind {
  if (value === true) return "work";
  if (value === false) return "personal";
  if (typeof value !== "string" || !value.trim()) return "unknown";
  const normalized = value.trim().toLowerCase();
  if (["personal", "plus", "pro", "free", "consumer"].includes(normalized)) return "personal";
  if (
    normalized.includes("work")
    || normalized.includes("team")
    || normalized.includes("business")
    || normalized.includes("enterprise")
    || normalized.includes("workspace")
  ) {
    return "work";
  }
  return "unknown";
}
