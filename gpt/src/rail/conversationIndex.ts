/* Adapted from GPT Conversation Toolkit conversation-index.js, virtualized-jump.js
 * and utils/dom.js. Copyright (c) 2026 bujue3709. MIT; see THIRD_PARTY_NOTICES.md.
 */
import type { YadaTurn } from '../conversation/types';
import { isInsideComposer } from '../conversation/composerGuard';

export type JumpTarget = { messageId: string; messageIndex: number; userOrder: number; role: 'user'; previewText: string };
export type IndexedMessage = { messageId: string; index: number; turnIndex: number; userOrder: number; role: 'user' | 'assistant'; text: string };
export type ConversationIndex = { messages: IndexedMessage[]; byMessageId: Map<string, IndexedMessage>; byIndex: Map<number, IndexedMessage>; byUserOrder: Map<number, IndexedMessage> };
export function indexConversationMessages(turns: readonly YadaTurn[]): ConversationIndex {
  const messages: IndexedMessage[] = [];
  const byMessageId = new Map<string, IndexedMessage>(), byIndex = new Map<number, IndexedMessage>(), byUserOrder = new Map<number, IndexedMessage>();
  for (const turn of turns) {
    for (const role of ['user', 'assistant'] as const) {
      const messageId = role === 'user' ? turn.userMessageId : turn.assistantMessageId;
      if (!messageId) continue;
      const message = { messageId, index: messages.length, turnIndex: turn.index, userOrder: turn.displayNumber ?? turn.index + 1, role,
        text: role === 'user' ? turn.userMarkdown : turn.assistantMarkdown };
      messages.push(message); byMessageId.set(messageId, message); byIndex.set(message.index, message);
      if (role === 'user') byUserOrder.set(message.userOrder, message);
    }
  }
  return { messages, byMessageId, byIndex, byUserOrder };
}
export function toJumpTarget(turn: YadaTurn): JumpTarget | null {
  return turn.userMessageId ? { messageId: turn.userMessageId, messageIndex: turn.index, userOrder: turn.displayNumber ?? turn.index + 1, role: 'user', previewText: turn.userPreview } : null;
}
export function getDomMessageIdCandidates(node: HTMLElement): string[] {
  const ids = new Set<string>();
  for (const attr of ['data-message-id', 'data-turn-id', 'data-turn-id-container']) {
    const own = node.getAttribute(attr), child = node.querySelector(`[${attr}]`)?.getAttribute(attr);
    if (own) ids.add(own); if (child) ids.add(child);
  }
  return [...ids];
}
export function detectRole(node: HTMLElement): string {
  return node.getAttribute('data-message-author-role') ?? node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') ?? node.getAttribute('data-turn') ?? '';
}
export function normalizeMessageNode(node: HTMLElement): HTMLElement {
  // Keep the actual role node when a wrapper groups both user and assistant.
  const role = node.closest<HTMLElement>('[data-message-author-role]') ?? node.querySelector<HTMLElement>('[data-message-author-role]');
  return role ?? node.closest<HTMLElement>('[data-turn][data-turn-id], [data-turn-id], [data-testid^="conversation-turn-"], article') ?? node;
}
export function getMessageNodes(): HTMLElement[] {
  const root = document.querySelector('main') ?? document.querySelector('#thread') ?? document.body;
  const nodes = root.querySelectorAll<HTMLElement>('[data-message-author-role], [data-message-id], [data-turn-id], [data-turn-id-container]');
  return [...new Set([...nodes].filter(node => !isInsideComposer(node) && !node.closest('[data-yada-root]')).map(normalizeMessageNode))]
    .filter(node => node.isConnected && node.getClientRects().length > 0);
}
export function queryMessageNodeById(messageId: string, role = 'user'): HTMLElement | null {
  if (!messageId) return null;
  const escaped = CSS.escape(messageId);
  const selector = `[data-message-id="${escaped}"], [data-turn-id="${escaped}"], [data-turn-id-container="${escaped}"]`;
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    if (isInsideComposer(node) || node.closest('[data-yada-root]')) continue;
    const normalized = normalizeMessageNode(node);
    if (detectRole(normalized) !== role || !normalized.getClientRects().length) continue;
    // A turn ID is useful only if it does not contradict an explicit message ID.
    const explicit = normalized.getAttribute('data-message-id') ?? normalized.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (explicit && explicit !== messageId) continue;
    return normalized;
  }
  return null;
}
export const normalizeVirtualJumpText = (text: string): string => text.replace(/\s+/g, ' ').trim();
export function getTextMatchScore(leftValue: string, rightValue: string): number {
  const left = normalizeVirtualJumpText(leftValue).toLowerCase().slice(0, 120);
  const right = normalizeVirtualJumpText(rightValue).toLowerCase().slice(0, 120);
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return 1;
  const leftTokens = new Set(left.split(/\s+/).filter(token => token.length > 1));
  const rightTokens = new Set(right.split(/\s+/).filter(token => token.length > 1));
  if (!leftTokens.size || !rightTokens.size) {
    let same = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] === right[i]) same++;
    return same / Math.max(left.length, right.length, 1);
  }
  let shared = 0; leftTokens.forEach(token => { if (rightTokens.has(token)) shared++; });
  return shared * 2 / (leftTokens.size + rightTokens.size);
}
export type VirtualIndexCandidate = { index: number; confidence: number; source: string };
export function getDomVirtualIndexCandidates(node: HTMLElement): VirtualIndexCandidate[] {
  const candidates: VirtualIndexCandidate[] = [];
  const add = (raw: string | null | undefined, shift: number, confidence: number, source: string): void => {
    if (raw === null || raw === undefined || raw === '') return;
    const n = Number(raw) + shift;
    if (Number.isFinite(n) && n >= 0 && !candidates.some(c => c.index === Math.trunc(n))) candidates.push({ index: Math.trunc(n), confidence, source });
  };
  const attr = (name: string): string | null | undefined => node.getAttribute(name) ?? node.closest(`[${name}]`)?.getAttribute(name) ?? node.querySelector(`[${name}]`)?.getAttribute(name);
  add(attr('data-index'), 0, .9, 'data-index');
  add(attr('aria-posinset'), -1, .85, 'aria-posinset');
  const turn = attr('data-testid')?.match(/conversation-turn-(\d+)/i);
  if (turn) add(turn[1], -1, .45, 'conversation-turn');
  return candidates;
}
export function resolveDomNodeConversationMessage(node: HTMLElement, index: ConversationIndex): IndexedMessage | null {
  const role = detectRole(node), ids = getDomMessageIdCandidates(node);
  for (const id of ids) {
    const message = index.byMessageId.get(id);
    if (message && (!role || message.role === role)) return message;
  }
  // Text is used only to describe an otherwise anonymous mounted window, never to override a conflicting ID.
  if (ids.length) return null;
  const text = node.innerText;
  const matches = index.messages.filter(message => message.role === role && getTextMatchScore(text, message.text) >= .99);
  return matches.length === 1 ? matches[0] : null;
}
