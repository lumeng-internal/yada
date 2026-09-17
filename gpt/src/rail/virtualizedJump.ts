/* TypeScript port of GPT Conversation Toolkit features/virtualized-jump.js.
 * Copyright (c) 2026 bujue3709. MIT; see THIRD_PARTY_NOTICES.md.
 * Retains ID/window resolution, calibrated imperative bridge, mutation waits,
 * directional paging, stagnation detection, boundary probes and nudges.
 * Yada excludes ratio guesses, reverse probes and weak-match success by contract.
 */
import {
  getMessageNodes, getDomMessageIdCandidates, getDomVirtualIndexCandidates,
  queryMessageNodeById, resolveDomNodeConversationMessage, getTextMatchScore, detectRole,
  type ConversationIndex, type IndexedMessage, type JumpTarget
} from './conversationIndex';
import { requestVirtualizerScrollToIndex, type BridgeResult } from './virtualizerBridge';
import { resolveScrollRoot, type ScrollRoot } from './active';
import { alignStableTarget, highlightNavigationTarget } from './alignment';

const MAX_ATTEMPTS = 24;
const LARGE_STEP_RATIO = .85;
const SMALL_STEP_RATIO = .25;
const STUCK_STEP_RATIO = 1.4;
const BOUNDARY_NUDGE_PX = 24;
const CALIBRATION_TTL_MS = 5000;

type RenderedItem = { key: string; node: HTMLElement; message: IndexedMessage; index: number; userOrder: number; role: string };
export type RenderedWindow = {
  minIndex: number | null; maxIndex: number | null;
  minUserOrder: number | null; maxUserOrder: number | null;
  renderedCount: number; items: RenderedItem[];
  scrollTop: number; messageSignature: string; signature: string;
};
type Calibration = { offset: number; confidence: number; updatedAt: number; unit: 'message' | 'turn' };
type ScrollController = { root: ScrollRoot; getTop: () => number; getHeight: () => number; getMaxTop: () => number; setTop: (top: number) => void };
export type JumpOptions = { signal: AbortSignal; getRoot: () => ScrollRoot; onProgress?: (attempt: number) => void; onBridge?: (result: BridgeResult) => void };

