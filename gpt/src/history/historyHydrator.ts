/* Pagination bounds, ended/loading state, and same-conversation guard
 * follow Leo7805/luna-toc conversationBackfill.ts
 * 1339969ec25d7c9b63068abd3776ce41780023ed. MIT; see THIRD_PARTY_NOTICES.md.
 * Sentinel triggering is issued through the MAIN-world page script.
 */
import { findScrollRoot, getThreadRoot, getTurnEl } from "../rail/nativeSkeleton";
import { viewport } from "../rail/active";
import { PageHistoryBridge, type HistoryBridge } from "./historyClient";
import {
  HISTORY_LIMITS,
  historyProgressTitle,
  isChatGenerating,
  type HistoryLimits,
  type RailHistoryStatus
} from "./historyState";

export type ReadingAnchor = { visibleTurnContainerId: string; offsetFromScrollRootTop: number; scrollHeight: number };

export function captureReadingAnchor(): ReadingAnchor | null {
  const root = findScrollRoot();
  const area = viewport(root);
  let visibleTurnContainerId = "";
  for (const node of getThreadRoot()?.children ?? []) {
    if (!(node instanceof HTMLElement) || !node.hasAttribute("data-turn-id-container")) continue;
    const id = node.getAttribute("data-turn-id-container") ?? "";
    if (!id || id.startsWith("client-created-")) continue;
    const rect = node.getBoundingClientRect();
    if (rect.bottom > area.top && rect.top < area.top + area.height) {
      visibleTurnContainerId = id;
      return { visibleTurnContainerId, offsetFromScrollRootTop: rect.top - area.top, scrollHeight: root.scrollHeight };
    }
  }
  return { visibleTurnContainerId, offsetFromScrollRootTop: 0, scrollHeight: root.scrollHeight };
}

export function restoreReadingAnchor(anchor: ReadingAnchor | null): void {
  if (!anchor) return;
  const root = findScrollRoot();
  const area = viewport(root);
  const current = anchor.visibleTurnContainerId ? getTurnEl(anchor.visibleTurnContainerId) : null;
  if (current) {
    root.scrollTop += current.getBoundingClientRect().top - area.top - anchor.offsetFromScrollRootTop;
    return;
  }
  root.scrollTop += Math.max(0, root.scrollHeight - anchor.scrollHeight);
}

export function isStopGeneratingVisible(): boolean {
  return isChatGenerating();
}

type HydratorOptions = {
  getConversationId: () => string | null;
  skeletonSignature: () => string;
  materializedCount: () => number;
  totalCount: () => number;
  isMaterialized: (userMessageId: string) => boolean;
  applyBindings: () => void;
  onStatus: (status: RailHistoryStatus, title: string) => void;
  bridge?: HistoryBridge;
  limits?: Partial<HistoryLimits>;
};

type TargetWaiter = { id: string; resolve: (ok: boolean) => void; signal?: AbortSignal; onAbort?: () => void };

const wait = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
});

