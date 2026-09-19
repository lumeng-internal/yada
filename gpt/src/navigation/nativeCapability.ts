import { hasUnsentComposerDraft, isInsideComposer } from "../conversation/composerGuard";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import type { YadaTurn } from "../conversation/types";

export const CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR = [
  `main [class$="_convSearchResultHighlightRoot"]`,
  `main [class*="_convSearchResultHighlightRoot "]`
].join(",");

export const CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR = [
  "fixed",
  "inset-e-4",
  "top-1/2",
  "z-20",
  "-translate-y-1/2"
];

export type OfficialButton = {
  index: number;
  element: HTMLButtonElement;
};

export type StableSlot = {
  id: string;
  role: "user" | "assistant" | "unknown";
  element: HTMLElement;
};

const CANCEL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space"]);

export function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function isOfficialFixedChild(element: Element): element is HTMLElement {
  return element instanceof HTMLElement
    && CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR.every((token) => element.classList.contains(token))
    && !element.closest("[data-yada-root]");
}

export function listOfficialNavigationRoots(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR)]
    .filter((node) => [...node.children].some(isOfficialFixedChild));
}

function parsePromptNumber(button: HTMLButtonElement): number | null {
  const toc = button.dataset.tocItemIndex;
  if (toc != null && /^\d+$/.test(toc)) return Number(toc);
  const label = button.getAttribute("aria-label") ?? "";
  const description = button.getAttribute("aria-description") ?? "";
  const match = /Prompt\s+(\d+)/i.exec(label) || /Prompt\s+(\d+)/i.exec(description);
  return match ? Number(match[1]) : null;
}

function readOfficialButtonsFromRoot(root: HTMLElement): OfficialButton[] | null {
  const fixed = [...root.children].find(isOfficialFixedChild);
  if (!fixed) return null;
  const buttons = [...fixed.querySelectorAll("button")].filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);
  if (!buttons.length) return null;

  const parsed = buttons.map((element) => ({ element, raw: parsePromptNumber(element) }));
  if (parsed.some((item) => item.raw == null)) return null;
  const values = parsed.map((item) => item.raw!);
  if (new Set(values).size !== values.length) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const zeroBased = min === 0 && max === values.length - 1;
  const oneBased = min === 1 && max === values.length;
  if (!zeroBased && !oneBased) return null;
  const offset = oneBased ? 1 : 0;
  return parsed
    .map((item) => ({ element: item.element, index: item.raw! - offset }))
    .sort((left, right) => left.index - right.index);
}

export function collectOfficialButtons(root: ParentNode = document): OfficialButton[] {
  const navRoots = listOfficialNavigationRoots(root);
  if (navRoots.length !== 1) return [];
  return readOfficialButtonsFromRoot(navRoots[0]!) ?? [];
}

export function isOfficialNavigationComplete(
  expectedTurnCount: number,
  conversationId: string,
  root: ParentNode = document
): boolean {
  if (expectedTurnCount <= 0) return false;
  const pageId = getConversationIdFromUrl();
  if (pageId && pageId !== conversationId) return false;
  const buttons = collectOfficialButtons(root);
  if (buttons.length !== expectedTurnCount) return false;
  return buttons.every((button, index) => button.index === index);
}

export function isEphemeralTurnIndexMarker(id: string): boolean {
  return /^conversation-turn-\d+$/i.test(id.trim());
}

function slotRole(slot: HTMLElement): StableSlot["role"] {
  const known = new Set<"user" | "assistant">();
  if (slot.matches('[data-message-author-role="user"]')) known.add("user");
  if (slot.matches('[data-message-author-role="assistant"]')) known.add("assistant");
  for (const node of slot.querySelectorAll<HTMLElement>("[data-message-author-role]")) {
    const role = node.getAttribute("data-message-author-role");
    if (role === "user" || role === "assistant") known.add(role);
  }
  if (known.size === 1) return [...known][0]!;
  return "unknown";
}

