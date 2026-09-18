import { fetchCurrentConversation } from "../conversation/fetchConversation";
import { extractAssistantUsageEvents } from "../conversation/extractAssistantUsageEvents";
import { normalizeConversation } from "../conversation/normalizeConversation";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import type {
  ConversationListener,
  ConversationLoadOptions,
  ConversationSnapshot
} from "./types";

const COALESCE_MS = 250;

export class ConversationRepository {
  private readonly listeners = new Set<ConversationListener>();
  private readonly cache = new Map<string, ConversationSnapshot>();
  private readonly inflight = new Map<string, Promise<ConversationSnapshot>>();
  private readonly pending = new Map<string, { reason: string; timer: number }>();
  private revision = 0;
  private disposed = false;
  private activeConversationId: string | null = null;
  private activeAbort: AbortController | null = null;

  subscribe(listener: ConversationListener): () => void {
    this.listeners.add(listener);
    const current = this.activeConversationId ? this.cache.get(this.activeConversationId) ?? null : null;
    listener(current ?? null);
    return () => this.listeners.delete(listener);
  }

  load(conversationId: string, options: ConversationLoadOptions = {}): Promise<ConversationSnapshot> {
    if (this.disposed) return Promise.reject(new Error("ConversationRepository disposed"));
    if (!conversationId) return Promise.reject(new Error("No active ChatGPT conversation"));

    if (!options.force) {
      const cached = this.cache.get(conversationId);
      if (cached) return Promise.resolve(cached);
      const existing = this.inflight.get(conversationId);
      if (existing) return existing.then((snapshot) => snapshot.revision >= 0 ? snapshot : this.read(conversationId, options.signal));
    } else {
      const existing = this.inflight.get(conversationId);
      if (existing) return existing.then((snapshot) => snapshot.revision >= 0 ? snapshot : this.read(conversationId, options.signal));
    }

    return this.read(conversationId, options.signal);
  }

  refresh(conversationId: string, _reason: string): Promise<ConversationSnapshot> {
    if (this.disposed) return Promise.reject(new Error("ConversationRepository disposed"));
    const existing = this.inflight.get(conversationId);
    if (existing) return existing.then((snapshot) => snapshot.revision >= 0 ? snapshot : this.read(conversationId));

    const pending = this.pending.get(conversationId);
    if (pending) clearTimeout(pending.timer);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(conversationId);
          this.read(conversationId).then(resolve, reject);
        }, COALESCE_MS) as unknown as number;
      this.pending.set(conversationId, { reason: _reason, timer });
    });
  }

  invalidate(conversationId: string): void {
    this.cache.delete(conversationId);
    if (this.activeConversationId === conversationId) this.emit(null);
  }

  setActiveConversation(conversationId: string | null): void {
    if (this.activeConversationId === conversationId) return;
    this.activeAbort?.abort();
    this.activeAbort = null;
    const pending = this.activeConversationId ? this.pending.get(this.activeConversationId) : undefined;
    if (pending && this.activeConversationId) {
      clearTimeout(pending.timer);
      this.pending.delete(this.activeConversationId);
    }
    this.activeConversationId = conversationId;
    if (!conversationId) {
      this.emit(null);
      return;
    }
    void this.load(conversationId).then((snapshot) => {
      if (snapshot.revision < 0) return;
    }, (error) => {
      if (isAbortError(error)) return;
      if (this.activeConversationId === conversationId) this.emit(null);
    });
  }

  getSnapshot(conversationId = this.activeConversationId): ConversationSnapshot | null {
    return conversationId ? this.cache.get(conversationId) ?? null : null;
  }

  dispose(): void {
    this.disposed = true;
    this.activeAbort?.abort();
    this.activeAbort = null;
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.inflight.clear();
    this.cache.clear();
    this.listeners.clear();
  }

  private read(conversationId: string, externalSignal?: AbortSignal): Promise<ConversationSnapshot> {
    const existing = this.inflight.get(conversationId);
    if (existing) return existing;

    const controller = new AbortController();
    const abort = (): void => controller.abort();
    if (this.activeConversationId === conversationId) {
      this.activeAbort?.abort();
      this.activeAbort = controller;
    }
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abort, { once: true });
    }

    const request = new Promise<ConversationSnapshot>((resolve, reject) => {
      void (async () => {
        try {
          const conversation = await fetchCurrentConversation(conversationId, controller.signal);
          if (controller.signal.aborted) {
            this.dropInflight(conversationId, request);
            resolve(cancelledSnapshot(conversationId));
            return;
          }
          if (!conversation) throw new Error("ChatGPT conversation was not returned");
          this.revision += 1;
          const snapshot: ConversationSnapshot = {
            conversationId: conversation.id ?? conversation.conversation_id ?? conversationId,
            revision: this.revision,
            capturedAt: Date.now(),
            activeTurns: normalizeConversation(conversation),
            assistantEvents: extractAssistantUsageEvents(conversation),
            title: conversation.title
          };
          this.cache.set(conversationId, snapshot);
          if (snapshot.conversationId !== conversationId) this.cache.set(snapshot.conversationId, snapshot);
          if (this.activeConversationId === conversationId || this.activeConversationId === snapshot.conversationId) {
            this.emit(snapshot);
          }
          resolve(snapshot);
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            this.dropInflight(conversationId, request);
            resolve(cancelledSnapshot(conversationId));
            return;
          }
          reject(error);
        }
      })().catch((error) => {
        if (controller.signal.aborted || isAbortError(error)) {
          this.dropInflight(conversationId, request);
          resolve(cancelledSnapshot(conversationId));
          return;
        }
        reject(error);
      });
    });

    this.inflight.set(conversationId, request);
    void request.finally(() => {
      if (this.inflight.get(conversationId) === request) this.inflight.delete(conversationId);
      externalSignal?.removeEventListener("abort", abort);
      if (this.activeAbort === controller) this.activeAbort = null;
    });
    return request;
  }

  private dropInflight(conversationId: string, request: Promise<ConversationSnapshot>): void {
    if (this.inflight.get(conversationId) === request) this.inflight.delete(conversationId);
  }

  private emit(snapshot: ConversationSnapshot | null): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function conversationIdFromLocation(): string | null {
  return getConversationIdFromUrl();
}

function cancelledSnapshot(conversationId: string): ConversationSnapshot {
  return {
    conversationId,
    revision: -1,
    capturedAt: 0,
    activeTurns: [],
    assistantEvents: []
  };
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name: string }).name === "AbortError");
}
