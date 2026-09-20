import type { ConversationSync } from "../core/conversationSync";
import {
  exposePaginationSentinel,
  readNativePrompts,
  readingPositionDrift,
  safeDesktopLayout,
  saveReadingPosition,
  stableLayoutAvailable,
  type ReadingPosition
} from "./dom";
import {
  NATIVE_NAV_CHANNEL,
  PREPARE_ACK_WAIT_MS,
  PREPARE_HEARTBEAT_MS,
  conversationIdFromUrl,
  emptyHistory,
  isMessageDeepLink,
  isNativeHistoryState,
  record,
  type NativeHistoryState
} from "./protocol";

const ACTIVE_LIMIT_MS = 60_000;
const ADDITIONAL_PAGE_LIMIT = 20;
const PAGE_PROGRESS_LIMIT_MS = 12_000;
const NATIVE_APPEARANCE_WAIT_MS = 2_500;
const RECOVERY_IDLE_MS = 2_500;
const MAX_RECOVERIES = 3;
const DEBUG_KEY = "chatgpt-yada:native-nav-debug";

export type NativeNavigatorDiagnostics = {
  phase: string;
  conversationId: string | null;
  pages: number;
  messages: number;
  capturedPrompts: number;
  expectedPrompts: number;
  nativeFound: number;
  nativeVisible: number;
  boundary: NativeHistoryState["boundary"];
  cursorPresent: boolean;
  boosted: boolean;
  prepareActive: boolean;
  issue: string | null;
  lastOutcome: string | null;
  recoveryCount: number;
  elapsedActiveMs: number;
  maxObservedDriftPx: number;
};

export function officialNavigatorReadiness(
  native: { found: number; visible: number },
  waitedMs: number,
  waitLimitMs = NATIVE_APPEARANCE_WAIT_MS
): "ready-complete" | "hidden" | "waiting-native" | "loaded-no-native" {
  if (native.found > 0 && native.visible > 0) return "ready-complete";
  if (native.found > 0) return "hidden";
  if (waitedMs < waitLimitMs) return "waiting-native";
  return "loaded-no-native";
}

declare global {
  var __YADA_NATIVE_NAV_DIAGNOSTICS__: NativeNavigatorDiagnostics | undefined;
}