export function collectStableSlots(root: ParentNode = document): StableSlot[] {
  const containers = [...root.querySelectorAll<HTMLElement>("[data-turn-id-container]")];
  const groups = new Map<HTMLElement, HTMLElement[]>();
  for (const container of containers) {
    const parent = container.parentElement;
    if (!parent) continue;
    const group = groups.get(parent);
    if (group) group.push(container);
    else groups.set(parent, [container]);
  }
  const largest = [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
  const seen = new Map<string, HTMLElement>();
  const duplicates = new Set<string>();
  for (const element of largest) {
    const id = element.getAttribute("data-turn-id-container")?.trim() ?? "";
    if (!id || id === "client-created-root" || isEphemeralTurnIndexMarker(id)) continue;
    if (duplicates.has(id)) continue;
    if (seen.has(id)) {
      seen.delete(id);
      duplicates.add(id);
      continue;
    }
    seen.set(id, element);
  }
  return [...seen.entries()].map(([id, element]) => ({ id, element, role: slotRole(element) }));
}

export function isStableSlotsComplete(turns: readonly YadaTurn[], root: ParentNode = document): boolean {
  if (!turns.length) return false;
  const slots = collectStableSlots(root);
  if (slots.length < turns.length) return false;
  return turns.every((turn) => resolveStableSlot(turn, slots) != null);
}

export function resolveStableSlot(turn: YadaTurn, slots: readonly StableSlot[]): HTMLElement | null {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const user = turn.userMessageId ? byId.get(turn.userMessageId) : undefined;
  if (user && (user.role === "user" || user.role === "unknown")) return user.element;
  const round = byId.get(turn.id);
  if (round && (round.role === "user" || round.role === "unknown")) return round.element;
  const assistant = turn.assistantMessageId ? byId.get(turn.assistantMessageId) : undefined;
  if (assistant && (assistant.role === "assistant" || assistant.role === "unknown") && !user) {
    return assistant.element;
  }
  return null;
}

export function countMountedUserMessages(root: ParentNode = document): number {
  let count = 0;
  for (const node of root.querySelectorAll<HTMLElement>('[data-message-author-role="user"][data-message-id]')) {
    if (isInsideComposer(node)) continue;
    if (node.dataset.messageId) count += 1;
  }
  return count;
}

export function findMountedUserMessage(messageId: string, root: ParentNode = document): HTMLElement | null {
  const exact = root.querySelector<HTMLElement>(`[data-message-author-role="user"][data-message-id="${cssEscape(messageId)}"]`);
  if (exact && !isInsideComposer(exact) && readMessageId(exact) === messageId) return exact;
  for (const node of root.querySelectorAll<HTMLElement>("[data-message-id]")) {
    if (isInsideComposer(node)) continue;
    if (readMessageId(node) !== messageId) continue;
    const role = node.getAttribute("data-message-author-role")
      ?? node.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");
    if (role === "user") return node;
  }
  return null;
}

export function readMessageId(element: HTMLElement): string | null {
  return element.dataset.messageId
    ?? element.closest<HTMLElement>("[data-message-id]")?.dataset.messageId
    ?? null;
}

export function scrollElementIntoView(element: HTMLElement): void {
  if (typeof element.scrollIntoView !== "function") return;
  try {
    element.scrollIntoView({ behavior: "auto", block: "start" });
  } catch {
    /* jsdom and some host builds throw; the caller still verifies identity. */
  }
}

export function pageConversationMatches(conversationId: string): boolean {
  const pageId = getConversationIdFromUrl();
  return !pageId || pageId === conversationId;
}

export function isInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (!element.isConnected) return false;
  if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) return true;
  const height = window.innerHeight || 800;
  return rect.bottom > 8 && rect.top < height - 8;
}

export function isChatGptGenerating(root: ParentNode = document): boolean {
  return Boolean(
    root.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming, button[data-testid="stop-button"]')
  );
}

export function composerHasDraft(): boolean {
  return hasUnsentComposerDraft();
}

export function attachUserNavigationCancel(abort: () => void): () => void {
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
  window.addEventListener("touchstart", onTouch, { passive: true, capture: true });
  window.addEventListener("touchmove", onTouch, { passive: true, capture: true });
  window.addEventListener("pointerdown", onPointer, { capture: true });
  window.addEventListener("keydown", onKey, { capture: true });
  return () => {
    window.removeEventListener("wheel", onWheel, true);
    window.removeEventListener("touchstart", onTouch, true);
    window.removeEventListener("touchmove", onTouch, true);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("keydown", onKey, true);
  };
}

export type NativeCapabilitySnapshot = {
  officialButtonCount: number;
  officialComplete: boolean;
  slotCount: number;
  slotsComplete: boolean;
  mountedUserCount: number;
  generating: boolean;
  composerDraft: boolean;
};

export function readNativeCapability(
  turns: readonly YadaTurn[],
  conversationId: string,
  root: ParentNode = document
): NativeCapabilitySnapshot {
  const officialButtons = collectOfficialButtons(root);
  const slots = collectStableSlots(root);
  return {
    officialButtonCount: officialButtons.length,
    officialComplete: isOfficialNavigationComplete(turns.length, conversationId, root),
    slotCount: slots.length,
    slotsComplete: isStableSlotsComplete(turns, root),
    mountedUserCount: countMountedUserMessages(root),
    generating: isChatGptGenerating(root),
    composerDraft: composerHasDraft()
  };
}
