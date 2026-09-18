import { createNavigationAnchorStore } from "@/navigation/jump/navigationAnchorStore";
import { searchVirtualPrompt } from "@/navigation/jump/virtualSearchController";
import { buildFingerprintIndex } from "@/navigation/fingerprint/index";
import { buildDerivedSegmentIndex } from "@/navigation/fingerprint/segments";
import {
  findRenderedChatGptPrompt,
  getChatGptScrollContainer,
  getChatGptScrollMetrics,
  isChatGptElementVisible,
  observeChatGptVirtualPosition
} from "@/platforms/chatgpt/virtualSearchAdapter";
import type { YadaTurn } from "../conversation/types";
import { findTurn, toLunaNavigationTurns, toLunaPrompts } from "./conversationAdapter";
import { NAVIGATION_CONFIG } from "./config";
import type { NavigationResult, NavigateToOptions } from "./types";
import type { NavigationFingerprintIndex } from "@/navigation/fingerprint/index";
import type { NavigationSegmentIndex } from "@/navigation/fingerprint/segments";

const PROMPT_TOP_OFFSET_PX = NAVIGATION_CONFIG.promptTopOffsetPx;
const ANCHOR_KEY = "chatgpt-yada:nav-anchors:v1";
const CANCEL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Space", " "]);

type FingerprintCache = {
  signature: string;
  fingerprintIndex: NavigationFingerprintIndex;
  segmentIndex: NavigationSegmentIndex;
};

export class NavigationPort {
  private transaction: AbortController | null = null;
  private fingerprintCache: FingerprintCache | null = null;
  private readonly anchors = createNavigationAnchorStore({
    storage: {
      async read() {
        if (typeof chrome === "undefined" || !chrome.storage?.local) return undefined;
        const data = await chrome.storage.local.get(ANCHOR_KEY);
        return data[ANCHOR_KEY];
      },
      async write(value) {
        if (typeof chrome === "undefined" || !chrome.storage?.local) return;
        await chrome.storage.local.set({ [ANCHOR_KEY]: value });
      }
    }
  });
  private interrupt: (() => void) | null = null;

  async navigateTo(
    turnId: string,
    turns: readonly YadaTurn[],
    conversationId: string,
    options: NavigateToOptions = {}
  ): Promise<NavigationResult> {
    this.cancel();
    const turn = findTurn(turns, turnId);
    if (!turn) return { ok: false, status: "failed" };

    const controller = new AbortController();
    this.transaction = controller;
    const abort = (): void => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }
    this.attachInterrupt(abort);

