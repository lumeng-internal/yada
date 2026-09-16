import { CLAUDE_ROOT_MESSAGE_ID } from '../conversation/buildActiveBranch';
import type {
  ClaudeConversation,
  RawClaudeAttachment,
  RawClaudeContentBlock,
  RawClaudeMessage,
} from '../conversation/types';

export type CountTokens = (text: string) => number;
export type HashText = (text: string) => Promise<string | null>;

export interface CountableMessage {
  uuid: string;
  sender: RawClaudeMessage['sender'];
  countableText: string;
  nonTextBlockCount: number;
  unknownBlockCount: number;
  createdAt?: string;
}

export interface CountableActiveBranch {
  messages: CountableMessage[];
  complete: boolean;
  currentLeafMessageId: string;
}

export interface ConversationTokenMetrics {
  trunkMessageCount: number;
  totalTokens: number | null;
  lastAssistantMs: number | null;
  cachedUntil: number | null;
  currentLeafMessageId: string;
  branchComplete: boolean;
  nonTextBlockCount: number;
  unknownBlockCount: number;
  compacted: boolean;
  estimateIncomplete: boolean;
}

type UnknownRecord = Record<string, unknown>;

const readString = (value: unknown): string => typeof value === 'string' ? value : '';

const firstString = (record: UnknownRecord, keys: string[]): string => {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return '';
};

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const normalize = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== 'object') return candidate;
    if (seen.has(candidate)) return '[Circular]';
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.map(normalize);
    return Object.fromEntries(
      Object.keys(candidate as UnknownRecord)
        .sort()
        .map((key) => [key, normalize((candidate as UnknownRecord)[key])]),
    );
  };

  try {
    return JSON.stringify(normalize(value));
  } catch {
    return '';
  }
};

export const normalizeCountableContent = (value: string): string => value
  .replace(/\r\n?/g, '\n')
  .replace(/[\t ]+\n/g, '\n')
  .trim();

const visibleNestedText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const record = item as UnknownRecord;
      const type = readString(record.type);
      if (type === 'thinking' || type === 'redacted_thinking') return '';
      return firstString(record, ['text', 'content', 'value', 'result']);
    })
    .filter(Boolean)
    .join('\n');
};

interface ExtractedMessageContent {
  text: string;
  nonTextBlockCount: number;
  unknownBlockCount: number;
}

const extractContentBlock = (block: RawClaudeContentBlock): ExtractedMessageContent => {
  const sourceType = readString(block.type);
  if (sourceType === 'thinking' || sourceType === 'redacted_thinking') {
    return { text: '', nonTextBlockCount: 0, unknownBlockCount: 0 };
  }
  if (sourceType === 'text') {
    return { text: firstString(block, ['text', 'content', 'value']), nonTextBlockCount: 0, unknownBlockCount: 0 };
  }
  if (sourceType === 'tool_use' || sourceType === 'server_tool_use') {
    const name = firstString(block, ['name', 'tool_name', 'label']) || 'unknown';
    return {
      text: stableStringify({ name, input: block.input }),
      nonTextBlockCount: 0,
      unknownBlockCount: 0,
    };
  }
  if (sourceType === 'tool_result') {
    const visible = visibleNestedText(block.content) || firstString(block, ['text', 'result']);
    return {
      text: visible ? stableStringify({ is_error: block.is_error, content: visible }) : '',
      nonTextBlockCount: visible ? 0 : 1,
      unknownBlockCount: 0,
    };
  }
  if (sourceType === 'image') {
    return { text: '', nonTextBlockCount: 1, unknownBlockCount: 0 };
  }
  if (sourceType === 'file' || sourceType === 'document' || sourceType === 'attachment') {
    const extracted = firstString(block, ['extracted_content', 'text']);
    return { text: extracted, nonTextBlockCount: 1, unknownBlockCount: 0 };
  }
  if (sourceType === 'artifact' || sourceType === 'create_artifact' || sourceType === 'update_artifact') {
    const visible = firstString(block, ['text', 'content', 'code']);
    return { text: visible, nonTextBlockCount: visible ? 0 : 1, unknownBlockCount: 0 };
  }

  return { text: '', nonTextBlockCount: 1, unknownBlockCount: 1 };
};

const attachmentIdentity = (attachment: RawClaudeAttachment): string => stableStringify({
  id: attachment.id ?? attachment.uuid,
  name: attachment.file_name ?? attachment.filename ?? attachment.name,
  mime: attachment.mime_type ?? attachment.file_type ?? attachment.media_type,
  extractedLength: readString(attachment.extracted_content ?? attachment.text).length,
});

