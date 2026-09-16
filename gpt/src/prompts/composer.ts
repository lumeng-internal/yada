type Composer = HTMLTextAreaElement | HTMLElement;
export type ComposerSelection = { element: Composer; text: string; range?: Range; start?: number; end?: number };
function usable(element: HTMLElement): boolean {
  return !element.closest('[data-yada-root]') && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== "hidden"
    && (element instanceof HTMLTextAreaElement ? !element.disabled && !element.readOnly : element.isContentEditable);
}
export function findComposer(): Composer | null {
  for (const selector of ['#prompt-textarea', '[contenteditable="true"][role="textbox"]', '.ProseMirror', 'textarea, [contenteditable="true"]']) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(usable);
    if (found) return found;
  }
  return null;
}
function textOf(element: Composer): string {
  return element instanceof HTMLTextAreaElement ? element.value : element.innerText;
}
export function captureComposerSelection(): ComposerSelection | null {
  const element = findComposer();
  if (!element) return null;
  if (element instanceof HTMLTextAreaElement) {
    return document.activeElement === element ? { element, text: element.value, start: element.selectionStart, end: element.selectionEnd } : null;
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.startContainer) && element.contains(range.endContainer)
    ? { element, text: textOf(element), range: range.cloneRange() } : null;
}
export function insertPrompt(content: string, saved: ComposerSelection | null = null): boolean {
  const element = findComposer();
  if (!element) return false;
  const before = textOf(element);
  const bookmark = saved?.element === element && saved.text === before ? saved : captureComposerSelection();
  const hasRange = bookmark?.element === element && (element instanceof HTMLTextAreaElement
    ? bookmark.start !== undefined : !!bookmark.range && element.contains(bookmark.range.startContainer) && element.contains(bookmark.range.endContainer));
  const insertion = !hasRange && before.trim() ? `\n\n${content}` : content;
  element.focus();
  let range: Range | undefined;
  if (element instanceof HTMLTextAreaElement) {
    element.setSelectionRange(hasRange ? bookmark!.start! : before.length, hasRange ? bookmark!.end! : before.length);
  } else {
    range = hasRange ? bookmark!.range!.cloneRange() : document.createRange();
    if (!hasRange) { range.selectNodeContents(element); range.collapse(false); }
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
  }
  // Native editing preserves undo and lets the editor process its normal input transaction.
  try {
    if (document.execCommand("insertText", false, insertion) || textOf(element) !== before) return true;
  } catch { /* Native editing unavailable: use a minimal plain-text fallback. */ }
  const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: insertion });
  if (!element.dispatchEvent(event)) return textOf(element) !== before;
  if (element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart, end = element.selectionEnd;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, before.slice(0, start) + insertion + before.slice(end));
    element.setSelectionRange(start + insertion.length, start + insertion.length);
  } else if (range) {
    range.deleteContents();
    const node = document.createTextNode(insertion);
    range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  }
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: insertion }));
  return true;
}
