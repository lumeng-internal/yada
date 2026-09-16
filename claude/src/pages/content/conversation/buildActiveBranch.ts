import { normalizeClaudeMessage } from './content';
import type { ActiveBranchResult, BranchIssue, ClaudeConversation, RawClaudeMessage } from './types';

export const CLAUDE_ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

const isRootParent = (parentId: string | null | undefined): boolean => (
  !parentId || parentId === CLAUDE_ROOT_MESSAGE_ID
);

export const buildActiveBranch = async (conversation: ClaudeConversation): Promise<ActiveBranchResult> => {
  const rawMessages = Array.isArray(conversation.chat_messages) ? conversation.chat_messages : [];
  const issues: BranchIssue[] = [];
  const byId = new Map<string, RawClaudeMessage>();
  const duplicateIds = new Set<string>();

  for (const message of rawMessages) {
    if (byId.has(message.uuid)) duplicateIds.add(message.uuid);
    else byId.set(message.uuid, message);
  }
  for (const messageId of duplicateIds) issues.push({ code: 'duplicate-message-id', messageId });

  const leafMessageId = conversation.current_leaf_message_uuid ?? undefined;
  if (!leafMessageId || !byId.has(leafMessageId)) {
    return {
      messages: [],
      complete: false,
      issues: [{ code: 'missing-current-leaf', messageId: leafMessageId }, ...issues],
      leafMessageId,
    };
  }

  const reverseBranch: RawClaudeMessage[] = [];
  const visited = new Set<string>();
  let currentId: string | null | undefined = leafMessageId;

  while (currentId && !isRootParent(currentId)) {
    if (visited.has(currentId)) {
      issues.push({ code: 'cycle', messageId: currentId });
      break;
    }
    visited.add(currentId);

    const message = byId.get(currentId);
    if (!message) {
      issues.push({ code: 'missing-parent', messageId: currentId });
      break;
    }

    reverseBranch.push(message);
    const parentId = message.parent_message_uuid;
    if (isRootParent(parentId)) break;
    currentId = parentId;
  }

  const orderedRaw = reverseBranch.reverse();
  const messages = await Promise.all(orderedRaw.map((message, order) => normalizeClaudeMessage(message, order)));

  return {
    messages,
    complete: issues.length === 0,
    issues,
    rootMessageId: messages[0]?.id,
    leafMessageId,
  };
};
