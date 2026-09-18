import { getConversationIdFromUrl } from "../platform/chatgptAdapter";

export const OFFICIAL_BUTTON_SELECTOR = "button[data-toc-item-index], button[data-toc-active]";

export function officialButtons(root: ParentNode = document): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(OFFICIAL_BUTTON_SELECTOR)];
}

export function closestOfficialButton(target: EventTarget | null): HTMLButtonElement | null {
  const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return node?.closest<HTMLButtonElement>(OFFICIAL_BUTTON_SELECTOR) ?? null;
}

export function resolveOfficialTurnIndex(button: HTMLElement, turnCount: number): number | null {
  if (turnCount <= 0) return null;
  const attr = parseIndex(button.getAttribute("data-toc-item-index"));
  if (attr != null && attr >= 0 && attr < turnCount) return attr;
  const buttons = officialButtons(button.ownerDocument ?? document);
  if (buttons.length === turnCount) {
    const order = buttons.indexOf(button as HTMLButtonElement);
    if (order >= 0) return order;
  }
  return accessibleIndex(button, turnCount);
}

export function tryOfficialFastPath(
  turnIndex: number,
  turnCount: number,
  conversationId: string
): boolean {
  if (!conversationId || getConversationIdFromUrl() !== conversationId) return false;
  if (turnCount <= 0 || turnIndex < 0 || turnIndex >= turnCount) return false;
  const buttons = officialButtons();
  if (buttons.length !== turnCount) return false;
  const button = buttons[turnIndex];
  if (!button) return false;
  button.click();
  return true;
}

function parseIndex(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function accessibleIndex(button: HTMLElement, turnCount: number): number | null {
  const text = [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
    .filter((value): value is string => !!value && value.trim().length > 0)
    .join(" ");
  const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (!numbers.length) return null;
  const candidates = numbers.length >= 2 && numbers[numbers.length - 1] === turnCount
    ? numbers.slice(0, -1)
    : numbers;
  const indexes = [...new Set(candidates.flatMap((n) => n >= 1 && n <= turnCount ? [n - 1] : []))];
  return indexes.length === 1 ? indexes[0] : null;
}
