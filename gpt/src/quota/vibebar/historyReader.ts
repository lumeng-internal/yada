/**
 * Upstream: AstroQore/vibe-bar
 * Upstream file: Sources/VibeBarCore/Services/ChatGPTChatHistoryReader.swift
 * Commit: af26391c5bcc074108072af8f2807fc4c47edf21
 * License: AGPL-3.0
 * Port: Swift → TypeScript for ChatGPT Yada
 */

import { identity, isWork, parseConversation } from "./conversationParser";
import { asObject, parseDate, type JsonObject } from "./json";
import type { ChatGPTChatConversation, ChatGPTChatHistoryCache, ChatGPTChatHistorySummary, ChatGPTChatTurn } from "./types";

export const HISTORY_WINDOW_SECONDS = 7 * 86_400;
export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_PAGES = 4;
export const HISTORY_DETAIL_BUDGET = 24;
export const HISTORY_DEADLINE_MS = 25_000;
export const HISTORY_CACHE_KEY = "chatgpt-yada:quota-history:v2";

export type HistoryTransport = {
  request(path: string, signal?: AbortSignal): Promise<unknown>;
};

// Browser transport explicitly marks temporary failures; parsing errors are not retryable.
export class RetryableHistoryTransportError extends Error {}

export type HistoryStore = {
  load(identity: string): Promise<ChatGPTChatHistoryCache>;
  save(cache: ChatGPTChatHistoryCache, identity: string): Promise<void>;
};

