import { describe, expect, it } from 'vitest';
import { emptyAssistantConversation, linearConversation } from '../fixtures/conversations';
import { buildActiveBranch } from '@src/pages/content/conversation/buildActiveBranch';
import { buildCanonicalTurns } from '@src/pages/content/conversation/buildCanonicalTurns';

describe('buildCanonicalTurns', () => {
  it('uses the user message ID as the stable canonical turn ID', async () => {
    const branch = await buildActiveBranch(linearConversation);
    const turns = buildCanonicalTurns(branch.messages);

    expect(turns.map((turn) => turn.id)).toEqual(['msg-user-001', 'msg-user-002']);
    expect(turns[0]).toMatchObject({
      userMessageId: 'msg-user-001',
      assistantMessageId: 'msg-assistant-001',
      order: 0,
    });
  });

  it('retains an empty assistant in its user turn', async () => {
    const branch = await buildActiveBranch(emptyAssistantConversation);
    const turns = buildCanonicalTurns(branch.messages);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.assistantMessageId).toBe('msg-assistant-empty');
    expect(turns[0]?.assistantPreview).toBe('');
  });

  it('creates a stable assistant-only turn for a leading assistant message', async () => {
    const assistant = (await buildActiveBranch({
      uuid: 'conversation-leading-assistant',
      current_leaf_message_uuid: 'msg-leading-assistant',
      chat_messages: [{
        uuid: 'msg-leading-assistant',
        parent_message_uuid: null,
        sender: 'assistant',
        text: '人工开场回答',
        content: [{ type: 'text', text: '人工开场回答' }],
      }],
    })).messages;

    const turns = buildCanonicalTurns(assistant);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: 'msg-leading-assistant',
      assistantMessageId: 'msg-leading-assistant',
    });
    expect(turns[0]?.userMessageId).toBeUndefined();
  });
});
