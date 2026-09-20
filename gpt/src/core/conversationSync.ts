import { abortError, isAbortError, readConversation as readConversationFromApi } from "../conversation/readConversation";
import type { ConversationListener, ConversationSnapshot, ReadConversation } from "./types";

export class ConversationSync {
  private activeConversationId: string | null = null;
  private generation = 0;
  private runningPromise: Promise<void> | null = null;
  private dirty = false;
  private abortController: AbortController | null = null;
  private latestSnapshot: ConversationSnapshot | null = null;
  private lastError: Error | null = null;
  private readonly listeners = new Set<ConversationListener>();
  private observer: MutationObserver | null = null;
  private lastStreamingState = false;
  private readonly seenAssistantMessageIds = new Set<string>();
  private disposed = false;
  private published = 0;
  private readonly read: ReadConversation;

  constructor(options: { readConversation?: ReadConversation } = {}) {
    this.read = options.readConversation ?? readConversationFromApi;
  }

  subscribe(listener: ConversationListener): () => void {
    this.listeners.add(listener);
    void listener(this.latestSnapshot);
    return () => this.listeners.delete(listener);
  }

  requestSync(_reason: string): Promise<void> {
    if (this.disposed) return Promise.reject(abortError());
    this.dirty = true;
    if (this.runningPromise) return this.runningPromise;
    this.runningPromise = Promise.resolve().then(() => this.runLoop());
    return this.runningPromise;
  }

  setActiveConversation(conversationId: string | null): void {
    if (this.activeConversationId === conversationId) return;
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.activeConversationId = conversationId;
    this.seenAssistantMessageIds.clear();
    this.lastStreamingState = false;
    this.latestSnapshot = null;
    this.lastError = null;
    if (!conversationId) {
      this.dirty = false;
      void this.publish(null);
      return;
    }
    this.dirty = true;
    void this.requestSync("route");
  }

  getSnapshot(): ConversationSnapshot | null {
    return this.latestSnapshot;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  getActiveConversationId(): string | null {
    return this.activeConversationId;
  }

  mountPageObserver(root: ParentNode = document.documentElement): void {
    if (this.observer || typeof MutationObserver === "undefined") return;
    this.observer = new MutationObserver(() => this.inspectPageSignals());
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-is-streaming", "data-message-id", "data-message-author-role"]
    });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.dirty = false;
    this.observer?.disconnect();
    this.observer = null;
    this.listeners.clear();
    this.latestSnapshot = null;
    this.runningPromise = null;
    this.seenAssistantMessageIds.clear();
  }

  private async runLoop(): Promise<void> {
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false;
        const conversationId = this.activeConversationId;
        const generation = this.generation;
        if (!conversationId) {
          await this.publish(null);
          continue;
        }
        this.abortController?.abort();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        try {
          const snapshot = await this.read(conversationId, signal);
          if (this.disposed || signal.aborted) throw abortError();
          if (this.activeConversationId === conversationId && this.generation === generation) {
            snapshot.revision = ++this.published;
            this.lastError = null;
            await this.publish(snapshot);
          }
        } catch (error) {
          if (this.disposed) return;
          if (isAbortError(error) || this.generation !== generation) continue;
          if (this.activeConversationId === conversationId) {
            this.lastError = error instanceof Error ? error : new Error(String(error));
            if (!this.latestSnapshot) await this.publish(null);
          }
        }
      }
    } finally {
      this.runningPromise = null;
      if (this.dirty && !this.disposed) {
        await this.requestSync("drain");
      }
    }
  }

  private async publish(snapshot: ConversationSnapshot | null): Promise<void> {
    this.latestSnapshot = snapshot;
    if (snapshot) {
      for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
      for (const turn of snapshot.activeTurns) {
        if (turn.assistantMessageId) this.seenAssistantMessageIds.add(turn.assistantMessageId);
      }
    }
    await Promise.all([...this.listeners].map((listener) => listener(snapshot)));
  }

  private inspectPageSignals(): void {
    if (this.disposed || !this.activeConversationId) return;

    const streaming = isAssistantStreaming();
    const wasStreaming = this.lastStreamingState;
    this.lastStreamingState = streaming;
    if (streaming) return;

    if (wasStreaming) void this.requestSync("streaming-end");

    for (const id of collectStableAssistantMessageIds()) {
      if (this.seenAssistantMessageIds.has(id)) continue;
      this.seenAssistantMessageIds.add(id);
      void this.requestSync("new-assistant");
    }
  }
}

export { ConversationSync as ConversationRepository };

function isAssistantStreaming(root: ParentNode = document): boolean {
  return Boolean(
    root.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming')
  );
}

function collectStableAssistantMessageIds(root: ParentNode = document): string[] {
  const ids: string[] = [];
  for (const node of root.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"][data-message-id]')) {
    if (node.getAttribute("data-is-streaming") === "true" || node.classList.contains("result-streaming")) continue;
    const id = node.dataset.messageId;
    if (id) ids.push(id);
  }
  return ids;
}
