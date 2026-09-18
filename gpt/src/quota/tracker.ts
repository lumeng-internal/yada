import type { ConversationRepository } from "../core/conversationRepository";
import type { ConversationSnapshot } from "../core/types";
import { readAccountContext } from "./account";
import { HistoryBackfill } from "./historyBackfill";
import { toQuotaEvents } from "./usageScanner";

const REFRESH_AFTER_ANSWER_MS = 1100;

export class QuotaTracker {
  private unsubscribe: (() => void) | null = null;
  private conversationId: string | null = null;
  private backfill = new HistoryBackfill();
  private answerTimer = 0;
  private mutation: MutationObserver | null = null;
  private disposed = false;

  constructor(private readonly repository: ConversationRepository) {}

  mount(): void {
    this.unsubscribe = this.repository.subscribe((snapshot) => {
      void this.onSnapshot(snapshot);
    });
    this.mutation = new MutationObserver(() => this.observeAnswerLifecycle());
    this.mutation.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-is-streaming"] });
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.backfill.run();
  }

  setConversationId(conversationId: string | null): void {
    this.conversationId = conversationId;
  }

  async refreshCurrent(): Promise<void> {
    if (!this.conversationId) return;
    await this.repository.refresh(this.conversationId, "popup");
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.mutation?.disconnect();
    this.mutation = null;
    window.clearTimeout(this.answerTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.backfill.pause();
  }

  private async onSnapshot(snapshot: ConversationSnapshot | null): Promise<void> {
    if (this.disposed || !snapshot) return;
    this.conversationId = snapshot.conversationId;
    const account = readAccountContext(snapshot.assistantEvents[0]?.workspaceKind);
    const events = toQuotaEvents(snapshot.assistantEvents, account.accountKey, "live").map((event) => (
      account.workspaceKind === "work" || event.workspaceKind === "work"
        ? { ...event, workspaceKind: "work" as const, accountKey: account.accountKey }
        : { ...event, accountKey: account.accountKey, workspaceKind: account.workspaceKind === "personal" ? event.workspaceKind === "unknown" ? account.workspaceKind : event.workspaceKind : event.workspaceKind }
    ));
    if (!events.length) return;
    await chrome.runtime.sendMessage({ type: "quota/ingest", events });
  }

  private observeAnswerLifecycle(): void {
    if (this.disposed || !this.conversationId) return;
    const streaming = document.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming');
    if (streaming) {
      window.clearTimeout(this.answerTimer);
      this.answerTimer = 0;
      return;
    }
    if (this.answerTimer) return;
    this.answerTimer = window.setTimeout(() => {
      this.answerTimer = 0;
      if (this.conversationId) void this.repository.refresh(this.conversationId, "answer-complete");
    }, REFRESH_AFTER_ANSWER_MS);
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") this.backfill.pause();
    else void this.backfill.run();
  };
}
