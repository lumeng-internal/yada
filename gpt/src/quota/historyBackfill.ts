import { fetchConversation } from "../conversation/fetchConversation";
import { extractAssistantUsageEvents } from "../conversation/extractAssistantUsageEvents";
import { readAccountContext } from "./account";
import { DAY_MS } from "./rules";
import { toQuotaEvents } from "./usageScanner";
import { BACKFILL_KEY, type BackfillStatus, type QuotaBackfillState } from "./types";

const WEEK_MS = 7 * DAY_MS;
const MAX_CONCURRENCY = 2;
const PAGE_LIMIT = 28;
const GAP_MS = 180;
const MAX_RETRIES = 3;

export class HistoryBackfill {
  private aborted = false;

  async run(): Promise<BackfillStatus> {
    const state = await readBackfillState();
    if (state.status === "complete" || state.status === "unavailable") return state.status;
    this.aborted = false;
    const cutoffAt = state.cutoffAt || Date.now() - WEEK_MS;
    state.cutoffAt = cutoffAt;
    state.status = "running";
    state.updatedAt = Date.now();
    await writeBackfillState(state);

    try {
      let offset = state.cursorOffset;
      while (!this.aborted) {
        if (document.visibilityState === "hidden") {
          state.status = "paused";
          await writeBackfillState(state);
          return "paused";
        }
        const page = await fetchConversationList(offset);
        if (page === "unavailable") {
          state.status = "unavailable";
          await writeBackfillState(state);
          return "unavailable";
        }
        if (!page.items.length) {
          state.status = "complete";
          await writeBackfillState(state);
          return "complete";
        }
        const due = page.items.filter((item) => item.updateTime >= cutoffAt);
        if (!due.length) {
          state.status = "complete";
          await writeBackfillState(state);
          return "complete";
        }
        await this.scanItems(due, state);
        offset += page.items.length;
        state.cursorOffset = offset;
        await writeBackfillState(state);
        if (!page.hasMore || due.length < page.items.length) {
          state.status = "complete";
          await writeBackfillState(state);
          return "complete";
        }
      }
      state.status = "paused";
      await writeBackfillState(state);
      return "paused";
    } catch {
      state.status = "error";
      await writeBackfillState(state);
      return "error";
    }
  }

  pause(): void {
    this.aborted = true;
  }

  private async scanItems(items: ConversationListItem[], state: QuotaBackfillState): Promise<void> {
    const pending = items.filter((item) => state.scanned[item.id] == null);
    for (let i = 0; i < pending.length; i += MAX_CONCURRENCY) {
      if (this.aborted) return;
      const batch = pending.slice(i, i + MAX_CONCURRENCY);
      await Promise.all(batch.map((item) => this.scanOne(item, state)));
      await sleep(GAP_MS);
    }
  }

  private async scanOne(item: ConversationListItem, state: QuotaBackfillState): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const conversation = await fetchConversation(item.id);
        const events = extractAssistantUsageEvents(conversation);
        const account = readAccountContext();
        const quotaEvents = toQuotaEvents(events, account.accountKey, "history");
        if (quotaEvents.length) {
          await chrome.runtime.sendMessage({ type: "quota/ingest", events: quotaEvents });
        }
        state.scanned[item.id] = conversation.update_time ?? Date.now();
        state.updatedAt = Date.now();
        return;
      } catch {
        await sleep(GAP_MS * (attempt + 1));
      }
    }
  }
}

type ConversationListItem = { id: string; updateTime: number };

async function fetchConversationList(offset: number): Promise<{ items: ConversationListItem[]; hasMore: boolean } | "unavailable"> {
  try {
    const response = await fetch(`/backend-api/conversations?offset=${offset}&limit=${PAGE_LIMIT}&order=updated`, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (response.status === 401 || response.status === 403 || response.status === 404) return "unavailable";
    if (!response.ok) throw new Error(`list ${response.status}`);
    const data = await response.json() as { items?: Array<{ id?: string; conversation_id?: string; update_time?: number }>; has_missing_conversations?: boolean };
    const items = (data.items ?? [])
      .map((item) => ({ id: item.id ?? item.conversation_id ?? "", updateTime: (item.update_time ?? 0) * (item.update_time && item.update_time < 1e12 ? 1000 : 1) }))
      .filter((item) => item.id);
    return { items, hasMore: items.length === PAGE_LIMIT };
  } catch {
    return "unavailable";
  }
}

async function readBackfillState(): Promise<QuotaBackfillState> {
  const data = await chrome.storage.local.get(BACKFILL_KEY);
  const value = data[BACKFILL_KEY] as QuotaBackfillState | undefined;
  if (!value || value.version !== 1) {
    return { version: 1, status: "idle", cutoffAt: Date.now() - WEEK_MS, scanned: {}, cursorOffset: 0, updatedAt: Date.now() };
  }
  return value;
}

async function writeBackfillState(state: QuotaBackfillState): Promise<void> {
  await chrome.storage.local.set({ [BACKFILL_KEY]: state });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getBackfillStatus(): Promise<BackfillStatus> {
  return (await readBackfillState()).status;
}
