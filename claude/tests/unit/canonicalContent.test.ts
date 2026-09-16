import { describe, expect, it } from 'vitest';
import { emptyAssistantConversation, richContentConversation, streamingConversation } from '../fixtures/conversations';
import { normalizeClaudeMessage } from '@src/pages/content/conversation/content';

describe('normalizeClaudeMessage', () => {
  it('filters thinking while preserving conservative visible type markers', async () => {
    const raw = richContentConversation.chat_messages[1]!;
    const message = await normalizeClaudeMessage(raw, 1);

    expect(message.visibleMarkdown).toContain('人工富内容回答');
    expect(message.visibleMarkdown).not.toContain('不应输出的人工思考');
    expect(message.visibleMarkdown).toContain('[工具调用：fixture_tool]');
    expect(message.visibleMarkdown).toContain('[工具结果：fixture_tool]');
    expect(message.visibleMarkdown).toContain('人工工具可见结果');
    expect(message.visibleMarkdown).toContain('[Artifact：人工制品｜text/markdown]');
    expect(message.visibleMarkdown).toContain('人工制品可见正文');
    expect(message.visibleMarkdown).toContain('[图片：generated.png]');
    expect(message.visibleMarkdown).toContain('[暂不支持的内容块：future_fixture_block]');
    expect(message.filteredContentBlockCount).toBe(2);
    expect(message.unknownContentBlockCount).toBe(1);
  });

  it('serializes attachment and image metadata without internal JSON', async () => {
    const raw = richContentConversation.chat_messages[0]!;
    const message = await normalizeClaudeMessage(raw, 0);

    expect(message.visibleMarkdown).toContain('[附件：fixture.pdf｜application/pdf]');
    expect(message.visibleMarkdown).toContain('人工附件可见文本');
    expect(message.visibleMarkdown).toContain('[图片：fixture.png]');
    expect(message.visibleMarkdown).not.toContain('extracted_content');
  });

  it('keeps an empty assistant as a canonical message', async () => {
    const message = await normalizeClaudeMessage(emptyAssistantConversation.chat_messages[1]!, 1);

    expect(message.role).toBe('assistant');
    expect(message.visibleMarkdown).toBe('');
    expect(message.visibleContentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('marks an unfinished assistant as streaming', async () => {
    const message = await normalizeClaudeMessage(streamingConversation.chat_messages[1]!, 1);

    expect(message.streaming).toBe(true);
    expect(message.visibleText).toContain('人工流式片段');
  });
});
