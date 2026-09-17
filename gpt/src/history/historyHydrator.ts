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
  type HistoryPageResult,
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
  private resumes = 0;
  private idleTimer = 0;
  private terminal = false;
  private targetId: string | null = null;
  private inflight: Promise<boolean> | null = null;
  private epoch = 0;
  status: RailHistoryStatus = "API_LOADING";
  constructor(private readonly opts: HydratorOptions) {
    this.limits = { ...HISTORY_LIMITS, ...opts.limits };
    this.bridge = opts.bridge ?? new PageHistoryBridge();
  }
  reset(conversationId: string | null): void {
    this.epoch++;
    this.conversationId = conversationId;
    this.paused = false;
    this.resumes = 0;
    this.terminal = false;
    this.targetId = null;
    this.inflight = null;
    clearTimeout(this.idleTimer);
    this.status = conversationId ? "API_LOADING" : "PARTIAL_STOPPED";
    this.emit();
  }
  dispose(): void {
    this.epoch++;
    this.terminal = true;
    this.paused = true;
    this.inflight = null;
    clearTimeout(this.idleTimer);
  }
  pause(): void {
    this.paused = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.resumeFromIdle(), this.limits.idleMs);
  }
  private resumeFromIdle(): void {
    this.idleTimer = 0;
    if (!this.paused || this.terminal || document.visibilityState === "hidden") return;
    if (this.resumes >= this.limits.maxResumes) return;
    this.resumes++;
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
    await this.begin();
  }
  async materialize(userMessageId: string, signal?: AbortSignal): Promise<boolean> {
    if (this.opts.isMaterialized(userMessageId)) return true;
    this.targetId = userMessageId;
    const wasPaused = this.paused;
    this.paused = false;
    this.terminal = false;
    try {
      return await this.begin(signal);
    } finally {
      this.targetId = null;
      this.paused = wasPaused;
    }
  }
  private begin(signal?: AbortSignal): Promise<boolean> {
    return this.inflight ??= this.loop(signal).finally(() => { this.inflight = null; });
  }
  private async loop(signal?: AbortSignal): Promise<boolean> {
    const epoch = this.epoch, started = Date.now();
    let pages = 0, stalls = 0, lastCursor: string | null | undefined;
    const fetchState: { current: HistoryPageResult | null } = { current: null };
    const unsub = this.bridge.subscribe(event => {
      if (event.type === "fetch-result") fetchState.current = {
        ok: event.ok !== false,
        status: event.status ?? 0,
        triggered: true,
        generation: event.generation ?? 0,
        hasSentinel: event.hasSentinel === true,
        hasPreviousPage: event.hasPreviousPage,
        cursor: event.cursor,
        conversationId: event.conversationId
      };
    });
    this.status = "HISTORY_HYDRATING";
    this.emit();
    try {
      while (epoch === this.epoch && !this.terminal) {
        if (signal?.aborted) return false;
        if (this.targetId && this.opts.isMaterialized(this.targetId)) return true;
        if (!this.targetId && this.opts.totalCount() > 0 && this.opts.materializedCount() >= this.opts.totalCount()) {
          this.status = "COMPLETE";
          this.terminal = true;
          this.emit();
          return true;
        }
        if (this.paused && !this.targetId) return false;
        if (document.visibilityState === "hidden" && !this.targetId) { this.pause(); return false; }
        if (isChatGenerating() && !this.targetId) { this.pause(); return false; }
        if (Date.now() - started > this.limits.maxMs) { this.stop(); return false; }
        if (pages >= this.limits.maxPages) { this.stop(); return false; }
        const conversationId = this.opts.getConversationId();
        if (!conversationId || conversationId !== this.conversationId) return false;
        const before = this.opts.skeletonSignature();
        const beforeCount = this.opts.materializedCount();
        const anchor = captureReadingAnchor();
        pages++;
        const result = await this.bridge.loadPage(conversationId, signal);
        if (epoch !== this.epoch) return false;
        const deadline = Date.now() + this.limits.pageTimeoutMs;
        while (Date.now() < deadline && epoch === this.epoch) {
          if (signal?.aborted) return false;
          if (fetchState.current && fetchState.current.conversationId === conversationId && (fetchState.current.status === 429 || (fetchState.current.status >= 400 && !fetchState.current.ok))) break;
          this.opts.applyBindings();
          if (this.targetId && this.opts.isMaterialized(this.targetId)) break;
          if (this.opts.skeletonSignature() !== before || this.opts.materializedCount() !== beforeCount) break;
          await wait(40, signal);
        }
        if (epoch !== this.epoch) return false;
        this.opts.applyBindings();
        restoreReadingAnchor(anchor);
        this.emit();
        const fetch = fetchState.current?.conversationId === conversationId ? fetchState.current : result;
        fetchState.current = null;
        if (fetch.status === 429 || (fetch.status >= 400 && !fetch.ok)) { this.stop(); return false; }
        if (!result.triggered && !this.opts.isMaterialized(this.targetId ?? "")) { this.stop(); return false; }
        if (fetch.hasPreviousPage === false) {
          this.opts.applyBindings();
          if (this.opts.materializedCount() >= this.opts.totalCount()) {
            this.status = "COMPLETE";
            this.terminal = true;
          } else this.stop();
          this.emit();
          return this.targetId ? this.opts.isMaterialized(this.targetId) : this.status === "COMPLETE";
        }
        if (fetch.cursor && fetch.cursor === lastCursor) { this.stop(); return false; }
        if (fetch.cursor) lastCursor = fetch.cursor;
        if (this.opts.skeletonSignature() === before && this.opts.materializedCount() === beforeCount) {
          stalls++;
          if (stalls >= this.limits.stallRounds) { this.stop(); return false; }
        } else stalls = 0;
      }
      return this.targetId ? this.opts.isMaterialized(this.targetId) : this.opts.materializedCount() >= this.opts.totalCount();
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return false;
      this.stop();
      return false;
    } finally {
      unsub();
      this.emit();
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
    this.emit();
  }
  private emit(): void {
    this.opts.onStatus(this.status, historyProgressTitle(this.opts.materializedCount(), this.opts.totalCount(), this.status));
  }
}
