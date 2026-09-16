import { getBridgePort, type ConversationBridgePayload } from './bridge';
import { ConversationClientImpl } from './conversationClient';
import { ConversationStore } from './conversationStore';
import type { ClaudeConversation, ConversationRequestContext } from './types';

const client = new ConversationClientImpl(getBridgePort);
export const conversationStore = new ConversationStore(client);

const readConversationId = (): string | null => {
  const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
  return match?.[1] ?? null;
};

const readOrganizationId = (): string | null => {
  try {
    const encoded = document.cookie
      .split('; ')
      .find((row) => row.startsWith('lastActiveOrg='))
      ?.slice('lastActiveOrg='.length);
    return encoded ? decodeURIComponent(encoded) : null;
  } catch {
    return null;
  }
};

const readContext = (): ConversationRequestContext | null => {
  const organizationId = readOrganizationId();
  const conversationId = readConversationId();
  return organizationId && conversationId ? { organizationId, conversationId } : null;
};

const parsePayload = (payload: ConversationBridgePayload): { context: ConversationRequestContext; conversation: ClaudeConversation } | null => {
  if (typeof payload.orgId !== 'string' || typeof payload.conversationId !== 'string') return null;
  if (!payload.data || typeof payload.data !== 'object') return null;
  return {
    context: { organizationId: payload.orgId, conversationId: payload.conversationId },
    conversation: payload.data as ClaudeConversation,
  };
};

export interface DebouncedConversationRefresh {
  schedule(): void;
  cancel(): void;
}

export class ConversationBridgeSequenceGate {
  private latestSequence = -1;

  accept(_conversationId: string, sequence: number | null): boolean {
    if (sequence === null) return true;
    if (sequence < this.latestSequence) return false;
    this.latestSequence = sequence;
    return true;
  }
}

export class GenerationRefreshCoordinator {
  private readonly active = new Set<number>();

  constructor(
    private readonly refresh: DebouncedConversationRefresh,
    private readonly markStale: () => void,
  ) {}

  start(generationId: number): void {
    this.refresh.cancel();
    this.active.add(generationId);
    this.markStale();
  }

  settled(generationId: number): void {
    const wasActive = this.active.delete(generationId);
    if (wasActive && this.active.size === 0) this.refresh.schedule();
  }

  stop(): void {
    this.active.clear();
    this.refresh.cancel();
  }
}

export const createDebouncedConversationRefresh = (
  refresh: () => void,
  delayMs: number,
  setTimer: (callback: () => void, delay: number) => number,
  clearTimer: (timer: number) => void,
): DebouncedConversationRefresh => {
  let timer: number | null = null;
  return {
    schedule: () => {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        refresh();
      }, delayMs);
    },
    cancel: () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
};

export const startConversationRuntime = (): (() => void) => {
  let activeController: AbortController | null = null;
  const bridgeSequenceGate = new ConversationBridgeSequenceGate();

  const loadCurrentRoute = (force = false) => {
    activeController?.abort();
    activeController = null;
    const context = readContext();
    if (!context) {
      conversationStore.clear();
      return;
    }
    activeController = new AbortController();
    void conversationStore.load(context, { force, signal: activeController.signal });
  };

  const settledRefresh = createDebouncedConversationRefresh(
    () => loadCurrentRoute(true),
    500,
    (callback, delay) => window.setTimeout(callback, delay),
    (timer) => window.clearTimeout(timer),
  );
  const generationRefresh = new GenerationRefreshCoordinator(
    settledRefresh,
    () => conversationStore.markStale(),
  );
  const handleRouteChange = () => {
    generationRefresh.stop();
    loadCurrentRoute(false);
  };

  const bridge = getBridgePort();
  const unsubscribeBridge = bridge?.on('cc:conversation', (payload) => {
    const parsed = parsePayload(payload);
    if (!parsed) return;
    const sequence = typeof payload.requestSequence === 'number' ? payload.requestSequence : null;
    if (!bridgeSequenceGate.accept(parsed.context.conversationId, sequence)) return;
    void conversationStore.applyConversation(parsed.context, parsed.conversation);
  }) ?? (() => undefined);

  const unsubscribeGenerationStart = bridge?.on('cc:generation_start', (payload) => {
    const generationId = typeof payload.generationId === 'number' ? payload.generationId : 0;
    generationRefresh.start(generationId);
  }) ?? (() => undefined);
  const unsubscribeGenerationSettled = bridge?.on('cc:generation_settled', (payload) => {
    const generationId = typeof payload.generationId === 'number' ? payload.generationId : 0;
    generationRefresh.settled(generationId);
  }) ?? (() => undefined);

  window.addEventListener('cc:urlchange', handleRouteChange);
  window.addEventListener('claude-nexus:locationchange', handleRouteChange);
  window.addEventListener('popstate', handleRouteChange);
  loadCurrentRoute();

  return () => {
    activeController?.abort();
    generationRefresh.stop();
    unsubscribeBridge();
    unsubscribeGenerationStart();
    unsubscribeGenerationSettled();
    window.removeEventListener('cc:urlchange', handleRouteChange);
    window.removeEventListener('claude-nexus:locationchange', handleRouteChange);
    window.removeEventListener('popstate', handleRouteChange);
    conversationStore.clear();
  };
};
