/* Minimal official-navigation DOM structure adapted from AI-MarkDone.
 * Copyright (c) 2025 BenkoZhao. MIT; see NOTICE.md and THIRD_PARTY_NOTICES.md.
 */

const MESSAGE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
const OFFICIAL_ROOT_SELECTOR = [
  'main [class$="_convSearchResultHighlightRoot"]',
  'main [class*="_convSearchResultHighlightRoot "]'
].join(",");
const OFFICIAL_CONTAINER_TOKENS = ["fixed", "inset-e-4", "top-1/2", "z-20", "-translate-y-1/2"];
const SENTINEL_SELECTOR = '[data-testid="conversation-pagination-sentinel"]';

export type NativePromptState = { found: number; visible: number };
export type ReadingPosition = {
  identity: { attribute: string; value: string } | null;
  element: HTMLElement;
  offset: number;
  scroller: HTMLElement;
};

export function conversationScroller(): HTMLElement | null {
  const surface = document.querySelector("main, [role=main]") ?? document;
  const message = surface.querySelector<HTMLElement>(MESSAGE_SELECTOR);
  if (!message) return null;
  let ancestor = message.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    if (ancestor.clientHeight > 100 && ["auto", "scroll", "overlay"].some((value) => style.overflowY.includes(value))) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

export function viewportTop(scroller: HTMLElement): number {
  if (scroller === document.scrollingElement) return 0;
  const rectangle = scroller.getBoundingClientRect();
  return rectangle.top + scroller.clientTop;
}

export function readNativePrompts(root: ParentNode = document): NativePromptState {
  const candidates = [...root.querySelectorAll<HTMLElement>(OFFICIAL_ROOT_SELECTOR)];
  if (candidates.length !== 1) return { found: 0, visible: 0 };
  const container = [...candidates[0]!.children].find((child): child is HTMLElement =>
    child instanceof HTMLElement
    && OFFICIAL_CONTAINER_TOKENS.every((token) => child.classList.contains(token))
    && !child.closest("[data-yada-root]")
  );
  if (!container) return { found: 0, visible: 0 };

  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
  const indexes = buttons.map(readPromptIndex);
  if (!indexes.length || indexes.some((index) => index === null)) return { found: 0, visible: 0 };
  const numeric = indexes as number[];
  if (new Set(numeric).size !== numeric.length) return { found: 0, visible: 0 };
  const first = Math.min(...numeric);
  const ordered = [...numeric].map((index) => index - (first === 1 ? 1 : 0)).sort((left, right) => left - right);
  if (!ordered.every((index, position) => index === position)) return { found: 0, visible: 0 };
  return { found: buttons.length, visible: buttons.filter(elementVisible).length };
}

export function saveReadingPosition(): ReadingPosition | null {
  const scroller = conversationScroller();
  if (!scroller) return null;
  const top = viewportTop(scroller);
  const bottom = Math.min(innerHeight, top + scroller.clientHeight);
  const onScreen = [...document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)].filter((message) => {
    const rectangle = message.getBoundingClientRect();
    return rectangle.bottom > top + 8 && rectangle.top < bottom - 8;
  });
  const anchor = onScreen.find((message) => message.getBoundingClientRect().top >= top) ?? onScreen[0];
  if (!anchor) return null;
  return {
    identity: stableMessageIdentity(anchor),
    element: anchor,
    offset: anchor.getBoundingClientRect().top - top,
    scroller
  };
}

export function readingPositionDrift(position: ReadingPosition): number | null {
  if (!position.scroller.isConnected || conversationScroller() !== position.scroller) return null;
  let anchor: HTMLElement | null = position.element.isConnected ? position.element : null;
  if (position.identity) anchor = findStableMessage(position.identity);
  if (!anchor) return null;
  return anchor.getBoundingClientRect().top - viewportTop(position.scroller) - position.offset;
}

export function stableLayoutAvailable(): boolean {
  const scroller = conversationScroller();
  if (!scroller || getComputedStyle(scroller).overflowAnchor === "none") return false;
  return !document.querySelector(
    '[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming, button[data-testid="stop-button"], [data-stream-active="true"]'
  );
}

export function safeDesktopLayout(): boolean {
  return document.visibilityState === "visible"
    && innerWidth >= 1024
    && matchMedia("(hover: hover)").matches
    && stableLayoutAvailable();
}

export function exposePaginationSentinel(scroller: HTMLElement): { element: HTMLElement; release(): void } | null {
  const matches = [...scroller.querySelectorAll<HTMLElement>(SENTINEL_SELECTOR)];
  if (matches.length !== 1) return null;
  const element = matches[0]!;
  const rectangle = element.getBoundingClientRect();
  if (!element.isConnected || element.getClientRects().length === 0 || rectangle.height > 100) return null;

  const ownedStyles = new Map<string, string>([
    ["position", "sticky"],
    ["top", "80px"],
    ["opacity", "0"],
    ["pointer-events", "none"]
  ]);
  const previous = new Map<string, { value: string; priority: string }>();
  for (const [property, value] of ownedStyles) {
    previous.set(property, {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    });
    element.style.setProperty(property, value, "important");
  }

  let active = true;
  return {
    element,
    release() {
      if (!active) return;
      active = false;
      for (const [property, value] of ownedStyles) {
        if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== "important") continue;
        const original = previous.get(property)!;
        if (original.value) element.style.setProperty(property, original.value, original.priority);
        else element.style.removeProperty(property);
      }
    }
  };
}

function readPromptIndex(button: HTMLButtonElement): number | null {
  const explicit = button.dataset.tocItemIndex;
  if (explicit && /^\d+$/.test(explicit)) return Number(explicit);
  for (const name of ["aria-label", "aria-description"]) {
    const match = /^prompt\s+(\d+)(?:\b|:)/i.exec(button.getAttribute(name) ?? "");
    if (match) return Number(match[1]);
  }
  return null;
}

function elementVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
  const rectangle = element.getBoundingClientRect();
  return rectangle.width > 0
    && rectangle.height > 0
    && rectangle.right > 0
    && rectangle.left < innerWidth
    && rectangle.bottom > 0
    && rectangle.top < innerHeight;
}

function stableMessageIdentity(element: HTMLElement): ReadingPosition["identity"] {
  let node: HTMLElement | null = element;
  for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
    for (const attribute of ["data-message-id", "data-turn-id", "data-turn-id-container"]) {
      const value = node.getAttribute(attribute);
      if (value && value.length <= 256) return { attribute, value };
    }
    if (node.tagName === "ARTICLE") break;
  }
  return null;
}

function findStableMessage(identity: NonNullable<ReadingPosition["identity"]>): HTMLElement | null {
  const matches = [...document.querySelectorAll<HTMLElement>(`[${identity.attribute}="${CSS.escape(identity.value)}"]`)];
  if (matches.length !== 1) return null;
  return matches[0]!.matches(MESSAGE_SELECTOR)
    ? matches[0]!
    : matches[0]!.querySelector<HTMLElement>(MESSAGE_SELECTOR);
}
