import type { YadaTurn } from "../conversation/types";
import { NATIVE_NAV_CONFIG } from "./config";
import { publishNavigationDiagnostics } from "./diagnostics";
import { resolveNavigationTurn, turnUserMessageId } from "./identity";
import {
  attachUserNavigationCancel,
  findMountedUserMessage,
  isOfficialNavigationComplete,
  isStableSlotsComplete,
  readMessageId,
  readNativeCapability,
  scrollElementIntoView
} from "./nativeCapability";
import { jumpOfficialButton } from "./nativeButtonDriver";
import { readNativePrepState } from "./nativePreparation";
import { jumpStableSlot } from "./stableSlotDriver";
import type { NavigationDiagnostics, NavigationResult, NavigateToOptions } from "./types";
import { isAbortError, sleep } from "./wait";

type ActiveNavigation = {
  key: string;
  controller: AbortController;
  promise: Promise<NavigationResult>;
};

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

      const direct = findMountedUserMessage(userMessageId);
      if (direct && readMessageId(direct) === userMessageId) {
        path = "direct";
        scrollElementIntoView(direct);
        await sleep(NATIVE_NAV_CONFIG.directSettleMs, controller.signal);
        const still = findMountedUserMessage(userMessageId);
        if (still && readMessageId(still) === userMessageId) {
          result = { ok: true, path: "direct" };
          return result;
        }
        result = { ok: false, status: "failed" };
        return result;
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
        reloadAttempted: readNativePrepState(conversationId) === "attempted" || readNativePrepState(conversationId) === "ready",
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
