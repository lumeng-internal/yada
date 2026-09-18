import type { ConversationRepository } from "../core/conversationRepository";
import type { ConversationSnapshot } from "../core/types";
import type { NavigatorController } from "../navigation/navigatorController";
import { OfficialNavSuppressor } from "../navigation/officialNavSuppressor";
import { findScrollRoot, readVisibleUserMessageId, type ScrollRoot } from "./active";
import { placeRail } from "./layout";
import { RailView } from "./view";

export class YadaRailController {
  private readonly view: RailView;
  private readonly suppressor = new OfficialNavSuppressor();
  private unsubscribe: (() => void) | null = null;
  private snapshot: ConversationSnapshot | null = null;
  private root: ScrollRoot | null = null;
  private disposed = false;
  private raf = 0;
  private jumping = false;

  constructor(
    private readonly repository: ConversationRepository,
    private readonly navigator: NavigatorController
  ) {
    this.view = new RailView((id) => { void this.jump(id); });
  }

  mount(): void {
    this.unsubscribe = this.repository.subscribe((snapshot) => this.onSnapshot(snapshot));
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
    this.view.setTurns([]);
    this.view.clearHover();
    this.suppressor.disable();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onLayout);
    window.removeEventListener("scroll", this.onScroll, true);
    this.root?.removeEventListener("scroll", this.onScroll);
    this.suppressor.dispose();
    this.view.dispose();
  }

  private onSnapshot(snapshot: ConversationSnapshot | null): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    const turns = snapshot?.activeTurns ?? [];
    this.view.setTurns(turns);
    if (turns.length) {
      this.suppressor.enable();
      this.layout();
      this.syncActive();
    } else {
      this.suppressor.disable();
    }
  }

  private async jump(turnId: string): Promise<void> {
    if (this.jumping) this.navigator.cancel();
    this.jumping = true;
    this.view.setStatus("定位中");
    try {
      const result = await this.navigator.navigateTo(turnId);
      if (result.status === "cancelled") {
        this.view.setStatus("");
        return;
      }
      if (!result.ok) {
        this.view.setStatus("定位失败");
        return;
      }
      this.view.setStatus("");
      this.syncActive();
    } finally {
      this.jumping = false;
    }
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
