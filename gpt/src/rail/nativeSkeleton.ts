/* Adapted from Loongphy/chatgpt-usage chatgpt-always-toc.user.js
 * f1811fb5788e040fd6b35a1d25dd7b76238d8d65. Copyright (c) loongphy.
 * MIT; see THIRD_PARTY_NOTICES.md. Skeletons only bind current materialization.
 */
import type { YadaTurn } from '../conversation/types';
import { viewport, type ScrollRoot } from './active';

export type SkeletonHit = { turnContainerId: string; skeletonIndex: number };

export type RailEntry = {
  index: number;
  userMessageId: string;
  assistantMessageId?: string;
  turn: YadaTurn | null;
  turnContainerId: string | null;
  skeletonIndex: number | null;
  materialized: boolean;
};

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
  const root = getThreadRoot();
  return root?.querySelector<HTMLElement>(`:scope > [data-turn-id-container="${CSS.escape(id)}"]`) ?? null;
}

export function skeletonSignature(hits: readonly SkeletonHit[]): string {
  return hits.map(hit => hit.turnContainerId).join('\n');
}

export function skeletonOnlyEntries(hits: readonly SkeletonHit[]): RailEntry[] {
  return hits.map((hit, index) => ({
    index,
    userMessageId: hit.turnContainerId,
    turn: null,
    turnContainerId: hit.turnContainerId,
    skeletonIndex: hit.skeletonIndex,
    materialized: true
  }));
}

export function bindTurnsToSkeletons(turns: readonly YadaTurn[], hits: readonly SkeletonHit[]): RailEntry[] {
  const entries: RailEntry[] = turns.map((turn, index) => ({
    index,
    userMessageId: turn.userMessageId || turn.id,
    assistantMessageId: turn.assistantMessageId,
    turn,
    turnContainerId: null,
    skeletonIndex: null,
    materialized: false
  }));
  if (!hits.length) return entries;
  const byUserId = new Map(entries.map(entry => [entry.userMessageId, entry]));
  const byDomId = new Map<string, RailEntry>();
  for (const entry of entries) {
    const domId = entry.turn?.turnDomId;
    if (domId) byDomId.set(domId, entry);
  }
  const used = new Set<RailEntry>();
  const exact: { windowIndex: number; apiIndex: number }[] = [];
  hits.forEach((hit, windowIndex) => {
    const match = byUserId.get(hit.turnContainerId) ?? byDomId.get(hit.turnContainerId);
    if (!match || used.has(match)) return;
    assignSkeleton(match, hit);
    used.add(match);
    exact.push({ windowIndex, apiIndex: match.index });
  });
  const offsets = new Set(exact.map(item => item.apiIndex - item.windowIndex));
  if (exact.length && offsets.size === 1) {
    const offset = [...offsets][0];
    hits.forEach((hit, windowIndex) => {
      const entry = entries[windowIndex + offset];
      if (!entry || used.has(entry)) return;
      assignSkeleton(entry, hit);
      used.add(entry);
    });
  }
  return entries;
}

function assignSkeleton(entry: RailEntry, hit: SkeletonHit): void {
  entry.turnContainerId = hit.turnContainerId;
  entry.skeletonIndex = hit.skeletonIndex;
  entry.materialized = true;
}

export class NativeSkeleton {
  private userParity: number | null = null;
  reset(): void { this.userParity = null; }
  collect(): SkeletonHit[] {
    const root = getThreadRoot();
    if (!root?.isConnected) return [];
    const containers = [...root.children].filter(node => node.hasAttribute('data-turn-id-container'));
    const ids = containers.map(node => node.getAttribute('data-turn-id-container')!);
    for (const section of root.querySelectorAll('section[data-turn="user"][data-turn-id]')) {
      const id = section.getAttribute('data-turn-id')!;
      const container = section.closest('[data-turn-id-container]');
      const index = ids.indexOf(id) >= 0 ? ids.indexOf(id) : containers.indexOf(container!);
      if (index >= 0 && !ids[index].startsWith('client-created-')) { this.userParity = index % 2; break; }
    }
    const parity = this.userParity ?? (ids[0]?.startsWith('client-created-') ? 1 : 0);
    const hits: SkeletonHit[] = [];
    for (let n = 0; n < ids.length; n++) {
      if (n % 2 !== parity || !ids[n] || ids[n].startsWith('client-created-')) continue;
      hits.push({ turnContainerId: ids[n], skeletonIndex: n });
    }
    return hits;
  }
  scan(turns: readonly YadaTurn[] = []): RailEntry[] {
    const hits = this.collect();
    return turns.length ? bindTurnsToSkeletons(turns, hits) : skeletonOnlyEntries(hits);
  }
}

export function syncActive(entries: readonly RailEntry[], root: ScrollRoot): number {
  if (!entries.length) return -1;
  const wanted = new Map(entries.filter(entry => entry.turnContainerId).map(entry => [entry.turnContainerId, entry.index]));
  const area = viewport(root), line = area.top + area.height * 0.35;
  let active = entries.find(entry => entry.materialized)?.index ?? 0;
  for (const node of getThreadRoot()?.children ?? []) {
    const index = wanted.get(node.getAttribute('data-turn-id-container') ?? '');
    if (index !== undefined && node.getBoundingClientRect().top <= line) active = index;
  }
  return active;
}
