/* Page structure facts for ChatGPT. Identity and generation adapt both the
 * legacy role attributes and the 2026 search-unit / turn-wrapper shape
 * documented by AI-MarkDone 6.0.0 (8269364d7162712d1eb45a27937e00116f8e1ca7).
 * This module does not download conversations, store bodies, or compute quota.
 */

export type MessageRole = "user" | "assistant" | "unknown";

export type StableIdentity = {
  attribute: string;
  value: string;
};

export type PageMessage = {
  id: string;
  role: MessageRole;
  element: HTMLElement;
  identity: StableIdentity;
};

export type GenerationState = {
  generating: boolean;
  evidence: "stop-button" | "streaming-attr" | "none";
};

export type NativePromptState = {
  found: number;
  visible: number;
  root: HTMLElement | null;
  container: HTMLElement | null;
  available: boolean;
  indexes: number[];
};

export type NativeActionGroup = {
  container: HTMLElement;
  buttons: HTMLElement[];
};

export type ReadingPosition = {
  identity: StableIdentity | null;
  element: HTMLElement;
  offset: number;
  scroller: HTMLElement;
};

export const CONVERSATION_SURFACE_SELECTOR = "main, [role='main']";
export const GENERATION_STOP_SELECTOR = 'button[data-testid="stop-button"]';
export const STREAMING_ATTR_SELECTOR = [
  '[data-is-streaming="true"]',
  '[data-message-author-role="assistant"].result-streaming',
  '[data-stream-active="true"]'
].join(", ");
export const PAGE_IDENTITY_ATTRIBUTES = [
  "data-message-id",
  "data-chatgpt-search-message-ids",
  "data-chatgpt-search-unit-key",
  "data-turn-id",
  "data-turn-id-container",
  "data-turn-key",
  "data-content-search-turn-key",
  "data-message-author-role",
  "data-conversation-role",
  "data-user-message-bubble",
  "data-app-action-timeline-scroll",
  "data-turn",
  "data-is-streaming",
  "data-testid"
] as const;

const LEGACY_OFFICIAL_ROOT_SELECTOR = [
  'main [class$="_convSearchResultHighlightRoot"]',
  'main [class*="_convSearchResultHighlightRoot "]'
].join(",");
const LEGACY_OFFICIAL_CONTAINER_TOKENS = ["fixed", "inset-e-4", "top-1/2", "z-20", "-translate-y-1/2"];
const SENTINEL_SELECTOR = '[data-testid="conversation-pagination-sentinel"]';
const HEADER_SEARCH_SELECTORS = [
  '[data-testid="app-shell-header-context-menu-surface"]',
  "#page-header",
  "#conversation-header-actions",
  '[data-testid="conversation-header-actions"]',
  "header",
  '[role="banner"]'
];
const YADA_ROOT_SELECTOR = "[data-yada-root]";
const COMPOSER_SELECTOR = 'form, #prompt-textarea, [data-composer-markdown], [name="prompt-textarea"]';
const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]';
const INDEX_IDENTITY_ATTRIBUTES = [
  "data-message-id",
  "data-turn-id",
  "data-turn-id-container",
  "data-turn-key",
  "data-content-search-turn-key"
] as const;

export function conversationSurface(root: ParentNode = document): HTMLElement | null {
  const scoped = root.querySelector<HTMLElement>(CONVERSATION_SURFACE_SELECTOR);
  if (scoped) return scoped;
  if (root instanceof HTMLElement && root.matches(CONVERSATION_SURFACE_SELECTOR)) return root;
  return document.querySelector<HTMLElement>(CONVERSATION_SURFACE_SELECTOR);
}

export function conversationDomId(root: ParentNode = document): string | null {
  return root.querySelector<HTMLElement>("[data-conversation-id]")?.dataset.conversationId ?? null;
}

