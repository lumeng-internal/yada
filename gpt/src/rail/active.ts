import type { YadaTurn } from "../conversation/types";
import { isInsideComposer } from "../conversation/composerGuard";
export type ScrollRoot = HTMLElement;
export function resolveScrollRoot(anchor?: HTMLElement | null): ScrollRoot {
  let current = anchor ?? document.querySelector<HTMLElement>('main [data-message-id], #thread [data-message-author-role], #thread, main');
  while (current && current !== document.documentElement) {
    const style = getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && current.clientHeight > 0 && current.scrollHeight > current.clientHeight + 24) return current;
    current = current.parentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}
export function viewport(root: ScrollRoot): { top: number; height: number } {
  if (root === document.scrollingElement || root === document.documentElement) return { top: 0, height: innerHeight };
  const rect = root.getBoundingClientRect();
  const top = Math.max(0, rect.top + root.clientTop);
  return { top, height: Math.max(0, Math.min(innerHeight, rect.bottom) - top) };
}
export function trustedUserAnchor(turn?: YadaTurn): HTMLElement | null {
  const anchor = turn?.userAnchorElement;
  if (!anchor?.isConnected || !turn?.anchorMappingTrusted || isInsideComposer(anchor) || !anchor.getClientRects().length) return null;
  const message = anchor.closest('[data-message-id]') ?? anchor.querySelector('[data-message-id]');
  if (message && turn.userMessageId && message.getAttribute('data-message-id') !== turn.userMessageId) return null;
  return anchor;
}
export function activeTurnAtLine(positions: readonly { index: number; top: number }[], line: number): number {
  if (!positions.length) return -1;
  let nearest = positions[0];
  for (const position of positions) {
    if (position.top <= line && (nearest.top > line || position.top > nearest.top)) nearest = position;
    else if (nearest.top > line && position.top < nearest.top) nearest = position;
  }
  return nearest.index;
}
export function getActiveTurn(turns: readonly YadaTurn[], root: ScrollRoot): number {
  const area = viewport(root);
  return activeTurnAtLine(turns.flatMap(turn => {
    const anchor = trustedUserAnchor(turn);
    return anchor ? [{ index: turn.index, top: anchor.getBoundingClientRect().top }] : [];
  }), area.top + area.height * 0.4);
}
