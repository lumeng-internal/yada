import { loadCurrentConversationSnapshot } from "../conversation/normalizeConversation";
import type { YadaTurn } from "../conversation/types";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import { closestOfficialButton, resolveOfficialTurnIndex } from "./map";
import { PreviewView } from "./view";

export class NativePreviewController {
  private readonly view = new PreviewView();
  private turns: YadaTurn[] = [];
  private route: string | null | undefined;
  private epoch = 0;
  private disposed = false;
  private request: AbortController | null = null;
  private fetching = false;
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
    this.request?.abort();
    this.request = null;
    this.fetching = false;
    this.turns = [];
    this.clearPreview();
    if (id) void this.fetchTurns();
  }

  dispose(): void {
    this.disposed = true;
    this.epoch++;
    this.request?.abort();
    this.request = null;
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

  private previewButton(button: HTMLButtonElement): void {
    this.currentButton = button;
    if (!this.turns.length) return;
    const index = resolveOfficialTurnIndex(button, this.turns.length);
    const turn = index == null ? undefined : this.turns[index];
    if (!turn) {
      this.view.hide();
      return;
    }
    this.view.show(turn, button);
  }

  private clearPreview(): void {
    this.currentButton = null;
    this.view.hide();
  }

  private async fetchTurns(): Promise<void> {
    const id = this.route;
    const epoch = this.epoch;
    if (!id || this.disposed || this.fetching) return;
    this.fetching = true;
    const request = new AbortController();
    this.request = request;
    try {
      const snapshot = await loadCurrentConversationSnapshot({ conversationId: id, signal: request.signal });
      if (epoch !== this.epoch || this.disposed) return;
      this.turns = snapshot.turns;
      if (this.currentButton?.isConnected) this.previewButton(this.currentButton);
    } catch {
      if (epoch !== this.epoch || this.disposed || request.signal.aborted) return;
      this.turns = [];
    } finally {
      if (epoch === this.epoch && !this.disposed) this.fetching = false;
    }
  }
}