    try {
      if (controller.signal.aborted) return { ok: false, status: "cancelled" };

      if (await this.jumpDirect(turn, controller.signal)) {
        return { ok: true, status: "found", path: "direct" };
      }
      if (controller.signal.aborted) return { ok: false, status: "cancelled" };

      return await this.jumpVirtual(turn, turns, conversationId, controller.signal);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return { ok: false, status: "cancelled" };
      return { ok: false, status: "failed" };
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.detachInterrupt();
      if (this.transaction === controller) this.transaction = null;
    }
  }

  cancel(): void {
    this.transaction?.abort();
    this.transaction = null;
    this.detachInterrupt();
  }

  dispose(): void {
    this.cancel();
    this.fingerprintCache = null;
  }

  private async jumpDirect(turn: YadaTurn, signal: AbortSignal): Promise<boolean> {
    const ids = [turn.userMessageId, turn.assistantMessageId, turn.id].filter((id): id is string => !!id);
    for (const id of ids) {
      if (signal.aborted) return false;
      const element = findRenderedById(id);
      const container = getChatGptScrollContainer();
      if (!element || !container) continue;
      if (readMessageId(element) !== id) continue;
      scrollElementIntoContainer(element, container);
      await wait(32);
      if (signal.aborted) return false;
      const still = findRenderedById(id);
      if (still && readMessageId(still) === id) return true;
    }
    return false;
  }

  private async jumpVirtual(
    turn: YadaTurn,
    turns: readonly YadaTurn[],
    conversationId: string,
    signal: AbortSignal
  ): Promise<NavigationResult> {
    const prompts = toLunaPrompts(turns);
    const lunaTurns = toLunaNavigationTurns(turns);
    const signature = `${conversationId}:${turns.map((item) => `${item.userMessageId}:${item.assistantMessageId}`).join("|")}`;
    if (!this.fingerprintCache || this.fingerprintCache.signature !== signature) {
      this.fingerprintCache = {
        signature,
        fingerprintIndex: await buildFingerprintIndex(lunaTurns),
        segmentIndex: await buildDerivedSegmentIndex(lunaTurns)
      };
    }
    const { fingerprintIndex, segmentIndex } = this.fingerprintCache;
    const targetPromptId = turn.userMessageId ?? turn.id;
    const container = (): HTMLElement | null => getChatGptScrollContainer();

    const result = await searchVirtualPrompt({
      targetPromptId,
      targetPromptIndex: turn.index,
      promptCount: turns.length,
      getConfirmedAnchors: () => this.anchors.getConfirmedAnchors(conversationId),
      invalidateConfirmedAnchor: (promptId) => this.anchors.removeConfirmed(conversationId, promptId).then(() => undefined),
      getObservedAnchors: () => this.anchors.getObservedAnchors(conversationId),
      recordObservation: (anchor) => {
        this.anchors.recordObservation(anchor);
      },
      getScrollMetrics: () => {
        const node = container();
        return node ? getChatGptScrollMetrics(node) : { scrollTop: 0, maximumScrollTop: 0, viewportWidth: innerWidth, viewportHeight: innerHeight };
      },
      observePosition: () => observeChatGptVirtualPosition({
        conversationKey: conversationId,
        prompts,
        fingerprintIndex,
        segmentIndex
      }),
      isTargetRendered: () => {
        const element = findRenderedById(targetPromptId);
        const node = container();
        return Boolean(element && node && readMessageId(element) === targetPromptId);
      },
      scrollTo: (scrollTop) => {
        const node = container();
        if (node) node.scrollTop = scrollTop;
      },
      now: () => Date.now(),
      signal
    });

    if (result.status === "found") {
      const element = findRenderedById(targetPromptId);
      const node = container();
      if (element && node) {
        scrollElementIntoContainer(element, node);
        const metrics = getChatGptScrollMetrics(node);
        await this.anchors.recordConfirmed({
          conversationKey: conversationId,
          promptId: targetPromptId,
          promptIndex: turn.index,
          scrollTop: metrics.scrollTop,
          scrollHeight: node.scrollHeight,
          viewportWidth: metrics.viewportWidth,
          viewportHeight: metrics.viewportHeight
        });
      }
      return { ok: true, status: "found", path: "virtual", attempts: result.attempts };
    }
    if (result.status === "cancelled") return { ok: false, status: "cancelled", path: "virtual", attempts: result.attempts };
    if (result.status === "timed-out") return { ok: false, status: "timed-out", path: "virtual", attempts: result.attempts };
    if (result.status === "exhausted") return { ok: false, status: "exhausted", path: "virtual", attempts: result.attempts };
    return { ok: false, status: "unresolved", path: "virtual", attempts: result.attempts };
  }

  private attachInterrupt(abort: () => void): void {
    this.detachInterrupt();
    const onWheel = (): void => abort();
    const onTouch = (): void => abort();
    const onPointer = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.buttons === 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-yada-root]")) return;
      abort();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (CANCEL_KEYS.has(event.key)) abort();
    };
    window.addEventListener("wheel", onWheel, { passive: true, capture: true });
    window.addEventListener("touchmove", onTouch, { passive: true, capture: true });
    window.addEventListener("pointerdown", onPointer, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    this.interrupt = () => {
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("touchmove", onTouch, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }

  private detachInterrupt(): void {
    this.interrupt?.();
    this.interrupt = null;
  }
}

function findRenderedById(id: string): HTMLElement | null {
  return findRenderedChatGptPrompt(id)
    ?? document.querySelector<HTMLElement>(`[data-message-id="${cssEscape(id)}"]`);
}

function readMessageId(element: HTMLElement): string | null {
  return element.dataset.messageId
    ?? element.closest<HTMLElement>("[data-message-id]")?.dataset.messageId
    ?? null;
}

function scrollElementIntoContainer(element: HTMLElement, container: HTMLElement): void {
  const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - PROMPT_TOP_OFFSET_PX;
  container.scrollTop = Math.max(0, top);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

export function isElementCurrentlyVisible(element: HTMLElement): boolean {
  const container = getChatGptScrollContainer();
  return container ? isChatGptElementVisible(element, container) : false;
}