export type HistoryReadResult = {
  turns: ChatGPTChatTurn[];
  summary: ChatGPTChatHistorySummary;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createMemoryHistoryStore(): HistoryStore {
  const all = new Map<string, ChatGPTChatHistoryCache>();
  return {
    async load(identity) {
      return all.get(identity) ?? { conversations: {} };
    },
    async save(cache, identity) {
      all.set(identity, cache);
    }
  };
}

export function createChromeHistoryStore(): HistoryStore {
  return {
    async load(identity) {
      const data = await chrome.storage.local.get(HISTORY_CACHE_KEY);
      const all = (data[HISTORY_CACHE_KEY] as Record<string, ChatGPTChatHistoryCache> | undefined) ?? {};
      return all[identity] ?? { conversations: {} };
    },
    async save(cache, identity) {
      const data = await chrome.storage.local.get(HISTORY_CACHE_KEY);
      const all = (data[HISTORY_CACHE_KEY] as Record<string, ChatGPTChatHistoryCache> | undefined) ?? {};
      all[identity] = cache;
      await chrome.storage.local.set({ [HISTORY_CACHE_KEY]: all });
    }
  };
}

export async function readChatHistory(input: {
  transport: HistoryTransport;
  store: HistoryStore;
  identity: string;
  now: number;
  signal?: AbortSignal;
  windowSeconds?: number;
  pageSize?: number;
  maxPages?: number;
  detailBudget?: number;
  deadlineMs?: number;
  clock?: () => number;
  fetchDetail?: (id: string, signal?: AbortSignal) => Promise<unknown>;
}): Promise<HistoryReadResult> {
  const windowSeconds = input.windowSeconds ?? HISTORY_WINDOW_SECONDS;
  const pageSize = input.pageSize ?? HISTORY_PAGE_SIZE;
  const maxPages = input.maxPages ?? HISTORY_MAX_PAGES;
  const detailBudget = input.detailBudget ?? HISTORY_DETAIL_BUDGET;
  const deadlineMs = input.deadlineMs ?? HISTORY_DEADLINE_MS;
  const clock = input.clock ?? Date.now;
  const cutoff = input.now - windowSeconds * 1000;
  const deadline = input.now + deadlineMs;
  let cache = await input.store.load(input.identity);
  const keepAfter = input.now - 2 * windowSeconds * 1000;
  cache = {
    conversations: Object.fromEntries(
      Object.entries(cache.conversations).filter(([, value]) => value.updatedAt >= keepAfter)
    )
  };

  const seen = new Set<string>();
  let streamsFinished = 0;
  let failures = 0;
  let retryableFailures = 0;
  let permanentFailures = 0;
  let work = 0;
  let unknown = 0;
  let fetched = 0;
  let fetchedSuccessfully = 0;
  let read = 0;
  let cancelled = false;
  let hitDeadline = false;
  let hitDetailBudget = false;
  const turns: ChatGPTChatTurn[] = [];

  const aborted = (): boolean => Boolean(input.signal?.aborted);
  const recordFailure = (error: unknown): void => {
    failures += 1;
    if (error instanceof RetryableHistoryTransportError) retryableFailures += 1;
    else permanentFailures += 1;
  };

  try {
    for (const archived of [false, true]) {
      let offset = 0;
      let reachedEnd = false;
      for (let page = 0; page < maxPages; page++) {
        if (aborted()) throw abortError();
        if (clock() >= deadline) {
          hitDeadline = true;
          break;
        }
        const path = `/backend-api/conversations?offset=${offset}&limit=${pageSize}&order=updated&is_archived=${archived}`;
        const data = await input.transport.request(path, input.signal);
        const root = asObject(data);
        const items = Array.isArray(root.items) ? root.items as JsonObject[] : null;
        if (!items) throw new Error("ChatGPT Chat history list has no items.");
        const before = seen.size;
        for (const item of items) {
          const id = typeof item.id === "string" ? item.id : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const updated = parseDate(item.update_time);
          if (updated != null && updated < cutoff) {
            reachedEnd = true;
            continue;
          }
          if (isWork(typeof item.conversation_origin === "string" ? item.conversation_origin : null, null)) {
            work += 1;
            continue;
          }
          if (item.is_temporary_chat === true) continue;
          if (!UUID.test(id) || updated == null) {
            failures += 1;
            permanentFailures += 1;
            continue;
          }
          const key = await identity(id);
          let parsed: ChatGPTChatConversation | undefined = cache.conversations[key];
          if (parsed?.updatedAt !== updated) {
            if (fetched < detailBudget && clock() < deadline) {
              fetched += 1;
              try {
                const detail = await (input.fetchDetail
                  ? input.fetchDetail(id, input.signal)
                  : input.transport.request(`/backend-api/conversation/${id}`, input.signal));
                parsed = await parseConversation(detail, id, updated, cutoff);
                cache.conversations[key] = parsed;
                fetchedSuccessfully += 1;
              } catch (error) {
                if (isAbortError(error)) throw error;
                recordFailure(error);
              }
            } else {
              if (fetched >= detailBudget) hitDetailBudget = true;
              if (clock() >= deadline) hitDeadline = true;
              failures += 1;
            }
          }
          if (parsed) {
            read += 1;
            if (parsed.isWork) work += 1;
            unknown += parsed.unclassifiedTurns;
            turns.push(...parsed.turns);
          }
        }
        offset += items.length;
        if (!items.length || items.length < pageSize) reachedEnd = true;
        if (reachedEnd) break;
        if (seen.size === before) {
          failures += 1;
          permanentFailures += 1;
          break;
        }
      }
      if (reachedEnd) streamsFinished += 1;
    }
  } catch (error) {
    if (isAbortError(error)) cancelled = true;
    else recordFailure(error);
  }

  if (!cancelled) await input.store.save(cache, input.identity);
  const recent = turns.filter((turn) => turn.createdAt >= cutoff && turn.createdAt <= input.now);
  const complete = streamsFinished === 2
    && failures === 0
    && !cancelled
    && !hitDetailBudget
    && !hitDeadline;
  return {
    turns: recent,
    summary: {
      queriedAt: input.now,
      observedFrom: cutoff,
      complete,
      conversationsRead: read,
      conversationsFetched: fetchedSuccessfully,
      excludedWorkConversations: work,
      unclassifiedTurns: unknown,
      failedConversations: failures,
      retryableFailures,
      permanentFailures,
      cancelled,
      hitDetailBudget,
      hitDeadline
    }
  };
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name: string }).name === "AbortError");
}
