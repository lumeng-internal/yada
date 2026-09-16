export type CanonicalRole = 'user' | 'assistant';

export interface RawClaudeContentBlock {
  type?: unknown;
  [key: string]: unknown;
}

export interface RawClaudeAttachment {
  [key: string]: unknown;
}

export interface RawClaudeMessage {
  uuid: string;
  parent_message_uuid?: string | null;
  sender: 'human' | 'user' | 'assistant';
  text?: string;
  content?: RawClaudeContentBlock[];
  attachments?: RawClaudeAttachment[];
  files?: RawClaudeAttachment[];
  files_v2?: RawClaudeAttachment[];
  created_at?: string;
  stop_reason?: string | null;
}

export interface ClaudeConversation {
  uuid?: string;
  current_leaf_message_uuid?: string | null;
  chat_messages?: RawClaudeMessage[];
  [key: string]: unknown;
}

export type CanonicalContentKind =
  | 'text'
  | 'file'
  | 'image'
  | 'artifact'
  | 'tool-use'
  | 'tool-result'
  | 'filtered'
  | 'unknown';

export interface CanonicalContentBlock {
  kind: CanonicalContentKind;
  sourceType: string;
  markdown: string;
  visibleText: string;
  filtered: boolean;
  unknown: boolean;
}

export interface CanonicalMessage {
  id: string;
  parentId: string | null;
  role: CanonicalRole;
  order: number;
  contentBlocks: CanonicalContentBlock[];
  visibleMarkdown: string;
  visibleText: string;
  visibleContentHash: string;
  filteredContentBlockCount: number;
  unknownContentBlockCount: number;
  createdAt?: string;
  streaming: boolean;
}

export interface CanonicalTurn {
  id: string;
  order: number;
  userMessageId?: string;
  assistantMessageId?: string;
  userPreview: string;
  assistantPreview: string;
}

export type BranchIssueCode =
  | 'missing-current-leaf'
  | 'missing-parent'
  | 'cycle'
  | 'duplicate-message-id';

export interface BranchIssue {
  code: BranchIssueCode;
  messageId?: string;
}

export interface ActiveBranchResult {
  messages: CanonicalMessage[];
  complete: boolean;
  issues: BranchIssue[];
  rootMessageId?: string;
  leafMessageId?: string;
}

export type ConversationStoreStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'incomplete' | 'error';

export interface ConversationSnapshot {
  conversationId: string;
  currentLeafMessageId: string;
  messages: CanonicalMessage[];
  turns: CanonicalTurn[];
  complete: boolean;
  issues: BranchIssue[];
  fetchedAt: number;
}

export interface ConversationStoreState {
  status: ConversationStoreStatus;
  snapshot: ConversationSnapshot | null;
  error: string | null;
}

export interface ConversationRequestContext {
  organizationId: string;
  conversationId: string;
}

export interface ConversationClientResult {
  source: 'api';
  fetchedAt: number;
  conversation: ClaudeConversation;
}

export interface ConversationClient {
  fetchConversation(
    context: ConversationRequestContext,
    options?: { force?: boolean; signal?: AbortSignal },
  ): Promise<ConversationClientResult>;
  invalidate(conversationId?: string): void;
}
