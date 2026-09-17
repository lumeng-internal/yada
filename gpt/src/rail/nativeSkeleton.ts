/* Adapted from Loongphy/chatgpt-usage chatgpt-always-toc.user.js
 * f1811fb5788e040fd6b35a1d25dd7b76238d8d65. Copyright (c) loongphy.
 * MIT; see THIRD_PARTY_NOTICES.md. Only official skeletons define navigation.
 */
import type { YadaTurn } from '../conversation/types';
import { viewport, type ScrollRoot } from './active';
export type RailEntry = { index: number; turnContainerId: string; skeletonIndex: number; turn: YadaTurn | null };
export function getThreadRoot(): HTMLElement | null {
  return document.querySelector('[class*="convSearchResultHighlightRoot"]');
}
export function findScrollRoot(from: HTMLElement | null = getThreadRoot()): ScrollRoot {
  for (let node = from; node && node !== document.body; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 50 && /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)) return node;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}
export function getTurnEl(id: string): HTMLElement | null {
  // Re-query on every correction: ChatGPT may replace the whole container.
  const root = getThreadRoot();
  return root?.querySelector<HTMLElement>(`:scope > [data-turn-id-container="${CSS.escape(id)}"]`) ?? null;
}
export class NativeSkeleton {
  private userParity: number | null = null;
  reset(): void { this.userParity = null; }
  scan(turns: readonly YadaTurn[] = []): RailEntry[] {
    const root = getThreadRoot();
    if (!root?.isConnected) return [];
    const containers = [...root.children].filter(n => n.hasAttribute('data-turn-id-container'));
    const ids = containers.map(n => n.getAttribute('data-turn-id-container')!);
    for (const section of root.querySelectorAll('section[data-turn="user"][data-turn-id]')) {
      const id = section.getAttribute('data-turn-id')!;
      const container = section.closest('[data-turn-id-container]');
      const index = ids.indexOf(id) >= 0 ? ids.indexOf(id) : containers.indexOf(container!);
      if (index >= 0 && !ids[index].startsWith('client-created-')) { this.userParity = index % 2; break; }
    }
    const parity = this.userParity ?? (ids[0]?.startsWith('client-created-') ? 1 : 0);
    const entries: RailEntry[] = [];
    for (let n = 0; n < ids.length; n++) {
      if (n % 2 !== parity || !ids[n] || ids[n].startsWith('client-created-')) continue;
      entries.push({ index: entries.length, turnContainerId: ids[n], skeletonIndex: n, turn: null });
    }
    const byId = new Map<string, YadaTurn>();
    for (const turn of turns) for (const id of [turn.userMessageId, turn.turnDomId]) if (id) byId.set(id, turn);
    const used = new Set<YadaTurn>();
    for (const entry of entries) { entry.turn = byId.get(entry.turnContainerId) ?? null; if (entry.turn) used.add(entry.turn); }
    for (const entry of entries) {
      const ordered = turns[entry.index];
      if (!entry.turn && ordered && !used.has(ordered)) { entry.turn = ordered; used.add(ordered); }
    }
    return entries;
  }
}
export function syncActive(entries: readonly RailEntry[], root: ScrollRoot): number {
  if (!entries.length) return -1;
  const wanted = new Map(entries.map(entry => [entry.turnContainerId, entry.index]));
  const area = viewport(root), line = area.top + area.height * 0.35;
  let active = 0;
  for (const node of getThreadRoot()?.children ?? []) {
    const index = wanted.get(node.getAttribute('data-turn-id-container') ?? '');
    if (index !== undefined && node.getBoundingClientRect().top <= line) active = index;
  }
  return active;
}
