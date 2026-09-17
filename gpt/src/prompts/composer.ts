type Composer = HTMLTextAreaElement | HTMLElement;
export type ComposerSelection = { element: Composer; text: string; range?: Range; rangeStart?: Node; rangeEnd?: Node; rangeStartOffset?: number; rangeEndOffset?: number; start?: number; end?: number };
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
  if (document.activeElement !== element && !element.contains(document.activeElement)) return null;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return element.contains(range.startContainer) && element.contains(range.endContainer)
    ? { element, text: textOf(element), range: range.cloneRange(), rangeStart: range.startContainer, rangeEnd: range.endContainer, rangeStartOffset: range.startOffset, rangeEndOffset: range.endOffset } : null;
}
export function insertPrompt(content: string, saved: ComposerSelection | null = null): boolean {
  const element = findComposer();
  if (!element) return false;
  const before = textOf(element);
  const bookmark = saved ? (saved.element === element && saved.text === before ? saved : null) : captureComposerSelection();
  const hasRange = bookmark?.element === element && (element instanceof HTMLTextAreaElement
    ? bookmark.start !== undefined : !!bookmark.range && element.contains(bookmark.range.startContainer) && element.contains(bookmark.range.endContainer)
      && bookmark.range.startContainer === bookmark.rangeStart && bookmark.range.endContainer === bookmark.rangeEnd
      && bookmark.range.startOffset === bookmark.rangeStartOffset && bookmark.range.endOffset === bookmark.rangeEndOffset);
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
  } catch { /* Refuse a non-undoable DOM rewrite; leave the draft intact. */ }
  return false;
}

/** Wait for remounts, then re-query immediately before a single native edit. */
export async function insertPromptWhenReady(content: string, saved: ComposerSelection | null, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  if (!findComposer()) {
    await new Promise<void>(resolve => {
      let timer = 0;
      const finish = (): void => { observer.disconnect(); clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const observer = new MutationObserver(() => { if (findComposer()) finish(); });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable', 'disabled', 'hidden', 'style'] });
      signal.addEventListener('abort', finish, { once: true });
      timer = window.setTimeout(finish, 2000);
      if (signal.aborted || findComposer()) finish();
    });
  }
  return !signal.aborted && insertPrompt(content, saved);
}