export class OfficialNavigatorHydrator {
  private state = emptyHistory(conversationIdFromUrl(location.href));
  private expectedPrompts = 0;
  private context = "";
  private firstPage = 0;
  private activeMs = 0;
  private recoveries = 0;
  private peakDrift = 0;
  private completeSince = 0;
  private connected = false;
  private terminal = false;
  private phase = "waiting";
  private issue: string | null = null;
  private lastUserInput = performance.now() - RECOVERY_IDLE_MS;
  private lastOutcome: string | null = null;
  private prepareEnabled = false;
  private heartbeat = 0;
  private operation: AbortController | null = null;
  private timer = 0;
  private mutations: MutationObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly sync: ConversationSync) {}

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => {
      this.expectedPrompts = snapshot?.conversationId === this.state.conversationId
        ? snapshot.activeTurns.length
        : 0;
      this.schedule();
    });
    addEventListener("message", this.onMessage);
    addEventListener("wheel", this.onUserInput, { capture: true, passive: true });
    addEventListener("touchstart", this.onUserInput, { capture: true, passive: true });
    addEventListener("pointerdown", this.onUserInput, { capture: true, passive: true });
    addEventListener("keydown", this.onUserInput, { capture: true, passive: true });
    addEventListener("resize", this.onEnvironment, { passive: true });
    document.addEventListener("visibilitychange", this.onEnvironment);
    this.mutations = new MutationObserver(() => this.schedule());
    this.mutations.observe(document.documentElement, { subtree: true, childList: true });
    this.requestState();
    this.schedule(600);
  }

  resetRoute(): void {
    this.cancel("route");
    this.state = emptyHistory(conversationIdFromUrl(location.href), this.state.generation + 1);
    this.connected = false;
    this.expectedPrompts = 0;
    this.resetContext("", 0);
    this.setPhase("waiting");
    this.requestState();
    this.schedule(300);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel("dispose");
    clearTimeout(this.timer);
    this.timer = 0;
    this.mutations?.disconnect();
    this.mutations = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    removeEventListener("message", this.onMessage);
    removeEventListener("wheel", this.onUserInput, true);
    removeEventListener("touchstart", this.onUserInput, true);
    removeEventListener("pointerdown", this.onUserInput, true);
    removeEventListener("keydown", this.onUserInput, true);
    removeEventListener("resize", this.onEnvironment);
    document.removeEventListener("visibilitychange", this.onEnvironment);
    delete globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__;
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "state" || !isNativeHistoryState(message.state)) return;
    const incoming = message.state;
    if (incoming.conversationId !== conversationIdFromUrl(location.href)) return;
    if (incoming.generation < this.state.generation) return;
    if (incoming.generation === this.state.generation && incoming.revision < this.state.revision) return;

    const incomingContext = `${incoming.conversationId ?? ""}:${incoming.generation}:${incoming.initialVersion}`;
    if (incomingContext !== this.context) {
      this.cancel("context");
      this.resetContext(incomingContext, incoming.pages);
    }
    this.state = incoming;
    this.connected = true;
    this.schedule();
  };

  private readonly onUserInput = (): void => {
    this.lastUserInput = performance.now();
    if (this.operation) {
      this.cancel("user");
      this.setPhase("interrupted");
    } else {
      this.schedule(RECOVERY_IDLE_MS);
    }
  };

  private readonly onEnvironment = (): void => {
    if (document.visibilityState !== "visible") this.cancel("hidden");
    this.schedule(document.visibilityState === "visible" ? RECOVERY_IDLE_MS : 800);
  };

  private schedule(delayMs = 180): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void this.evaluate();
    }, Math.max(0, delayMs));
  }

  private async evaluate(): Promise<void> {
    if (this.disposed || this.operation) return;
    const native = readNativePrompts();
    if (!this.connected || !this.state.conversationId || this.state.initialVersion === 0 || this.state.pending > 0) {
      this.setPhase("waiting");
      return;
    }
    if (isMessageDeepLink()) {
      this.terminal = true;
      this.setPhase("deep-link");
      return;
    }
    if (this.state.boundary === "complete") {
      this.finishWithNativeState(native);
      return;
    }
    if (this.terminal) {
      this.publishDiagnostics();
      return;
    }
    const recoverableStalled = this.state.issue === "stalled" && this.state.boundary === "more";
    if (!recoverableStalled && (this.state.issue || this.state.boundary === "unknown")) {
      this.terminal = true;
      this.setPhase("unverified", this.state.issue ?? "unverified-history");
      return;
    }
    if (!safeDesktopLayout()) {
      this.setPhase("deferred");
      this.schedule(800);
      return;
    }
    const idleFor = performance.now() - this.lastUserInput;
    if (idleFor < RECOVERY_IDLE_MS) {
      this.setPhase("deferred");
      this.schedule(RECOVERY_IDLE_MS - idleFor);
      return;
    }
    if (this.activeMs >= ACTIVE_LIMIT_MS || this.state.pages - this.firstPage >= ADDITIONAL_PAGE_LIMIT) {
      this.terminal = true;
      this.setPhase("limit", "limit");
      return;
    }
    await this.launchAttempt();
  }

  private finishWithNativeState(native: ReturnType<typeof readNativePrompts>): void {
    if (this.completeSince === 0) this.completeSince = performance.now();
    const readiness = officialNavigatorReadiness(
      native,
      performance.now() - this.completeSince,
      NATIVE_APPEARANCE_WAIT_MS
    );
    if (readiness === "waiting-native") {
      this.setPhase("waiting-native");
      this.schedule(NATIVE_APPEARANCE_WAIT_MS - (performance.now() - this.completeSince));
      return;
    }
    this.terminal = true;
    this.setPhase(readiness);
  }

  private async launchAttempt(): Promise<void> {
    const controller = new AbortController();
    const attemptContext = this.context;
    const started = performance.now();
    this.operation = controller;
    this.setPhase("automatic-loading");
    let outcome: string;
    try {
      this.startPrepare();
      await this.waitForBoostedAck(controller.signal);
      outcome = await this.hydrate(controller.signal, attemptContext);
    } catch {
      outcome = controller.signal.reason === "user" || controller.signal.reason === "hidden"
        ? "interrupted"
        : "changed";
    } finally {
      this.stopPrepare();
      this.activeMs += Math.max(0, performance.now() - started);
      if (this.operation === controller) this.operation = null;
    }

    if (this.disposed || attemptContext !== this.context) return;
    this.lastOutcome = outcome;
    if (outcome === "complete") {
      this.completeSince = 0;
      this.schedule(0);
      return;
    }
    if (outcome === "interrupted") {
      if (this.recoveries < MAX_RECOVERIES && this.activeMs < ACTIVE_LIMIT_MS) {
        this.recoveries += 1;
        this.setPhase("recovering");
        this.schedule(RECOVERY_IDLE_MS);
      } else {
        this.terminal = true;
        this.setPhase("recovery-limit", "recovery-limit");
      }
      return;
    }
    if (outcome === "stalled") {
      if (this.activeMs >= ACTIVE_LIMIT_MS || this.state.pages - this.firstPage >= ADDITIONAL_PAGE_LIMIT) {
        this.terminal = true;
        this.setPhase("limit", "limit");
        return;
      }
      this.setPhase("stalled", "stalled");
      this.schedule(180);
      return;
    }
    this.terminal = true;
    this.setPhase(outcome, outcome);
  }

  private async hydrate(signal: AbortSignal, context: string): Promise<string> {
    const position = saveReadingPosition();
    if (!position || !stableLayoutAvailable()) return "incompatible-layout";
    const activeDeadline = performance.now() + Math.max(0, ACTIVE_LIMIT_MS - this.activeMs);
    let exposure: ReturnType<typeof exposePaginationSentinel> = null;
    const release = (): void => {
      exposure?.release();
      exposure = null;
    };
    const watch = watchReadingPosition(
      position,
      signal,
      (drift) => { this.peakDrift = Math.max(this.peakDrift, Math.abs(drift)); },
      release
    );
    signal.addEventListener("abort", release, { once: true });

    const problem = (): string | null => {
      if (signal.aborted) throw signal.reason;
      if (context !== this.context || this.state.conversationId !== conversationIdFromUrl(location.href)) return "changed";
      if (watch.problem()) return watch.problem();
      if (document.visibilityState !== "visible") return "interrupted";
      if (this.state.issue) return this.state.issue;
      if (this.state.boundary === "unknown") return "unverified";
      if (performance.now() >= activeDeadline || this.state.pages - this.firstPage >= ADDITIONAL_PAGE_LIMIT) return "limit";
      return null;
    };

    try {
      for (;;) {
        const currentProblem = problem();
        if (currentProblem) return currentProblem;
        if (this.state.pending > 0) {
          await abortableDelay(40, signal);
          continue;
        }
        if (this.state.boundary === "complete") return "complete";

        const pageAtStart = this.state.pages;
        const pendingAtStart = this.state.pending;
        exposure = exposePaginationSentinel(position.scroller);
        if (!exposure) return "incompatible-layout";
        const pageDeadline = Math.min(activeDeadline, performance.now() + PAGE_PROGRESS_LIMIT_MS);
        let hostStarted = false;
        while (performance.now() < pageDeadline) {
          await abortableDelay(20, signal);
          const waitProblem = problem();
          if (waitProblem) return waitProblem;
          if (
            this.state.pending > pendingAtStart
            || this.state.pages !== pageAtStart
            || (this.state as NativeHistoryState).boundary === "complete"
          ) {
            hostStarted = true;
            release();
            break;
          }
          const rectangle = exposure.element.getBoundingClientRect();
          const top = position.scroller === document.scrollingElement
            ? 0
            : position.scroller.getBoundingClientRect().top + position.scroller.clientTop;
          if (!exposure.element.isConnected || rectangle.bottom < top || rectangle.top > top + position.scroller.clientHeight) {
            return "incompatible-layout";
          }
        }
        release();
        if (!hostStarted) return "stalled";

        while (this.state.pending > 0 || this.state.pages === pageAtStart) {
          const completionProblem = problem();
          if (completionProblem) return completionProblem;
          if (performance.now() >= pageDeadline) return "stalled";
          await abortableDelay(40, signal);
        }
        await abortableDelay(240, signal);
      }
    } finally {
      release();
      watch.dispose();
      signal.removeEventListener("abort", release);
    }
  }

  private cancel(reason: string): void {
    this.operation?.abort(reason);
    this.stopPrepare();
  }

  private startPrepare(): void {
    this.sendPrepare(true);
    this.clearHeartbeat();
    this.heartbeat = window.setInterval(() => this.sendPrepare(true), PREPARE_HEARTBEAT_MS);
  }

  private stopPrepare(): void {
    this.clearHeartbeat();
    if (!this.prepareEnabled) return;
    this.sendPrepare(false);
  }

  private sendPrepare(enabled: boolean): void {
    if (!this.state.conversationId) {
      this.prepareEnabled = false;
      return;
    }
    this.prepareEnabled = enabled;
    window.postMessage({
      channel: NATIVE_NAV_CHANNEL,
      kind: "prepare",
      enabled,
      conversationId: this.state.conversationId,
      generation: this.state.generation
    }, location.origin);
  }

  private clearHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = 0;
  }

  private async waitForBoostedAck(signal: AbortSignal): Promise<void> {
    const until = performance.now() + PREPARE_ACK_WAIT_MS;
    while (!this.state.boosted && performance.now() < until) {
      await abortableDelay(40, signal);
    }
  }

  private resetContext(context: string, firstPage: number): void {
    this.context = context;
    this.firstPage = firstPage;
    this.activeMs = 0;
    this.recoveries = 0;
    this.peakDrift = 0;
    this.completeSince = 0;
    this.terminal = false;
    this.issue = null;
    this.lastOutcome = null;
  }

  private setPhase(phase: string, issue: string | null = null): void {
    this.phase = phase;
    this.issue = issue;
    this.publishDiagnostics();
  }

  private publishDiagnostics(): void {
    if (!debugEnabled()) {
      delete globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__;
      return;
    }
    const native = readNativePrompts();
    globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__ = {
      phase: this.phase,
      conversationId: this.state.conversationId,
      pages: this.state.pages,
      messages: this.state.messages,
      capturedPrompts: this.state.prompts,
      expectedPrompts: this.expectedPrompts,
      nativeFound: native.found,
      nativeVisible: native.visible,
      boundary: this.state.boundary,
      cursorPresent: this.state.cursorPresent,
      boosted: this.state.boosted,
      prepareActive: this.prepareEnabled,
      issue: this.issue ?? this.state.issue,
      lastOutcome: this.lastOutcome,
      recoveryCount: this.recoveries,
      elapsedActiveMs: Math.round(this.activeMs),
      maxObservedDriftPx: Math.round(this.peakDrift * 10) / 10
    };
  }

  private requestState(): void {
    window.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "hello" }, location.origin);
  }
}

function watchReadingPosition(
  position: ReadingPosition,
  signal: AbortSignal,
  onDrift: (drift: number) => void,
  onUnsafe: () => void
): { problem(): string | null; dispose(): void } {
  let issue: string | null = null;
  let missingFrames = 0;
  let frame = 0;
  let active = true;
  const inspect = (): void => {
    if (!active || signal.aborted) return;
    const drift = readingPositionDrift(position);
    if (drift === null) missingFrames += 1;
    else {
      missingFrames = 0;
      onDrift(drift);
    }
    if ((drift !== null && Math.abs(drift) > 8) || missingFrames > 3 || !stableLayoutAvailable()) {
      issue = "layout-changed";
      onUnsafe();
      return;
    }
    frame = requestAnimationFrame(inspect);
  };
  frame = requestAnimationFrame(inspect);
  return {
    problem: () => issue,
    dispose() {
      active = false;
      cancelAnimationFrame(frame);
    }
  };
}

function debugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
