import { fetchCurrentConversation, fetchRecentConversationPage } from "./fetchConversation";
import { normalizeConversation } from "./normalizeConversation";
import type { ConversationSnapshot } from "../core/types";
import { conversationOrigin, isTemporary, parseConversation } from "../quota/vibebar/conversationParser";
import { HISTORY_WINDOW_SECONDS } from "../quota/vibebar/historyReader";

export function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name: string }).name === "AbortError");
}

export async function readConversation(
  conversationId: string,
  signal?: AbortSignal
): Promise<ConversationSnapshot> {
  if (signal?.aborted) throw abortError();
  if (!conversationId) throw new Error("No active ChatGPT conversation");

  const conversation = await fetchCurrentConversation(conversationId, signal);
  if (signal?.aborted) throw abortError();
  if (!conversation) throw new Error("ChatGPT conversation was not returned");

  const now = Date.now();
  const parsed = await parseConversation(
    conversation,
    conversation.id ?? conversation.conversation_id ?? conversationId,
    now,
    now - HISTORY_WINDOW_SECONDS * 1000
  );

  return {
    conversationId: conversation.id ?? conversation.conversation_id ?? conversationId,
    revision: 0,
    capturedAt: now,
    activeTurns: normalizeConversation(conversation),
    quotaTurns: parsed.turns,
    quotaIsWork: parsed.isWork,
    quotaUnclassifiedTurns: parsed.unclassifiedTurns,
    quotaOrigin: conversationOrigin(conversation),
    quotaTemporary: isTemporary(conversation),
    title: conversation.title,
    coverage: "full"
  };
}

export async function readRecentConversation(
  conversationId: string,
  signal?: AbortSignal
): Promise<ConversationSnapshot> {
  const snapshot = await readConversationWith(conversationId, signal, fetchRecentConversationPage);
  return { ...snapshot, coverage: "recent" };
}

async function readConversationWith(
  conversationId: string,
  signal: AbortSignal | undefined,
  load: (conversationId: string, signal?: AbortSignal) => Promise<NonNullable<Awaited<ReturnType<typeof fetchCurrentConversation>>>>
): Promise<ConversationSnapshot> {
  if (signal?.aborted) throw abortError();
  if (!conversationId) throw new Error("No active ChatGPT conversation");
  const conversation = await load(conversationId, signal);
  if (signal?.aborted) throw abortError();
  const now = Date.now();
  const parsed = await parseConversation(
    conversation,
    conversation.id ?? conversation.conversation_id ?? conversationId,
    now,
    now - HISTORY_WINDOW_SECONDS * 1000
  );
  return {
    conversationId: conversation.id ?? conversation.conversation_id ?? conversationId,
    revision: 0,
    capturedAt: now,
    activeTurns: normalizeConversation(conversation),
    quotaTurns: parsed.turns,
    quotaIsWork: parsed.isWork,
    quotaUnclassifiedTurns: parsed.unclassifiedTurns,
    quotaOrigin: conversationOrigin(conversation),
    quotaTemporary: isTemporary(conversation),
    title: conversation.title,
    coverage: "full"
  };
}
