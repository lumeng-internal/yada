/* Native-TOC yielding adapted from loongphy's MIT chatgpt-always-toc.user.js.
 * Whole-document visibility/observer are Yada adapters. See THIRD_PARTY_NOTICES.md. */
export const OFFICIAL_SELECTOR = 'button[data-toc-item-index], button[data-toc-active]';
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
  // Yield as soon as one native marker is visible, without measuring the entire TOC.
  for (const button of document.querySelectorAll<HTMLButtonElement>(OFFICIAL_SELECTOR)) {
    if (visible(button)) return { ready: true };
  }
  return { ready: false };
}
export function observeOfficialNavigation(sync: () => void): () => void {
  let raf = 0;
  const check = (): void => { sync(); cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); };
  const observer = new MutationObserver(records => {
    if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-yada-root]')))) check();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-toc-item-index', 'data-toc-active', 'class', 'style', 'hidden', 'aria-hidden'] });
  window.addEventListener('resize', check, { passive: true });
  window.addEventListener('scroll', check, { capture: true, passive: true });
  check();
  return () => { observer.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('resize', check); window.removeEventListener('scroll', check, true); };
}
