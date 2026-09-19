import type { YadaTurn } from "../conversation/types";
import { NATIVE_NAV_CONFIG } from "./config";
import {
  collectStableSlots,
  findMountedUserMessage,
  isInViewport,
  readMessageId,
  resolveStableSlot,
  scrollElementIntoView
} from "./nativeCapability";
import { isAbortError, sleep } from "./wait";

export type StableSlotJumpResult =
  | { status: "ok"; alignmentAttempts: number; coarseLocates: number }
  | { status: "cancelled" | "timeout" | "failed" | "unavailable"; alignmentAttempts: number; coarseLocates: number };

function isAligned(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && rect.top === 0) return true;
  return Math.abs(rect.top) <= NATIVE_NAV_CONFIG.alignmentTolerancePx;
}

export async function jumpStableSlot(
  turn: YadaTurn,
  signal: AbortSignal,
  timeoutAt: number
): Promise<StableSlotJumpResult> {
  const userMessageId = turn.userMessageId ?? turn.id;
  const slots = collectStableSlots();
  const slot = resolveStableSlot(turn, slots);
  if (!slot?.isConnected) {
    return { status: "unavailable", alignmentAttempts: 0, coarseLocates: 0 };
  }

  let coarseLocates = 0;
  let alignmentAttempts = 0;
  try {
    coarseLocates = 1;
    scrollElementIntoView(slot);

    let mounted: HTMLElement | null = null;
    while (Date.now() < timeoutAt) {
      if (signal.aborted) return { status: "cancelled", alignmentAttempts, coarseLocates };
      mounted = findMountedUserMessage(userMessageId);
      if (mounted && readMessageId(mounted) === userMessageId) break;
      await sleep(NATIVE_NAV_CONFIG.pollMs, signal);
    }
    if (!mounted || readMessageId(mounted) !== userMessageId) {
      return { status: Date.now() >= timeoutAt ? "timeout" : "failed", alignmentAttempts, coarseLocates };
    }

    while (alignmentAttempts < NATIVE_NAV_CONFIG.maxAlignmentAttempts && Date.now() < timeoutAt) {
      if (signal.aborted) return { status: "cancelled", alignmentAttempts, coarseLocates };
      if (isInViewport(mounted) && isAligned(mounted) && readMessageId(mounted) === userMessageId) {
        return { status: "ok", alignmentAttempts, coarseLocates };
      }
      alignmentAttempts += 1;
      scrollElementIntoView(mounted);
      await sleep(NATIVE_NAV_CONFIG.alignmentQuietMs, signal);
      mounted = findMountedUserMessage(userMessageId) ?? mounted;
    }

    if (mounted && readMessageId(mounted) === userMessageId && isInViewport(mounted)) {
      return { status: "ok", alignmentAttempts, coarseLocates };
    }
    return { status: Date.now() >= timeoutAt ? "timeout" : "failed", alignmentAttempts, coarseLocates };
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return { status: "cancelled", alignmentAttempts, coarseLocates };
    return { status: "failed", alignmentAttempts, coarseLocates };
  }
}
