import type { ConversationSync } from "../core/conversationSync";
import {
  exposePaginationSentinel,
  readNativePrompts,
  readingPositionDrift,
  safeDesktopLayout,
  saveReadingPosition,
  stableLayoutAvailable,
  type NativePromptState,
  type ReadingPosition
} from "./dom";
import {
  NATIVE_NAV_CHANNEL,
  PREPARE_ACK_WAIT_MS,
  PREPARE_HEARTBEAT_MS,
  conversationIdFromUrl,
  emptyTransportState,
  isMessageDeepLink,
  isNativeTransportState,
  record,
  type NativeTransportState
} from "./protocol";

const ACTIVE_LIMIT_MS = 60_000;
const ADDITIONAL_PAGE_LIMIT = 20;
const PAGE_PROGRESS_LIMIT_MS = 12_000;
const READY_STABILITY_MS = 300;
const RECOVERY_IDLE_MS = 2_500;
const MAX_RECOVERIES = 3;
const DEBUG_KEY = "chatgpt-yada:native-nav-debug";

type NavigatorPhase = "waiting" | "preparing" | "sleeping" | "ready" | "stopped";
type AttemptOutcome =
  | { kind: "match" }
  | { kind: "sleep"; reason: string }
  | { kind: "interrupted"; reason: string }
  | { kind: "stopped"; reason: string }
  | { kind: "changed" };

export type NativeNavigatorDiagnostics = {
  phase: NavigatorPhase;
  conversationId: string | null;
  expectedPrompts: number;
  nativeFound: number;
  nativeVisible: number;
  historyRequests: number;
  olderRequests: number;
  requestInFlight: boolean;
  lastRequestKind: NativeTransportState["lastRequestKind"];
  lastHttpStatus: number | null;
  lastRequestDurationMs: number;
  lastRequestAt: number | null;
  lastRequestError: NativeTransportState["lastRequestError"];
  prepareActive: boolean;
  boosted: boolean;
  recoveryCount: number;
  elapsedActiveMs: number;
  maxObservedDriftPx: number;
  sleepReason: string | null;
  readyStableChecks: number;
};

export function officialNavigatorReadiness(
  native: Pick<NativePromptState, "found" | "visible">,
  expectedPrompts: number,
  stableChecks: number
): "waiting" | "incomplete" | "stabilizing" | "ready" {
  if (expectedPrompts <= 0) return "waiting";
  if (native.found !== expectedPrompts || native.visible <= 0) return "incomplete";
  return stableChecks >= 2 ? "ready" : "stabilizing";
}

declare global {
  var __YADA_NATIVE_NAV_DIAGNOSTICS__: NativeNavigatorDiagnostics | undefined;
}

export class OfficialNavigatorHydrator {
  private state = emptyTransportState(conversationIdFromUrl(location.href));
  private expectedPrompts = 0;
  private connected = false;
  private context = "";
  private firstOlderRequest = 0;
  private activeMs = 0;
  private recoveries = 0;
  private peakDrift = 0;
  private phase: NavigatorPhase = "waiting";
  private sleepReason: string | null = null;
  private readyStableChecks = 0;
  private stableRoot: HTMLElement | null = null;
  private stableContainer: HTMLElement | null = null;
  private stableFound = 0;
  private stableCheckedAt = 0;
  private lastUserInput = performance.now() - RECOVERY_IDLE_MS;
  private prepareEnabled = false;
  private heartbeat = 0;
  private operation: AbortController | null = null;
  private timer = 0;
  private mutations: MutationObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private heavyArmed = false;
  private awaitingSnapshot = false;

