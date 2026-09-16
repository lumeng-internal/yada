import type {
  CanonicalContentBlock,
  CanonicalMessage,
  RawClaudeAttachment,
  RawClaudeContentBlock,
  RawClaudeMessage,
} from './types';

const THINKING_TYPES = new Set(['thinking', 'redacted_thinking']);

const readString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const firstString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return '';
};

export const normalizeVisibleText = (value: string): string => value
  .replace(/\r\n?/g, '\n')
  .replace(/[\t ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const block = (
  kind: CanonicalContentBlock['kind'],
  sourceType: string,
  markdown: string,
  options: { filtered?: boolean; unknown?: boolean; visibleText?: string } = {},
): CanonicalContentBlock => ({
  kind,
  sourceType,
  markdown,
  visibleText: normalizeVisibleText(options.visibleText ?? markdown),
  filtered: options.filtered ?? false,
  unknown: options.unknown ?? false,
});

const readNestedVisibleText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return firstString(record, ['text', 'content', 'value']);
    })
    .filter(Boolean)
    .join('\n');
};

const normalizeContentBlock = (raw: RawClaudeContentBlock): CanonicalContentBlock => {
  const sourceType = readString(raw.type) || 'unknown';

  if (THINKING_TYPES.has(sourceType)) {
    return block('filtered', sourceType, '', { filtered: true, visibleText: '' });
  }

  if (sourceType === 'text') {
    const text = firstString(raw, ['text', 'content', 'value']);
    return block('text', sourceType, text);
  }

  if (sourceType === 'image') {
    const label = firstString(raw, ['file_name', 'filename', 'name', 'label', 'title']) || '图片';
    return block('image', sourceType, `[图片：${label}]`);
  }

  if (sourceType === 'file' || sourceType === 'document' || sourceType === 'attachment') {
    const filename = firstString(raw, ['file_name', 'filename', 'name', 'title']) || '未命名文件';
    const mime = firstString(raw, ['mime_type', 'file_type', 'media_type', 'type_name']) || 'unknown';
    const extracted = firstString(raw, ['extracted_content', 'text', 'content']);
    const marker = `[附件：${filename}｜${mime}]`;
    return block('file', sourceType, extracted ? `${marker}\n\n${extracted}` : marker);
  }

  if (sourceType === 'artifact' || sourceType === 'create_artifact' || sourceType === 'update_artifact') {
    const title = firstString(raw, ['title', 'name']) || '未命名';
    const artifactType = firstString(raw, ['artifact_type', 'mime_type', 'language', 'type_name']) || sourceType;
    const visible = firstString(raw, ['text', 'content', 'code']);
    const marker = `[Artifact：${title}｜${artifactType}]`;
    return block('artifact', sourceType, visible ? `${marker}\n\n${visible}` : marker);
  }

  if (sourceType === 'tool_use') {
    const name = firstString(raw, ['name', 'tool_name', 'label']) || 'unknown';
    return block('tool-use', sourceType, `[工具调用：${name}]`);
  }

  if (sourceType === 'tool_result') {
    const name = firstString(raw, ['name', 'tool_name', 'label']) || 'unknown';
    const visible = readNestedVisibleText(raw.content) || firstString(raw, ['text', 'result']);
    const marker = `[工具结果：${name}]`;
    return block('tool-result', sourceType, visible ? `${marker}\n\n${visible}` : marker);
  }

  return block('unknown', sourceType, `[暂不支持的内容块：${sourceType}]`, { unknown: true });
};

const normalizeAttachment = (raw: RawClaudeAttachment): CanonicalContentBlock => {
  const filename = firstString(raw, ['file_name', 'filename', 'name', 'title']) || '未命名文件';
  const mime = firstString(raw, ['mime_type', 'file_type', 'media_type']) || 'unknown';
  if (mime.startsWith('image/')) return block('image', 'image', `[图片：${filename}]`);

  const extracted = firstString(raw, ['extracted_content', 'text']);
  const marker = `[附件：${filename}｜${mime}]`;
  return block('file', 'file', extracted ? `${marker}\n\n${extracted}` : marker);
};

const collectRawBlocks = (raw: RawClaudeMessage): CanonicalContentBlock[] => {
  const normalized = Array.isArray(raw.content) ? raw.content.map(normalizeContentBlock) : [];
  const hasVisibleTextBlock = normalized.some((item) => item.kind === 'text' && item.visibleText);
  if (!hasVisibleTextBlock && readString(raw.text)) {
    normalized.unshift(block('text', 'text', readString(raw.text)));
  }

  for (const attachment of raw.attachments ?? []) normalized.push(normalizeAttachment(attachment));
  for (const attachment of raw.files ?? []) normalized.push(normalizeAttachment(attachment));
  for (const attachment of raw.files_v2 ?? []) normalized.push(normalizeAttachment(attachment));
  return normalized;
};

export const normalizeClaudeMessage = async (raw: RawClaudeMessage, order: number): Promise<CanonicalMessage> => {
  const contentBlocks = collectRawBlocks(raw);
  const visibleMarkdown = contentBlocks
    .filter((item) => !item.filtered && item.markdown)
    .map((item) => item.markdown.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const visibleText = normalizeVisibleText(contentBlocks
    .filter((item) => !item.filtered && item.visibleText)
    .map((item) => item.visibleText)
    .join('\n'));

  return {
    id: raw.uuid,
    parentId: raw.parent_message_uuid ?? null,
    role: raw.sender === 'human' || raw.sender === 'user' ? 'user' : 'assistant',
    order,
    contentBlocks,
    visibleMarkdown,
    visibleText,
    visibleContentHash: await sha256Hex(normalizeVisibleText(visibleMarkdown)),
    filteredContentBlockCount: contentBlocks.filter((item) => item.filtered).length,
    unknownContentBlockCount: contentBlocks.filter((item) => item.unknown).length,
    createdAt: raw.created_at,
    streaming: raw.sender === 'assistant' && raw.stop_reason === null,
  };
};
