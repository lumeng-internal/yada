/* Skeleton scrolling adapted from loongphy's MIT chatgpt-always-toc.user.js.
 * Copyright (c) loongphy. See THIRD_PARTY_NOTICES.md. */
import { viewport, type ScrollRoot } from './active';
import { findScrollRoot, getTurnEl, type RailEntry } from './nativeSkeleton';
import { officialButtons, visible } from './officialNavigation';

export function headerHeight(root: ScrollRoot): number {
  const area = viewport(root);
  let height = 0;
  for (const node of document.querySelectorAll<HTMLElement>('header, [role="banner"], #page-header, #conversation-header, [data-testid="conversation-header"]')) {
    if (node.closest('[data-yada-root]') || !visible(node)) continue;
    const r = node.getBoundingClientRect(), bounds = root.getBoundingClientRect();
    if (r.right > bounds.left && r.left < bounds.right && r.top <= area.top + 24 && r.bottom > area.top && r.height < area.height / 2) height = Math.max(height, r.bottom - area.top);
  }
  if (height) return height;
  const css = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height'));
  return Number.isFinite(css) && css > 0 ? css : 64;
}
export function targetY(element: HTMLElement, root: ScrollRoot): number {
  return Math.max(0, Math.min(root.scrollHeight - root.clientHeight,
    element.getBoundingClientRect().top - viewport(root).top + root.scrollTop - headerHeight(root) - 16));
}
/** Resolve immediately after the initial scroll; corrections remain cancellable via signal. */
export async function jumpToTurn(entry: RailEntry, entries: readonly RailEntry[], signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  const buttons = officialButtons();
  // Check the complete index sequence before interpreting a coincidental index match.
  const ordinalIndexed = buttons.length > 1 && buttons.every((button, i) => button.dataset.tocItemIndex === String(i))
    && buttons.some((button, i) => Number(button.dataset.tocItemIndex) !== entries[i]?.skeletonIndex);
  const exact = buttons.find(button => button.dataset.tocItemIndex === String(entry.skeletonIndex));
  const native = ordinalIndexed ? buttons[entry.index] : exact ?? buttons[entry.index];
  if (native && !native.disabled && native.getAttribute('aria-disabled') !== 'true') { native.click(); return true; }
  const element = getTurnEl(entry.turnContainerId);
  if (!element) return false;
  let root = findScrollRoot(element), raf = 0, stopped = false;
  const route = location.pathname, timers: number[] = [];
  const cancel = (): void => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(raf); timers.forEach(clearTimeout);
    signal.removeEventListener('abort', cancel);
    window.removeEventListener('wheel', cancel, true); window.removeEventListener('touchstart', cancel, true);
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('popstate', cancel);
  };
  const onKey = (event: KeyboardEvent): void => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  window.addEventListener('wheel', cancel, { capture: true, passive: true });
  window.addEventListener('touchstart', cancel, { capture: true, passive: true });
  window.addEventListener('keydown', onKey, true); window.addEventListener('popstate', cancel);
  const y = targetY(element, root), from = root.scrollTop, delta = y - from;
  const duration = Math.abs(delta) < 2 || Math.abs(delta) > 600 ? 0 : 280;
  const start = performance.now();
  let tweenDone = !duration;
  if (!duration) root.scrollTop = y;
  // Also watches SPA URL changes in the content script's isolated world.
  const step = (now: number): void => {
    if (stopped) return;
    if (signal.aborted || location.pathname !== route) { cancel(); return; }
    if (!root.isConnected) { root = findScrollRoot(); tweenDone = true; }
    if (!tweenDone) {
      const t = Math.min(1, (now - start) / duration);
      root.scrollTop = from + delta * (1 - Math.pow(1 - t, 3));
      if (t === 1) tweenDone = true;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  for (const ms of [200, 600, 1200, 2000]) timers.push(window.setTimeout(() => {
    if (stopped || signal.aborted || location.pathname !== route) { cancel(); return; }
    const current = getTurnEl(entry.turnContainerId);
    if (current) {
      root = findScrollRoot(current);
      const next = targetY(current, root);
      if (Math.abs(root.scrollTop - next) > 40) { tweenDone = true; root.scrollTop = next; }
    }
    if (ms === 2000) cancel();
  }, ms));
  if (!duration) return true;
  return new Promise(resolve => {
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(!stopped && !signal.aborted && location.pathname === route); };
    const timer = window.setTimeout(finish, duration + 40);
    signal.addEventListener('abort', finish, { once: true });
  });
}
