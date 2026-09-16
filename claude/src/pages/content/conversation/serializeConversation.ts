import { normalizeVisibleText, sha256Hex } from './content';
import type { ConversationSnapshot } from './types';

export interface SerializationMetrics {
  canonicalTurnCount: number;
  activeBranchMessageCount: number;
  serializedVisibleMessageCount: number;
  filteredContentBlockCount: number;
  unknownContentBlockCount: number;
  firstMessageIdHash: string;
  lastMessageIdHash: string;
  firstVisibleContentHash: string;
  lastVisibleContentHash: string;
}

export interface SerializedConversation {
  markdown: string;
  messageIds: string[];
  messages: SerializedMessage[];
  metrics: SerializationMetrics;
}

export interface SerializedMessage {
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  visibleMarkdown: string;
  visibleContentHash: string;
}

const messageMarkdown = (role: 'user' | 'assistant', visibleMarkdown: string): string => {
  const heading = role === 'user' ? '# User' : '# Claude';
  return visibleMarkdown ? `${heading}\n\n${visibleMarkdown}` : heading;
};

export const serializeConversationSnapshot = async (
  snapshot: ConversationSnapshot,
): Promise<SerializedConversation> => {
  const first = snapshot.messages[0];
  const last = snapshot.messages.at(-1);
  const messages = await Promise.all(snapshot.messages.map(async (message): Promise<SerializedMessage> => ({
    id: message.id,
    role: message.role,
    markdown: messageMarkdown(message.role, message.visibleMarkdown),
    visibleMarkdown: message.visibleMarkdown,
    visibleContentHash: await sha256Hex(normalizeVisibleText(message.visibleMarkdown)),
  })));
  const messageIds = messages.map((message) => message.id);
  const markdown = messages
    .map((message) => message.markdown)
    .join('\n\n')
    .trim();
  const firstSerialized = messages[0];
  const lastSerialized = messages.at(-1);

  return {
    markdown,
    messageIds,
    messages,
    metrics: {
      canonicalTurnCount: snapshot.turns.length,
      activeBranchMessageCount: snapshot.messages.length,
      serializedVisibleMessageCount: messages.length,
      filteredContentBlockCount: snapshot.messages.reduce(
        (total, message) => total + message.filteredContentBlockCount,
        0,
      ),
      unknownContentBlockCount: snapshot.messages.reduce(
        (total, message) => total + message.unknownContentBlockCount,
        0,
      ),
      firstMessageIdHash: first ? await sha256Hex(first.id) : '',
      lastMessageIdHash: last ? await sha256Hex(last.id) : '',
      firstVisibleContentHash: firstSerialized?.visibleContentHash ?? '',
      lastVisibleContentHash: lastSerialized?.visibleContentHash ?? '',
    },
  };
};
