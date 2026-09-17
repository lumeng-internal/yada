import { readChatGPTOfficialNavigation } from "./officialNavigation";
import { bindDomAnchorsToTurns } from "../conversation/domCollector";
import { isInsideComposer } from "../conversation/composerGuard";
import { loadCurrentConversationSnapshot } from "../conversation/normalizeConversation";
import type { YadaTurn } from "../conversation/types";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import { getActiveTurn, resolveScrollRoot, type ScrollRoot } from "./active";
import { placeRail } from "./layout";
import { jumpToTurn } from "./jump";
import { RailView } from "./view";

export class RailController {
  private readonly view = new RailView(id => { void this.jump(id); });
  private apiTurns: YadaTurn[] = [];
  private turns: YadaTurn[] = [];
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
  constructor() {
    this.resize = new ResizeObserver(() => this.scheduleRefresh());
    this.mutation = new MutationObserver(records => {
      const relevant = records.filter(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return element && !element.closest('[data-yada-root]') && !isInsideComposer(element)
          && !(record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every(node => node instanceof Element && node.matches('[data-yada-root]')));
      });
      if (!relevant.length) return;
      this.syncOfficialNavigation();
      this.scheduleRefresh();
      if (relevant.some(record => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        return record.type !== "attributes" && !!element?.closest('main, #thread');
      })) this.scheduleApi();
    });
    this.mutation.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-message-id', 'data-turn-id', 'class', 'style', 'hidden', 'aria-hidden'] });
    window.addEventListener("resize", this.scheduleRefresh, { passive: true });
    window.addEventListener("wheel", this.cancelJump, { passive: true });
    window.addEventListener("touchstart", this.cancelJump, { passive: true });
    window.addEventListener("keydown", this.cancelJumpOnKey);
  }
  setPreviewMode(assistant: boolean): void { this.view.setPreviewMode(assistant); }
  syncRoute(): void {
    const id = getConversationIdFromUrl();
    if (this.route === id) { this.scheduleRefresh(); return; }
    this.epoch++; this.route = id; this.request?.abort(); this.cancelJump();
    clearTimeout(this.apiTimer); clearTimeout(this.refreshTimer); cancelAnimationFrame(this.raf);
    this.apiTimer = this.refreshTimer = this.raf = 0;
    this.fetching = this.pendingFetch = false; this.failures = 0; this.lastFetch = 0;
    this.apiTurns = []; this.turns = []; this.view.clearHover(); this.view.setTurns([]);
    this.bindRoot(null);
    if (id) void this.fetchTurns();
  }
  dispose(): void {
    this.disposed = true; this.epoch++; this.request?.abort(); this.cancelJump();
    clearTimeout(this.apiTimer); clearTimeout(this.refreshTimer); cancelAnimationFrame(this.raf);
    this.mutation.disconnect(); this.resize.disconnect(); this.bindRoot(null);
    window.removeEventListener("resize", this.scheduleRefresh);
    window.removeEventListener("wheel", this.cancelJump);
    window.removeEventListener("touchstart", this.cancelJump);
    window.removeEventListener("keydown", this.cancelJumpOnKey);
    this.view.dispose();
  }
  private cancelJump = (): void => { this.jumping?.abort(); this.jumping = null; this.view.setStatus(""); };
  private cancelJumpOnKey = (event: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape', ' '].includes(event.key)) this.cancelJump();
  };
  private async jump(id: string): Promise<void> {
    this.cancelJump(); this.view.clearHover();
    if (this.syncOfficialNavigation()) return;
    const request = new AbortController(); this.jumping = request;
    this.view.setStatus("定位中");
    try {
      const found = await jumpToTurn(id, this.refreshAnchors, () => this.root ?? resolveScrollRoot(), request.signal, () => this.view.setStatus("定位中"));
      if (this.jumping !== request) return;
      if (!request.signal.aborted) this.view.setStatus(found ? "定位成功" : "该轮暂时无法定位");
      else this.view.setStatus("");
    } catch { if (!request.signal.aborted) this.view.setStatus("该轮暂时无法定位"); }
    finally { if (this.jumping === request) this.jumping = null; }
  }
  private syncOfficialNavigation(): boolean {
    const official = readChatGPTOfficialNavigation().ready;
    this.view.setSuppressed(official);
    if (official) { this.cancelJump(); this.view.clearHover(); }
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
      // The immutable API model is always rebound from scratch: virtual lists can recycle DOM nodes.
      this.apiTurns = snapshot.turns;
      this.view.setTurns(this.apiTurns); this.refreshAnchors();
    } catch {
      if (epoch !== this.epoch || this.disposed) return;
      this.failures++;
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
  private refreshAnchors = (): YadaTurn[] => {
    if (this.disposed || !this.route) return [];
    this.turns = bindDomAnchorsToTurns(this.apiTurns);
    const first = this.turns.find(turn => turn.userAnchorElement?.isConnected)?.userAnchorElement;
    this.bindRoot(resolveScrollRoot(first));
    // Reattach the same host if the application removed it during a layout transition.
    if (!this.view.host.isConnected) document.documentElement.append(this.view.host);
    placeRail(this.view.host, this.root!, this.turns.length);
    this.syncOfficialNavigation();
    this.view.setActive(getActiveTurn(this.turns, this.root!));
    return this.turns;
  };
  private bindRoot(root: ScrollRoot | null): void {
    if (this.root !== root) {
      this.root?.removeEventListener("scroll", this.onScroll);
      // Document scrolling dispatches on document, internal containers on the element itself.
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
      if (this.root && !this.disposed) this.view.setActive(getActiveTurn(this.turns, this.root));
    });
  };
}
