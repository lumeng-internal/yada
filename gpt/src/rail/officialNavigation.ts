/* Native-TOC yielding adapted from loongphy's MIT chatgpt-always-toc.user.js.
 * Whole-document visibility/observer are Yada adapters. See THIRD_PARTY_NOTICES.md. */
export const OFFICIAL_SELECTOR = 'button[data-toc-item-index], button[data-toc-active]';
export type OfficialSyncPhase = 'immediate' | 'confirm';
export function hasOfficialNavigationButtons(): boolean {
  return !!document.querySelector(OFFICIAL_SELECTOR);
}
export function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hidden || current.getAttribute('aria-hidden') === 'true' || style.display === 'none'
      || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    if (current === element || style.position === 'fixed') {
      const r = current.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    }
  }
  return true;
}
export function officialButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(OFFICIAL_SELECTOR)].filter(visible);
}
export function readChatGPTOfficialNavigation(): { ready: boolean } {
  for (const button of document.querySelectorAll<HTMLButtonElement>(OFFICIAL_SELECTOR)) {
    if (visible(button)) return { ready: true };
  }
  return { ready: false };
}
function addedOfficialButton(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof Element && record.target.matches(OFFICIAL_SELECTOR)) return true;
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches(OFFICIAL_SELECTOR) || node.querySelector(OFFICIAL_SELECTOR)) return true;
    }
  }
  return false;
}
export function observeOfficialNavigation(sync: (phase: OfficialSyncPhase) => void): () => void {
  let raf = 0;
  const confirm = (): void => { sync('confirm'); };
  const check = (phase: OfficialSyncPhase): void => {
    sync(phase);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(confirm);
  };
  const observer = new MutationObserver(records => {
    if (records.every(record => record.target instanceof Element && record.target.closest('[data-yada-root]'))) return;
    check(addedOfficialButton(records) ? 'immediate' : 'confirm');
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-toc-item-index', 'data-toc-active', 'class', 'style', 'hidden', 'aria-hidden'] });
  window.addEventListener('resize', confirm, { passive: true });
  window.addEventListener('scroll', confirm, { capture: true, passive: true });
  check('confirm');
  return () => { observer.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('resize', confirm); window.removeEventListener('scroll', confirm, true); };
}