export class HistoryHydrator {
  private readonly limits: HistoryLimits;
  private readonly bridge: HistoryBridge;
  private conversationId: string | null = null;
  private paused = false;
  private terminal = false;
  private skipIdleResume = false;
  private inflight: Promise<boolean> | null = null;
  private epoch = 0;
  private sessionStartedAt = 0;
  private sessionPages = 0;
  private sessionLastCursor: string | null | undefined;
  private sessionStalls = 0;
  private sessionResumes = 0;
  private runAbort: AbortController | null = null;
  private activeTargetId: string | null = null;
  private waiters: TargetWaiter[] = [];
  private idleTimer = 0;
  status: RailHistoryStatus = "API_LOADING";
  constructor(private readonly opts: HydratorOptions) {
    this.limits = { ...HISTORY_LIMITS, ...opts.limits };
    this.bridge = opts.bridge ?? new PageHistoryBridge();
  }
  get sessionPageCount(): number { return this.sessionPages; }
  get sessionResumeCount(): number { return this.sessionResumes; }
  get sessionAgeMs(): number { return this.sessionStartedAt ? Date.now() - this.sessionStartedAt : 0; }
  reset(conversationId: string | null): void {
    this.epoch++;
    this.runAbort?.abort();
    this.runAbort = null;
    this.conversationId = conversationId;
    this.paused = false;
    this.terminal = false;
    this.skipIdleResume = false;
    this.inflight = null;
    this.sessionStartedAt = 0;
    this.sessionPages = 0;
    this.sessionLastCursor = undefined;
    this.sessionStalls = 0;
    this.sessionResumes = 0;
    this.failWaiters();
    this.activeTargetId = null;
    clearTimeout(this.idleTimer);
    this.status = conversationId ? "API_LOADING" : "PARTIAL_STOPPED";
    this.emit();
  }
  dispose(): void {
    this.epoch++;
    this.terminal = true;
    this.paused = true;
    this.runAbort?.abort();
    this.runAbort = null;
    this.inflight = null;
    this.failWaiters();
    clearTimeout(this.idleTimer);
  }
  pause(): void {
    this.paused = true;
    this.failWaiters();
    this.activeTargetId = null;
    this.runAbort?.abort();
    clearTimeout(this.idleTimer);
    if (!this.skipIdleResume && !this.terminal) this.idleTimer = window.setTimeout(() => this.resumeFromIdle(), this.limits.idleMs);
  }
  haltBackground(): void {
    this.paused = true;
    this.skipIdleResume = true;
    this.terminal = true;
    this.activeTargetId = null;
    clearTimeout(this.idleTimer);
    this.runAbort?.abort();
  }
  markTargetReached(userMessageId: string): void {
    this.resolveWaiters(userMessageId, true);
    if (this.activeTargetId === userMessageId) this.activeTargetId = null;
  }
  private resumeFromIdle(): void {
    this.idleTimer = 0;
    if (!this.paused || this.terminal || this.skipIdleResume || document.visibilityState === "hidden") return;
    if (this.sessionResumes >= this.limits.maxResumes) return;
    this.sessionResumes++;
    this.paused = false;
    void this.startAuto();
  }
  async startAuto(): Promise<void> {
    if (this.paused || this.terminal || this.inflight || !this.conversationId || document.visibilityState === "hidden" || isChatGenerating()) return;
    if (this.opts.totalCount() <= this.opts.materializedCount()) {
      this.completeIfDone();
      return;
    }
    const status = await this.bridge.query();
    if (!status.hasSentinel) return;
    this.ensureLoop();
    await this.inflight;
  }
  async materialize(userMessageId: string, signal?: AbortSignal): Promise<boolean> {
    if (this.opts.isMaterialized(userMessageId)) return true;
    if (this.terminal && this.sessionPages >= this.limits.maxPages) return false;
    this.failWaiters();
    this.activeTargetId = userMessageId;
    this.paused = false;
    this.skipIdleResume = false;
    if (!this.terminal || this.opts.materializedCount() < this.opts.totalCount()) this.terminal = false;
    const waiter = this.addWaiter(userMessageId, signal);
    this.ensureLoop();
    return waiter;
  }
  private addWaiter(userMessageId: string, signal?: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
      const waiter: TargetWaiter = { id: userMessageId, resolve, signal };
      const onAbort = (): void => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        if (this.activeTargetId === userMessageId) this.activeTargetId = null;
        resolve(false);
      };
      waiter.onAbort = onAbort;
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
      this.flushWaiters();
    });
  }
  private ensureLoop(): void {
    if (!this.conversationId) return;
    if (this.inflight) {
      const previous = this.inflight;
      if (this.runAbort?.signal.aborted) {
        void previous.finally(() => {
          if (!this.inflight && this.conversationId && (!this.paused || this.activeTargetId) && !this.terminal) this.startLoop();
        });
      }
      return;
    }
    this.startLoop();
  }
  private startLoop(): void {
    if (this.inflight || !this.conversationId) return;
    this.runAbort = new AbortController();
    const signal = this.runAbort.signal;
    const run = this.loop(signal).finally(() => {
      if (this.runAbort?.signal === signal) this.runAbort = null;
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
  }
  private async loop(signal: AbortSignal): Promise<boolean> {
    const epoch = this.epoch;
    if (!this.sessionStartedAt) this.sessionStartedAt = Date.now();
    this.status = "HISTORY_HYDRATING";
    this.emit();
    try {
      while (epoch === this.epoch && !this.terminal && !signal.aborted) {
        this.flushWaiters();
        if (this.activeTargetId && this.opts.isMaterialized(this.activeTargetId)) {
          this.markTargetReached(this.activeTargetId);
          if (!this.activeTargetId && this.paused) return false;
        }
        if (!this.activeTargetId && this.opts.totalCount() > 0 && this.opts.materializedCount() >= this.opts.totalCount()) {
          this.status = "COMPLETE";
          this.terminal = true;
          this.emit();
          return true;
        }
        if (this.paused && !this.activeTargetId) return false;
        if (document.visibilityState === "hidden" && !this.activeTargetId) { this.pause(); return false; }
        if (isChatGenerating() && !this.activeTargetId) { this.pause(); return false; }
        if (Date.now() - this.sessionStartedAt > this.limits.maxMs) { this.stop(); return false; }
        if (this.sessionPages >= this.limits.maxPages) { this.stop(); return false; }
        const conversationId = this.opts.getConversationId();
        if (!conversationId || conversationId !== this.conversationId) return false;
        const before = this.opts.skeletonSignature();
        const beforeCount = this.opts.materializedCount();
        const anchor = captureReadingAnchor();
        this.sessionPages++;
        const result = await this.bridge.loadPage(conversationId, signal);
        if (epoch !== this.epoch || signal.aborted) return false;
        const deadline = Date.now() + Math.min(400, this.limits.pageTimeoutMs);
        while (Date.now() < deadline && epoch === this.epoch && !signal.aborted) {
          this.opts.applyBindings();
          this.flushWaiters();
          if (this.activeTargetId && this.opts.isMaterialized(this.activeTargetId)) break;
          if (this.opts.skeletonSignature() !== before || this.opts.materializedCount() !== beforeCount) break;
          await wait(40, signal);
        }
        if (epoch !== this.epoch || signal.aborted) return false;
        this.opts.applyBindings();
        restoreReadingAnchor(anchor);
        this.flushWaiters();
        this.emit();
        if (result.status === 429 || (result.status >= 400 && !result.ok)) { this.stop(); return false; }
        if (!result.triggered && !(this.activeTargetId && this.opts.isMaterialized(this.activeTargetId))) { this.stop(); return false; }
        if (result.hasPreviousPage === false) {
          this.opts.applyBindings();
          this.flushWaiters();
          if (this.opts.materializedCount() >= this.opts.totalCount()) {
            this.status = "COMPLETE";
            this.terminal = true;
          } else this.stop();
          this.emit();
          return this.activeTargetId ? this.opts.isMaterialized(this.activeTargetId) : this.status === "COMPLETE";
        }
        if (result.cursor && result.cursor === this.sessionLastCursor) { this.stop(); return false; }
        if (result.cursor) this.sessionLastCursor = result.cursor;
        if (this.opts.skeletonSignature() === before && this.opts.materializedCount() === beforeCount) {
          this.sessionStalls++;
          if (this.sessionStalls >= this.limits.stallRounds) { this.stop(); return false; }
        } else this.sessionStalls = 0;
      }
      return this.activeTargetId ? this.opts.isMaterialized(this.activeTargetId) : this.opts.materializedCount() >= this.opts.totalCount();
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return false;
      this.stop();
      return false;
    } finally {
      this.emit();
    }
  }
  private flushWaiters(): void {
    for (const waiter of [...this.waiters]) {
      if (this.opts.isMaterialized(waiter.id)) this.resolveWaiters(waiter.id, true);
    }
  }
  private resolveWaiters(id: string, ok: boolean): void {
    const matched = this.waiters.filter(waiter => waiter.id === id);
    this.waiters = this.waiters.filter(waiter => waiter.id !== id);
    for (const waiter of matched) {
      if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(ok);
    }
  }
  private failWaiters(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const waiter of pending) {
      if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(false);
    }
  }
  private completeIfDone(): void {
    if (this.opts.totalCount() > 0 && this.opts.materializedCount() >= this.opts.totalCount()) {
      this.status = "COMPLETE";
      this.terminal = true;
      this.emit();
    }
  }
  private stop(): void {
    this.terminal = true;
    this.status = this.opts.materializedCount() >= this.opts.totalCount() && this.opts.totalCount() > 0
      ? "COMPLETE"
      : "PARTIAL_STOPPED";
    this.failWaiters();
    this.activeTargetId = null;
    this.emit();
  }
  private emit(): void {
    this.opts.onStatus(this.status, historyProgressTitle(this.opts.materializedCount(), this.opts.totalCount(), this.status));
  }
}