export function readGenerationState(root: ParentNode = document): GenerationState {
  const scope = root instanceof Document ? root : root;
  if (scope.querySelector(GENERATION_STOP_SELECTOR)) {
    return { generating: true, evidence: "stop-button" };
  }
  if (scope.querySelector(STREAMING_ATTR_SELECTOR)) {
    return { generating: true, evidence: "streaming-attr" };
  }
  return { generating: false, evidence: "none" };
}

export function isGenerating(root: ParentNode = document): boolean {
  return readGenerationState(root).generating;
}

export function collectPageMessages(root: ParentNode = document): PageMessage[] {
  const surface = conversationSurface(root) ?? root;
  const seen = new Set<string>();
  const messages: PageMessage[] = [];
  const nodes = surface.querySelectorAll<HTMLElement>([
    "[data-message-id]",
    "[data-user-message-bubble]",
    "[data-chatgpt-search-message-ids]",
    '[data-chatgpt-search-unit-key$=":assistant"]',
    '[data-chatgpt-search-unit-key$=":user"]',
    '[data-message-author-role="assistant"]',
    '[data-message-author-role="user"]',
    'article[data-turn="assistant"]',
    'article[data-turn="user"]',
    'section[data-turn="assistant"]',
    'section[data-turn="user"]',
    "[data-turn-id]",
    "[data-turn-id-container]"
  ].join(","));
  for (const node of nodes) {
    if (node.closest(YADA_ROOT_SELECTOR)) continue;
    if (shouldDeferToDescendantMessage(node)) continue;
    const identity = stableMessageIdentity(node);
    if (!identity) continue;
    if (seen.has(identity.value)) continue;
    const role = readMessageRole(node);
    if (role === "unknown") continue;
    seen.add(identity.value);
    messages.push({ id: identity.value, role, element: node, identity });
  }
  return messages;
}

export function collectCompletedAssistantIds(root: ParentNode = document): string[] {
  const messages = collectPageMessages(root);
  const generating = isGenerating(root);
  const activeId = generating
    ? [...messages].reverse().find((message) => message.role === "assistant")?.id
    : null;
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (isMessageStreaming(message.element)) continue;
    if (activeId && message.id === activeId) continue;
    ids.push(message.id);
  }
  return ids;
}

