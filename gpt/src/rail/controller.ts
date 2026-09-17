import { observeOfficialNavigation, readChatGPTOfficialNavigation } from "./officialNavigation";
import { NativeSkeleton, findScrollRoot, skeletonSignature, syncActive, type RailEntry } from "./nativeSkeleton";
import { observeRouteChange } from "../utils/route";
import { isInsideComposer } from "../conversation/composerGuard";
import { loadCurrentConversationSnapshot } from "../conversation/normalizeConversation";
import type { YadaTurn } from "../conversation/types";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import { type ScrollRoot } from "./active";
import { placeRail } from "./layout";
import { jumpToTurn } from "./jump";
import { RailView } from "./view";
import { HistoryHydrator } from "../history/historyHydrator";
import {
  canUseMessageFallback,
  clearPendingJump,
  markMessageFallbackUsed,
  readPendingJump,
  replaceWithMessageQuery,
  writePendingJump
} from "../history/pendingNavigation";

export class RailController {
  private readonly view = new RailView(id => { void this.jump(id); });
  private apiTurns: YadaTurn[] = [];
  private entries: RailEntry[] = [];
  private readonly skeleton = new NativeSkeleton();
  private readonly hydrator: HistoryHydrator;
  private official = false;
  private officialDispose: () => void;
  private routeDispose: () => void;
  private root: ScrollRoot | null = null;
  private route: string | null = null;
  private epoch = 0;
  private disposed = false;
  private mutation: MutationObserver;
  private resize: ResizeObserver;
  private resizeTargets: Element[] = [];
  private refreshTimer = 0;
  private apiTimer = 0;
  private raf = 0;
  private lastFetch = 0;
  private fetching = false;
  private pendingFetch = false;
  private failures = 0;
  private request: AbortController | null = null;
  private jumping: AbortController | null = null;
  private restoringPending = false;
  constructor() {
    this.hydrator = new HistoryHydrator({
      getConversationId: () => this.route,
      skeletonSignature: () => skeletonSignature(this.skeleton.collect()),
      materializedCount: () => this.entries.filter(entry => entry.materialized).length,
      totalCount: () => this.apiTurns.length,
      isMaterialized: id => this.entries.some(entry => entry.userMessageId === id && entry.materialized),
      applyBindings: () => { this.refreshAnchors(); },
      onStatus: (status, title) => {
        this.view.host.dataset.yadaHistoryStatus = status;
        this.view.setHydrateTitle(title);
      }
    });
    this.resize = new ResizeObserver(() => this.scheduleRefresh());
    this.mutation = new MutationObserver(records => {
      const relevant = records.filter(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return element && !element.closest('[data-yada-root]') && !isInsideComposer(element)
          && !(record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every(node => node instanceof Element && node.matches('[data-yada-root]')));
      });
      if (!relevant.length) return;
      this.syncRoute();
      this.scheduleRefresh();
      if (relevant.some(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return record.type !== "attributes" && !!element?.closest('main, #thread');
      })) this.scheduleApi();
    });
    this.mutation.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-turn-id-container', 'data-turn', 'data-turn-id', 'class', 'style', 'hidden', 'aria-hidden'] });
    this.officialDispose = observeOfficialNavigation(() => this.syncOfficialNavigation());
    this.routeDispose = observeRouteChange(() => this.syncRoute());
    window.addEventListener("resize", this.scheduleRefresh, { passive: true });
    window.addEventListener("wheel", this.onUserInterrupt, { passive: true });
    window.addEventListener("touchstart", this.onUserInterrupt, { passive: true });
    window.addEventListener("pointerdown", this.onUserInterrupt, { passive: true });
    window.addEventListener("keydown", this.onUserKey);
    document.addEventListener("visibilitychange", this.onVisibility);
  }
  setPreviewMode(assistant: boolean): void { this.view.setPreviewMode(assistant); }
  syncRoute(): void {
    const id = getConversationIdFromUrl();
    if (this.route === id) { this.scheduleRefresh(); return; }
    this.epoch++; this.route = id; this.request?.abort(); this.cancelJump();
    clearTimeout(this.apiTimer); clearTimeout(this.refreshTimer); cancelAnimationFrame(this.raf);
    this.apiTimer = this.refreshTimer = this.raf = 0;
    this.fetching = this.pendingFetch = false; this.failures = 0; this.lastFetch = 0;
    this.apiTurns = []; this.entries = []; this.skeleton.reset(); this.hydrator.reset(id);
    this.view.clearHover(); this.view.setHydrateTitle(""); this.view.setEntries([]);
    this.bindRoot(null);
    if (id) { this.refreshAnchors(); void this.fetchTurns(); void this.restorePending(id); }
  }
  dispose(): void {
    this.disposed = true; this.epoch++; this.request?.abort(); this.cancelJump(); this.hydrator.dispose();
    clearTimeout(this.apiTimer); clearTimeout(this.refreshTimer); cancelAnimationFrame(this.raf);
    this.officialDispose(); this.routeDispose(); this.mutation.disconnect(); this.resize.disconnect(); this.bindRoot(null);
    window.removeEventListener("resize", this.scheduleRefresh);
    window.removeEventListener("wheel", this.onUserInterrupt);
    window.removeEventListener("touchstart", this.onUserInterrupt);
    window.removeEventListener("pointerdown", this.onUserInterrupt);
    window.removeEventListener("keydown", this.onUserKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.view.dispose();
  }
  private cancelJump = (): void => { this.jumping?.abort(); this.jumping = null; this.view.setStatus(""); };
  private onUserInterrupt = (): void => { this.cancelJump(); this.hydrator.pause(); };
  private onUserKey = (event: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape', ' '].includes(event.key)) this.onUserInterrupt();
  };
  private onVisibility = (): void => { if (document.visibilityState === "hidden") this.hydrator.pause(); };
  private async jump(userMessageId: string): Promise<void> {
    this.cancelJump(); this.view.clearHover();
    const entry = this.entries.find(item => item.userMessageId === userMessageId);
    if (!entry) return;
    const request = new AbortController(); this.jumping = request;
    this.view.setStatus("定位中");
    try {
      const found = await jumpToTurn(entry, this.entries, request.signal, {
        materialize: async (id, signal) => {
          const ok = await this.hydrator.materialize(id, signal);
          this.refreshAnchors();
          return ok ? this.entries.find(item => item.userMessageId === id) ?? null : null;
        },
        fallbackRefresh: () => this.useMessageFallback(entry)
      });
      if (this.jumping !== request) return;
      if (found) {
        clearPendingJump();
        if (!request.signal.aborted) this.view.setStatus("定位成功");
      } else if (!request.signal.aborted) this.view.setStatus("该轮暂时无法定位");
      else this.view.setStatus("");
    } catch { if (!request.signal.aborted) this.view.setStatus("该轮暂时无法定位"); }
  }
  private useMessageFallback(entry: RailEntry): boolean {
    const id = this.route;
    if (!id || this.restoringPending || !canUseMessageFallback(id)) return false;
    writePendingJump({ conversationId: id, userMessageId: entry.userMessageId, index: entry.index, attempted: true });
    markMessageFallbackUsed(id);
    return replaceWithMessageQuery();
  }
  private async restorePending(conversationId: string): Promise<void> {
    const pending = readPendingJump();
    if (!pending || pending.conversationId !== conversationId) return;
    this.restoringPending = true;
    const epoch = this.epoch;
    for (let i = 0; i < 40 && epoch === this.epoch && !this.disposed; i++) {
      this.refreshAnchors();
      const entry = this.entries.find(item => item.userMessageId === pending.userMessageId);
      if (entry && (entry.materialized || readChatGPTOfficialNavigation().ready)) {
        await this.jump(pending.userMessageId);
        clearPendingJump();
        this.restoringPending = false;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    clearPendingJump();
    this.restoringPending = false;
  }
  private syncOfficialNavigation(): boolean {
    const official = readChatGPTOfficialNavigation().ready;
    if (official === this.official) return official;
    this.official = official;
    this.view.setSuppressed(official);
    if (official) { this.cancelJump(); this.view.clearHover(); }
    else this.refreshAnchors();
    return official;
  }
  private scheduleApi(): void {
    if (!this.route || this.disposed || this.apiTimer) return;
    if (this.fetching) { this.pendingFetch = true; return; }
    this.apiTimer = window.setTimeout(() => { this.apiTimer = 0; void this.fetchTurns(); }, Math.max(600, 5000 - (Date.now() - this.lastFetch)));
  }
  private async fetchTurns(): Promise<void> {
    const id = this.route, epoch = this.epoch;
    if (!id || this.disposed || this.fetching) return;
    this.fetching = true; this.lastFetch = Date.now();
    const request = new AbortController(); this.request = request;
    try {
      const snapshot = await loadCurrentConversationSnapshot({ conversationId: id, signal: request.signal });
      if (epoch !== this.epoch || this.disposed) return;
      this.failures = 0;
      this.apiTurns = snapshot.turns;
      this.refreshAnchors();
    } catch {
      if (epoch !== this.epoch || this.disposed) return;
      this.failures++;
      this.view.setHydrateTitle("会话读取失败，等待重新读取完整会话");
      this.view.host.title = "会话读取失败，等待重新读取完整会话";
      if (this.failures <= 3) this.pendingFetch = true;
    } finally {
      if (epoch === this.epoch && !this.disposed) {
        this.fetching = false;
        if (this.pendingFetch) { this.pendingFetch = false; this.scheduleApi(); }
      }
    }
  }
  private scheduleRefresh = (): void => {
    if (this.disposed || this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(() => { this.refreshTimer = 0; this.refreshAnchors(); }, 160);
  };
  private refreshAnchors = (): RailEntry[] => {
    if (this.disposed || !this.route) return [];
    this.entries = this.skeleton.scan(this.apiTurns);
    this.view.setEntries(this.entries);
    this.bindRoot(findScrollRoot());
    if (!this.view.host.isConnected) document.documentElement.append(this.view.host);
    placeRail(this.view.host, this.root!, this.entries.length);
    this.syncOfficialNavigation();
    this.view.setActive(syncActive(this.entries, this.root!));
    if (this.apiTurns.length) void this.hydrator.startAuto();
    return this.entries;
  };
  private bindRoot(root: ScrollRoot | null): void {
    if (this.root !== root) {
      this.root?.removeEventListener("scroll", this.onScroll);
      document.removeEventListener("scroll", this.onScroll);
      this.root = root;
      if (root === document.scrollingElement) document.addEventListener("scroll", this.onScroll, { passive: true });
      else root?.addEventListener("scroll", this.onScroll, { passive: true });
    }
    const targets = (root ? [root, document.querySelector('main')] : []).filter((element): element is HTMLElement => element instanceof HTMLElement);
    if (targets.length !== this.resizeTargets.length || targets.some((element, index) => this.resizeTargets[index] !== element)) {
      this.resize.disconnect(); targets.forEach(element => this.resize.observe(element)); this.resizeTargets = targets;
    }
  }
  private onScroll = (): void => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.root && !this.disposed) this.view.setActive(syncActive(this.entries, this.root));
    });
  };
}
