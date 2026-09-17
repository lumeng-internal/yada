/* MAIN-world document_start page script.
 * Fetch rewrite adapted from canxin121/chatgpt-web-performance-fix rewriteGetRequest
 * and Leo7805/luna-toc conversation URL / num_turns bump (both MIT). Original
 * fetch Promise and Response are returned unchanged; only response.clone() is read.
 */
import {
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_MS,
  MAX_CLONE_READERS,
  PREPARE_TTL_MS,
  YADA_CONTENT_SOURCE,
  YADA_PAGE_SOURCE,
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

let readers = 0;
let boostUntil = 0;
let boostConversationId = "";
const captureControllers = new Set<AbortController>();

function publish(state: HistoryState): void {
  window.postMessage({ source: YADA_PAGE_SOURCE, type: "history-state", state } satisfies { source: string; type: string; state: HistoryState }, location.origin);
}

function boostActive(conversationId: string): boolean {
  return Boolean(conversationId) && boostConversationId === conversationId && Date.now() < boostUntil;
}

export function isPrepareBoostActive(conversationId = currentConversationId()): boolean {
  return typeof conversationId === "string" && boostActive(conversationId);
}

function cancelCaptures(): void {
  for (const controller of captureControllers) controller.abort();
  captureControllers.clear();
}

async function captureResponse(
  tracker: HistoryTracker,
  promise: Promise<Response>,
  matchKind: "paginated-initial" | "paginated-messages",
  conversationId: string,
  requestedBefore: string | null,
  boosted: boolean
): Promise<void> {
  let response: Response;
  try {
    response = await promise;
  } catch {
    publish(tracker.markIssue("http-error"));
    return;
  }
  if (!response.ok) {
    publish(tracker.markIssue("http-error"));
    return;
  }
  if (readers >= MAX_CLONE_READERS) {
    publish(tracker.markIssue("capture-unavailable"));
    return;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    publish(tracker.markIssue("capture-unavailable"));
    return;
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_CAPTURE_BYTES) {
    publish(tracker.markIssue("capture-unavailable"));
    return;
  }

  readers += 1;
  const controller = new AbortController();
  captureControllers.add(controller);
  const timer = window.setTimeout(() => controller.abort(), MAX_CAPTURE_MS);
  try {
    const clone = response.clone();
    const buffer = await Promise.race([
      clone.arrayBuffer(),
      new Promise<ArrayBuffer>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        if (controller.signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      })
    ]);
    if (buffer.byteLength > MAX_CAPTURE_BYTES) {
      publish(tracker.markIssue("capture-unavailable"));
      return;
    }
    const payload = JSON.parse(new TextDecoder().decode(buffer)) as HistoryPayload;
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
    const state = matchKind === "paginated-initial"
      ? tracker.applyInitial(conversationId, slim)
      : tracker.applyOlder(slim, requestedBefore);
    state.boosted = state.boosted || boosted;
    publish(state);
  } catch {
    if (!controller.signal.aborted) publish(tracker.markIssue("capture-unavailable"));
  } finally {
    window.clearTimeout(timer);
    captureControllers.delete(controller);
    readers = Math.max(0, readers - 1);
  }
}

export function installNativeBootstrapPage(): () => void {
  const globalState = globalThis as typeof globalThis & { [FLAG]?: PageHook };
  if (globalState[FLAG]) return globalState[FLAG]!.dispose;

  const tracker = new HistoryTracker();
  const nativeFetch = window.fetch;

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
    publish(tracker.beginRequest(conversationId, rewritten.boosted));
    const promise = nativeFetch.call(window, nextInput, nextInit);
    void promise.finally(() => publish(tracker.endRequest()));
    void captureResponse(tracker, promise, match.kind, conversationId, requestedBefore, rewritten.boosted);
    return promise;
  };

  window.addEventListener("message", onMessage);

  const dispose = (): void => {
    if (globalState[FLAG]?.dispose !== dispose) return;
    window.removeEventListener("message", onMessage);
    window.fetch = nativeFetch;
    cancelCaptures();
    boostUntil = 0;
    boostConversationId = "";
    tracker.reset();
    delete globalState[FLAG];
  };

  globalState[FLAG] = { dispose, tracker };
  return dispose;
}

installNativeBootstrapPage();
