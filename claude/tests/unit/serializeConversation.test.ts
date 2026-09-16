import { describe, expect, it } from 'vitest';
import { buildActiveBranch } from '@src/pages/content/conversation/buildActiveBranch';
import { buildCanonicalTurns } from '@src/pages/content/conversation/buildCanonicalTurns';
import { sha256Hex } from '@src/pages/content/conversation/content';
import { serializeConversationSnapshot } from '@src/pages/content/conversation/serializeConversation';
import type { ConversationSnapshot } from '@src/pages/content/conversation/types';
import {
  branchedConversation,
  emptyAssistantConversation,
  linearConversation,
  richContentConversation,
} from '../fixtures/conversations';

const snapshotFor = async (
  conversation: typeof linearConversation,
  conversationId = conversation.uuid,
): Promise<ConversationSnapshot> => {
  const branch = await buildActiveBranch(conversation);
  return {
    conversationId,
    currentLeafMessageId: conversation.current_leaf_message_uuid,
    messages: branch.messages,
    turns: buildCanonicalTurns(branch.messages),
    complete: branch.complete,
    issues: branch.issues,
    fetchedAt: 100,
  };
};

describe('serializeConversationSnapshot', () => {
  it('records branch and visible-message counts separately with endpoint hashes', async () => {
    const snapshot = await snapshotFor(linearConversation);
    const serialized = await serializeConversationSnapshot(snapshot);

    expect(serialized.metrics).toMatchObject({
      activeBranchMessageCount: 4,
      serializedVisibleMessageCount: 4,
      filteredContentBlockCount: 0,
      unknownContentBlockCount: 0,
      firstVisibleContentHash: snapshot.messages[0]?.visibleContentHash,
      lastVisibleContentHash: snapshot.messages[3]?.visibleContentHash,
    });
    expect(serialized.metrics.firstMessageIdHash).toBe(await sha256Hex('msg-user-001'));
    expect(serialized.metrics.lastMessageIdHash).toBe(await sha256Hex('msg-assistant-002'));
    expect(serialized.messages[0]?.visibleContentHash).toBe(
      await sha256Hex(snapshot.messages[0]?.visibleMarkdown ?? ''),
    );
    expect(serialized.messages.at(-1)?.visibleContentHash).toBe(
      await sha256Hex(snapshot.messages.at(-1)?.visibleMarkdown ?? ''),
    );
    expect(serialized.markdown.match(/^# User$/gm)).toHaveLength(2);
    expect(serialized.markdown.match(/^# Claude$/gm)).toHaveLength(2);
  });

  it('derives visible counts and endpoint hashes from emitted message segments', async () => {
    const snapshot = await snapshotFor(linearConversation);
    const serialized = await serializeConversationSnapshot(snapshot);

    expect(serialized.metrics.serializedVisibleMessageCount).toBe(serialized.messages.length);
    expect(serialized.metrics.firstVisibleContentHash).toBe(serialized.messages[0]?.visibleContentHash);
    expect(serialized.metrics.lastVisibleContentHash).toBe(serialized.messages.at(-1)?.visibleContentHash);
  });

  it('uses the conservative content-block rules and counts filtered and unknown blocks', async () => {
    const snapshot = await snapshotFor(richContentConversation);
    const serialized = await serializeConversationSnapshot(snapshot);

    expect(serialized.metrics.activeBranchMessageCount).toBe(2);
    expect(serialized.metrics.serializedVisibleMessageCount).toBe(2);
    expect(serialized.metrics.filteredContentBlockCount).toBe(2);
    expect(serialized.metrics.unknownContentBlockCount).toBe(1);
    expect(serialized.markdown).toContain('[附件：fixture.pdf｜application/pdf]');
    expect(serialized.markdown).toContain('[工具调用：fixture_tool]');
    expect(serialized.markdown).toContain('[Artifact：人工制品｜text/markdown]');
    expect(serialized.markdown).toContain('[暂不支持的内容块：future_fixture_block]');
    expect(serialized.markdown).not.toContain('不应输出的人工思考');
  });

  it('serializes an empty assistant header while retaining the raw branch count', async () => {
    const snapshot = await snapshotFor(emptyAssistantConversation);
    const serialized = await serializeConversationSnapshot(snapshot);

    expect(serialized.metrics.activeBranchMessageCount).toBe(2);
    expect(serialized.metrics.serializedVisibleMessageCount).toBe(2);
    expect(serialized.markdown).toMatch(/# Claude\s*$/);
  });

  it('never includes messages from a non-active sibling branch', async () => {
    const snapshot = await snapshotFor(branchedConversation);
    const serialized = await serializeConversationSnapshot(snapshot);

    expect(serialized.metrics.activeBranchMessageCount).toBe(6);
    expect(serialized.messageIds).not.toContain('msg-user-main');
    expect(serialized.messageIds).not.toContain('msg-assistant-main');
    expect(serialized.markdown).not.toContain('人工主分支问题');
  });
});
