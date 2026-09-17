import type { YadaTurn } from '../conversation/types';
import { type ScrollRoot } from './active';
import { indexConversationMessages, toJumpTarget } from './conversationIndex';
import { VirtualizedJump } from './virtualizedJump';

/** Yada boundary adapter. The engine receives immutable API identity once per jump. */
export async function jumpToTurn(
  id: string, scan: () => YadaTurn[], getRoot: () => ScrollRoot, signal: AbortSignal,
  onProgress?: (attempt: number) => void
): Promise<boolean> {
  if (signal.aborted) return false;
  const turns = scan(), turn = turns.find(item => item.id === id);
  const target = turn && toJumpTarget(turn);
  if (!target) return false;
  const route = location.pathname;
  const request = new AbortController();
  const cancel = (): void => request.abort();
  const onKey = (event: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Escape', ' '].includes(event.key)) cancel();
  };
  const userEvents = ['wheel', 'touchstart', 'pointerdown', 'click'] as const;
  userEvents.forEach(name => window.addEventListener(name, cancel, { capture: true, passive: true }));
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('popstate', cancel);
  const routeFrame = (): void => { if (location.pathname !== route) cancel(); else if (!request.signal.aborted) routeRaf = requestAnimationFrame(routeFrame); };
  let routeRaf = requestAnimationFrame(routeFrame);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const engine = new VirtualizedJump(indexConversationMessages(turns), { signal: request.signal, getRoot, onProgress });
  try { return await engine.jumpToConversationMessage(target); }
  finally {
    cancelAnimationFrame(routeRaf); engine.dispose(); signal.removeEventListener('abort', cancel);
    userEvents.forEach(name => window.removeEventListener(name, cancel, true));
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('popstate', cancel);
  }
}
