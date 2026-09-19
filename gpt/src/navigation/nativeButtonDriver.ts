import { NATIVE_NAV_CONFIG } from "./config";
import {
  collectOfficialButtons,
  findMountedUserMessage,
  isInViewport,
  isOfficialNavigationComplete,
  readMessageId
} from "./nativeCapability";
import { isAbortError, sleep } from "./wait";

export type OfficialButtonJumpResult = "ok" | "cancelled" | "timeout" | "failed" | "unavailable";

export async function jumpOfficialButton(
  conversationId: string,
  expectedTurnCount: number,
  targetIndex: number,
  userMessageId: string,
  signal: AbortSignal,
  timeoutAt: number
): Promise<OfficialButtonJumpResult> {
  if (!isOfficialNavigationComplete(expectedTurnCount, conversationId)) return "unavailable";
  const buttons = collectOfficialButtons();
  const target = buttons[targetIndex];
  if (!target || target.index !== targetIndex) return "unavailable";
  if (signal.aborted) return "cancelled";

  try {
    target.element.click();
  } catch {
    return "failed";
  }

  try {
    while (Date.now() < timeoutAt) {
      if (signal.aborted) return "cancelled";
      const node = findMountedUserMessage(userMessageId);
      if (node && readMessageId(node) === userMessageId && isInViewport(node)) return "ok";
      await sleep(NATIVE_NAV_CONFIG.pollMs, signal);
    }
    return "timeout";
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return "cancelled";
    return "failed";
  }
}
