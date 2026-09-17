/* Page/content history protocol follows Leo7805/luna-toc pageHook event shape:
 * 1339969ec25d7c9b63068abd3776ce41780023ed. MIT; see THIRD_PARTY_NOTICES.md.
 * Only control events are exchanged; never conversation bodies, tokens, or account data.
 */
import type { HistoryFetchResult, HistoryPageResult } from "./historyState";

const HISTORY_SOURCE = "chatgpt-yada-history";

export type HistoryStatusSnapshot = { generation: number; hasSentinel: boolean; conversationId: string | null };

export interface HistoryBridge {
  query(): Promise<HistoryStatusSnapshot>;
  loadPage(conversationId: string, signal?: AbortSignal): Promise<HistoryPageResult>;
  subscribe(listener: (event: { type: string } & Partial<HistoryFetchResult & HistoryStatusSnapshot>) => void): () => void;
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
  subscribe(listener: (event: { type: string } & Partial<HistoryFetchResult & HistoryStatusSnapshot>) => void): () => void {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || data.source !== HISTORY_SOURCE) return;
      listener(data as { type: string } & Partial<HistoryFetchResult & HistoryStatusSnapshot>);
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
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 400);
    post({ type: "load-page", conversationId, nonce });
    try {
      return await listen<HistoryPageResult & { type: string; nonce?: number }>(
        data => data.type === "load-result" && data.nonce === nonce,
        controller.signal
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ok: false, status: 0, triggered: false, generation: 0, hasSentinel: false, conversationId };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
