import type { ConversationSync } from "./conversationSync";
import {
  NATIVE_NAV_CHANNEL,
  isNativeTransportState,
  record,
  type NativeTransportState
} from "../nativeNavigator/protocol";

export const BOOT_FALLBACK_MS = 15_000;
const IDLE_TIMEOUT_MS = 2_000;
const RESOURCE_SKEW_MS = 1_000;

export class ConversationBootGate {
  private generation = 0;
  private conversationId: string | null = null;
  private hostGeneration: number | null = null;
  private initialEndedAt: number | null = null;
  private initialDurationMs = 0;
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
    this.hostGeneration = null;
    this.initialEndedAt = null;
    this.initialDurationMs = 0;
    this.transferSeen = false;
    this.launched = false;
    if (!conversationId || document.visibilityState === "hidden") return;
    if (this.sync.hasUsableFullSnapshot(conversationId)) return;
    const generation = ++this.generation;
    this.timer = window.setTimeout(() => this.fallback(generation), BOOT_FALLBACK_MS);
    this.listenMain();
    this.observeResources(conversationId, generation);
    this.requestState();
  }

  isPending(): boolean {
    return this.conversationId != null
      && !this.launched
      && !this.sync.hasUsableFullSnapshot(this.conversationId)
      && this.isWatching();
  }

  isActive(): boolean {
    return this.launched && this.sync.isReading();
  }

  clear(): void {
    this.generation += 1;
    this.stopWatching();
    this.conversationId = null;
    this.hostGeneration = null;
    this.initialEndedAt = null;
    this.initialDurationMs = 0;
  }

  dispose(): void {
    this.clear();
  }

  private isWatching(): boolean {
    return this.listening || this.observer != null || this.timer !== 0 || this.idleTimer !== 0 || this.idleId !== 0;
  }

  private requestState(): void {
    window.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "hello" }, location.origin);
  }

  private observeResources(conversationId: string, generation: number): void {
    this.inspectResources(conversationId, generation);
    if (typeof PerformanceObserver === "undefined") return;
    this.observer = new PerformanceObserver((list) => {
      void list;
      this.inspectResources(conversationId, generation);
    });
    try {
      this.observer.observe({ type: "resource", buffered: true });
    } catch {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  private inspectResources(conversationId: string, generation: number): void {
    if (generation !== this.generation || this.initialEndedAt == null) return;
    const existing = performance.getEntriesByType?.("resource") ?? [];
    if (existing.some((entry) => this.resourceMatchesCurrentInitial(entry, conversationId))) {
      this.onTransfer(generation);
    }
  }

  private resourceMatchesCurrentInitial(entry: PerformanceEntry, conversationId: string): boolean {
    if (!historyTransferDone(entry, conversationId) || this.initialEndedAt == null) return false;
    const timing = entry as PerformanceResourceTiming;
    const endedAt = performance.timeOrigin + timing.responseEnd;
    const startedAt = this.initialEndedAt - this.initialDurationMs;
    return endedAt >= startedAt - RESOURCE_SKEW_MS && endedAt <= this.initialEndedAt + RESOURCE_SKEW_MS;
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
    if (!isNativeTransportState(message.state)) return;
    this.onHostState(message.state);
  };

  private onHostState(state: NativeTransportState): void {
    if (state.conversationId !== this.conversationId) return;
    if (this.hostGeneration == null) this.hostGeneration = state.generation;
    if (state.generation !== this.hostGeneration) return;
    if (state.lastRequestKind !== "initial" || state.requestInFlight || state.lastRequestAt == null) return;
    this.initialEndedAt = state.lastRequestAt;
    this.initialDurationMs = state.lastRequestDurationMs;
    if (this.observer) {
      this.inspectResources(this.conversationId!, this.generation);
      return;
    }
    this.onTransfer(this.generation);
  }

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
