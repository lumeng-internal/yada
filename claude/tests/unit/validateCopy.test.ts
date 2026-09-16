import { describe, expect, it } from 'vitest';
import { buildActiveBranch } from '@src/pages/content/conversation/buildActiveBranch';
import { buildCanonicalTurns } from '@src/pages/content/conversation/buildCanonicalTurns';
import { serializeConversationSnapshot } from '@src/pages/content/conversation/serializeConversation';
import type { ConversationSnapshot } from '@src/pages/content/conversation/types';
import { validateCompleteCopy } from '@src/pages/content/conversation/validateCopy';
import { linearConversation } from '../fixtures/conversations';

const createSnapshot = async (): Promise<ConversationSnapshot> => {
  const branch = await buildActiveBranch(linearConversation);
  return {
    conversationId: linearConversation.uuid,
    currentLeafMessageId: linearConversation.current_leaf_message_uuid,
    messages: branch.messages,
    turns: buildCanonicalTurns(branch.messages),
    complete: branch.complete,
    issues: branch.issues,
    fetchedAt: 100,
  };
};

describe('validateCompleteCopy', () => {
  it('accepts matching counts, branch membership, endpoint IDs, and visible hashes', async () => {
    const snapshot = await createSnapshot();
    expect(await validateCompleteCopy(snapshot, await serializeConversationSnapshot(snapshot))).toEqual([]);
  });

  it('detects count and branch membership tampering', async () => {
    const snapshot = await createSnapshot();
    const serialized = await serializeConversationSnapshot(snapshot);
    serialized.metrics.serializedVisibleMessageCount -= 1;
    serialized.messageIds[1] = 'msg-sibling-branch';

    expect(await validateCompleteCopy(snapshot, serialized)).toEqual(expect.arrayContaining([
      'message-count-mismatch',
      'branch-membership-mismatch',
    ]));
  });

  it('detects first and last ID or visible-content hash tampering', async () => {
    const snapshot = await createSnapshot();
    const serialized = await serializeConversationSnapshot(snapshot);
    serialized.metrics.firstMessageIdHash = '0'.repeat(64);
    serialized.metrics.lastMessageIdHash = '1'.repeat(64);
    serialized.metrics.firstVisibleContentHash = '2'.repeat(64);
    serialized.metrics.lastVisibleContentHash = '3'.repeat(64);

    expect(await validateCompleteCopy(snapshot, serialized)).toEqual(expect.arrayContaining([
      'first-message-id-hash-mismatch',
      'last-message-id-hash-mismatch',
      'first-visible-content-hash-mismatch',
      'last-visible-content-hash-mismatch',
    ]));
  });

  it('rejects output whose emitted first body no longer matches the canonical endpoint', async () => {
    const snapshot = await createSnapshot();
    const serialized = await serializeConversationSnapshot(snapshot);
    serialized.messages[0] = {
      ...serialized.messages[0]!,
      markdown: '# User',
      visibleMarkdown: '',
      visibleContentHash: await crypto.subtle.digest('SHA-256', new TextEncoder().encode('')).then(
        (digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      ),
    };
    serialized.metrics.firstVisibleContentHash = serialized.messages[0].visibleContentHash;

    expect(await validateCompleteCopy(snapshot, serialized)).toEqual(expect.arrayContaining([
      'first-visible-content-hash-mismatch',
      'output-markdown-mismatch',
    ]));
  });
});
