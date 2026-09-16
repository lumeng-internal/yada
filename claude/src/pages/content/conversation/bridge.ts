import type { ClaudeConversation } from './types';

export interface ConversationBridgePayload {
  orgId?: unknown;
  conversationId?: unknown;
  data?: unknown;
  requestSequence?: unknown;
  generationId?: unknown;
}

export interface BridgePort {
  requestConversation(organizationId: string, conversationId: string): Promise<ClaudeConversation>;
  invalidateConversation?(conversationId?: string): void;
  on(type: string, listener: (payload: ConversationBridgePayload) => void): () => void;
}

type CounterGlobal = typeof globalThis & {
  ClaudeCounter?: {
    bridge?: BridgePort;
  };
};

export const getBridgePort = (): BridgePort | null => {
  const bridge = (globalThis as CounterGlobal).ClaudeCounter?.bridge;
  if (!bridge || typeof bridge.requestConversation !== 'function' || typeof bridge.on !== 'function') return null;
  return bridge;
};
