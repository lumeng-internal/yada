import { officialButtons, uniqueOfficialCount } from "../nativePreview/map";
import { DOM_COALESCE_MS, SENTINEL_TEST_ID } from "./shared";

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

export function uniquePaginationSentinel(root: ParentNode = document): HTMLElement | null {
  const sentinels = paginationSentinels(root);
  return sentinels.length === 1 ? sentinels[0] : null;
}

export interface NativeDomSnapshot {
  sentinelCount: number;
  sentinels: HTMLElement[];
  officialCount: number;
  officialButtons: HTMLElement[];
}

const WATCHED_ATTRS = ["data-testid", "data-toc-item-index", "data-toc-active"] as const;

export function readNativeDomSnapshot(root: ParentNode = document): NativeDomSnapshot {
  const sentinels = paginationSentinels(root);
  return {
    sentinelCount: sentinels.length,
    sentinels,
    officialCount: uniqueOfficialCount(root),
    officialButtons: officialButtons(root)
  };
}

function mutationMatters(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type === "attributes") return true;
    if (record.type === "childList") return true;
  }
  return false;
}

export class NativeDomCoordinator {
  private observer: MutationObserver | null = null;
  private coalesceTimer = 0;
  private readonly listeners = new Set<(snapshot: NativeDomSnapshot) => void>();
  private last: NativeDomSnapshot | null = null;

  start(): void {
    if (this.observer || typeof MutationObserver === "undefined") return;
    const root = document.documentElement;
    if (!root) return;
    this.observer = new MutationObserver(records => {
      if (!mutationMatters(records)) return;
      if (this.coalesceTimer) return;
      this.coalesceTimer = window.setTimeout(() => {
        this.coalesceTimer = 0;
        this.emit();
      }, DOM_COALESCE_MS);
    });
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...WATCHED_ATTRS]
    });
    this.emit();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.coalesceTimer) {
      window.clearTimeout(this.coalesceTimer);
      this.coalesceTimer = 0;
    }
    this.listeners.clear();
    this.last = null;
  }

  snapshot(): NativeDomSnapshot {
    return this.last ?? readNativeDomSnapshot();
  }

  subscribe(listener: (snapshot: NativeDomSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.last = readNativeDomSnapshot();
    for (const listener of this.listeners) listener(this.last);
  }
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
