/* Page/content history protocol follows Leo7805/luna-toc pageHook event shape:
 * 1339969ec25d7c9b63068abd3776ce41780023ed. MIT; see THIRD_PARTY_NOTICES.md.
 * Only control events are exchanged; never conversation bodies, tokens, or account data.
 */
import type { HistoryFetchResult, HistoryPageResult } from "./historyState";
import { HISTORY_LIMITS } from "./historyState";

const HISTORY_SOURCE = "chatgpt-yada-history";

export type HistoryStatusSnapshot = { generation: number; hasSentinel: boolean; conversationId: string | null };

export interface HistoryBridge {
  query(): Promise<HistoryStatusSnapshot>;
  loadPage(conversationId: string, signal?: AbortSignal): Promise<HistoryPageResult>;
  subscribe(listener: (event: { type: string } & Partial<HistoryFetchResult & HistoryStatusSnapshot & HistoryPageResult>) => void): () => void;
}

function listen<T extends { source?: string; type?: string }>(
  match: (data: T) => boolean,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as T | null;
      if (!data || data.source !== HISTORY_SOURCE || !match(data)) return;
      cleanup();
      resolve(data);
    };
    const onAbort = (): void => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const cleanup = (): void => {
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function post(payload: Record<string, unknown>): void {
  window.postMessage({ source: HISTORY_SOURCE, ...payload }, location.origin);
}

export class PageHistoryBridge implements HistoryBridge {
  subscribe(listener: (event: { type: string } & Partial<HistoryFetchResult & HistoryStatusSnapshot & HistoryPageResult>) => void): () => void {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || data.source !== HISTORY_SOURCE) return;
      listener(data as { type: string } & Partial<HistoryFetchResult & HistoryStatusSnapshot & HistoryPageResult>);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }
  async query(): Promise<HistoryStatusSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    post({ type: "query" });
    try {
      return await listen<HistoryStatusSnapshot & { type: string }>(data => data.type === "status" || data.type === "ready", controller.signal);
    } catch {
      return { generation: 0, hasSentinel: false, conversationId: null };
    } finally {
      clearTimeout(timer);
    }
  }
  async loadPage(conversationId: string, signal?: AbortSignal): Promise<HistoryPageResult> {
    const nonce = Date.now() + Math.random();
    const failed: HistoryPageResult = { ok: false, status: 0, triggered: false, generation: 0, hasSentinel: false, nonce, conversationId };
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      signal.removeEventListener("abort", onAbort);
      throw new DOMException("Aborted", "AbortError");
    }
    const timer = setTimeout(() => controller.abort(), HISTORY_LIMITS.pageTimeoutMs);
    post({ type: "load-page", conversationId, nonce });
    let triggered = false;
    try {
      const ack = await listen<HistoryPageResult & { type: string; nonce?: number }>(
        data => data.type === "load-result" && data.nonce === nonce,
        controller.signal
      );
      if (!ack.triggered) return { ...failed, ...ack, nonce, triggered: false, conversationId };
      triggered = true;
      const settled = await listen<HistoryPageResult & { type: string; nonce?: number }>(
        data => data.type === "page-settled" && data.nonce === nonce,
        controller.signal
      );
      return {
        ok: settled.ok !== false,
        status: settled.status ?? 0,
        triggered: true,
        generation: settled.generation ?? 0,
        hasSentinel: settled.hasSentinel === true,
        nonce,
        conversationId: settled.conversationId ?? conversationId,
        sentinelGeneration: settled.sentinelGeneration,
        hasPreviousPage: settled.hasPreviousPage,
        cursor: settled.cursor
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ...failed, triggered };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
