import type { YadaTurn } from "../conversation/types";
import { NATIVE_NAV_CONFIG } from "./config";
import {
  readNativeCapability,
  type NativeCapabilitySnapshot
} from "./nativeCapability";

export type NativePrepState = "unseen" | "attempted" | "ready" | "unsupported";

export type NativePrepHost = {
  getSession(key: string): string | null;
  setSession(key: string, value: string): void;
  locationHref(): string;
  assign(url: string): void;
  replaceUrl(url: string): void;
};

export type NativePrepDecision =
  | { action: "none"; state: NativePrepState }
  | { action: "assign"; state: "attempted"; url: string }
  | { action: "wait"; state: "attempted" }
  | { action: "ready"; state: "ready"; url: string }
  | { action: "unsupported"; state: "unsupported" };

const defaultHost: NativePrepHost = {
  getSession(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  setSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* ignore quota */ }
  },
  locationHref: () => location.href,
  assign: (url) => { location.assign(url); },
  replaceUrl: (url) => { history.replaceState(history.state, "", url); }
};

const PREP_MUTATION_SELECTOR = [
  `[class*="_convSearchResultHighlightRoot"]`,
  "[data-turn-id-container]",
  "button[data-toc-item-index]",
  `button[aria-label^="Prompt "]`
].join(",");

export function nativePrepKey(conversationId: string): string {
  return `chatgpt-yada:native-prepared:${conversationId}`;
}

export function readNativePrepState(conversationId: string, host: NativePrepHost = defaultHost): NativePrepState {
  const value = host.getSession(nativePrepKey(conversationId));
  if (value === "attempted" || value === "ready" || value === "unsupported") return value;
  return "unseen";
}

export function writeNativePrepState(conversationId: string, state: Exclude<NativePrepState, "unseen">, host: NativePrepHost = defaultHost): void {
  host.setSession(nativePrepKey(conversationId), state);
}

export function nativePrepReloadAttempted(conversationId: string, host: NativePrepHost = defaultHost): boolean {
  return readNativePrepState(conversationId, host) !== "unseen";
}

export function messageQueryValue(href: string): string | null {
  try {
    const url = new URL(href, "https://chatgpt.com");
    if (!url.searchParams.has("message")) return null;
    return url.searchParams.get("message") ?? "";
  } catch {
    return null;
  }
}

export function hasNonEmptyMessageQuery(href: string): boolean {
  const value = messageQueryValue(href);
  return value != null && value !== "";
}

export function hasEmptyMessageQuery(href: string): boolean {
  return messageQueryValue(href) === "";
}

export function withEmptyMessageTrigger(href: string): string | null {
  if (hasNonEmptyMessageQuery(href)) return null;
  try {
    const url = new URL(href, "https://chatgpt.com");
    url.searchParams.set("message", "");
    return url.toString();
  } catch {
    return null;
  }
}

export function stripEmptyMessageQuery(href: string): string {
  try {
    const url = new URL(href, "https://chatgpt.com");
    if (url.searchParams.get("message") === "") url.searchParams.delete("message");
    return url.toString();
  } catch {
    return href;
  }
}

export function shouldAttemptNativePreparation(
  turns: readonly YadaTurn[],
  capability: NativeCapabilitySnapshot
): boolean {
  if (!turns.length) return false;
  if (capability.generating || capability.composerDraft) return false;
  if (capability.officialComplete || capability.slotsComplete) return false;
  return turns.length > capability.mountedUserCount;
}

export function decideNativePreparation(
  conversationId: string,
  turns: readonly YadaTurn[],
  href: string,
  capability: NativeCapabilitySnapshot,
  host: NativePrepHost = defaultHost
): NativePrepDecision {
  const state = readNativePrepState(conversationId, host);
  if (hasNonEmptyMessageQuery(href)) return { action: "none", state };
  if (state === "ready" || state === "unsupported") return { action: "none", state };

  const complete = capability.officialComplete || capability.slotsComplete;
  if (state === "attempted") {
    if (complete) {
      writeNativePrepState(conversationId, "ready", host);
      return { action: "ready", state: "ready", url: stripEmptyMessageQuery(href) };
    }
    if (!hasEmptyMessageQuery(href)) return { action: "none", state: "attempted" };
    return { action: "wait", state: "attempted" };
  }

  if (hasEmptyMessageQuery(href)) {
    writeNativePrepState(conversationId, "attempted", host);
    if (complete) {
      writeNativePrepState(conversationId, "ready", host);
      return { action: "ready", state: "ready", url: stripEmptyMessageQuery(href) };
    }
    return { action: "wait", state: "attempted" };
  }

  if (!shouldAttemptNativePreparation(turns, capability)) return { action: "none", state: "unseen" };
  const next = withEmptyMessageTrigger(href);
  if (!next) return { action: "none", state: "unseen" };
  writeNativePrepState(conversationId, "attempted", host);
  return { action: "assign", state: "attempted", url: next };
}

