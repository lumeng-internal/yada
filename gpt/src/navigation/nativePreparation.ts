import type { YadaTurn } from "../conversation/types";
import {
  composerHasDraft,
  isChatGptGenerating,
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
    writeNativePrepState(conversationId, "unsupported", host);
    return { action: "unsupported", state: "unsupported" };
  }

  if (hasEmptyMessageQuery(href)) {
    writeNativePrepState(conversationId, "attempted", host);
    if (complete) {
      writeNativePrepState(conversationId, "ready", host);
      return { action: "ready", state: "ready", url: stripEmptyMessageQuery(href) };
    }
    writeNativePrepState(conversationId, "unsupported", host);
    return { action: "unsupported", state: "unsupported" };
  }

  if (!shouldAttemptNativePreparation(turns, capability)) return { action: "none", state: "unseen" };
  const next = withEmptyMessageTrigger(href);
  if (!next) return { action: "none", state: "unseen" };
  writeNativePrepState(conversationId, "attempted", host);
  return { action: "assign", state: "attempted", url: next };
}

export class NativePreparationController {
  constructor(private readonly host: NativePrepHost = defaultHost) {}

  evaluate(conversationId: string | null, turns: readonly YadaTurn[]): NativePrepDecision {
    if (!conversationId || !turns.length) return { action: "none", state: "unseen" };
    const href = this.host.locationHref();
    const capability = readNativeCapability(turns, conversationId);
    const decision = decideNativePreparation(conversationId, turns, href, capability, this.host);
    if (decision.action === "assign") this.host.assign(decision.url);
    if (decision.action === "ready") this.host.replaceUrl(decision.url);
    return decision;
  }

  blockedByPage(turns: readonly YadaTurn[], conversationId: string): boolean {
    return isChatGptGenerating() || composerHasDraft() || !turns.length || !conversationId;
  }
}
