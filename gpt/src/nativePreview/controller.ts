import { loadCurrentConversationSnapshot } from "../conversation/normalizeConversation";
import type { YadaTurn } from "../conversation/types";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import { closestOfficialButton, officialButtons, resolveOfficialTurnIndex } from "./map";
import { PreviewView } from "./view";

const DOM_REFRESH_DEBOUNCE_MS = 600;
const AUTO_REFRESH_GAP_MS = 2000;

export class NativePreviewController {
  private readonly view = new PreviewView();
  private turns: YadaTurn[] = [];
  private route: string | null | undefined;
  private epoch = 0;
  private disposed = false;
  private request: AbortController | null = null;
  private fetching = false;
  private pendingRefresh = false;
  private debounceTimer = 0;
  private gapTimer = 0;
  private lastAutoRefreshAt = 0;
  private snapshotButtonCount = 0;
  private currentButton: HTMLButtonElement | null = null;
  private readonly mutation: MutationObserver;

  constructor() {
    document.addEventListener("pointerover", this.onPointerOver);
    document.addEventListener("pointerout", this.onPointerOut);
    document.addEventListener("focusin", this.onFocusIn);
    document.addEventListener("focusout", this.onFocusOut);
    window.addEventListener("scroll", this.onReposition, true);
    window.addEventListener("resize", this.onReposition);
    this.mutation = new MutationObserver(() => {
      if (this.currentButton && !this.currentButton.isConnected) this.clearPreview();
      this.scheduleAutoRefresh();
    });
    this.mutation.observe(document.documentElement, { childList: true, subtree: true });
  }

  setPreviewMode(assistant: boolean): void {
    this.view.setPreviewMode(assistant);
  }

  syncRoute(): void {
    const id = getConversationIdFromUrl();
    if (id === this.route) return;
    this.epoch++;
    this.route = id;
    this.resetRequestState();
    this.turns = [];
    this.snapshotButtonCount = 0;
    this.lastAutoRefreshAt = 0;
    this.clearPreview();
    if (id) void this.fetchTurns();
  }

  dispose(): void {
    this.disposed = true;
    this.epoch++;
    this.resetRequestState();
    this.clearPreview();
    this.mutation.disconnect();
    document.removeEventListener("pointerover", this.onPointerOver);
    document.removeEventListener("pointerout", this.onPointerOut);
    document.removeEventListener("focusin", this.onFocusIn);
    document.removeEventListener("focusout", this.onFocusOut);
    window.removeEventListener("scroll", this.onReposition, true);
    window.removeEventListener("resize", this.onReposition);
    this.view.dispose();
  }

  private onPointerOver = (event: PointerEvent): void => {
    const button = closestOfficialButton(event.target);
    if (button) this.previewButton(button);
  };

  private onPointerOut = (event: PointerEvent): void => {
    const from = closestOfficialButton(event.target);
    const to = closestOfficialButton(event.relatedTarget);
    if (from && from !== to) {
      if (to) this.previewButton(to);
      else if (this.currentButton === from) this.clearPreview();
    }
  };

  private onFocusIn = (event: FocusEvent): void => {
    const button = closestOfficialButton(event.target);
    if (button) this.previewButton(button);
  };

  private onFocusOut = (event: FocusEvent): void => {
    const from = closestOfficialButton(event.target);
    const to = closestOfficialButton(event.relatedTarget);
    if (from && from !== to) {
      if (to) this.previewButton(to);
      else if (this.currentButton === from) this.clearPreview();
    }
  };

  private onReposition = (): void => {
    if (!this.currentButton) return;
    if (!this.currentButton.isConnected) {
      this.clearPreview();
      return;
    }
    this.view.reposition();
  };

  private previewButton(button: HTMLButtonElement, fromFetch = false): void {
    this.currentButton = button;
    const index = resolveOfficialTurnIndex(button, this.turns.length);
    const turn = index == null ? undefined : this.turns[index];
    if (!turn) {
      this.view.hide();
      if (!fromFetch) this.requestRefresh("hover");
      return;
    }
    this.view.show(turn, button);
    if (!fromFetch && index === this.turns.length - 1 && !turn.assistantMarkdown) {
      this.requestRefresh("hover");
    }
  }

  private clearPreview(): void {
    this.currentButton = null;
    this.view.hide();
  }

  private officialButtonCount(): number {
    return officialButtons().length;
  }

  private shouldAutoRefresh(): boolean {
    if (!this.route || this.disposed) return false;
    const count = this.officialButtonCount();
    return count > this.turns.length && count > this.snapshotButtonCount;
  }

  private scheduleAutoRefresh(): void {
    if (!this.shouldAutoRefresh()) return;
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = 0;
      this.requestRefresh("auto");
    }, DOM_REFRESH_DEBOUNCE_MS);
  }

  private requestRefresh(reason: "auto" | "hover"): void {
    if (!this.route || this.disposed) return;
    if (reason === "auto" && !this.shouldAutoRefresh()) return;
    if (this.fetching) {
      this.pendingRefresh = true;
      return;
    }
    if (reason === "hover") this.clearTimers();
    if (reason === "auto") {
      const remaining = this.lastAutoRefreshAt ? AUTO_REFRESH_GAP_MS - (Date.now() - this.lastAutoRefreshAt) : 0;
      if (remaining > 0) {
        if (this.gapTimer) window.clearTimeout(this.gapTimer);
        this.gapTimer = window.setTimeout(() => {
          this.gapTimer = 0;
          this.requestRefresh("auto");
        }, remaining);
        return;
      }
      this.lastAutoRefreshAt = Date.now();
    }
    void this.fetchTurns();
  }

  private resetRequestState(): void {
    this.request?.abort();
    this.request = null;
    this.fetching = false;
    this.pendingRefresh = false;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = 0;
    }
    if (this.gapTimer) {
      window.clearTimeout(this.gapTimer);
      this.gapTimer = 0;
    }
  }

  private async fetchTurns(): Promise<void> {
    const id = this.route;
    const epoch = this.epoch;
    if (!id || this.disposed || this.fetching) return;
    this.fetching = true;
    this.pendingRefresh = false;
    const request = new AbortController();
    this.request = request;
    try {
      const snapshot = await loadCurrentConversationSnapshot({ conversationId: id, signal: request.signal });
      if (epoch !== this.epoch || this.disposed) return;
      this.turns = snapshot.turns;
      this.snapshotButtonCount = this.officialButtonCount();
      if (this.currentButton?.isConnected) this.previewButton(this.currentButton, true);
    } catch {
      if (epoch !== this.epoch || this.disposed || request.signal.aborted) return;
      this.snapshotButtonCount = this.officialButtonCount();
    } finally {
      if (epoch !== this.epoch || this.disposed) return;
      this.fetching = false;
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        void this.fetchTurns();
      }
    }
  }
}
