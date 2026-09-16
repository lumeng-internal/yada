import { normalizeVisibleText, sha256Hex } from './content';
import type { SerializedConversation } from './serializeConversation';
import type { ConversationSnapshot } from './types';

export type CopyValidationError =
  | 'snapshot-incomplete'
  | 'empty-branch'
  | 'leaf-mismatch'
  | 'message-count-mismatch'
  | 'branch-membership-mismatch'
  | 'output-markdown-mismatch'
  | 'first-message-id-hash-mismatch'
  | 'last-message-id-hash-mismatch'
  | 'first-visible-content-hash-mismatch'
  | 'last-visible-content-hash-mismatch';

export const validateCompleteCopy = async (
  snapshot: ConversationSnapshot,
  serialized: SerializedConversation,
): Promise<CopyValidationError[]> => {
  const errors: CopyValidationError[] = [];
  const first = snapshot.messages[0];
  const last = snapshot.messages.at(-1);

  if (!snapshot.complete || snapshot.issues.length > 0) errors.push('snapshot-incomplete');
  if (!first || !last) errors.push('empty-branch');
  if (last && snapshot.currentLeafMessageId !== last.id) errors.push('leaf-mismatch');
  if (
    serialized.metrics.activeBranchMessageCount !== snapshot.messages.length ||
    serialized.metrics.serializedVisibleMessageCount !== serialized.messages.length ||
    serialized.messages.length !== snapshot.messages.length
  ) errors.push('message-count-mismatch');

  const expectedIds = snapshot.messages.map((message) => message.id);
  if (
    serialized.messageIds.length !== expectedIds.length ||
    serialized.messageIds.some((messageId, index) => messageId !== expectedIds[index])
  ) errors.push('branch-membership-mismatch');
  const expectedMarkdown = serialized.messages.map((message) => message.markdown).join('\n\n').trim();
  if (serialized.markdown !== expectedMarkdown) errors.push('output-markdown-mismatch');

  if (first) {
    const emittedFirstHash = await sha256Hex(normalizeVisibleText(serialized.messages[0]?.visibleMarkdown ?? ''));
    if (serialized.metrics.firstMessageIdHash !== await sha256Hex(first.id)) {
      errors.push('first-message-id-hash-mismatch');
    }
    if (
      serialized.metrics.firstVisibleContentHash !== first.visibleContentHash ||
      serialized.messages[0]?.visibleContentHash !== first.visibleContentHash ||
      emittedFirstHash !== first.visibleContentHash
    ) {
      errors.push('first-visible-content-hash-mismatch');
    }
  }
  if (last) {
    const emittedLastHash = await sha256Hex(normalizeVisibleText(serialized.messages.at(-1)?.visibleMarkdown ?? ''));
    if (serialized.metrics.lastMessageIdHash !== await sha256Hex(last.id)) {
      errors.push('last-message-id-hash-mismatch');
    }
    if (
      serialized.metrics.lastVisibleContentHash !== last.visibleContentHash ||
      serialized.messages.at(-1)?.visibleContentHash !== last.visibleContentHash ||
      emittedLastHash !== last.visibleContentHash
    ) {
      errors.push('last-visible-content-hash-mismatch');
    }
  }

  return errors;
};