  constructor(private readonly sync: ConversationSync) {}

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => {
      const nextExpected = snapshot?.conversationId === this.state.conversationId
        ? snapshot.activeTurns.length
        : 0;
      const changed = nextExpected !== this.expectedPrompts;
      this.expectedPrompts = nextExpected;
      if (this.phase === "stopped") {
        this.publishDiagnostics();
        return;
      }
      if (snapshot) this.awaitingSnapshot = false;
      if (this.phase === "sleeping" || (this.phase === "ready" && changed)) this.wake("snapshot");
      else if (this.phase !== "ready") this.maybeArmHeavyWork();
      if (this.heavyArmed && this.phase !== "ready") this.schedule();
      this.publishDiagnostics();
    });
    addEventListener("message", this.onMessage);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.requestState();
  }

  resetRoute(): void {
    this.cancel("route");
    const current = conversationIdFromUrl(location.href);
    this.state = emptyTransportState(current, this.state.generation);
    this.connected = false;
    this.expectedPrompts = this.sync.getSnapshot()?.conversationId === current
      ? this.sync.getSnapshot()!.activeTurns.length
      : 0;
    this.resetContext("");
    this.awaitingSnapshot = true;
    this.parkHeavyWork();
    this.setPhase("waiting");
    this.requestState();
  }

  isMaintenanceBlocked(): boolean {
    return this.phase === "preparing" || this.heavyArmed;
  }

  isHeavyWorkArmed(): boolean {
    return this.heavyArmed && this.mutations != null;
  }

  isParked(): boolean {
    return !this.heavyArmed && (this.phase === "sleeping" || this.phase === "ready" || this.phase === "stopped");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel("dispose");
    clearTimeout(this.timer);
    this.timer = 0;
    this.parkHeavyWork();
    this.unsubscribe?.();
    this.unsubscribe = null;
    removeEventListener("message", this.onMessage);
    document.removeEventListener("visibilitychange", this.onVisibility);
    delete globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__;
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "state" || !isNativeTransportState(message.state)) return;
    const incoming = message.state;
    if (incoming.conversationId !== conversationIdFromUrl(location.href)) return;
    if (incoming.generation < this.state.generation) return;
    if (incoming.generation === this.state.generation && incoming.revision < this.state.revision) return;

    const incomingContext = `${incoming.conversationId ?? ""}:${incoming.generation}`;
    if (incomingContext !== this.context) {
      this.cancel("context");
      this.resetContext(incomingContext, incoming.olderRequests);
    }
    const hasNewEvidence = incoming.revision > this.state.revision;
    this.state = incoming;
    this.connected = true;
    this.maybeArmHeavyWork();
    if (this.phase === "sleeping" && hasNewEvidence) this.wake("transport");
    else if (this.heavyArmed && this.phase !== "ready" && this.phase !== "stopped") this.schedule();
    this.publishDiagnostics();
  };

  private readonly onUserInput = (): void => {
    this.lastUserInput = performance.now();
    if (this.operation) this.cancel("user");
    else this.schedule(RECOVERY_IDLE_MS);
  };

  private readonly onEnvironment = (): void => {
    if (this.operation) this.cancel("layout");
    else this.schedule(180);
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      if (this.phase === "sleeping") this.wake("visible");
      return;
    }
    if (this.phase === "ready" || this.phase === "stopped") return;
    if (this.operation) this.cancel("hidden");
    else this.sleep("hidden");
  };

  private schedule(delayMs = 180): void {
    if (this.disposed || this.phase === "sleeping" || this.phase === "ready" || this.phase === "stopped") return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void this.evaluate();
    }, Math.max(0, delayMs));
  }

  private async evaluate(): Promise<void> {
    if (this.disposed || this.operation || this.phase === "sleeping" || this.phase === "ready" || this.phase === "stopped") return;
    const native = readNativePrompts();
    if (this.awaitingSnapshot || !this.connected || !this.state.conversationId || this.expectedPrompts <= 0) {
      this.resetReadyStability();
      this.setPhase("waiting");
      return;
    }
    this.maybeArmHeavyWork();
    if (isMessageDeepLink()) {
      this.stop("deep-link");
      return;
    }
    if (this.checkReady(native)) return;
    if (this.limitReached()) {
      this.stop("limit");
      return;
    }
    if (document.visibilityState !== "visible") {
      this.sleep("hidden");
      return;
    }
    if (!safeDesktopLayout()) {
      this.setPhase("waiting");
      return;
    }
    const idleFor = performance.now() - this.lastUserInput;
    if (idleFor < RECOVERY_IDLE_MS) {
      this.setPhase("waiting");
      this.schedule(RECOVERY_IDLE_MS - idleFor);
      return;
    }
    await this.launchAttempt();
  }

  private checkReady(native: NativePromptState): boolean {
    const readiness = officialNavigatorReadiness(native, this.expectedPrompts, this.readyStableChecks);
    if (readiness === "waiting" || readiness === "incomplete") {
      this.resetReadyStability();
      return false;
    }

    const now = performance.now();
    const same = this.stableRoot === native.root
      && this.stableContainer === native.container
      && this.stableFound === native.found
      && native.root?.isConnected === true
      && native.container?.isConnected === true;
    if (!same) {
      this.stableRoot = native.root;
      this.stableContainer = native.container;
      this.stableFound = native.found;
      this.readyStableChecks = 1;
      this.stableCheckedAt = now;
      this.setPhase("waiting");
      this.schedule(READY_STABILITY_MS);
      return true;
    }
    if (this.readyStableChecks < 2) {
      const remaining = READY_STABILITY_MS - (now - this.stableCheckedAt);
      if (remaining > 0) {
        this.setPhase("waiting");
        this.schedule(remaining);
        return true;
      }
      this.readyStableChecks = 2;
    }
    this.parkHeavyWork();
    this.setPhase("ready");
    return true;
  }

  private async launchAttempt(): Promise<void> {
    const controller = new AbortController();
    const attemptContext = this.context;
    const started = performance.now();
    this.operation = controller;
    this.setPhase("preparing");
    let outcome: AttemptOutcome;
    try {
      this.startPrepare();
      await this.waitForBoostedAck(controller.signal);
      outcome = await this.hydrate(controller.signal, attemptContext);
    } catch {
      const reason = String(controller.signal.reason ?? "changed");
      outcome = reason === "user" || reason === "hidden" || reason === "layout"
        ? { kind: "interrupted", reason }
        : { kind: "changed" };
    } finally {
      this.stopPrepare();
      this.activeMs += Math.max(0, performance.now() - started);
      if (this.operation === controller) this.operation = null;
    }

    if (this.disposed || attemptContext !== this.context) return;
    if (outcome.kind === "match") {
      this.setPhase("waiting");
      this.schedule(0);
      return;
    }
    if (outcome.kind === "changed") return;
    if (outcome.kind === "stopped") {
      this.stop(outcome.reason);
      return;
    }
    if (outcome.kind === "interrupted" && outcome.reason === "user") {
      if (this.recoveries >= MAX_RECOVERIES || this.limitReached()) {
        this.stop("recovery-limit");
        return;
      }
      this.recoveries += 1;
      this.setPhase("waiting");
      this.schedule(RECOVERY_IDLE_MS);
      return;
    }
    this.sleep(outcome.reason);
  }

  private async hydrate(signal: AbortSignal, context: string): Promise<AttemptOutcome> {
    const position = saveReadingPosition();
    if (!position || !stableLayoutAvailable()) return { kind: "sleep", reason: "layout-unavailable" };
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

    const problem = (): AttemptOutcome | null => {
      if (signal.aborted) throw signal.reason;
      if (context !== this.context || this.state.conversationId !== conversationIdFromUrl(location.href)) return { kind: "changed" };
      const layoutProblem = watch.problem();
      if (layoutProblem) return { kind: "sleep", reason: layoutProblem };
      if (document.visibilityState !== "visible") return { kind: "interrupted", reason: "hidden" };
      if (performance.now() >= activeDeadline || this.limitReached()) return { kind: "stopped", reason: "limit" };
      return null;
    };

    try {
      for (;;) {
        const currentProblem = problem();
        if (currentProblem) return currentProblem;
        const native = readNativePrompts();
        if (officialNavigatorReadiness(native, this.expectedPrompts, 0) === "stabilizing") {
          return { kind: "match" };
        }

        if (this.state.requestInFlight) {
          const waitingFor = this.state.historyRequests;
          while (this.state.requestInFlight && this.state.historyRequests === waitingFor) {
            const requestProblem = problem();
            if (requestProblem) return requestProblem;
            await abortableDelay(40, signal);
          }
          if (this.state.lastRequestError) return { kind: "sleep", reason: this.state.lastRequestError };
          await abortableDelay(240, signal);
          continue;
        }

        const requestsAtStart = this.state.historyRequests;
        exposure = exposePaginationSentinel(position.scroller);
        if (!exposure) return { kind: "sleep", reason: "sentinel-unavailable" };
        const pageDeadline = Math.min(activeDeadline, performance.now() + PAGE_PROGRESS_LIMIT_MS);
        while (performance.now() < pageDeadline && this.state.historyRequests === requestsAtStart) {
          await abortableDelay(20, signal);
          const waitProblem = problem();
          if (waitProblem) return waitProblem;
          const rectangle = exposure.element.getBoundingClientRect();
          const top = position.scroller === document.scrollingElement
            ? 0
            : position.scroller.getBoundingClientRect().top + position.scroller.clientTop;
          if (!exposure.element.isConnected || rectangle.bottom < top || rectangle.top > top + position.scroller.clientHeight) {
            return { kind: "sleep", reason: "layout-changed" };
          }
        }
        release();
        if (this.state.historyRequests === requestsAtStart) return { kind: "sleep", reason: "no-host-request" };

        while (this.state.requestInFlight) {
          const completionProblem = problem();
          if (completionProblem) return completionProblem;
          if (performance.now() >= pageDeadline) return { kind: "sleep", reason: "request-timeout" };
          await abortableDelay(40, signal);
        }
        if (this.state.lastRequestError) return { kind: "sleep", reason: this.state.lastRequestError };
        await abortableDelay(240, signal);
      }
    } finally {
      release();
      watch.dispose();
      signal.removeEventListener("abort", release);
    }
  }

  private limitReached(): boolean {
    return this.activeMs >= ACTIVE_LIMIT_MS
      || this.state.olderRequests - this.firstOlderRequest >= ADDITIONAL_PAGE_LIMIT;
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
    if (this.prepareEnabled) this.sendPrepare(false);
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
    while (!this.state.boosted && performance.now() < until) await abortableDelay(40, signal);
  }

  private sleep(reason: string): void {
    if (this.phase === "ready" || this.phase === "stopped") return;
    this.sleepReason = reason;
    this.parkHeavyWork();
    this.setPhase("sleeping");
  }

  private wake(_reason: string): void {
    if (this.disposed || this.phase === "stopped") return;
    this.sleepReason = null;
    this.resetReadyStability();
    this.setPhase("waiting");
    this.maybeArmHeavyWork();
    if (this.heavyArmed) this.schedule(0);
  }

  private stop(reason: string): void {
    this.sleepReason = reason;
    this.parkHeavyWork();
    this.setPhase("stopped");
  }

  private maybeArmHeavyWork(): void {
    if (this.disposed || this.awaitingSnapshot) return;
    if (this.phase === "ready" || this.phase === "sleeping" || this.phase === "stopped") return;
    if (this.expectedPrompts <= 0 || !this.connected) return;
    this.armHeavyWork();
  }

  private armHeavyWork(): void {
    if (this.disposed) return;
    if (!this.heavyArmed) {
      addEventListener("wheel", this.onUserInput, { capture: true, passive: true });
      addEventListener("touchstart", this.onUserInput, { capture: true, passive: true });
      addEventListener("pointerdown", this.onUserInput, { capture: true, passive: true });
      addEventListener("keydown", this.onUserInput, { capture: true, passive: true });
      addEventListener("resize", this.onEnvironment, { passive: true });
      this.heavyArmed = true;
    }
    if (!this.mutations) {
      this.mutations = new MutationObserver(() => this.schedule());
      this.mutations.observe(document.documentElement, { subtree: true, childList: true });
    }
  }

  private parkHeavyWork(): void {
    clearTimeout(this.timer);
    this.timer = 0;
    this.stopPrepare();
    this.mutations?.disconnect();
    this.mutations = null;
    if (!this.heavyArmed) return;
    removeEventListener("wheel", this.onUserInput, true);
    removeEventListener("touchstart", this.onUserInput, true);
    removeEventListener("pointerdown", this.onUserInput, true);
    removeEventListener("keydown", this.onUserInput, true);
    removeEventListener("resize", this.onEnvironment);
    this.heavyArmed = false;
  }

  private resetContext(context: string, firstOlderRequest = 0): void {
    this.context = context;
    this.firstOlderRequest = firstOlderRequest;
    this.activeMs = 0;
    this.recoveries = 0;
    this.peakDrift = 0;
    this.sleepReason = null;
    this.resetReadyStability();
  }

  private resetReadyStability(): void {
    this.readyStableChecks = 0;
    this.stableRoot = null;
    this.stableContainer = null;
    this.stableFound = 0;
    this.stableCheckedAt = 0;
  }

  private setPhase(phase: NavigatorPhase): void {
    this.phase = phase;
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
      expectedPrompts: this.expectedPrompts,
      nativeFound: native.found,
      nativeVisible: native.visible,
      historyRequests: this.state.historyRequests,
      olderRequests: this.state.olderRequests,
      requestInFlight: this.state.requestInFlight,
      lastRequestKind: this.state.lastRequestKind,
      lastHttpStatus: this.state.lastHttpStatus,
      lastRequestDurationMs: this.state.lastRequestDurationMs,
      lastRequestAt: this.state.lastRequestAt,
      lastRequestError: this.state.lastRequestError,
      prepareActive: this.prepareEnabled,
      boosted: this.state.boosted,
      recoveryCount: this.recoveries,
      elapsedActiveMs: Math.round(this.activeMs),
      maxObservedDriftPx: Math.round(this.peakDrift * 10) / 10,
      sleepReason: this.sleepReason,
      readyStableChecks: this.readyStableChecks
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
