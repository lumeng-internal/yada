import { officialButtons } from "../nativePreview/map";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import {
  captureReadAnchor,
  conversationScrollContainer,
  exposePaginationSentinel,
  paginationSentinels,
  readAnchorOffset,
  restorePaginationSentinel,
  type ReadAnchor
} from "./dom";
import { currentConversationId, isMessageDeepLink } from "./history";
import {
  MAX_ACTIVE_MS,
  MAX_EXTRA_PAGES,
  MAX_RESUMES,
  MIN_USER_TURNS,
  MIN_VIEWPORT_WIDTH,
  MISSING_ANCHOR_FRAMES,
  PREPARE_RENEW_MS,
  READ_DRIFT_PX,
  STALLED_ROUNDS,
  USER_IDLE_MS,
  YADA_CONTENT_SOURCE,
  YADA_PAGE_SOURCE,
  emptyHistoryState,
  waitForPageCommit,
  type HistoryState,
  type PrepareStatus
} from "./shared";

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"]);

export type PrepareBlockReason =
  | "用户操作已暂停"
  | "正在生成回答"
  | "页面过窄"
  | "历史请求失败"
  | "加载达到上限"
  | "页面结构暂不兼容"
  | "历史完整但 ChatGPT 未显示官方导航";

export interface PrepareContext {
  conversationId: string | null;
  visible: boolean;
  width: number;
  hover: boolean;
  deepLink: boolean;
  generating: boolean;
  customNav: boolean;
  expectedTurns: number;
  capturedPrompts: number;
  officialCount: number;
  history: HistoryState;
}

export function supportsHoverPointer(media: (query: string) => { matches: boolean } = query => window.matchMedia(query)): boolean {
  return media("(hover: hover)").matches && media("(pointer: fine)").matches;
}

export function isGeneratingResponse(root: ParentNode = document): boolean {
  return Boolean(root.querySelector([
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop generating" i]',
    'button[aria-label*="Stop streaming" i]',
    '[data-is-streaming="true"]',
    ".result-streaming"
  ].join(",")));
}

export function hasLegacyCustomNav(root: ParentNode = document): boolean {
  const legacyHostId = ["chatgpt", "yada", "rail", "host"].join("-");
  if (root instanceof Document && root.getElementById(legacyHostId)) return true;
  return Boolean(root.querySelector('[aria-label^="跳到第"], .mark-bar, .marks[role="navigation"]'));
}

export function visibleUserTurns(root: ParentNode = document): number {
  return root.querySelectorAll('[data-message-author-role="user"]').length;
}

export function getPrepareBlockReason(ctx: PrepareContext): PrepareBlockReason | null {
  if (!ctx.conversationId) return null;
  if (ctx.deepLink) return "页面结构暂不兼容";
  if (!ctx.visible) return "用户操作已暂停";
  if (ctx.width < MIN_VIEWPORT_WIDTH) return "页面过窄";
  if (!ctx.hover) return "页面结构暂不兼容";
  if (ctx.generating) return "正在生成回答";
  if (ctx.customNav) return "页面结构暂不兼容";
  const turns = Math.max(ctx.expectedTurns, ctx.capturedPrompts);
  if (turns < MIN_USER_TURNS) return "页面结构暂不兼容";
  if (ctx.history.issue === "http-error" || ctx.history.issue === "capture-unavailable") return "历史请求失败";
  if (ctx.history.issue === "limit") return "加载达到上限";
  return null;
}

function officialNavComplete(expectedTurns: number, officialCount: number, userTurns: number): boolean {
  if (officialCount <= 0) return false;
  if (expectedTurns >= MIN_USER_TURNS && officialCount === expectedTurns) return true;
  return userTurns >= MIN_USER_TURNS && officialCount === userTurns;
}

export class NativeBootstrapController {
  private history = emptyHistoryState();
  private expectedTurns = 0;
  private conversationId: string | null = null;
  private disposed = false;
  private running = false;
  private paused = false;
  private ready = false;
  private incomplete = false;
  private reason: PrepareBlockReason | null = null;
  private resumes = 0;
  private extraPages = 0;
  private activeMs = 0;
  private activeStarted = 0;
  private idleTimer = 0;
  private renewTimer = 0;
  private watchFrame = 0;
  private missingAnchor = 0;
  private anchor: ReadAnchor | null = null;
  private loopToken = 0;
  private stalledRounds = 0;

  constructor(private readonly onStatus: (status: PrepareStatus) => void = () => {}) {
    window.addEventListener("message", this.onMessage);
    window.addEventListener("wheel", this.onUserIntent, { capture: true, passive: true });
    window.addEventListener("touchstart", this.onUserIntent, { capture: true, passive: true });
    window.addEventListener("pointerdown", this.onUserIntent, { capture: true, passive: true });
    window.addEventListener("keydown", this.onKeyIntent, true);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.postMessage({
      source: YADA_CONTENT_SOURCE,
      type: "request-state",
      conversationId: currentConversationId() ?? ""
    }, location.origin);
  }