export function conversationScroller(root: ParentNode = document): HTMLElement | null {
  const surface = conversationSurface(root) ?? (root instanceof HTMLElement ? root : document.body);
  const timeline = surface.querySelector<HTMLElement>("[data-app-action-timeline-scroll]");
  if (timeline?.isConnected && timeline.scrollHeight > timeline.clientHeight) return timeline;
  const seed = collectPageMessages(surface)[0]?.element
    ?? surface.querySelector<HTMLElement>("[data-message-author-role], [data-chatgpt-search-unit-key], [data-turn], [data-message-id], article")
    ?? (surface instanceof HTMLElement ? surface : null);
  if (!seed) return document.scrollingElement as HTMLElement | null;
  let ancestor: HTMLElement | null = seed.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    const overflowY = style.overflowY;
    const canScroll = overflowY.includes("auto") || overflowY.includes("scroll") || overflowY.includes("overlay");
    if (canScroll && ancestor.scrollHeight > ancestor.clientHeight) {
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

export function stableLayoutAvailable(root: ParentNode = document): boolean {
  const scroller = conversationScroller(root);
  return Boolean(scroller?.isConnected) && !isGenerating(root);
}

export function safeDesktopLayout(root: ParentNode = document): boolean {
  return document.visibilityState === "visible"
    && innerWidth >= 1024
    && matchMedia("(hover: hover)").matches
    && stableLayoutAvailable(root);
}

export function saveReadingPosition(root: ParentNode = document): ReadingPosition | null {
  const scroller = conversationScroller(root);
  if (!scroller) return null;
  const top = viewportTop(scroller);
  const bottom = Math.min(innerHeight, top + scroller.clientHeight);
  const onScreen = visibleConversationNodes(root).filter((node) => {
    const rectangle = node.getBoundingClientRect();
    return rectangle.bottom > top + 8 && rectangle.top < bottom - 8;
  });
  const anchor = onScreen.find((node) => node.getBoundingClientRect().top >= top) ?? onScreen[0];
  if (!anchor) return null;
  return {
    identity: stableMessageIdentity(anchor),
    element: anchor,
    offset: anchor.getBoundingClientRect().top - top,
    scroller
  };
}

export function readingPositionDrift(position: ReadingPosition, root: ParentNode = document): number | null {
  if (!position.scroller.isConnected || conversationScroller(root) !== position.scroller) return null;
  let anchor: HTMLElement | null = position.element.isConnected ? position.element : null;
  if (position.identity) anchor = findStableMessage(position.identity, root);
  if (!anchor) return null;
  return anchor.getBoundingClientRect().top - viewportTop(position.scroller) - position.offset;
}

export function readOfficialNavigator(root: ParentNode = document): NativePromptState {
  const legacy = readLegacyOfficialNavigator(root);
  if (legacy.available) return legacy;
  return readIndexedOfficialNavigator(root);
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

export function findNativeActionGroup(root: ParentNode = document): NativeActionGroup | null {
  const regions: HTMLElement[] = [];
  for (const selector of HEADER_SEARCH_SELECTORS) {
    for (const node of root.querySelectorAll<HTMLElement>(selector)) {
      if (node.closest(YADA_ROOT_SELECTOR) || node.closest(COMPOSER_SELECTOR)) continue;
      if (!regions.includes(node)) regions.push(node);
    }
  }
  for (const region of regions) {
    const known = asKnownActionContainer(region);
    if (known) return known;
    const buttons = visibleHeaderButtons(region);
    if (buttons.length === 0) continue;
    const container = commonLayoutAncestor(buttons);
    if (!container || container.closest(YADA_ROOT_SELECTOR) || container.closest(COMPOSER_SELECTOR)) continue;
    return { container, buttons };
  }
  return null;
}

export function nativeActionObstacles(group: NativeActionGroup): HTMLElement[] {
  const title = group.container.closest("header, [role='banner'], #page-header")
    ?.querySelector<HTMLElement>("h1, h2, [data-testid='conversation-title'], [data-testid='conversation-turn-header']");
  const obstacles = [...group.buttons];
  if (title && !obstacles.includes(title)) obstacles.push(title);
  return obstacles;
}

export function stableMessageIdentity(element: HTMLElement): StableIdentity | null {
  let node: HTMLElement | null = element;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    const searchIds = node.getAttribute("data-chatgpt-search-message-ids")?.trim().split(/\s+/).filter(Boolean);
    if (searchIds?.length && searchIds.every((id) => id === searchIds[0]) && searchIds[0]!.length <= 256) {
      return { attribute: "data-chatgpt-search-message-ids", value: searchIds[0]! };
    }
    for (const attribute of INDEX_IDENTITY_ATTRIBUTES) {
      const value = node.getAttribute(attribute)?.trim();
      if (value && value.length <= 256) return { attribute, value };
    }
    if (node.tagName === "ARTICLE" || node.tagName === "MAIN") break;
  }
  return null;
}

function readLegacyOfficialNavigator(root: ParentNode): NativePromptState {
  const candidates = [...root.querySelectorAll<HTMLElement>(LEGACY_OFFICIAL_ROOT_SELECTOR)];
  if (candidates.length !== 1) return emptyNativePromptState();
  const container = [...candidates[0]!.children].find((child): child is HTMLElement =>
    child instanceof HTMLElement
    && LEGACY_OFFICIAL_CONTAINER_TOKENS.every((token) => child.classList.contains(token))
    && !child.closest(YADA_ROOT_SELECTOR)
  );
  if (!container || !layoutVisible(candidates[0]!, false) || !layoutVisible(container, true)) {
    return emptyNativePromptState();
  }
  return navigatorFromButtons(container, candidates[0]!);
}

function readIndexedOfficialNavigator(root: ParentNode): NativePromptState {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")].filter((button) => {
    if (button.closest(YADA_ROOT_SELECTOR) || button.closest(OVERLAY_SELECTOR) || button.closest(COMPOSER_SELECTOR)) {
      return false;
    }
    return readPromptIndex(button) !== null;
  });
  if (!buttons.length) return emptyNativePromptState();

  const groups = new Map<HTMLElement, HTMLButtonElement[]>();
  for (const button of buttons) {
    const container = indexedNavigatorContainer(button);
    if (!container) continue;
    const list = groups.get(container) ?? [];
    list.push(button);
    groups.set(container, list);
  }

  const matches: NativePromptState[] = [];
  for (const [container, group] of groups) {
    if (!layoutVisible(container, true) || !isRightRail(container)) continue;
    const state = navigatorFromButtons(container, container);
    if (state.available && state.found === group.length) matches.push(state);
  }
  return matches.length === 1 ? matches[0]! : emptyNativePromptState();
}

