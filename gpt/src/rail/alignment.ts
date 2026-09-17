/* Adapted from AI-MarkDone chatgptDirectory/navigation.ts and
 * ChatGPTConversationNavigation.ts. Copyright (c) 2025 BenkoZhao.
 * MIT; see THIRD_PARTY_NOTICES.md. Exact identity replaces surface adapter dependencies.
 */
import { queryMessageNodeById } from './conversationIndex';
import { resolveScrollRoot, viewport, type ScrollRoot } from './active';

export function readableTop(root: ScrollRoot, anchor: HTMLElement): number {
  const area = viewport(root), target = anchor.getBoundingClientRect();
  let top = area.top;
  for (const element of document.querySelectorAll<HTMLElement>('header, [role="banner"], #page-header, #conversation-header, [data-testid="conversation-header"]')) {
    if (element.closest('[data-yada-root]')) continue;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    if (rect.width > 0 && rect.height > 0 && rect.right > target.left && rect.left < target.right
      && rect.top <= top + 24 && rect.bottom > top && rect.bottom < area.top + area.height / 2) top = Math.max(top, rect.bottom);
  }
  return top + 12;
}
export function waitQuiet(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = window.setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
function alignAnchor(anchor: HTMLElement): void {
  anchor.scrollIntoView({ behavior: 'auto', block: 'start' });
  const root = resolveScrollRoot(anchor);
  const delta = anchor.getBoundingClientRect().top - readableTop(root, anchor);
  root.scrollTo({ top: Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + delta)), behavior: 'instant' });
}
export async function alignStableTarget(messageId: string, signal: AbortSignal): Promise<HTMLElement | null> {
  let anchor = queryMessageNodeById(messageId);
  if (!anchor || signal.aborted) return null;
  let realignments = 0, stableMeasurements = 0;
  const started = performance.now();
  alignAnchor(anchor);
  while (!signal.aborted && performance.now() - started < 900) {
    await waitQuiet(80, signal);
    if (signal.aborted) return null;
    const next = queryMessageNodeById(messageId);
    if (!next?.isConnected) { stableMeasurements = 0; continue; }
    const replaced = next !== anchor;
    anchor = next;
    const root = resolveScrollRoot(anchor), rect = anchor.getBoundingClientRect();
    const top = readableTop(root, anchor);
    const delta = rect.top - top;
    // At the beginning/end of the scroll range, accept only an actually readable exact target.
    const clamped = root.scrollTop <= 1 && delta < 0 && rect.top >= top - 12
      || root.scrollTop >= root.scrollHeight - root.clientHeight - 1 && delta > 0 && rect.top < viewport(root).top + viewport(root).height - 24;
    if ((Math.abs(delta) <= 8 || clamped) && !replaced) {
      if (++stableMeasurements >= 2) return anchor;
      continue;
    }
    stableMeasurements = 0;
    if (realignments >= 2) return null;
    realignments++; alignAnchor(anchor);
  }
  return null;
}
export function highlightNavigationTarget(anchor: HTMLElement): void {
  // Web Animations avoids leaving inline styles on application-owned message nodes.
  if (typeof anchor.animate === 'function') anchor.animate([
    { backgroundColor: 'rgba(16,163,127,.18)' }, { backgroundColor: 'rgba(16,163,127,0)' }
  ], { duration: 1100, easing: 'ease-out' });
}