/** A per-request engine prevents a previous conversation's nodes/calibration from leaking. */
export class VirtualizedJump {
  private calibration: Calibration = { offset: 0, confidence: 0, updatedAt: 0, unit: 'message' };
  private lastWindowSignature = '';
  private readonly observer: MutationObserver;
  private readonly route = location.pathname;
  private windowCache: RenderedWindow | null = null;
  private dirty = true;
  private revision = 0;
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly index: ConversationIndex, private readonly options: JumpOptions) {
    this.observer = new MutationObserver(records => {
      const relevant = records.some(record => {
        const node = record.target instanceof Element ? record.target : record.target.parentElement;
        return node && !node.closest('[data-yada-root]');
      });
      if (!relevant) return;
      this.dirty = true; this.revision++;
      this.changeListeners.forEach(listener => listener());
    });
    this.observer.observe(document.querySelector('main') ?? document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['data-message-id', 'data-turn-id', 'data-turn-id-container', 'data-index', 'aria-posinset']
    });
  }
  dispose(): void { this.observer.disconnect(); this.changeListeners.clear(); }
  private active(): boolean { return !this.options.signal.aborted && location.pathname === this.route; }

  private getScrollController(): ScrollController {
    const mounted = this.getRenderedMessageWindow().items[0]?.node;
    const root = mounted ? resolveScrollRoot(mounted) : this.options.getRoot();
    const documentLike = root === document.scrollingElement || root === document.documentElement;
    const getTop = (): number => documentLike ? window.scrollY || root.scrollTop : root.scrollTop;
    const getHeight = (): number => documentLike ? innerHeight : root.clientHeight;
    const getMaxTop = (): number => Math.max(0, root.scrollHeight - getHeight());
    const setTop = (top: number): void => {
      if (!this.active()) return;
      const clampedTop = Math.min(Math.max(0, top), getMaxTop());
      if (documentLike) window.scrollTo({ top: clampedTop, behavior: 'instant' });
      else root.scrollTo({ top: clampedTop, behavior: 'instant' });
    };
    return { root, getTop, getHeight, getMaxTop, setTop };
  }

  getRenderedMessageWindow(): RenderedWindow {
    const root = this.options.getRoot(), scrollTop = Math.round(root.scrollTop);
    if (!this.dirty && this.windowCache) {
      return { ...this.windowCache, scrollTop, signature: `${this.windowCache.messageSignature}:${scrollTop}` };
    }
    const items: RenderedItem[] = [], seenKeys = new Set<string>();
    for (const node of getMessageNodes()) {
      const message = resolveDomNodeConversationMessage(node, this.index);
      if (!message || seenKeys.has(message.messageId)) continue;
      seenKeys.add(message.messageId);
      items.push({ key: message.messageId, node, message, index: message.index, userOrder: message.userOrder, role: message.role });
    }
    items.sort((a, b) => a.index - b.index);
    const indexes = items.map(item => item.index);
    const userOrders = items.filter(item => item.role === 'user').map(item => item.userOrder);
    const minIndex = indexes.length ? Math.min(...indexes) : null;
    const maxIndex = indexes.length ? Math.max(...indexes) : null;
    const messageSignature = `${minIndex ?? ''}:${maxIndex ?? ''}:${items.map(item => item.key).join(',')}`;
    this.windowCache = {
      minIndex, maxIndex,
      minUserOrder: userOrders.length ? Math.min(...userOrders) : null,
      maxUserOrder: userOrders.length ? Math.max(...userOrders) : null,
      renderedCount: items.length, items, scrollTop, messageSignature,
      signature: `${messageSignature}:${scrollTop}`
    };
    this.dirty = false;
    return this.windowCache;
  }

  private calibrateVirtualIndexOffset(): Calibration {
    // Upstream offset grouping. Also evaluate turn units because ChatGPT can mount a user/assistant pair in one item.
    const groups = new Map<string, { offset: number; unit: Calibration['unit']; count: number; weight: number; highConfidenceCount: number }>();
    for (const item of this.getRenderedMessageWindow().items) {
      // Only stable IDs can calibrate the native index; text similarity cannot steer it.
      if (!getDomMessageIdCandidates(item.node).includes(item.message.messageId)) continue;
      for (const candidate of getDomVirtualIndexCandidates(item.node)) {
        for (const unit of ['message', 'turn'] as const) {
          const base = unit === 'message' ? item.index : item.message.turnIndex;
          const offset = candidate.index - base;
          if (!Number.isFinite(offset) || Math.abs(offset) > 5000) continue;
          const key = `${unit}:${offset}`;
          const group = groups.get(key) ?? { offset, unit, count: 0, weight: 0, highConfidenceCount: 0 };
          group.count++; group.weight += candidate.confidence;
          if (candidate.confidence >= .75) group.highConfidenceCount++;
          groups.set(key, group);
        }
      }
    }
    const best = [...groups.values()].sort((a, b) => b.count - a.count || b.weight - a.weight)[0];
    this.calibration = best && best.count >= 3 && (best.highConfidenceCount >= 3 || best.weight >= 2.4)
      ? { offset: best.offset, unit: best.unit, confidence: best.highConfidenceCount >= 3 ? .85 : .61, updatedAt: Date.now() }
      : { offset: 0, unit: 'message', confidence: 0, updatedAt: Date.now() };
    return this.calibration;
  }
  private resolveVirtualIndexCandidates(target: JumpTarget): number[] {
    const message = this.index.byMessageId.get(target.messageId);
    if (!message) return [];
    if (Date.now() - this.calibration.updatedAt > CALIBRATION_TTL_MS) this.calibrateVirtualIndexOffset();
    const calibration = this.calibration;
    const base = (calibration.unit === 'turn' ? target.messageIndex : message.index)
      + (calibration.confidence > .6 ? calibration.offset : 0);
    // Preserve upstream local candidate order; none is allowed to assert target identity.
    return [...new Set([0, -1, 1, -2, 2, -5, 5, -10, 10].map(delta => Math.trunc(base + delta)).filter(n => n >= 0))];
  }

  private resolveByPreviewText(target: JumpTarget): HTMLElement | null {
    // Retained as a secondary lookup only. A stable ID and role must still agree.
    const candidates = getMessageNodes().filter(node => detectRole(node) === target.role
      && getTextMatchScore(target.previewText, node.innerText) >= .72
      && getDomMessageIdCandidates(node).includes(target.messageId));
    return candidates.length === 1 ? candidates[0] : null;
  }
  private resolveMessageDomNode(target: JumpTarget): HTMLElement | null {
    return queryMessageNodeById(target.messageId, target.role) ?? this.resolveByPreviewText(target);
  }
  private async resolveAndFinish(target: JumpTarget): Promise<boolean> {
    const node = this.resolveMessageDomNode(target);
    if (!this.active() || !node) return false;
    const aligned = await alignStableTarget(target.messageId, this.options.signal);
    if (!this.active() || !aligned) return false;
    highlightNavigationTarget(aligned);
    return true;
  }

  /** Subscribe before scrolling; resolve on a changed window OR real topology replacement.
   * No full API-model rescans per frame, and abort removes listeners/timers immediately.
   */
  private waitForMessageWindowMutation(previous: RenderedWindow, previousRevision: number, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
      let finished = false, quietTimer = 0;
      const finish = (changed: boolean): void => {
        if (finished) return;
        finished = true; clearTimeout(timer); clearTimeout(quietTimer);
        this.changeListeners.delete(check); this.options.signal.removeEventListener('abort', abort);
        resolve(changed);
      };
      const check = (): void => {
        if (!this.active()) { finish(false); return; }
        if (this.revision !== previousRevision || this.getRenderedMessageWindow().messageSignature !== previous.messageSignature) {
          clearTimeout(quietTimer);
          quietTimer = window.setTimeout(() => finish(true), 40);
        }
      };
      const abort = (): void => finish(false);
      const timer = window.setTimeout(() => finish(this.revision !== previousRevision || this.getRenderedMessageWindow().messageSignature !== previous.messageSignature), timeoutMs);
      this.changeListeners.add(check);
      this.options.signal.addEventListener('abort', abort, { once: true });
      check();
    });
  }
  private async scrollAndWait(action: () => void, timeout = 450): Promise<boolean> {
    if (!this.active()) return false;
    const before = this.getRenderedMessageWindow(), revision = this.revision;
    const wait = this.waitForMessageWindowMutation(before, revision, timeout);
    action();
    return wait;
  }
  private scrollConversationByVirtualPage(direction: number, scale = LARGE_STEP_RATIO): void {
    const controller = this.getScrollController();
    const step = Math.max(160, controller.getHeight() * Math.max(.1, scale));
    controller.setTop(controller.getTop() + Math.sign(direction) * step);
  }
  private nudgeVirtualScroll(direction: number): void {
    const controller = this.getScrollController();
    controller.setTop(controller.getTop() + Math.sign(direction) * BOUNDARY_NUDGE_PX);
  }
  private async boundaryProbe(direction: number): Promise<boolean> {
    if (!this.active()) return false;
    const before = this.getRenderedMessageWindow();
    const boundary = direction < 0 ? before.items[0] : before.items.at(-1);
    if (!boundary?.node.isConnected) return false;
    const controller = this.getScrollController(), origin = controller.getTop();
    const rect = boundary.node.getBoundingClientRect();
    const viewportTop = controller.root === document.scrollingElement ? 0 : controller.root.getBoundingClientRect().top;
    const boundaryTop = direction < 0 ? origin + rect.top - viewportTop : origin + rect.bottom - viewportTop - controller.getHeight();
    const moved = await this.scrollAndWait(() => {
      // Upstream boundary alignment, clamped to the target direction to prevent a reverse jump.
      controller.setTop(direction < 0 ? Math.min(origin, boundaryTop) : Math.max(origin, boundaryTop));
      this.nudgeVirtualScroll(direction);
    }, 900);
    if (!this.active()) return false;
    if (this.getRenderedMessageWindow().messageSignature !== before.messageSignature) return true;
    if (!moved) {
      await this.scrollAndWait(() => this.scrollConversationByVirtualPage(direction, STUCK_STEP_RATIO));
      return this.active() && this.getRenderedMessageWindow().messageSignature !== before.messageSignature;
    }
    return moved;
  }

  async jumpToConversationMessage(target: JumpTarget): Promise<boolean> {
    if (!this.active() || !this.index.byMessageId.has(target.messageId)) return false;
    if (this.resolveMessageDomNode(target)) return this.resolveAndFinish(target);
    const beforeBridge = this.getRenderedMessageWindow(), beforeRevision = this.revision;
    const imperative = await requestVirtualizerScrollToIndex(this.resolveVirtualIndexCandidates(target), this.options.signal);
    this.options.onBridge?.(imperative);
    if (!this.active()) return false;
    if (imperative.ok) {
      if (!this.resolveMessageDomNode(target)) await this.waitForMessageWindowMutation(beforeBridge, beforeRevision, 900);
      if (!this.active()) return false;
      if (this.resolveMessageDomNode(target)) return this.resolveAndFinish(target);
    }
    const targetIndex = this.index.byMessageId.get(target.messageId)!.index;
    let stagnantWindows = 0, lastDirection = 0;
    this.lastWindowSignature = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && this.active(); attempt++) {
      if (this.resolveMessageDomNode(target)) return this.resolveAndFinish(target);
      const rendered = this.getRenderedMessageWindow();
      this.options.onProgress?.(attempt);
      if (rendered.messageSignature === this.lastWindowSignature) stagnantWindows++;
      else { stagnantWindows = 0; this.lastWindowSignature = rendered.messageSignature; }
      let direction = 0;
      if (rendered.minIndex !== null && rendered.maxIndex !== null) {
        if (targetIndex < rendered.minIndex) direction = -1;
        else if (targetIndex > rendered.maxIndex) direction = 1;
      }
      if (!direction && rendered.minUserOrder !== null && rendered.maxUserOrder !== null) {
        if (target.userOrder < rendered.minUserOrder) direction = -1;
        else if (target.userOrder > rendered.maxUserOrder) direction = 1;
      }
      // A missing ID inside the mounted window, unknown window, or overshoot is a failure.
      // Never alternate directions and never accept a neighboring text match.
      if (!direction || (lastDirection && lastDirection !== direction) || stagnantWindows >= 3) return false;
      lastDirection = direction;
      let stepScale = LARGE_STEP_RATIO;
      if (rendered.minIndex !== null && rendered.maxIndex !== null && targetIndex >= rendered.minIndex - 3 && targetIndex <= rendered.maxIndex + 3) stepScale = SMALL_STEP_RATIO;
      if (stagnantWindows === 1) stepScale = STUCK_STEP_RATIO;
      if (stagnantWindows > 0 || attempt > 3 && attempt % 4 === 0) {
        if (await this.boundaryProbe(direction)) continue;
        if (!this.active()) return false;
      }
      const controller = this.getScrollController(), origin = controller.getTop();
      const changed = await this.scrollAndWait(() => this.scrollConversationByVirtualPage(direction, stepScale));
      if (!this.active()) return false;
      if (!changed && Math.abs(controller.getTop() - origin) < 1 && stagnantWindows >= 1) return false;
    }
    return false;
  }
}