function mutationTouchesNativeSkeleton(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (record.target instanceof Element && record.target.closest(PREP_MUTATION_SELECTOR)) return true;
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (!(node instanceof Element)) continue;
      if (node.matches(PREP_MUTATION_SELECTOR) || node.querySelector(PREP_MUTATION_SELECTOR)) return true;
    }
  }
  return false;
}

class NativePrepWaiter {
  private observer: MutationObserver | null = null;
  private raf = 0;
  private timer = 0;
  private active = true;
  private turns: readonly YadaTurn[];

  constructor(
    readonly conversationId: string,
    turns: readonly YadaTurn[],
    private readonly host: NativePrepHost,
    private readonly onSettled: () => void
  ) {
    this.turns = turns;
    this.observer = new MutationObserver((records) => {
      if (mutationTouchesNativeSkeleton(records)) this.scheduleCheck();
    });
    this.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "data-toc-item-index", "aria-label", "aria-description", "data-turn-id-container"]
    });
    this.timer = window.setTimeout(() => this.finish("unsupported"), NATIVE_NAV_CONFIG.prepWaitMs);
    this.scheduleCheck();
  }

  isActive(): boolean {
    return this.active;
  }

  hasObserver(): boolean {
    return this.observer != null;
  }

  updateTurns(turns: readonly YadaTurn[]): void {
    this.turns = turns;
    this.scheduleCheck();
  }

  dispose(): void {
    this.stop();
  }

  private scheduleCheck(): void {
    if (!this.active || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.check();
    });
  }

  private check(): void {
    if (!this.active) return;
    const capability = readNativeCapability(this.turns, this.conversationId);
    if (capability.officialComplete || capability.slotsComplete) this.finish("ready");
  }

  private finish(result: "ready" | "unsupported"): void {
    if (!this.active) return;
    writeNativePrepState(this.conversationId, result, this.host);
    if (result === "ready") this.host.replaceUrl(stripEmptyMessageQuery(this.host.locationHref()));
    this.stop();
    this.onSettled();
  }

  private stop(): void {
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.timer);
    this.timer = 0;
  }
}

export class NativePreparationController {
  private wait: NativePrepWaiter | null = null;
  private readonly onPageHide = (): void => { this.cancelWait(); };

  constructor(private readonly host: NativePrepHost = defaultHost) {
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("beforeunload", this.onPageHide);
  }

  evaluate(conversationId: string | null, turns: readonly YadaTurn[]): NativePrepDecision {
    if (!conversationId || !turns.length) {
      this.cancelWait();
      return { action: "none", state: "unseen" };
    }
    if (this.wait && this.wait.conversationId !== conversationId) this.cancelWait();

    const href = this.host.locationHref();
    const capability = readNativeCapability(turns, conversationId);
    const decision = decideNativePreparation(conversationId, turns, href, capability, this.host);
    if (decision.action === "assign") {
      this.cancelWait();
      this.host.assign(decision.url);
    } else if (decision.action === "ready") {
      this.cancelWait();
      this.host.replaceUrl(decision.url);
    } else if (decision.action === "wait") {
      this.ensureWait(conversationId, turns);
    }
    return decision;
  }

  cancelWait(): void {
    this.wait?.dispose();
    this.wait = null;
  }

  isWaiting(): boolean {
    return this.wait?.isActive() === true;
  }

  waitingConversationId(): string | null {
    return this.wait?.isActive() ? this.wait.conversationId : null;
  }

  hasActiveObserver(): boolean {
    return this.wait?.hasObserver() === true;
  }

  dispose(): void {
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("beforeunload", this.onPageHide);
    this.cancelWait();
  }

  private ensureWait(conversationId: string, turns: readonly YadaTurn[]): void {
    if (this.wait?.isActive() && this.wait.conversationId === conversationId) {
      this.wait.updateTurns(turns);
      return;
    }
    this.cancelWait();
    this.wait = new NativePrepWaiter(conversationId, turns, this.host, () => {
      if (this.wait?.conversationId === conversationId && !this.wait.isActive()) this.wait = null;
    });
  }
}