function navigatorFromButtons(container: HTMLElement, root: HTMLElement): NativePromptState {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.closest(YADA_ROOT_SELECTOR));
  const indexes = buttons.map(readPromptIndex);
  if (!indexes.length || indexes.some((index) => index === null)) return emptyNativePromptState();
  const numeric = indexes as number[];
  if (new Set(numeric).size !== numeric.length) return emptyNativePromptState();
  const first = Math.min(...numeric);
  const ordered = [...numeric].map((index) => index - (first === 1 ? 1 : 0)).sort((left, right) => left - right);
  if (!ordered.every((index, position) => index === position)) return emptyNativePromptState();
  return {
    found: buttons.length,
    visible: buttons.filter((button) => layoutVisible(button, true)).length,
    root,
    container,
    available: buttons.length > 0,
    indexes: numeric
  };
}

function indexedNavigatorContainer(button: HTMLButtonElement): HTMLElement | null {
  let node: HTMLElement | null = button.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (style.position === "fixed" || style.position === "absolute" || style.position === "sticky") return node;
    node = node.parentElement;
  }
  return button.parentElement;
}

function isRightRail(element: HTMLElement): boolean {
  const rectangle = element.getBoundingClientRect();
  if (rectangle.width <= 0 || rectangle.height <= 0) return false;
  return rectangle.left > innerWidth * 0.55 && rectangle.right <= innerWidth + 1;
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

function emptyNativePromptState(): NativePromptState {
  return { found: 0, visible: 0, root: null, container: null, available: false, indexes: [] };
}

function layoutVisible(element: HTMLElement, requireRectangle: boolean): boolean {
  if (!element.isConnected || (requireRectangle && element.getClientRects().length === 0)) return false;
  let ancestor: HTMLElement | null = element;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    if (ancestor.hidden
      || ancestor.getAttribute("aria-hidden") === "true"
      || style.visibility === "hidden"
      || style.display === "none"
      || (style.opacity !== "" && Number(style.opacity) === 0)) return false;
    ancestor = ancestor.parentElement;
  }
  if (!requireRectangle) return true;
  const rectangle = element.getBoundingClientRect();
  return rectangle.width > 0
    && rectangle.height > 0
    && rectangle.right > 0
    && rectangle.left < innerWidth
    && rectangle.bottom > 0
    && rectangle.top < innerHeight;
}

function findStableMessage(identity: StableIdentity, root: ParentNode): HTMLElement | null {
  const escaped = escapeAttributeValue(identity.value);
  const matches = identity.attribute === "data-chatgpt-search-message-ids"
    ? [...root.querySelectorAll<HTMLElement>(`[data-chatgpt-search-message-ids]`)]
      .filter((node) => node.getAttribute("data-chatgpt-search-message-ids")?.trim().split(/\s+/).includes(identity.value))
    : [...root.querySelectorAll<HTMLElement>(`[${identity.attribute}="${escaped}"]`)];
  if (matches.length !== 1) return null;
  return matches[0]!;
}

function escapeAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\");
}