const extractMessageContent = (message: RawClaudeMessage): ExtractedMessageContent => {
  const parts: string[] = [];
  let nonTextBlockCount = 0;
  let unknownBlockCount = 0;

  for (const contentBlock of message.content ?? []) {
    const extracted = extractContentBlock(contentBlock);
    if (extracted.text) parts.push(extracted.text);
    nonTextBlockCount += extracted.nonTextBlockCount;
    unknownBlockCount += extracted.unknownBlockCount;
  }

  if (parts.length === 0 && message.text) parts.push(message.text);

  const seenAttachments = new Set<string>();
  for (const attachment of [
    ...(message.attachments ?? []),
    ...(message.files ?? []),
    ...(message.files_v2 ?? []),
  ]) {
    const identity = attachmentIdentity(attachment);
    if (seenAttachments.has(identity)) continue;
    seenAttachments.add(identity);
    const extracted = readString(attachment.extracted_content ?? attachment.text);
    if (extracted) parts.push(extracted);
    nonTextBlockCount += 1;
  }

  return {
    text: normalizeCountableContent(parts.filter(Boolean).join('\n')),
    nonTextBlockCount,
    unknownBlockCount,
  };
};

const isExplicitlyCompacted = (conversation: ClaudeConversation, messages: RawClaudeMessage[]): boolean => {
  const record = conversation as UnknownRecord;
  if (
    record.is_compacted === true ||
    record.compacted === true ||
    record.has_compacted_messages === true
  ) return true;

  const status = readString(record.compaction_status).toLowerCase();
  if (status && status !== 'none' && status !== 'not_compacted') return true;

  return messages.some((message) => {
    const messageRecord = message as unknown as UnknownRecord;
    if (messageRecord.is_compacted === true || messageRecord.is_compaction_summary === true) return true;
    return (message.content ?? []).some((contentBlock) => (
      contentBlock.type === 'compaction' || contentBlock.type === 'compaction_summary'
    ));
  });
};

export const buildCountableActiveBranch = (conversation: ClaudeConversation): CountableActiveBranch => {
  const rawMessages = Array.isArray(conversation.chat_messages) ? conversation.chat_messages : [];
  const byId = new Map<string, RawClaudeMessage>();
  let complete = true;
  for (const message of rawMessages) {
    if (!message?.uuid || byId.has(message.uuid)) {
      complete = false;
      continue;
    }
    byId.set(message.uuid, message);
  }

  const currentLeafMessageId = conversation.current_leaf_message_uuid ?? '';
  if (!currentLeafMessageId || !byId.has(currentLeafMessageId)) {
    return { messages: [], complete: false, currentLeafMessageId };
  }

  const reverseBranch: RawClaudeMessage[] = [];
  const visited = new Set<string>();
  let currentId: string | null | undefined = currentLeafMessageId;
  while (currentId && currentId !== CLAUDE_ROOT_MESSAGE_ID) {
    if (visited.has(currentId)) {
      complete = false;
      break;
    }
    visited.add(currentId);
    const current = byId.get(currentId);
    if (!current) {
      complete = false;
      break;
    }
    reverseBranch.push(current);
    currentId = current.parent_message_uuid;
  }

  return {
    messages: reverseBranch.reverse().map((raw): CountableMessage => {
      const extracted = extractMessageContent(raw);
      return {
        uuid: raw.uuid,
        sender: raw.sender,
        countableText: extracted.text,
        nonTextBlockCount: extracted.nonTextBlockCount,
        unknownBlockCount: extracted.unknownBlockCount,
        createdAt: raw.created_at,
      };
    }),
    complete,
    currentLeafMessageId,
  };
};

interface CachedMessageTokens {
  fingerprint: string;
  tokens: number;
}

export class TokenMetricsCalculator {
  private readonly cacheByConversation = new Map<string, Map<string, CachedMessageTokens>>();

