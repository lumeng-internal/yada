/* IntersectionObserver sentinel wrapping adapted from
 * canxin121/chatgpt-web-performance-fix src/chatgpt-performance-fix.user.ts
 * c4b12ddd87220ab8d2a14001da46aba5e773f5c7. MIT; see THIRD_PARTY_NOTICES.md.
 * Conversation GET expansion and page_info peek follow Leo7805/luna-toc
 * 1339969ec25d7c9b63068abd3776ce41780023ed. MIT.
 */
export const HISTORY_SOURCE = "chatgpt-yada-history";
const SENTINEL = "conversation-pagination-sentinel";
const INSTALLED = "__chatgptYadaHistoryPage";

type SentinelRecord = {
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
  target: Element;
  generation: number;
  lastEntry: IntersectionObserverEntry | null;
};

type HistoryStatus = { generation: number; hasSentinel: boolean; conversationId: string | null };
type FetchPeek = { status: number; ok: boolean; hasPreviousPage?: boolean; cursor?: string | null; conversationId: string | null };

let generation = 0;
let sentinel: SentinelRecord | null = null;
let lastFetch: FetchPeek | null = null;

export function conversationIdFromHref(url = location.href): string | null {
  try {
    const parsed = new URL(url);
    return parsed.pathname.match(/^\/c\/([a-z0-9-]+)/i)?.[1]
      ?? parsed.pathname.match(/^\/g\/[a-z0-9-]+\/c\/([a-z0-9-]+)/i)?.[1]
      ?? null;
  } catch {
    return url.match(/\/c\/([a-z0-9-]+)/i)?.[1] ?? null;
  }
}

export function isHistorySentinel(target: unknown): target is Element {
  if (!(target instanceof Element)) return false;
  const testId = target.getAttribute("data-testid");
  return typeof testId === "string" && testId.includes(SENTINEL);
}

export function getHistoryPageStatus(): HistoryStatus {
  const target = sentinel?.target;
  return {
    generation,
    hasSentinel: !!target?.isConnected,
    conversationId: conversationIdFromHref()
  };
}

export function rewriteConversationHistoryRequest(
  rawUrl: string,
  method: string,
  conversationId: string | null,
  extra: { accept?: string | null } = {}
): string | null {
  if (!conversationId || method.toUpperCase() !== "GET") return null;
  if (extra.accept?.toLowerCase().includes("text/event-stream")) return null;
  let url: URL;
  try { url = new URL(rawUrl, location.origin); } catch { return null; }
  if (url.origin !== location.origin) return null;
  if (url.searchParams.has("include_message_id")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  const base = `/backend-api/conversations/${conversationId}`;
  if (path !== base && path !== `${base}/messages`) return null;
  const current = Number(url.searchParams.get("num_turns"));
  const needsTurns = !Number.isFinite(current) || current < 100;
  const needsVersions = url.searchParams.get("include_has_versions") !== "true";
  if (!needsTurns && !needsVersions) return null;
  if (needsTurns) url.searchParams.set("num_turns", "100");
  if (needsVersions) url.searchParams.set("include_has_versions", "true");
  return url.toString();
}

export function wrapFetchForHistory(original: typeof fetch, getConversationId: () => string | null): typeof fetch {
  return function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? "GET";
    const url = request ? request.url : String(input);
    const headers = new Headers(init?.headers ?? request?.headers);
    const conversationId = getConversationId();
    const rewritten = rewriteConversationHistoryRequest(url, method, conversationId, { accept: headers.get("accept") });
    const nextInput: RequestInfo | URL = rewritten
      ? (request ? new Request(rewritten, request) : rewritten)
      : input;
    return original.call(this, nextInput, request && rewritten ? undefined : init).then(response => {
      const used = rewritten ?? url;
      if (conversationId && method.toUpperCase() === "GET" && isConversationHistoryUrl(used, conversationId)
        && !headers.get("accept")?.toLowerCase().includes("text/event-stream")) {
        void noteFetch(response, conversationId);
      }
      return response;
    });
  };
}

function isConversationHistoryUrl(rawUrl: string, conversationId: string): boolean {
  try {
    const url = new URL(rawUrl, location.origin);
    if (url.origin !== location.origin || url.searchParams.has("include_message_id")) return false;
    const path = url.pathname.replace(/\/+$/, "");
    const base = `/backend-api/conversations/${conversationId}`;
    return path === base || path === `${base}/messages`;
  } catch {
    return false;
  }
}

async function noteFetch(response: Response, conversationId: string | null): Promise<void> {
  const peek = await peekPageInfo(response);
  lastFetch = { status: response.status, ok: response.ok, conversationId, ...peek };
  post({ type: "fetch-result", ...lastFetch, generation, hasSentinel: getHistoryPageStatus().hasSentinel });
}

async function peekPageInfo(response: Response): Promise<{ hasPreviousPage?: boolean; cursor?: string | null }> {
  try {
    const data = await response.clone().json() as Record<string, unknown> | null;
    const nested = data && typeof data.conversation === "object" && data.conversation ? data.conversation as Record<string, unknown> : null;
    const page = (data?.page_info ?? data?.pageInfo ?? nested?.page_info ?? nested?.pageInfo) as Record<string, unknown> | undefined;
    if (!page || typeof page !== "object") return {};
    const has = page.has_previous_page ?? page.hasPreviousPage;
    const cursor = page.start_cursor ?? page.startCursor;
    return {
      hasPreviousPage: typeof has === "boolean" ? has : undefined,
      cursor: typeof cursor === "string" && cursor ? cursor : null
    };
  } catch {
    return {};
  }
}

