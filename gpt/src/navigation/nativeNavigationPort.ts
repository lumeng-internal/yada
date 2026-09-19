import type { YadaTurn } from "../conversation/types";
import { NATIVE_NAV_CONFIG } from "./config";
import { publishNavigationDiagnostics } from "./diagnostics";
import { resolveNavigationTurn, turnUserMessageId } from "./identity";
import {
  attachUserNavigationCancel,
  findMountedUserMessage,
  isInViewport,
  isOfficialNavigationComplete,
  isStableSlotsComplete,
  pageConversationMatches,
  readMessageId,
  readNativeCapability,
  scrollElementIntoView
} from "./nativeCapability";
import { jumpOfficialButton } from "./nativeButtonDriver";
import { nativePrepReloadAttempted } from "./nativePreparation";
import { jumpStableSlot } from "./stableSlotDriver";
import type { NavigationDiagnostics, NavigationResult, NavigateToOptions } from "./types";
import { isAbortError, nextFrame } from "./wait";

type ActiveNavigation = {
  key: string;
  controller: AbortController;
  promise: Promise<NavigationResult>;
};

type DirectJumpResult = "ok" | "miss" | "cancelled" | "stale-target";

function targetKey(conversationId: string, turn: YadaTurn): string {
  return `${conversationId}|${turnUserMessageId(turn)}|${turn.index}`;
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined;
  const abort = (): void => target.abort();
  if (source.aborted) target.abort();
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

async function jumpDirect(
  userMessageId: string,
  conversationId: string,
  signal: AbortSignal,
  timeoutAt: number
): Promise<DirectJumpResult> {
  if (signal.aborted) return "cancelled";
  if (!pageConversationMatches(conversationId)) return "stale-target";
  const node = findMountedUserMessage(userMessageId);
  if (!node || !node.isConnected || readMessageId(node) !== userMessageId) return "miss";
  scrollElementIntoView(node);

  const deadline = Math.min(timeoutAt, Date.now() + NATIVE_NAV_CONFIG.directViewportMs);
  try {
    while (true) {
      if (signal.aborted) return "cancelled";
      if (!pageConversationMatches(conversationId)) return "stale-target";
      const current = findMountedUserMessage(userMessageId);
      if (
        current?.isConnected
        && readMessageId(current) === userMessageId
        && isInViewport(current)
      ) {
        return "ok";
      }
      if (Date.now() >= deadline) return "miss";
      await nextFrame(signal);
    }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return "cancelled";
    throw error;
  }
}

export class NativeNavigationPort {
  private active: ActiveNavigation | null = null;
  private interrupt: (() => void) | null = null;
  lastDiagnostics: NavigationDiagnostics | null = null;

  navigateTo(
    turnId: string,
    turns: readonly YadaTurn[],
    conversationId: string,
    options: NavigateToOptions = {}
  ): Promise<NavigationResult> {
    const resolved = resolveNavigationTurn(turns, turnId);
    if (!resolved.ok) return Promise.resolve(resolved);
    const key = targetKey(conversationId, resolved.turn);
    if (this.active?.key === key) return this.active.promise;

    this.cancel();
    const controller = new AbortController();
    const unlink = linkAbortSignal(options.signal, controller);
    const promise = this.run(resolved.turn, turns, conversationId, controller, options.timeoutMs)
      .finally(() => {
        unlink();
        if (this.active?.controller === controller) this.active = null;
      });
    this.active = { key, controller, promise };
    return promise;
  }

  cancel(): void {
    this.active?.controller.abort();
    this.active = null;
    this.detachInterrupt();
  }

  dispose(): void {
    this.cancel();
    this.lastDiagnostics = null;
    publishNavigationDiagnostics(null);
  }

  private async run(
    turn: YadaTurn,
    turns: readonly YadaTurn[],
    conversationId: string,
    controller: AbortController,
    timeoutMs?: number
  ): Promise<NavigationResult> {
    const started = Date.now();
    const limit = Math.max(1, Math.min(NATIVE_NAV_CONFIG.timeoutMs, timeoutMs ?? NATIVE_NAV_CONFIG.timeoutMs));
    const timeoutAt = started + limit;
    let timedOut = false;
    const timeoutTimer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, timeoutAt - Date.now()));
    this.attachInterrupt(() => controller.abort());

    const userMessageId = turnUserMessageId(turn);
    const capability = readNativeCapability(turns, conversationId);
    let path: NavigationDiagnostics["path"] = null;
    let alignmentAttempts = 0;
    let result: NavigationResult = { ok: false, status: "failed" };

    try {
      if (controller.signal.aborted && !timedOut) return { ok: false, status: "cancelled" };

      const mounted = findMountedUserMessage(userMessageId);
      if (mounted && readMessageId(mounted) === userMessageId) {
        const jumped = await jumpDirect(userMessageId, conversationId, controller.signal, timeoutAt);
        if (jumped === "ok") {
          path = "direct";
          result = { ok: true, path: "direct" };
          return result;
        }
        if (jumped === "cancelled") {
          result = { ok: false, status: timedOut ? "timeout" : "cancelled" };
          return result;
        }
        if (jumped === "stale-target") {
          result = { ok: false, status: "stale-target" };
          return result;
        }
      }

      if (isOfficialNavigationComplete(turns.length, conversationId)) {
        path = "official-button";
        const jumped = await jumpOfficialButton(
          conversationId,
          turns.length,
          turn.index,
          userMessageId,
          controller.signal,
          timeoutAt
        );
        if (jumped === "ok") result = { ok: true, path: "official-button" };
        else if (jumped === "cancelled") result = { ok: false, status: timedOut ? "timeout" : "cancelled" };
        else if (jumped === "timeout") result = { ok: false, status: "timeout" };
        else if (jumped === "unavailable") result = { ok: false, status: "unsupported" };
        else result = { ok: false, status: "failed" };
        return result;
      }

      if (isStableSlotsComplete(turns)) {
        path = "stable-slot";
        const jumped = await jumpStableSlot(turn, controller.signal, timeoutAt);
        alignmentAttempts = jumped.alignmentAttempts;
        if (jumped.status === "ok") result = { ok: true, path: "stable-slot" };
        else if (jumped.status === "cancelled") result = { ok: false, status: timedOut ? "timeout" : "cancelled" };
        else if (jumped.status === "timeout") result = { ok: false, status: "timeout" };
        else if (jumped.status === "unavailable") result = { ok: false, status: "unsupported" };
        else result = { ok: false, status: "failed" };
        return result;
      }

      result = { ok: false, status: "unsupported" };
      return result;
    } catch (error) {
      if (timedOut) result = { ok: false, status: "timeout" };
      else if (controller.signal.aborted || isAbortError(error)) result = { ok: false, status: "cancelled" };
      else result = { ok: false, status: "failed" };
      return result;
    } finally {
      window.clearTimeout(timeoutTimer);
      this.detachInterrupt();
      this.lastDiagnostics = {
        conversationId,
        targetIndex: turn.index,
        targetMessageId: userMessageId,
        path: result.ok ? result.path : path,
        officialButtonCount: capability.officialButtonCount,
        expectedTurnCount: turns.length,
        slotCount: capability.slotCount,
        reloadAttempted: nativePrepReloadAttempted(conversationId),
        yadaScrollWrites: 0,
        alignmentAttempts,
        result: result.ok ? result.path : result.status,
        duration: Date.now() - started
      };
      publishNavigationDiagnostics(this.lastDiagnostics);
    }
  }

  private attachInterrupt(abort: () => void): void {
    this.detachInterrupt();
    this.interrupt = attachUserNavigationCancel(abort);
  }

  private detachInterrupt(): void {
    this.interrupt?.();
    this.interrupt = null;
  }
}

export { NativeNavigationPort as NavigationPort };
