export const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

export type FixtureContentBlock = Record<string, unknown> & { type: string };

export interface FixtureMessage {
  uuid: string;
  parent_message_uuid: string | null;
  sender: 'human' | 'assistant';
  text?: string;
  content?: FixtureContentBlock[];
  attachments?: Array<Record<string, unknown>>;
  files_v2?: Array<Record<string, unknown>>;
  created_at?: string;
  stop_reason?: string | null;
}

export interface FixtureConversation {
  uuid: string;
  current_leaf_message_uuid: string;
  chat_messages: FixtureMessage[];
}

const textBlock = (text: string): FixtureContentBlock => ({ type: 'text', text });

const message = (
  uuid: string,
  parent: string | null,
  sender: FixtureMessage['sender'],
  text: string,
  extra: Partial<FixtureMessage> = {},
): FixtureMessage => ({
  uuid,
  parent_message_uuid: parent,
  sender,
  text,
  content: [textBlock(text)],
  created_at: '2026-01-01T00:00:00.000Z',
  ...extra,
});

export const linearConversation: FixtureConversation = {
  uuid: 'conversation-linear',
  current_leaf_message_uuid: 'msg-assistant-002',
  chat_messages: [
    message('msg-user-001', ROOT_MESSAGE_ID, 'human', '人工问题一'),
    message('msg-assistant-001', 'msg-user-001', 'assistant', '人工回答一'),
    message('msg-user-002', 'msg-assistant-001', 'human', '人工问题二'),
    message('msg-assistant-002', 'msg-user-002', 'assistant', '人工回答二'),
  ],
};

export const branchedConversation: FixtureConversation = {
  uuid: 'conversation-branched',
  current_leaf_message_uuid: 'msg-assistant-side-002',
  chat_messages: [
    message('msg-user-root', ROOT_MESSAGE_ID, 'human', '人工根问题'),
    message('msg-assistant-root', 'msg-user-root', 'assistant', '人工根回答'),
    message('msg-user-main', 'msg-assistant-root', 'human', '人工主分支问题'),
    message('msg-assistant-main', 'msg-user-main', 'assistant', '人工主分支回答'),
    message('msg-user-side-001', 'msg-assistant-root', 'human', '人工旁分支问题一'),
    message('msg-assistant-side-001', 'msg-user-side-001', 'assistant', '人工旁分支回答一'),
    message('msg-user-side-002', 'msg-assistant-side-001', 'human', '人工旁分支问题二'),
    message('msg-assistant-side-002', 'msg-user-side-002', 'assistant', '人工旁分支回答二'),
  ],
};

export const mainLeafConversation: FixtureConversation = {
  ...branchedConversation,
  uuid: 'conversation-main-leaf',
  current_leaf_message_uuid: 'msg-assistant-main',
};

export const missingParentConversation: FixtureConversation = {
  uuid: 'conversation-missing-parent',
  current_leaf_message_uuid: 'msg-assistant-orphan',
  chat_messages: [
    message('msg-assistant-orphan', 'msg-parent-missing', 'assistant', '人工孤立回答'),
  ],
};

export const cyclicConversation: FixtureConversation = {
  uuid: 'conversation-cycle',
  current_leaf_message_uuid: 'msg-cycle-b',
  chat_messages: [
    message('msg-cycle-a', 'msg-cycle-b', 'human', '人工循环甲'),
    message('msg-cycle-b', 'msg-cycle-a', 'assistant', '人工循环乙'),
  ],
};

export const duplicateIdConversation: FixtureConversation = {
  uuid: 'conversation-duplicate',
  current_leaf_message_uuid: 'msg-duplicate',
  chat_messages: [
    message('msg-duplicate', ROOT_MESSAGE_ID, 'human', '人工重复一'),
    message('msg-duplicate', ROOT_MESSAGE_ID, 'assistant', '人工重复二'),
  ],
};

export const emptyAssistantConversation: FixtureConversation = {
  uuid: 'conversation-empty-assistant',
  current_leaf_message_uuid: 'msg-assistant-empty',
  chat_messages: [
    message('msg-user-empty', ROOT_MESSAGE_ID, 'human', '人工空回复问题'),
    message('msg-assistant-empty', 'msg-user-empty', 'assistant', '', { content: [] }),
  ],
};

export const streamingConversation: FixtureConversation = {
  uuid: 'conversation-streaming',
  current_leaf_message_uuid: 'msg-assistant-streaming',
  chat_messages: [
    message('msg-user-streaming', ROOT_MESSAGE_ID, 'human', '人工流式问题'),
    message('msg-assistant-streaming', 'msg-user-streaming', 'assistant', '人工流式片段', {
      stop_reason: null,
    }),
  ],
};

export const richContentConversation: FixtureConversation = {
  uuid: 'conversation-rich-content',
  current_leaf_message_uuid: 'msg-assistant-rich',
  chat_messages: [
    message('msg-user-rich', ROOT_MESSAGE_ID, 'human', '人工富内容问题', {
      attachments: [
        {
          file_name: 'fixture.pdf',
          file_type: 'application/pdf',
          extracted_content: '人工附件可见文本',
        },
      ],
      files_v2: [
        { file_name: 'fixture.png', mime_type: 'image/png' },
      ],
    }),
    message('msg-assistant-rich', 'msg-user-rich', 'assistant', '人工富内容回答', {
      content: [
        { type: 'thinking', thinking: '不应输出的人工思考' },
        { type: 'redacted_thinking', data: '不应输出' },
        textBlock('人工富内容回答'),
        { type: 'tool_use', name: 'fixture_tool', input: { query: '人工摘要参数', secret: '不输出' } },
        { type: 'tool_result', name: 'fixture_tool', content: '人工工具可见结果' },
        { type: 'artifact', title: '人工制品', artifact_type: 'text/markdown', text: '人工制品可见正文' },
        { type: 'image', file_name: 'generated.png' },
        { type: 'future_fixture_block', label: '人工未知类型' },
      ],
    }),
  ],
};

export const makeLongConversation = (messageCount = 101): FixtureConversation => {
  const messages: FixtureMessage[] = [];
  let parent: string = ROOT_MESSAGE_ID;

  for (let index = 0; index < messageCount; index += 1) {
    const role = index % 2 === 0 ? 'human' : 'assistant';
    const uuid = `msg-long-${String(index + 1).padStart(3, '0')}`;
    messages.push(message(uuid, parent, role, `人工长对话内容 ${index + 1}`));
    parent = uuid;
  }

  return {
    uuid: `conversation-long-${messageCount}`,
    current_leaf_message_uuid: parent,
    chat_messages: messages,
  };
};

export const repeatedTextConversation: FixtureConversation = {
  uuid: 'conversation-repeated-text',
  current_leaf_message_uuid: 'msg-repeat-a-003',
  chat_messages: [
    message('msg-repeat-u-001', ROOT_MESSAGE_ID, 'human', '继续'),
    message('msg-repeat-a-001', 'msg-repeat-u-001', 'assistant', '好的'),
    message('msg-repeat-u-002', 'msg-repeat-a-001', 'human', '继续'),
    message('msg-repeat-a-002', 'msg-repeat-u-002', 'assistant', '好的'),
    message('msg-repeat-u-003', 'msg-repeat-a-002', 'human', '相同问题'),
    message('msg-repeat-a-003', 'msg-repeat-u-003', 'assistant', '共同前缀后的唯一结尾三'),
  ],
};