function post(payload: Record<string, unknown>): void {
  try { window.postMessage({ source: HISTORY_SOURCE, ...payload }, location.origin); } catch { /* page may be tearing down */ }
}

function rememberSentinel(callback: IntersectionObserverCallback, observer: IntersectionObserver, target: Element, entry: IntersectionObserverEntry | null): void {
  const known = sentinel?.target === target && sentinel.observer === observer;
  if (!known) generation += 1;
  sentinel = { callback, observer, target, generation, lastEntry: entry ?? sentinel?.lastEntry ?? null };
  post({ type: "status", ...getHistoryPageStatus() });
}

function forgetSentinel(target: Element, observer: IntersectionObserver): void {
  if (sentinel?.target === target && sentinel.observer === observer) {
    sentinel = null;
    post({ type: "status", ...getHistoryPageStatus() });
  }
}

function syntheticEntry(record: SentinelRecord): IntersectionObserverEntry {
  if (record.lastEntry) {
    const forced = Object.create(record.lastEntry) as IntersectionObserverEntry;
    Object.defineProperty(forced, "isIntersecting", { value: true });
    Object.defineProperty(forced, "intersectionRatio", { value: Math.max(0.01, record.lastEntry.intersectionRatio) });
    return forced;
  }
  const target = record.target;
  const rect = target.getBoundingClientRect();
  return {
    time: performance.now(),
    target,
    rootBounds: new DOMRect(0, 0, innerWidth, innerHeight),
    boundingClientRect: rect,
    intersectionRect: rect,
    isIntersecting: true,
    intersectionRatio: 1
  };
}

function triggerLoadPage(conversationId: string, nonce: number): void {
  const status = getHistoryPageStatus();
  const record = sentinel?.target?.isConnected ? sentinel : null;
  if (!record || (conversationId && status.conversationId && conversationId !== status.conversationId)) {
    post({ type: "load-result", nonce, triggered: false, ok: false, status: 0, ...status, conversationId: status.conversationId });
    return;
  }
  try { record.callback([syntheticEntry(record)], record.observer); }
  catch {
    post({ type: "load-result", nonce, triggered: false, ok: false, status: 0, ...getHistoryPageStatus() });
    return;
  }
  post({
    type: "load-result",
    nonce,
    triggered: true,
    ok: lastFetch?.ok !== false,
    status: lastFetch?.status ?? 0,
    hasPreviousPage: lastFetch?.hasPreviousPage,
    cursor: lastFetch?.cursor,
    ...getHistoryPageStatus()
  });
}

export function wrapIntersectionObserver(Native: typeof IntersectionObserver): typeof IntersectionObserver {
  class YadaHistoryObserver implements IntersectionObserver {
    private readonly callback: IntersectionObserverCallback;
    private readonly native: IntersectionObserver;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback;
      this.native = new Native(entries => {
        for (const entry of entries) {
          if (isHistorySentinel(entry.target)) rememberSentinel(this.callback, this, entry.target, entry);
        }
        this.callback(entries, this);
      }, options);
    }
    observe(target: Element): void {
      if (isHistorySentinel(target)) rememberSentinel(this.callback, this, target, null);
      this.native.observe(target);
    }
    unobserve(target: Element): void {
      this.native.unobserve(target);
      forgetSentinel(target, this);
    }
    disconnect(): void {
      this.native.disconnect();
      if (sentinel?.observer === this) {
        sentinel = null;
        post({ type: "status", ...getHistoryPageStatus() });
      }
    }
    takeRecords(): IntersectionObserverEntry[] { return this.native.takeRecords(); }
    get root(): Element | Document | null { return this.native.root; }
    get rootMargin(): string { return this.native.rootMargin; }
    get thresholds(): readonly number[] { return this.native.thresholds; }
  }
  Object.setPrototypeOf(YadaHistoryObserver.prototype, Native.prototype);
  Object.setPrototypeOf(YadaHistoryObserver, Native);
  Object.defineProperty(YadaHistoryObserver, "name", { value: "IntersectionObserver" });
  return YadaHistoryObserver as unknown as typeof IntersectionObserver;
}

function onMessage(event: MessageEvent): void {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data as { source?: string; type?: string; conversationId?: string; nonce?: number } | null;
  if (!data || data.source !== HISTORY_SOURCE) return;
  if (data.type === "query") post({ type: "status", ...getHistoryPageStatus() });
  if (data.type === "load-page") triggerLoadPage(data.conversationId ?? "", Number(data.nonce) || 0);
}

export function installHistoryPage(): void {
  const page = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (page[INSTALLED]) return;
  page[INSTALLED] = true;
  window.fetch = wrapFetchForHistory(window.fetch.bind(window), conversationIdFromHref);
  if (typeof IntersectionObserver === "function") {
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: wrapIntersectionObserver(IntersectionObserver)
    });
  }
  window.addEventListener("message", onMessage);
  post({ type: "ready", ...getHistoryPageStatus() });
}

installHistoryPage();
