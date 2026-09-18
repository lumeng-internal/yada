const PROMPT_LABEL = /^Prompt\s+\d+/i;

export const OFFICIAL_BUTTON_SELECTOR = [
  "button[data-toc-item-index]",
  "button[data-toc-active]",
  'button[aria-label^="Prompt " i]',
  'button[aria-description^="Prompt " i]',
  '[role="button"][aria-label^="Prompt " i]',
  '[role="button"][aria-description^="Prompt " i]'
].join(", ");

export function isOfficialNavItem(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const index = element.getAttribute("data-toc-item-index");
  if (index != null && index.trim() !== "" && Number.isInteger(Number(index))) return true;
  const label = element.getAttribute("aria-label") ?? "";
  const description = element.getAttribute("aria-description") ?? "";
  return PROMPT_LABEL.test(label) || PROMPT_LABEL.test(description);
}

export function officialButtons(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(OFFICIAL_BUTTON_SELECTOR)].filter(isOfficialNavItem);
}

export function uniqueOfficialCount(root: ParentNode = document): number {
  const keys = new Set<string>();
  let extras = 0;
  for (const button of officialButtons(root)) {
    const attr = button.getAttribute("data-toc-item-index");
    if (attr != null && attr.trim() !== "" && Number.isInteger(Number(attr))) {
      keys.add(`i:${Number(attr)}`);
      continue;
    }
    const text = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("aria-description") ?? ""}`;
    const prompt = text.match(/Prompt\s+(\d+)/i);
    if (prompt) {
      keys.add(`i:${Number(prompt[1]) - 1}`);
      continue;
    }
    extras += 1;
  }
  return keys.size + extras;
}

export function closestOfficialButton(target: EventTarget | null): HTMLElement | null {
  const node = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const found = node?.closest<HTMLElement>(OFFICIAL_BUTTON_SELECTOR);
  return found && isOfficialNavItem(found) ? found : null;
}

export function resolveOfficialTurnIndex(button: HTMLElement, turnCount: number): number | null {
  if (turnCount <= 0) return null;

  const attr = parseIndex(button.getAttribute("data-toc-item-index"));
  if (attr != null && attr >= 0 && attr < turnCount) return attr;

  const buttons = officialButtons(button.ownerDocument ?? document);
  if (buttons.length === turnCount) {
    const order = buttons.indexOf(button);
    if (order >= 0) return order;
  }

  return accessibleIndex(button, turnCount);
}

function parseIndex(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function accessibleIndex(button: HTMLElement, turnCount: number): number | null {
  const text = [
    button.getAttribute("aria-label"),
    button.getAttribute("aria-description"),
    button.getAttribute("title"),
    button.textContent
  ]
    .filter((value): value is string => !!value && value.trim().length > 0)
    .join(" ");
  const prompt = text.match(/Prompt\s+(\d+)/i);
  if (prompt) {
    const index = Number(prompt[1]) - 1;
    return index >= 0 && index < turnCount ? index : null;
  }
  const numbers = [...text.matchAll(/\d+/g)].map(match => Number(match[0]));
  if (!numbers.length) return null;

  const candidates = numbers.length >= 2 && numbers[numbers.length - 1] === turnCount
    ? numbers.slice(0, -1)
    : numbers;
  const indexes = [...new Set(candidates.flatMap(n => n >= 1 && n <= turnCount ? [n - 1] : []))];
  return indexes.length === 1 ? indexes[0] : null;
}
