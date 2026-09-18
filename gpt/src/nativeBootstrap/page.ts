/* MAIN-world document_start page script.
 * Fetch rewrite adapted from canxin121/chatgpt-web-performance-fix rewriteGetRequest
 * and Leo7805/luna-toc conversation URL / num_turns bump (both MIT). Original
 * fetch Promise and Response are returned unchanged; only response.clone() is read.
 * Sentinel/request-generation timing follows canxin121 MutationObserver coalescing
 * and detached/late data-testid replacement boundaries; settings UI is not imported.
 */
import {
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_MS,
  MAX_CLONE_READERS,
  PREPARE_TTL_MS,
  YADA_CONTENT_SOURCE,
  YADA_PAGE_SOURCE,
  type CaptureContext,
  type ContentToPageMessage,
  type HistoryPayload,
  type HistoryState
} from "./shared";
import {
  boostConversationUrl,
  currentConversationId,
  getFetchUrl,
  HistoryTracker,
  rewriteGetRequest,
  shouldHandleConversationRequest
} from "./history";

const FLAG = "__chatgptYadaNativeBootstrapPage";

interface PageHook {
  dispose: () => void;
  tracker: HistoryTracker;
}

interface CaptureHandle {
  ctx: CaptureContext;
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
}

let readers = 0;
let boostUntil = 0;
let boostConversationId = "";
let routeConversationId = currentConversationId() ?? "";
const captures = new Map<number, CaptureHandle>();

function publish(state: HistoryState): void {
  window.postMessage({ source: YADA_PAGE_SOURCE, type: "history-state", state } satisfies { source: string; type: string; state: HistoryState }, location.origin);
}

function boostActive(conversationId: string): boolean {
  return Boolean(conversationId) && boostConversationId === conversationId && Date.now() < boostUntil;
}

export function isPrepareBoostActive(conversationId = currentConversationId()): boolean {
  return typeof conversationId === "string" && boostActive(conversationId);
}

export function nativeBootstrapCaptureStats(): { readers: number; captures: number } {
  return { readers, captures: captures.size };
}

function cancelHandle(handle: CaptureHandle): void {
  try {
    handle.controller.abort();
  } catch {
    // already aborted
  }
  if (handle.reader) {
    void handle.reader.cancel().catch(() => undefined);
    handle.reader = null;
  }
}

function cancelCaptures(predicate?: (ctx: CaptureContext) => boolean): void {
  for (const [requestId, handle] of captures) {
    if (predicate && !predicate(handle.ctx)) continue;
    cancelHandle(handle);
    captures.delete(requestId);
  }
}

function cancelStaleCaptures(tracker: HistoryTracker): void {
  cancelCaptures(ctx => tracker.isStale(ctx));
}

async function readCloneLimited(
  clone: Response,
  handle: CaptureHandle,
  signal: AbortSignal
): Promise<Uint8Array> {
  const body = clone.body;
  if (!body) throw new Error("missing-body");
  const reader = body.getReader();
  handle.reader = reader;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abortRead = (): void => {
    void reader.cancel().catch(() => undefined);
    handle.reader = null;
  };
  if (signal.aborted) {
    abortRead();
    throw new DOMException("Aborted", "AbortError");
  }
  signal.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_CAPTURE_BYTES) {
        chunks.length = 0;
        abortRead();
        throw new Error("limit");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abortRead);
    if (handle.reader === reader) handle.reader = null;
    try {
      reader.releaseLock();
    } catch {
      // cancelled or already released
    }
  }
}

async function captureResponse(
  tracker: HistoryTracker,
  promise: Promise<Response>,
  ctx: CaptureContext,
  boosted: boolean
): Promise<void> {
  const handle: CaptureHandle = { ctx, controller: new AbortController(), reader: null };
  captures.set(ctx.requestId, handle);
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    handle.controller.abort();
  }, MAX_CAPTURE_MS);
  try {
    let response: Response;
    try {
      response = await promise;
    } catch {
      if (!tracker.isStale(ctx)) publish(tracker.markIssue("http-error", ctx));
      return;
    }
    if (tracker.isStale(ctx)) return;
    if (!response.ok) {
      publish(tracker.markIssue("http-error", ctx));
      return;
    }
    if (readers >= MAX_CLONE_READERS) {
      publish(tracker.markIssue("capture-unavailable", ctx));
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      publish(tracker.markIssue("capture-unavailable", ctx));
      return;
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_CAPTURE_BYTES) {
      publish(tracker.markIssue("capture-unavailable", ctx));
      return;
    }

    readers += 1;
    try {
      const clone = response.clone();
      const bytes = await readCloneLimited(clone, handle, handle.controller.signal);
      if (tracker.isStale(ctx)) return;
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as HistoryPayload;
      const slim: HistoryPayload = {
        current_node: typeof payload.current_node === "string" ? payload.current_node : null,
        page_info: payload.page_info,
        messages: Array.isArray(payload.messages)
          ? payload.messages.map(message => ({
              id: typeof message?.id === "string" ? message.id : undefined,
              author: { role: message?.author?.role }
            }))
          : undefined
      };
      const state = ctx.kind === "initial"
        ? tracker.applyInitialFrom(ctx, slim)
        : tracker.applyOlderFrom(ctx, slim);
      state.boosted = state.boosted || boosted;
      publish(state);
      cancelStaleCaptures(tracker);
    } catch (error) {
      if (tracker.isStale(ctx)) return;
      const limited = error instanceof Error && error.message === "limit";
      if (limited || timedOut) {
        publish(tracker.markIssue("capture-unavailable", ctx));
        return;
      }
      const aborted = handle.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      if (aborted) return;
      publish(tracker.markIssue("capture-unavailable", ctx));
    } finally {
      readers = Math.max(0, readers - 1);
    }
  } finally {
    window.clearTimeout(timer);
    if (captures.get(ctx.requestId) === handle) captures.delete(ctx.requestId);
    handle.reader = null;
  }
}

