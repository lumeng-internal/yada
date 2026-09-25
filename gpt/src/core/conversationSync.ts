import { abortError, isAbortError, readConversation as readConversationFromApi, readRecentConversation as readRecentFromApi } from "../conversation/readConversation";
import { mergeRecentSnapshot } from "../conversation/mergeRecent";
import type { ConversationListener, ConversationSnapshot, ReadConversation } from "./types";

export const SIGNAL_INSPECTION_DEBOUNCE_MS = 250;
const FALLBACK_IDLE_MS = 1_000;

export type SyncDemand = "recent" | "full";

type FullWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class ConversationSync {
  private activeConversationId: string | null = null;
  private generation = 0;
  private runningPromise: Promise<void> | null = null;
  private desired: SyncDemand | null = null;
  private active: SyncDemand | null = null;
  private abortController: AbortController | null = null;
  private latestSnapshot: ConversationSnapshot | null = null;
  private fullStale = false;
  private lastError: Error | null = null;
  private readonly listeners = new Set<ConversationListener>();
  private readonly fullWaiters: FullWaiter[] = [];
  private observer: MutationObserver | null = null;
  private visibilityListening = false;
  private signalTimer = 0;
  private fallbackTimer = 0;
  private fallbackIdle = 0;
  private lastStreamingState = false;
  private readonly seenAssistantMessageIds = new Set<string>();
  private disposed = false;
  private published = 0;
  private readonly readFull: ReadConversation;
  private readonly readRecent: ReadConversation | null;

  constructor(options: { readConversation?: ReadConversation; readRecentConversation?: ReadConversation | null } = {}) {
    this.readFull = options.readConversation ?? readConversationFromApi;
    this.readRecent = options.readRecentConversation === undefined
      ? (options.readConversation ? null : readRecentFromApi)
      : options.readRecentConversation;
  }

  subscribe(listener: ConversationListener): () => void {
    this.listeners.add(listener);
    this.deliver(listener, this.latestSnapshot);
    return () => this.listeners.delete(listener);
  }

  requestSync(reason: string): Promise<void> {
    return this.request(this.modeForReason(reason));
  }

  requestRecent(reason: string): Promise<void> {
    void reason;
    return this.request("recent");
  }

  requestFull(reason: string): Promise<void> {
    void reason;
    return this.request("full");
  }

  isReading(): boolean {
    return this.runningPromise != null || this.desired != null || this.active != null;
  }

  setActiveConversation(conversationId: string | null): void {
    if (this.activeConversationId === conversationId) return;
    this.generation += 1;
    this.clearSignalTimer();
    this.clearFallback();
    this.abortController?.abort();
    this.abortController = null;
    this.activeConversationId = conversationId;
    this.seenAssistantMessageIds.clear();
    this.lastStreamingState = false;
    this.fullStale = false;
    this.latestSnapshot = null;
    this.lastError = null;
    this.desired = null;
    this.rejectFullWaiters(abortError());
    if (!conversationId) {
      this.publish(null);
      return;
    }
    this.seedRenderedAssistants();
  }

  getSnapshot(): ConversationSnapshot | null {
    return this.latestSnapshot;
  }

  hasUsableFullSnapshot(conversationId: string | null = this.activeConversationId): boolean {
    return Boolean(
      conversationId
      && this.latestSnapshot?.conversationId === conversationId
      && !this.fullStale
      && this.latestSnapshot.coverage !== "recent"
    );
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  getActiveConversationId(): string | null {
    return this.activeConversationId;
  }

  mountPageObserver(root: ParentNode = document.documentElement): void {
    if (!this.visibilityListening) {
      document.addEventListener("visibilitychange", this.onVisibility);
      this.visibilityListening = true;
    }
    if (this.observer || typeof MutationObserver === "undefined") return;
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === "data-is-streaming"
          && record.target instanceof Element
          && record.target.getAttribute("data-is-streaming") === "true") {
          this.lastStreamingState = true;
        }
      }
      this.scheduleSignalInspection();
    });
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
    this.clearSignalTimer();
    this.clearFallback();
    this.abortController?.abort();
    this.abortController = null;
    this.desired = null;
    this.observer?.disconnect();
    this.observer = null;
    if (this.visibilityListening) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.visibilityListening = false;
    }
    this.rejectFullWaiters(abortError());
    this.listeners.clear();
    this.latestSnapshot = null;
    this.runningPromise = null;
    this.seenAssistantMessageIds.clear();
  }

  private modeForReason(reason: string): SyncDemand {
    if (reason === "streaming-end" || reason === "new-assistant") return this.liveMode();
    return "full";
  }

  private liveMode(): SyncDemand {
    return this.hasUsableFullSnapshot() ? "recent" : "full";
  }

  private request(mode: SyncDemand): Promise<void> {
    if (this.disposed) return Promise.reject(abortError());
    const effective: SyncDemand = mode === "recent" && !this.hasUsableFullSnapshot() ? "full" : mode;
    this.desired = this.desired === "full" || effective === "full" ? "full" : "recent";
    if (effective === "full") this.clearFallback();
    // The returned promise settles after pump() publishes the merged snapshot.
    const waitForTrailingFull = effective === "full" && this.active === "recent";
    if (!this.runningPromise) {
      this.runningPromise = Promise.resolve().then(() => this.pump()).finally(() => {
        this.runningPromise = null;
        this.active = null;
        if (this.desired && !this.disposed) void this.request(this.desired);
      });
    }
    if (waitForTrailingFull) {
      return new Promise((resolve, reject) => {
        this.fullWaiters.push({ resolve, reject });
      });
    }
    return this.runningPromise;
  }

  private async pump(): Promise<void> {
    while (this.desired && !this.disposed) {
      const mode = this.desired;
      this.desired = null;
      this.active = mode;
      const conversationId = this.activeConversationId;
      const generation = this.generation;
      if (!conversationId) {
        this.publish(null);
        this.settleFullWaiters();
        continue;
      }
      this.abortController?.abort();
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      try {
        const raw = mode === "recent" && this.readRecent
          ? await this.readRecent(conversationId, signal)
          : await this.readFull(conversationId, signal);
        if (this.disposed || signal.aborted || this.generation !== generation) throw abortError();
        if (this.activeConversationId !== conversationId) throw abortError();
        if (mode === "recent" && this.readRecent && this.latestSnapshot) {
          const merged = await mergeRecentSnapshot(this.latestSnapshot, { ...raw, coverage: "recent" });
          if (!merged) {
            this.fullStale = true;
            this.scheduleIdleFull();
            continue;
          }
          merged.revision = ++this.published;
          this.fullStale = false;
          this.lastError = null;
          this.publish(merged);
        } else {
          raw.revision = ++this.published;
          raw.coverage = "full";
          this.fullStale = false;
          this.lastError = null;
          this.publish(raw);
        }
        if (mode === "full") this.settleFullWaiters();
      } catch (error) {
        if (this.disposed) return;
        if (isAbortError(error) || this.generation !== generation) continue;
        if (this.activeConversationId === conversationId) {
          this.lastError = error instanceof Error ? error : new Error(String(error));
          if (!this.latestSnapshot) this.publish(null);
          if (mode === "full") this.settleFullWaiters(this.lastError);
        }
      }
    }
  }

  private publish(snapshot: ConversationSnapshot | null): void {
    this.latestSnapshot = snapshot;
    if (snapshot) {
      for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
      for (const turn of snapshot.activeTurns) {
        if (turn.assistantMessageId) this.seenAssistantMessageIds.add(turn.assistantMessageId);
      }
    }
    for (const listener of [...this.listeners]) this.deliver(listener, snapshot);
  }

  private deliver(listener: ConversationListener, snapshot: ConversationSnapshot | null): void {
    try {
      const result = listener(snapshot);
      if (result && typeof (result as Promise<void>).then === "function") {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // One listener cannot block the toolbar, navigator, or quota ledger.
    }
  }

  private settleFullWaiters(error?: unknown): void {
    const waiters = this.fullWaiters.splice(0);
    for (const waiter of waiters) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  private rejectFullWaiters(error: unknown): void {
    this.settleFullWaiters(error);
  }

  private scheduleSignalInspection(): void {
    if (this.disposed) return;
    const generation = this.generation;
    this.clearSignalTimer();
    this.signalTimer = window.setTimeout(() => {
      this.signalTimer = 0;
      if (this.disposed || this.generation !== generation) return;
      this.inspectPageSignals();
    }, SIGNAL_INSPECTION_DEBOUNCE_MS);
  }

  private clearSignalTimer(): void {
    if (!this.signalTimer) return;
    window.clearTimeout(this.signalTimer);
    this.signalTimer = 0;
  }

  private seedRenderedAssistants(): void {
    for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
  }

  private inspectPageSignals(): void {
    if (this.disposed || !this.activeConversationId) return;
    const streaming = isAssistantStreaming();
    const wasStreaming = this.lastStreamingState;
    this.lastStreamingState = streaming;
    if (streaming) return;

    if (wasStreaming) {
      for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
      void this.request(this.liveMode());
      return;
    }

    let unseen = false;
    for (const id of collectStableAssistantMessageIds()) {
      if (this.seenAssistantMessageIds.has(id)) continue;
      this.seenAssistantMessageIds.add(id);
      unseen = true;
    }
    if (unseen) void this.request(this.liveMode());
  }

  private scheduleIdleFull(): void {
    if (this.fallbackTimer || this.fallbackIdle || this.disposed || !this.fullStale) return;
    const generation = this.generation;
    const run = (): void => {
      this.fallbackTimer = 0;
      this.fallbackIdle = 0;
      if (this.disposed || this.generation !== generation || !this.fullStale) return;
      if (document.visibilityState === "hidden" || isAssistantStreaming()) {
        this.scheduleIdleFull();
        return;
      }
      void this.requestFull("fallback");
    };
    if (typeof requestIdleCallback === "function") {
      this.fallbackIdle = requestIdleCallback(() => run(), { timeout: FALLBACK_IDLE_MS });
      return;
    }
    this.fallbackTimer = window.setTimeout(run, FALLBACK_IDLE_MS);
  }

  private clearFallback(): void {
    if (this.fallbackTimer) window.clearTimeout(this.fallbackTimer);
    this.fallbackTimer = 0;
    if (this.fallbackIdle && typeof cancelIdleCallback === "function") cancelIdleCallback(this.fallbackIdle);
    this.fallbackIdle = 0;
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState !== "visible" || !this.fullStale) return;
    this.scheduleIdleFull();
  };
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
