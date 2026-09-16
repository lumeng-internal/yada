import { describe, expect, it } from 'vitest';
import {
  branchedConversation,
  cyclicConversation,
  duplicateIdConversation,
  linearConversation,
  mainLeafConversation,
  makeLongConversation,
  missingParentConversation,
} from '../fixtures/conversations';
import { buildActiveBranch } from '@src/pages/content/conversation/buildActiveBranch';

describe('buildActiveBranch', () => {
  it('orders a complete linear branch from root to current leaf', async () => {
    const result = await buildActiveBranch(linearConversation);

    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.messages.map((message) => message.id)).toEqual([
      'msg-user-001',
      'msg-assistant-001',
      'msg-user-002',
      'msg-assistant-002',
    ]);
    expect(result.rootMessageId).toBe('msg-user-001');
    expect(result.leafMessageId).toBe('msg-assistant-002');
  });

  it('includes only the current side branch and excludes sibling messages', async () => {
    const result = await buildActiveBranch(branchedConversation);

    expect(result.complete).toBe(true);
    expect(result.messages.map((message) => message.id)).toEqual([
      'msg-user-root',
      'msg-assistant-root',
      'msg-user-side-001',
      'msg-assistant-side-001',
      'msg-user-side-002',
      'msg-assistant-side-002',
    ]);
    expect(result.messages.some((message) => message.id === 'msg-assistant-main')).toBe(false);
  });

  it('builds the main branch when the current leaf points to it', async () => {
    const result = await buildActiveBranch(mainLeafConversation);

    expect(result.complete).toBe(true);
    expect(result.messages.at(-1)?.id).toBe('msg-assistant-main');
    expect(result.messages).toHaveLength(4);
  });

  it('marks a missing parent chain incomplete', async () => {
    const result = await buildActiveBranch(missingParentConversation);

    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual({ code: 'missing-parent', messageId: 'msg-parent-missing' });
  });

  it('detects a parent cycle without looping', async () => {
    const result = await buildActiveBranch(cyclicConversation);

    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'cycle')).toBe(true);
    expect(result.messages.length).toBeLessThanOrEqual(cyclicConversation.chat_messages.length);
  });

  it('detects duplicate message IDs and does not claim completeness', async () => {
    const result = await buildActiveBranch(duplicateIdConversation);

    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual({ code: 'duplicate-message-id', messageId: 'msg-duplicate' });
  });

  it('handles a 101-message branch without recursion', async () => {
    const result = await buildActiveBranch(makeLongConversation(101));

    expect(result.complete).toBe(true);
    expect(result.messages).toHaveLength(101);
    expect(result.messages[100]?.order).toBe(100);
  });

  it('reports a missing current leaf', async () => {
    const result = await buildActiveBranch({ ...linearConversation, current_leaf_message_uuid: 'msg-missing-leaf' });

    expect(result.complete).toBe(false);
    expect(result.messages).toEqual([]);
    expect(result.issues).toEqual([{ code: 'missing-current-leaf', messageId: 'msg-missing-leaf' }]);
  });
});
