import type { YadaTurn } from "./types";

const DIRECT_COMPOSER_SELECTOR = [
  "textarea",
  "input",
  "form",
  "#prompt-textarea",
  '[id*="prompt-textarea" i]',
  '[data-testid*="composer" i]',
  '[data-testid*="prompt-textarea" i]',
  '[data-testid*="send-button" i]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  '[class*="composer" i]',
  '[class*="prompt-textarea" i]'
].join(", ");

const COMPOSER_HINT_SELECTOR = [
  "textarea",
  "input",
  "form",
  "#prompt-textarea",
  '[id*="prompt-textarea" i]',
  '[data-testid*="composer" i]',
  '[data-testid*="prompt-textarea" i]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  '[class*="composer" i]',
  '[class*="prompt-textarea" i]',
  ".ProseMirror"
].join(", ");

const DRAFT_CONTROL_SELECTOR = [
  "textarea",
  "input",
  "#prompt-textarea",
  '[id*="prompt-textarea" i]',
  '[data-testid*="prompt-textarea" i]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  ".ProseMirror"
].join(", ");

export function isComposerElement(element: Element | null | undefined): boolean {
  if (!(element instanceof Element)) return false;
  if (element.matches(DIRECT_COMPOSER_SELECTOR)) return true;

  const className = String(element.getAttribute("class") ?? "");
  if (/\bProseMirror\b/i.test(className) && hasComposerAncestor(element)) return true;
  if (/prompt/i.test(className) && hasComposerEvidence(element)) return true;
  if (isStickyBottomComposerContainer(element)) return true;
  return false;
}

export function isInsideComposer(element: Element | null | undefined): boolean {
  if (!(element instanceof Element)) return false;
  if (element.closest(DIRECT_COMPOSER_SELECTOR)) return true;

  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    if (isComposerElement(current)) return true;
    current = current.parentElement;
  }

  return false;
}

export function isComposerDraftTurn(turn: YadaTurn | null | undefined): boolean {
  if (!turn) return false;
  if (turn.isComposerDraft === true) return true;
  if (turn.anchorSource === "composer" || turn.anchorMappingReason === "composer") return true;

  const elements = [
    turn.anchorElement,
    turn.userAnchorElement,
    turn.assistantAnchorElement,
    ...(turn.groupElements ?? [])
  ];
  return elements.some((element) => element instanceof Element && isInsideComposer(element));
}

export function filterComposerDraftTurns(turns: readonly YadaTurn[]): YadaTurn[] {
  let nextIndex = 0;
  return turns
    .filter((turn) => !isComposerDraftTurn(turn))
    .map((turn) => {
      const index = nextIndex;
      nextIndex += 1;
      return {
        ...turn,
        index,
        globalIndex: index,
        displayNumber: index + 1
      };
    });
}

export function countComposerElements(root: ParentNode = document): number {
  try {
    return Array.from(root.querySelectorAll(COMPOSER_HINT_SELECTOR))
      .filter((element) => isComposerElement(element) || isInsideComposer(element)).length;
  } catch {
    return 0;
  }
}

export function hasUnsentComposerDraft(root: ParentNode = document): boolean {
  try {
    for (const node of root.querySelectorAll(DRAFT_CONTROL_SELECTOR)) {
      if (!(node instanceof HTMLElement)) continue;
      if (!isComposerElement(node) && !isInsideComposer(node)) continue;
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        if (node.value.trim()) return true;
        continue;
      }
      if ((node.innerText || node.textContent || "").trim()) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function hasComposerAncestor(element: Element): boolean {
  return Boolean(element.closest([
    "form",
    "#prompt-textarea",
    '[id*="prompt-textarea" i]',
    '[data-testid*="composer" i]',
    '[data-testid*="prompt-textarea" i]',
    '[class*="composer" i]',
    '[class*="prompt-textarea" i]'
  ].join(", ")));
}

function hasComposerEvidence(element: Element): boolean {
  return hasComposerAncestor(element)
    || Boolean(element.querySelector(DRAFT_CONTROL_SELECTOR))
    || isStickyBottomComposerContainer(element);
}

function isStickyBottomComposerContainer(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (!element.querySelector(DRAFT_CONTROL_SELECTOR)) return false;

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const nearBottom = rect.bottom >= window.innerHeight - 180 && rect.top >= window.innerHeight * 0.35;
  const compactEnough = rect.height > 0 && rect.height <= Math.max(460, window.innerHeight * 0.55);
  const positionedAtBottom = style.position === "fixed" || style.position === "sticky";

  return (positionedAtBottom || nearBottom) && compactEnough;
}
