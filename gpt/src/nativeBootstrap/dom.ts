import { SENTINEL_TEST_ID } from "./shared";

const EXPOSE_STYLES: Array<{ property: string; value: string; priority: string }> = [
  { property: "position", value: "sticky", priority: "important" },
  { property: "top", value: "80px", priority: "important" },
  { property: "opacity", value: "0", priority: "important" },
  { property: "pointer-events", value: "none", priority: "important" }
];

interface SavedProperty {
  property: string;
  previousValue: string;
  previousPriority: string;
  appliedValue: string;
  appliedPriority: string;
}

interface ExposedSentinel {
  element: HTMLElement;
  saved: SavedProperty[];
}

let exposed: ExposedSentinel | null = null;

export function paginationSentinels(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-testid="${SENTINEL_TEST_ID}"], [data-testid*="${SENTINEL_TEST_ID}"]`)]
    .filter(node => node.isConnected);
}

export function conversationScrollContainer(from: Element | null = paginationSentinels()[0] ?? null): HTMLElement | null {
  let current: Element | null = from?.parentElement ?? document.querySelector("main");
  while (current instanceof HTMLElement) {
    const style = getComputedStyle(current);
    const overflowY = String(style.overflowY);
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && current.scrollHeight > current.clientHeight + 1) {
      return current;
    }
    current = current.parentElement;
  }
  const scrolling = document.scrollingElement;
  return scrolling instanceof HTMLElement ? scrolling : document.documentElement;
}

export function exposePaginationSentinel(): HTMLElement | null {
  restorePaginationSentinel();
  const sentinels = paginationSentinels();
  if (sentinels.length !== 1) return null;
  const element = sentinels[0];
  const saved: SavedProperty[] = EXPOSE_STYLES.map(rule => {
    const previousValue = element.style.getPropertyValue(rule.property);
    const previousPriority = element.style.getPropertyPriority(rule.property);
    element.style.setProperty(rule.property, rule.value, rule.priority);
    return {
      property: rule.property,
      previousValue,
      previousPriority,
      appliedValue: rule.value,
      appliedPriority: rule.priority
    };
  });
  exposed = { element, saved };
  return element;
}

export function restorePaginationSentinel(element?: HTMLElement | null): void {
  const current = exposed;
  if (!current) return;
  if (element && element !== current.element) return;
  restoreOwnedStyles(current.element, current.saved);
  exposed = null;
}

export function restoreOwnedStyles(element: HTMLElement, saved: SavedProperty[]): void {
  for (const item of saved) {
    if (!element.isConnected) continue;
    const value = element.style.getPropertyValue(item.property);
    const priority = element.style.getPropertyPriority(item.property);
    if (value !== item.appliedValue || priority !== item.appliedPriority) continue;
    if (!item.previousValue && !item.previousPriority) {
      element.style.removeProperty(item.property);
      continue;
    }
    element.style.setProperty(item.property, item.previousValue, item.previousPriority);
  }
}

export function isSentinelExposed(element: HTMLElement | null = exposed?.element ?? null): boolean {
  return Boolean(exposed && element === exposed.element);
}

export interface ReadAnchor {
  id: string;
  offset: number;
  container: HTMLElement;
}

const ANCHOR_SELECTORS = ["[data-message-id]", "[data-turn-id]", "[data-turn-id-container]"];
const ANCHOR_ATTRS = ["data-message-id", "data-turn-id", "data-turn-id-container"];

export function captureReadAnchor(container: HTMLElement | null = conversationScrollContainer()): ReadAnchor | null {
  if (!container?.isConnected) return null;
  const cRect = container.getBoundingClientRect();
  for (const selector of ANCHOR_SELECTORS) {
    const nodes = container.querySelectorAll<HTMLElement>(selector);
    for (const node of nodes) {
      const id = ANCHOR_ATTRS.map(attr => node.getAttribute(attr)).find(value => value && value.trim());
      if (!id) continue;
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= cRect.top || rect.top >= cRect.bottom) continue;
      return { id, offset: rect.top - cRect.top, container };
    }
  }
  return null;
}

export function readAnchorOffset(anchor: ReadAnchor): number | null {
  if (!anchor.container.isConnected) return null;
  for (const attr of ANCHOR_ATTRS) {
    const node = anchor.container.querySelector<HTMLElement>(`[${attr}="${cssEscape(anchor.id)}"]`);
    if (!node) continue;
    return node.getBoundingClientRect().top - anchor.container.getBoundingClientRect().top;
  }
  return null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
