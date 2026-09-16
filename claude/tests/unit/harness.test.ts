import { describe, expect, it } from 'vitest';
import { linearConversation } from '../fixtures/conversations';

describe('canonical test harness', () => {
  it('loads artificial conversation fixtures without real identifiers', () => {
    expect(linearConversation.current_leaf_message_uuid).toBe('msg-assistant-002');
    expect(linearConversation.chat_messages).toHaveLength(4);
    expect(linearConversation.chat_messages.every((message) => message.uuid.startsWith('msg-'))).toBe(true);
  });
});
