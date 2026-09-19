import type { ConversationSync } from "../core/conversationSync";
import type { ConversationSnapshot } from "../core/types";
import type { NavigatorController } from "../navigation/navigatorController";
import { NATIVE_NAV_CONFIG } from "../navigation/config";
import { findScrollRoot, readVisibleUserMessageId, type ScrollRoot } from "./active";
import { placeRail } from "./layout";
import { RailView } from "./view";

export class YadaRailController {
  private readonly view: RailView;
  private unsubscribe: (() => void) | null = null;
  private snapshot: ConversationSnapshot | null = null;
  private root: ScrollRoot | null = null;
  private disposed = false;
  private raf = 0;
  private jumping = false;
  private jumpGeneration = 0;
  private jumpTarget: string | null = null;
  private failTimer = 0;

  constructor(
    private readonly sync: ConversationSync,
    private readonly navigator: NavigatorController
  ) {
    this.view = new RailView((id) => { void this.jump(id); });
  }

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
    window.addEventListener("resize", this.onLayout, { passive: true });
    window.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
    this.root = findScrollRoot();
    this.root.addEventListener("scroll", this.onScroll, { passive: true });
  }

  setPreviewMode(assistant: boolean): void {
    this.view.setPreviewMode(assistant);
  }

  clear(): void {
    this.snapshot = null;
    this.jumping = false;
    this.jumpTarget = null;
    window.clearTimeout(this.failTimer);
    this.view.setTurns([]);
    this.view.clearHover();
    this.view.setPending(null);
    this.view.setFailed(null);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.cancelAnimationFrame(this.raf);
    window.clearTimeout(this.failTimer);
    window.removeEventListener("resize", this.onLayout);
    window.removeEventListener("scroll", this.onScroll, true);
    this.root?.removeEventListener("scroll", this.onScroll);
    this.view.dispose();
  }

  private onSnapshot(snapshot: ConversationSnapshot | null): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    const turns = snapshot?.activeTurns ?? [];
    this.view.setTurns(turns);
    if (turns.length) {
      this.layout();
      if (!this.jumping) this.syncActive();
    }
  }

  private async jump(turnId: string): Promise<void> {
    if (this.jumping && this.jumpTarget === turnId) return;
    const generation = ++this.jumpGeneration;
    this.jumpTarget = turnId;
    window.clearTimeout(this.failTimer);
    this.view.setFailed(null);
    this.jumping = true;
    const index = this.turnIndex(turnId);
    this.view.setPending(index);
    try {
      const result = await this.navigator.navigateTo(turnId);
      if (generation !== this.jumpGeneration) return;
      this.view.setPending(null);
      if (!result.ok && result.status === "cancelled") {
        this.syncActive();
        return;
      }
      if (!result.ok) {
        this.view.setFailed(index);
        this.failTimer = window.setTimeout(() => {
          if (generation !== this.jumpGeneration) return;
          this.view.setFailed(null);
          this.syncActive();
        }, NATIVE_NAV_CONFIG.failStyleMs);
        return;
      }
      if (index >= 0) this.view.setActive(index);
    } finally {
      if (generation === this.jumpGeneration) {
        this.jumping = false;
        this.jumpTarget = null;
      }
    }
  }

  private turnIndex(turnId: string): number {
    const turns = this.snapshot?.activeTurns ?? [];
    return turns.findIndex((turn) => turn.id === turnId || turn.userMessageId === turnId);
  }

  private readonly onLayout = (): void => {
    this.layout();
  };

  private readonly onScroll = (): void => {
    if (this.raf) return;
    this.raf = window.requestAnimationFrame(() => {
      this.raf = 0;
      this.syncActive();
    });
  };

  private layout(): void {
    this.root = findScrollRoot();
    placeRail(this.view.host, this.root, this.snapshot?.activeTurns.length ?? 0);
  }

  private syncActive(): void {
    if (this.jumping) return;
    const turns = this.snapshot?.activeTurns ?? [];
    if (!turns.length) return;
    this.root = findScrollRoot();
    const visibleId = readVisibleUserMessageId(this.root);
    const index = visibleId
      ? turns.findIndex((turn) => turn.userMessageId === visibleId || turn.id === visibleId)
      : -1;
    if (index >= 0) this.view.setActive(index);
  }
}