function readMessageRole(element: HTMLElement): MessageRole {
  let node: HTMLElement | null = element;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    if (node.hasAttribute("data-user-message-bubble")) return "user";
    const marker = node.matches("[data-conversation-role]") ? node : node.querySelector("[data-conversation-role]");
    const role = marker?.getAttribute("data-conversation-role");
    if (role === "user" || role === "assistant") return role;
    const author = node.getAttribute("data-message-author-role");
    if (author === "user" || author === "assistant") return author;
    const turn = node.getAttribute("data-turn");
    if (turn === "user" || turn === "assistant") return turn;
    const unit = node.getAttribute("data-chatgpt-search-unit-key") ?? "";
    if (unit.endsWith(":assistant")) return "assistant";
    if (unit.endsWith(":user")) return "user";
    if (node.tagName === "MAIN") break;
  }
  const heading = element.querySelector("h1, h2, h3, h4, h5")?.textContent?.trim() ?? "";
  if (/^(chatgpt|assistant)$/i.test(heading)) return "assistant";
  if (/^(you|你)$/i.test(heading)) return "user";
  return "unknown";
}

function isMessageStreaming(element: HTMLElement): boolean {
  return element.getAttribute("data-is-streaming") === "true"
    || element.classList.contains("result-streaming")
    || element.getAttribute("data-stream-active") === "true"
    || Boolean(element.closest(STREAMING_ATTR_SELECTOR));
}

function visibleConversationNodes(root: ParentNode): HTMLElement[] {
  const identified = collectPageMessages(root).map((message) => message.element);
  if (identified.length) return identified;
  const surface = conversationSurface(root) ?? root;
  return [...surface.querySelectorAll<HTMLElement>("[data-message-author-role], article[data-turn], [data-chatgpt-search-unit-key]")];
}

function shouldDeferToDescendantMessage(node: HTMLElement): boolean {
  if (node.hasAttribute("data-message-id") || node.hasAttribute("data-chatgpt-search-message-ids")) return false;
  return Boolean(node.querySelector("[data-message-id], [data-chatgpt-search-message-ids]"));
}

function asKnownActionContainer(region: HTMLElement): NativeActionGroup | null {
  const known = region.id === "conversation-header-actions"
    || region.getAttribute("data-testid") === "conversation-header-actions";
  if (!known) return null;
  const container = skipContents(region);
  if (!container) return null;
  return { container, buttons: visibleHeaderButtons(container) };
}

function visibleHeaderButtons(region: HTMLElement): HTMLElement[] {
  return [...region.querySelectorAll<HTMLElement>("button, [role='button']")].filter((element) => {
    if (element.closest(YADA_ROOT_SELECTOR) || element.closest(COMPOSER_SELECTOR)) return false;
    const rectangle = element.getBoundingClientRect();
    if (rectangle.width === 0 && rectangle.height === 0) {
      return region.id === "conversation-header-actions"
        || region.getAttribute("data-testid") === "conversation-header-actions"
        || region.id === "page-header";
    }
    return rectangle.width >= 8 && rectangle.height >= 8 && rectangle.top < 160;
  });
}

function commonLayoutAncestor(elements: HTMLElement[]): HTMLElement | null {
  if (!elements.length) return null;
  let ancestor: HTMLElement | null = skipContents(elements[0]!.parentElement);
  while (ancestor) {
    if (elements.every((element) => ancestor!.contains(element))) {
      const rectangle = ancestor.getBoundingClientRect();
      const known = ancestor.id === "conversation-header-actions"
        || ancestor.getAttribute("data-testid") === "conversation-header-actions";
      if (known || (rectangle.width > 0 && rectangle.height > 0 && !isContentsWrapper(ancestor))) {
        return ancestor;
      }
    }
    ancestor = skipContents(ancestor.parentElement);
  }
  return null;
}

function skipContents(element: HTMLElement | null): HTMLElement | null {
  let current = element;
  while (current && isContentsWrapper(current)) current = current.parentElement;
  return current;
}

function isContentsWrapper(element: HTMLElement): boolean {
  if (element.tagName === "SPAN" && element.classList.contains("contents")) return true;
  try {
    return getComputedStyle(element).display === "contents";
  } catch {
    return false;
  }
}