  setExpectedTurns(turns: number): void {
    this.expectedTurns = Math.max(0, Math.floor(turns));
    this.publishStatus();
    if (!this.running && !this.paused) this.maybeStart();
  }

  syncRoute(): void {
    const id = currentConversationId();
    this.resetSession(id);
    if (id) this.maybeStart();
  }

  dispose(): void {
    this.disposed = true;
    this.stopWork("hidden");
    window.removeEventListener("message", this.onMessage);
    window.removeEventListener("wheel", this.onUserIntent, true);
    window.removeEventListener("touchstart", this.onUserIntent, true);
    window.removeEventListener("pointerdown", this.onUserIntent, true);
    window.removeEventListener("keydown", this.onKeyIntent, true);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private resetSession(id: string | null): void {
    this.stopWork("hidden");
    this.conversationId = id;
    this.history = emptyHistoryState(id ?? "");
    this.expectedTurns = 0;
    this.resumes = 0;
    this.extraPages = 0;
    this.activeMs = 0;
    this.ready = false;
    this.incomplete = false;
    this.reason = null;
    this.paused = false;
    this.stalledRounds = 0;
    window.postMessage({
      source: YADA_CONTENT_SOURCE,
      type: "request-state",
      conversationId: id ?? ""
    }, location.origin);
    this.publishStatus();
  }

  private context(): PrepareContext {
    return {
      conversationId: this.conversationId ?? getConversationIdFromUrl(),
      visible: document.visibilityState === "visible",
      width: window.innerWidth,
      hover: supportsHoverPointer(),
      deepLink: isMessageDeepLink(),
      generating: isGeneratingResponse(),
      customNav: hasLegacyCustomNav(),
      expectedTurns: this.expectedTurns,
      capturedPrompts: this.history.prompts,
      officialCount: officialButtons().length,
      history: this.history
    };
  }

  private maybeStart(): void {
    if (this.disposed || this.running || this.ready) return;
    const ctx = this.context();
    if (!ctx.conversationId) {
      this.publishStatus();
      return;
    }
    const navComplete = officialNavComplete(this.expectedTurns, ctx.officialCount, visibleUserTurns());
    if (navComplete && this.history.boundary === "complete" && !this.history.issue) {
      this.finishReady();
      return;
    }
    if (navComplete) {
      this.publishStatus();
      return;
    }
    const blocked = getPrepareBlockReason(ctx);
    if (blocked) {
      if (blocked !== "页面过窄" && this.expectedTurns >= MIN_USER_TURNS) {
        this.reason = blocked;
        this.incomplete = true;
      }
      this.publishStatus();
      return;
    }
    if (this.history.boundary === "complete" && !officialNavComplete(this.expectedTurns, ctx.officialCount, visibleUserTurns())) {
      this.reason = "历史完整但 ChatGPT 未显示官方导航";
      this.incomplete = true;
      this.publishStatus();
      return;
    }
    if (this.history.boundary !== "more" && this.history.pages > 0 && this.history.boundary !== "unknown") {
      this.publishStatus();
      return;
    }
    if (this.history.pages === 0) {
      this.publishStatus();
      return;
    }
    if (this.activeMs >= MAX_ACTIVE_MS || this.extraPages >= MAX_EXTRA_PAGES) {
      this.reason = "加载达到上限";
      this.incomplete = true;
      this.publishStatus();
      return;
    }
    if (paginationSentinels().length !== 1 && this.history.boundary === "more") {
      this.reason = "页面结构暂不兼容";
      this.incomplete = true;
      this.publishStatus();
      return;
    }
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.incomplete = false;
    this.reason = null;
    this.loopToken += 1;
    const token = this.loopToken;
    this.activeStarted = Date.now();
    this.setBoost(true);
    this.startWatch();
    this.publishStatus();
    try {
      while (!this.disposed && this.running && token === this.loopToken) {
        if (this.budgetExceeded()) {
          this.fail("加载达到上限");
          return;
        }
        const ctx = this.context();
        const blocked = getPrepareBlockReason(ctx);
        if (blocked) {
          if (blocked === "用户操作已暂停" || blocked === "正在生成回答") this.interrupt(blocked);
          else this.fail(blocked);
          return;
        }
        if (this.history.issue === "unlinked" || this.history.issue === "stalled") {
          this.fail("页面结构暂不兼容");
          return;
        }
        if (this.history.issue === "http-error" || this.history.issue === "capture-unavailable") {
          this.fail("历史请求失败");
          return;
        }
        if (this.isSuccess()) {
          this.finishReady();
          return;
        }
        if (this.history.boundary === "complete") {
          this.fail("历史完整但 ChatGPT 未显示官方导航");
          return;
        }
        if (this.history.pages > 0 && this.history.boundary !== "more") {
          this.fail("页面结构暂不兼容");
          return;
        }
        if (paginationSentinels().length !== 1) {
          await waitForPageCommit(80);
          if (paginationSentinels().length !== 1) {
            this.stalledRounds += 1;
            if (this.stalledRounds >= STALLED_ROUNDS) {
              this.fail("页面结构暂不兼容");
              return;
            }
            continue;
          }
        }

        const pagesBefore = this.history.pages;
        const revisionBefore = this.history.revision;
        const sentinel = exposePaginationSentinel();
        if (!sentinel) {
          this.fail("页面结构暂不兼容");
          return;
        }
        const requested = await this.waitForOlderRequest(token);
        restorePaginationSentinel(sentinel);
        if (!this.running || token !== this.loopToken) return;
        if (!requested) {
          this.stalledRounds += 1;
          if (this.stalledRounds >= STALLED_ROUNDS) {
            this.fail("页面结构暂不兼容");
            return;
          }
          continue;
        }
        const advanced = await this.waitForPageAdvance(token, pagesBefore);
        if (!this.running || token !== this.loopToken) return;
        await waitForPageCommit();
        if (!this.running || token !== this.loopToken) return;
        this.extraPages += 1;
        if (advanced && (this.history.pages > pagesBefore || this.history.revision > revisionBefore)) {
          this.stalledRounds = 0;
        } else {
          this.stalledRounds += 1;
          if (this.stalledRounds >= STALLED_ROUNDS) {
            this.fail("页面结构暂不兼容");
            return;
          }
        }
        if (this.isSuccess()) {
          this.finishReady();
          return;
        }
      }
    } finally {
      restorePaginationSentinel();
      this.accountActiveTime();
      if (this.running && token === this.loopToken) this.running = false;
      this.setBoost(this.running);
      this.publishStatus();
    }
  }

  private waitForOlderRequest(token: number): Promise<boolean> {
    const pendingAtStart = this.history.pending;
    const pagesAtStart = this.history.pages;
    return new Promise(resolve => {
      const started = Date.now();
      const tick = (): void => {
        if (!this.running || token !== this.loopToken) {
          resolve(false);
          return;
        }
        if (this.history.pending > pendingAtStart || this.history.pages > pagesAtStart) {
          restorePaginationSentinel();
          resolve(true);
          return;
        }
        if (Date.now() - started > 8_000) {
          resolve(false);
          return;
        }
        window.setTimeout(tick, 32);
      };
      tick();
    });
  }

  private waitForPageAdvance(token: number, pagesBefore: number): Promise<boolean> {
    return new Promise(resolve => {
      const started = Date.now();
      const tick = (): void => {
        if (!this.running || token !== this.loopToken) {
          resolve(false);
          return;
        }
        if (this.history.pending === 0 && this.history.pages > pagesBefore) {
          resolve(true);
          return;
        }
        if (this.history.issue === "http-error" || this.history.issue === "capture-unavailable") {
          resolve(false);
          return;
        }
        if (Date.now() - started > 8_000) {
          resolve(this.history.pages > pagesBefore);
          return;
        }
        window.setTimeout(tick, 32);
      };
      tick();
    });
  }

  private startWatch(): void {
    this.anchor = captureReadAnchor(conversationScrollContainer());
    this.missingAnchor = 0;
    const tick = (): void => {
      if (!this.running || this.disposed) {
        this.watchFrame = 0;
        return;
      }
      if (isGeneratingResponse()) {
        this.interrupt("正在生成回答");
        return;
      }
      if (!this.anchor || !this.anchor.container.isConnected) {
        this.interrupt("用户操作已暂停");
        return;
      }
      const offset = readAnchorOffset(this.anchor);
      if (offset == null) {
        this.missingAnchor += 1;
        if (this.missingAnchor >= MISSING_ANCHOR_FRAMES) {
          this.interrupt("用户操作已暂停");
          return;
        }
      } else {
        this.missingAnchor = 0;
        if (Math.abs(offset - this.anchor.offset) > READ_DRIFT_PX) {
          this.interrupt("用户操作已暂停");
          return;
        }
      }
      this.watchFrame = requestAnimationFrame(tick);
    };
    this.watchFrame = requestAnimationFrame(tick);
  }

  private interrupt(reason: PrepareBlockReason): void {
    if (!this.running && this.paused) {
      this.reason = reason;
      this.publishStatus();
      return;
    }
    this.accountActiveTime();
    this.running = false;
    this.paused = true;
    this.loopToken += 1;
    restorePaginationSentinel();
    this.stopWatch();
    this.setBoost(false);
    this.reason = reason;
    this.incomplete = true;
    this.publishStatus();
    if (reason === "用户操作已暂停") this.scheduleResume();
  }

  private scheduleResume(): void {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = 0;
      if (this.disposed || this.running || this.ready) return;
      if (this.resumes >= MAX_RESUMES) {
        this.reason = "用户操作已暂停";
        this.incomplete = true;
        this.publishStatus();
        return;
      }
      this.resumes += 1;
      this.paused = false;
      this.maybeStart();
    }, USER_IDLE_MS);
  }

  private fail(reason: PrepareBlockReason): void {
    this.accountActiveTime();
    this.running = false;
    this.paused = false;
    this.loopToken += 1;
    restorePaginationSentinel();
    this.stopWatch();
    this.setBoost(false);
    this.reason = reason;
    this.incomplete = true;
    this.ready = false;
    this.publishStatus();
  }

  private finishReady(): void {
    this.accountActiveTime();
    this.running = false;
    this.paused = false;
    this.ready = true;
    this.incomplete = false;
    this.reason = null;
    this.loopToken += 1;
    restorePaginationSentinel();
    this.stopWatch();
    this.setBoost(false);
    this.publishStatus();
  }

  private isSuccess(): boolean {
    if (this.history.boundary !== "complete") return false;
    if (this.history.issue) return false;
    return officialNavComplete(this.expectedTurns, officialButtons().length, visibleUserTurns());
  }

  private budgetExceeded(): boolean {
    return this.extraPages >= MAX_EXTRA_PAGES || this.activeMs + (this.activeStarted ? Date.now() - this.activeStarted : 0) >= MAX_ACTIVE_MS;
  }

  private accountActiveTime(): void {
    if (!this.activeStarted) return;
    this.activeMs += Date.now() - this.activeStarted;
    this.activeStarted = 0;
  }

  private stopWatch(): void {
    if (this.watchFrame) {
      cancelAnimationFrame(this.watchFrame);
      this.watchFrame = 0;
    }
    this.anchor = null;
  }

  private stopWork(kind: PrepareStatus["kind"]): void {
    this.running = false;
    this.paused = false;
    this.loopToken += 1;
    restorePaginationSentinel();
    this.stopWatch();
    this.setBoost(false);
    window.clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    if (kind === "hidden") {
      this.ready = false;
      this.incomplete = false;
      this.reason = null;
    }
  }

  private setBoost(active: boolean): void {
    window.clearTimeout(this.renewTimer);
    this.renewTimer = 0;
    const conversationId = this.conversationId ?? "";
    const post = (on: boolean): void => {
      window.postMessage({
        source: YADA_CONTENT_SOURCE,
        type: "prepare-boost",
        conversationId,
        active: on
      }, location.origin);
    };
    post(active);
    if (!active || !conversationId) return;
    const renew = (): void => {
      if (!this.running || this.disposed) return;
      post(true);
      this.renewTimer = window.setTimeout(renew, PREPARE_RENEW_MS);
    };
    this.renewTimer = window.setTimeout(renew, PREPARE_RENEW_MS);
  }

  private onMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin) return;
    const data = event.data as { source?: string; type?: string; state?: HistoryState } | null;
    if (!data || data.source !== YADA_PAGE_SOURCE || data.type !== "history-state" || !data.state) return;
    if (this.conversationId && data.state.conversationId !== this.conversationId) return;
    this.history = data.state;
    if (!this.running && !this.paused && !this.ready) this.maybeStart();
    else this.publishStatus();
  };

  private onUserIntent = (): void => {
    if (!this.running && !this.paused) return;
    this.interrupt("用户操作已暂停");
  };

  private onKeyIntent = (event: KeyboardEvent): void => {
    if (!SCROLL_KEYS.has(event.key)) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const editable = target.closest("input, textarea, select, [contenteditable='true']");
      if (editable) return;
    }
    this.onUserIntent();
  };

  private onVisibility = (): void => {
    if (document.visibilityState !== "visible") {
      if (this.running) this.interrupt("用户操作已暂停");
      return;
    }
    if (this.paused) this.scheduleResume();
    else this.maybeStart();
  };

  private publishStatus(): void {
    const id = this.conversationId;
    if (!id) {
      this.onStatus({ kind: "hidden" });
      return;
    }
    const current = officialButtons().length || this.history.prompts;
    const total = Math.max(this.expectedTurns, this.history.prompts, current);
    if (this.ready) {
      this.onStatus({ kind: "ready", current: total, total });
      return;
    }
    if (this.running) {
      this.onStatus({ kind: "preparing", current, total });
      return;
    }
    if (this.incomplete && this.reason) {
      this.onStatus({ kind: "incomplete", current, total, reason: this.reason, title: this.reason });
      return;
    }
    this.onStatus({ kind: "hidden" });
  }
}
