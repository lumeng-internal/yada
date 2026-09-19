import type { ConversationSync } from "../core/conversationSync";
import type { ConversationSnapshot } from "../core/types";
import type { YadaTurn } from "../conversation/types";
import { NativeNavigationPort } from "./nativeNavigationPort";
import type { NavigationResult } from "./types";

export class NavigatorController {
  private readonly port = new NativeNavigationPort();
  private snapshot: ConversationSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly sync: ConversationSync) {}

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => {
      this.snapshot = snapshot;
    });
  }

  async navigateTo(turnId: string, signal?: AbortSignal): Promise<NavigationResult> {
    const snapshot = this.snapshot ?? this.sync.getSnapshot();
    if (!snapshot) return { ok: false, status: "failed" };
    return this.port.navigateTo(turnId, snapshot.activeTurns, snapshot.conversationId, { signal });
  }

  cancel(): void {
    this.port.cancel();
  }

  currentTurns(): YadaTurn[] {
    return this.snapshot?.activeTurns ?? [];
  }

  lastDiagnostics() {
    return this.port.lastDiagnostics;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.port.dispose();
  }
}
