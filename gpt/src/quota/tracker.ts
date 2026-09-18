import type { ConversationSync } from "../core/conversationSync";
import type { ConversationSnapshot } from "../core/types";
import { chatgptApi, fetchConversation } from "../conversation/fetchConversation";
import { readChatAccount, readModelLimits } from "./pageClient";
import type { QuotaClassification, QuotaUsageEvent } from "./types";
import { createChromeHistoryStore, readChatHistory } from "./vibebar/historyReader";
import type { ChatGPTChatTurn } from "./vibebar/types";

export class QuotaTracker {
  private unsubscribe: (() => void) | null = null;
  private ingestQueue: Promise<void> = Promise.resolve();
  private history = createChromeHistoryStore();
  private disposed = false;

  constructor(private readonly sync: ConversationSync) {}

  mount(): void {
    this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.scanHistory();
  }

  async refreshCurrent(): Promise<void> {
    await this.sync.requestSync("popup");
    await this.ingestQueue;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private onSnapshot(snapshot: ConversationSnapshot | null): Promise<void> {
    const work = this.writeLedger(snapshot);
    this.ingestQueue = this.ingestQueue.then(() => work, () => work);
    return work;
  }

  private async writeLedger(snapshot: ConversationSnapshot | null): Promise<void> {
    if (this.disposed || !snapshot) return;
    const account = await readChatAccount();
    const limits = await readModelLimits();
    const classification = classifySnapshot(snapshot);
    const events = snapshot.quotaIsWork
      ? []
      : toEvents(snapshot.quotaTurns, account.identity, classification);
    await chrome.runtime.sendMessage({
      type: "quota/ingest",
      events,
      plan: account.plan,
      unclassifiedTurns: snapshot.quotaUnclassifiedTurns,
      workspaceKind: snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal",
      limits,
      historyComplete: undefined,
      accountKey: account.identity
    });
  }

  private async scanHistory(): Promise<void> {
    if (this.disposed || document.visibilityState === "hidden") return;
    const account = await readChatAccount();
    const result = await readChatHistory({
      transport: {
        async request(path, signal) {
          const response = await chatgptApi(path, { signal });
          if (response.status === 401 || response.status === 403) throw Object.assign(new Error("login"), { name: "AbortError" });
          if (!response.ok) throw new Error(`history ${response.status}`);
          return response.json();
        }
      },
      fetchDetail: (id, signal) => fetchConversation(id, signal),
      store: this.history,
      identity: account.identity,
      now: Date.now()
    });
    if (this.disposed) return;
    const events = toEvents(result.turns, account.identity, "personal");
    await chrome.runtime.sendMessage({
      type: "quota/ingest",
      events,
      plan: account.plan,
      unclassifiedTurns: result.summary.unclassifiedTurns,
      historyComplete: result.summary.complete,
      workspaceKind: "personal",
      accountKey: account.identity
    });
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "visible") void this.scanHistory();
  };
}

function classifySnapshot(snapshot: ConversationSnapshot): QuotaClassification {
  if (snapshot.quotaIsWork) return "work";
  if (snapshot.quotaTemporary) return "temporary";
  if (snapshot.quotaOrigin && snapshot.quotaOrigin !== "chat" && snapshot.quotaOrigin !== "chatgpt") return "unknown";
  return "personal";
}

function toEvents(turns: readonly ChatGPTChatTurn[], accountKey: string, classification: QuotaClassification): QuotaUsageEvent[] {
  return turns.map((turn) => ({
    id: turn.id,
    accountKey,
    createdAt: turn.createdAt,
    model: turn.model,
    classification
  }));
}
