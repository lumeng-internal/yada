import type { ConversationSync } from "./conversationSync";
import { NATIVE_NAV_CHANNEL, record } from "../nativeNavigator/protocol";

export const BOOT_FALLBACK_MS = 15_000;
const IDLE_TIMEOUT_MS = 2_000;

export class ConversationBootGate {
  private generation = 0;
  private conversationId: string | null = null;
  private observer: PerformanceObserver | null = null;
  private timer = 0;
  private idleTimer = 0;
  private idleId = 0;
  private listening = false;
  private transferSeen = false;
  private launched = false;

  constructor(private readonly sync: ConversationSync) {}

  arm(conversationId: string | null): void {
    this.stopWatching();
    this.conversationId = conversationId;
    this.transferSeen = false;
    this.launched = false;
    if (!conversationId || document.visibilityState === "hidden") return;
    if (this.sync.hasUsableFullSnapshot(conversationId)) return;
    const generation = ++this.generation;
    this.timer = window.setTimeout(() => this.fallback(generation), BOOT_FALLBACK_MS);
    this.listenMain();
    this.observeResources(conversationId, generation);
  }

  clear(): void {
    this.generation += 1;
    this.stopWatching();
    this.conversationId = null;
  }

  dispose(): void {
    this.clear();
  }

  private observeResources(conversationId: string, generation: number): void {
    const existing = performance.getEntriesByType?.("resource") ?? [];
    if (existing.some((entry) => historyTransferDone(entry, conversationId))) {
      this.onTransfer(generation);
      return;
    }
    if (typeof PerformanceObserver === "undefined") return;
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (historyTransferDone(entry, conversationId)) this.onTransfer(generation);
      }
    });
    try {
      this.observer.observe({ type: "resource", buffered: true });
    } catch {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  private listenMain(): void {
    if (this.listening) return;
    window.addEventListener("message", this.onMain);
    this.listening = true;
  }

  private readonly onMain = (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "state") return;
    const state = record(message.state);
    if (!state || state.conversationId !== this.conversationId) return;
    if (state.requestInFlight !== false || state.lastRequestKind !== "initial") return;
    if (this.observer) return;
    this.onTransfer(this.generation);
  };

  private onTransfer(generation: number): void {
    if (generation !== this.generation || this.transferSeen || this.launched) return;
    this.transferSeen = true;
    const start = (): void => {
      this.idleId = 0;
      this.idleTimer = 0;
      this.launch(generation);
    };
    if (typeof requestIdleCallback === "function") {
      this.idleId = requestIdleCallback(() => start(), { timeout: IDLE_TIMEOUT_MS });
      return;
    }
    this.idleTimer = window.setTimeout(start, 0);
  }

  private fallback(generation: number): void {
    this.timer = 0;
    if (generation !== this.generation || this.launched) return;
    this.launch(generation);
  }

  private launch(generation: number): void {
    if (generation !== this.generation || this.launched) return;
    if (!this.canStart()) return;
    this.launched = true;
    this.stopWatching();
    void this.sync.requestFull("boot");
  }

  private canStart(): boolean {
    if (!this.conversationId || this.sync.getActiveConversationId() !== this.conversationId) return false;
    if (document.visibilityState === "hidden" || isAssistantStreaming()) return false;
    if (this.sync.hasUsableFullSnapshot(this.conversationId)) return false;
    return true;
  }

  private stopWatching(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
    if (this.idleTimer) window.clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    if (this.idleId && typeof cancelIdleCallback === "function") cancelIdleCallback(this.idleId);
    this.idleId = 0;
    if (this.listening) {
      window.removeEventListener("message", this.onMain);
      this.listening = false;
    }
  }
}

function historyTransferDone(entry: PerformanceEntry, conversationId: string): boolean {
  const timing = entry as PerformanceResourceTiming;
  if (!(timing.responseEnd > 0)) return false;
  try {
    const url = new URL(entry.name);
    const path = url.pathname;
    return path === `/backend-api/conversations/${conversationId}`
      || path === `/backend-api/conversation/${conversationId}`
      || path === `/backend-api/conversations/${conversationId}/messages`;
  } catch {
    return false;
  }
}

function isAssistantStreaming(): boolean {
  return Boolean(document.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming'));
}