  async compute(
    conversationId: string,
    conversation: ClaudeConversation,
    countTokens: CountTokens,
    hashText: HashText,
  ): Promise<ConversationTokenMetrics> {
    const branch = buildCountableActiveBranch(conversation);
    let conversationCache = this.cacheByConversation.get(conversationId);
    if (!conversationCache) {
      conversationCache = new Map();
      this.cacheByConversation.set(conversationId, conversationCache);
    }

    const activeIds = new Set(branch.messages.map((message) => message.uuid));
    for (const messageId of conversationCache.keys()) {
      if (!activeIds.has(messageId)) conversationCache.delete(messageId);
    }

    let totalTokens = 0;
    let available = true;
    let lastAssistantMs: number | null = null;
    let nonTextBlockCount = 0;
    let unknownBlockCount = 0;

    for (const message of branch.messages) {
      nonTextBlockCount += message.nonTextBlockCount;
      unknownBlockCount += message.unknownBlockCount;
      if (message.sender === 'assistant' && message.createdAt) {
        const timestamp = Date.parse(message.createdAt);
        if (Number.isFinite(timestamp) && (lastAssistantMs === null || timestamp > lastAssistantMs)) {
          lastAssistantMs = timestamp;
        }
      }

      const normalized = normalizeCountableContent(message.countableText);
      if (!normalized) continue;
      const hash = await hashText(normalized);
      const fingerprint = hash ? `${normalized.length}:${hash}` : null;
      const cached = conversationCache.get(message.uuid);
      if (fingerprint && cached?.fingerprint === fingerprint) {
        totalTokens += cached.tokens;
        continue;
      }

      try {
        const tokens = countTokens(normalized);
        if (!Number.isFinite(tokens) || tokens < 0) throw new Error('Tokenizer returned invalid token count');
        totalTokens += tokens;
        if (fingerprint) conversationCache.set(message.uuid, { fingerprint, tokens });
      } catch {
        available = false;
      }
    }

    const compacted = isExplicitlyCompacted(
      conversation,
      branch.messages.map((message) => (
        conversation.chat_messages?.find((candidate) => candidate.uuid === message.uuid)
      )).filter((message): message is RawClaudeMessage => Boolean(message)),
    );

    return {
      trunkMessageCount: branch.messages.length,
      totalTokens: available ? totalTokens : null,
      lastAssistantMs,
      cachedUntil: lastAssistantMs === null ? null : lastAssistantMs + 5 * 60 * 1000,
      currentLeafMessageId: branch.currentLeafMessageId,
      branchComplete: branch.complete,
      nonTextBlockCount,
      unknownBlockCount,
      compacted,
      estimateIncomplete: !branch.complete || compacted || nonTextBlockCount > 0 || unknownBlockCount > 0,
    };
  }
}

export interface CounterRefreshCoordinator {
  routeChanged(): void;
  generationStarted(generationId: number): void;
  generationSettled(generationId: number): void;
  dispose(): void;
}

export const createCounterRefreshCoordinator = ({
  refresh,
  markStale,
  delayMs = 500,
}: {
  refresh: (force: boolean) => void;
  markStale: () => void;
  delayMs?: number;
}): CounterRefreshCoordinator => {
  const activeGenerations = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    routeChanged: () => {
      activeGenerations.clear();
      cancelTimer();
      refresh(false);
    },
    generationStarted: (generationId) => {
      cancelTimer();
      activeGenerations.add(generationId);
      markStale();
    },
    generationSettled: (generationId) => {
      const wasActive = activeGenerations.delete(generationId);
      if (!wasActive || activeGenerations.size > 0) return;
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        refresh(true);
      }, delayMs);
    },
    dispose: () => {
      activeGenerations.clear();
      cancelTimer();
    },
  };
};

interface RuntimeTokenizer {
  countTokens(text: string): number;
}

interface CounterRuntime {
  CONST?: { CACHE_WINDOW_MS?: number };
  bridge?: { requestHash(text: string): Promise<{ hash?: string }> };
  tokens?: unknown;
}

type CounterRuntimeGlobal = typeof globalThis & {
  ClaudeCounter?: CounterRuntime;
  GPTTokenizer_o200k_base?: RuntimeTokenizer;
};

const runtimeGlobal = globalThis as CounterRuntimeGlobal;
const runtimeCounter = runtimeGlobal.ClaudeCounter;

const waitForRuntimeTokenizer = async (timeoutMs = 5000): Promise<RuntimeTokenizer | null> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (runtimeGlobal.GPTTokenizer_o200k_base?.countTokens) return runtimeGlobal.GPTTokenizer_o200k_base;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return runtimeGlobal.GPTTokenizer_o200k_base ?? null;
};

if (runtimeCounter) {
  const runtimeCalculator = new TokenMetricsCalculator();
  runtimeCounter.tokens = {
    computeConversationMetrics: async (conversation: ClaudeConversation, conversationId = conversation.uuid ?? 'unknown') => {
      const tokenizer = await waitForRuntimeTokenizer();
      if (!tokenizer) {
        const branch = buildCountableActiveBranch(conversation);
        return {
          trunkMessageCount: branch.messages.length,
          totalTokens: null,
          lastAssistantMs: null,
          cachedUntil: null,
          currentLeafMessageId: branch.currentLeafMessageId,
          branchComplete: branch.complete,
          nonTextBlockCount: 0,
          unknownBlockCount: 0,
          compacted: false,
          estimateIncomplete: true,
        } satisfies ConversationTokenMetrics;
      }
      return runtimeCalculator.compute(
        conversationId,
        conversation,
        (text) => tokenizer.countTokens(text),
        async (text) => {
          try {
            return (await runtimeCounter.bridge?.requestHash(text))?.hash ?? null;
          } catch {
            return null;
          }
        },
      );
    },
    createCounterRefreshCoordinator,
  };
}