function installRouteWatch(onChange: (conversationId: string) => void): () => void {
  const nativePush = history.pushState.bind(history);
  const nativeReplace = history.replaceState.bind(history);
  const notify = (): void => {
    const next = currentConversationId() ?? "";
    if (next === routeConversationId) return;
    routeConversationId = next;
    onChange(next);
  };
  history.pushState = function chatgptYadaPushState(...args: Parameters<History["pushState"]>): void {
    nativePush(...args);
    notify();
  };
  history.replaceState = function chatgptYadaReplaceState(...args: Parameters<History["replaceState"]>): void {
    nativeReplace(...args);
    notify();
  };
  window.addEventListener("popstate", notify);
  window.addEventListener("pageshow", notify);
  return () => {
    history.pushState = nativePush;
    history.replaceState = nativeReplace;
    window.removeEventListener("popstate", notify);
    window.removeEventListener("pageshow", notify);
  };
}

export function installNativeBootstrapPage(): () => void {
  const globalState = globalThis as typeof globalThis & { [FLAG]?: PageHook };
  if (globalState[FLAG]) return globalState[FLAG]!.dispose;

  const tracker = new HistoryTracker();
  const nativeFetch = window.fetch;
  routeConversationId = currentConversationId() ?? "";
  if (routeConversationId) tracker.notifyRoute(routeConversationId);

  const onRoute = (conversationId: string): void => {
    cancelCaptures();
    publish(tracker.notifyRoute(conversationId));
    if (boostConversationId && boostConversationId !== conversationId) {
      boostUntil = 0;
      boostConversationId = "";
    }
  };
  const disposeRoute = installRouteWatch(onRoute);

  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin) return;
    const data = event.data as ContentToPageMessage | null;
    if (!data || data.source !== YADA_CONTENT_SOURCE) return;
    if (data.type === "request-state") {
      publish(tracker.snapshotState());
      return;
    }
    if (data.type !== "prepare-boost") return;
    if (data.active && data.conversationId && data.conversationId === currentConversationId()) {
      boostConversationId = data.conversationId;
      boostUntil = Date.now() + PREPARE_TTL_MS;
      return;
    }
    boostUntil = 0;
    boostConversationId = "";
  };

  window.fetch = function chatgptYadaFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const conversationId = currentConversationId();
    const match = shouldHandleConversationRequest(input, init, location.href, conversationId);
    if (!match || !conversationId) return nativeFetch.call(window, input, init);

    const rawUrl = getFetchUrl(input);
    const url = new URL(rawUrl, location.href);
    const olderBoost = match.kind === "paginated-messages" && boostActive(conversationId);
    const rewritten = boostConversationUrl(url.href, location.href, match, olderBoost);
    const [nextInput, nextInit] = rewritten.href === url.href
      ? [input, init]
      : rewriteGetRequest(input, init, rewritten.href);
    const requestedBefore = match.kind === "paginated-messages" ? url.searchParams.get("before") : null;
    const ctx = tracker.beginRequest({
      conversationId,
      kind: match.kind === "paginated-initial" ? "initial" : "older",
      before: requestedBefore,
      boosted: rewritten.boosted
    });
    publish(tracker.snapshotState());
    const promise = nativeFetch.call(window, nextInput, nextInit);
    void promise.finally(() => publish(tracker.endRequest(ctx.requestId)));
    void captureResponse(tracker, promise, ctx, rewritten.boosted);
    return promise;
  };

  window.addEventListener("message", onMessage);

  const dispose = (): void => {
    if (globalState[FLAG]?.dispose !== dispose) return;
    window.removeEventListener("message", onMessage);
    window.fetch = nativeFetch;
    disposeRoute();
    cancelCaptures();
    boostUntil = 0;
    boostConversationId = "";
    readers = 0;
    tracker.reset();
    delete globalState[FLAG];
  };

  globalState[FLAG] = { dispose, tracker };
  return dispose;
}

installNativeBootstrapPage();
