import {
  NATIVE_NAV_CHANNEL,
  acceptPrepareHandshake,
  applyPrepareHandshake,
  conversationIdFromUrl,
  emptyPrepareLease,
  emptyTransportState,
  expandHistoryRequest,
  historyRequest,
  isPrepareActive,
  parsePrepareHandshake,
  record,
  shouldExpandHistoryRequest,
  type HistoryRequest,
  type HistoryRequestError,
  type PrepareLease
} from "./protocol";

export function installNativeHistoryHook(target: Window): void {
  const flag = target as Window & { __chatgptYadaNativeHistoryHook?: boolean };
  if (flag.__chatgptYadaNativeHistoryHook) return;
  flag.__chatgptYadaNativeHistoryHook = true;
  install(target);
}

const runningVitest = Boolean((globalThis as { process?: { env?: { VITEST?: string } } }).process?.env?.VITEST);
if (!runningVitest) installNativeHistoryHook(window);

type RequestTicket = {
  conversationId: string;
  generation: number;
  request: HistoryRequest;
  startedAt: number;
};

function install(target: Window): void {
  const nativeFetch = target.fetch;
  let transport = emptyTransportState(conversationIdFromUrl(target.location.href));
  let lease: PrepareLease = emptyPrepareLease();
  let pendingRequests = 0;

  const broadcast = (): void => {
    transport.revision += 1;
    target.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "state", state: { ...transport } }, target.location.origin);
  };

  const emitRoute = (): void => {
    target.postMessage({
      channel: NATIVE_NAV_CHANNEL,
      kind: "route",
      conversationId: transport.conversationId,
      generation: transport.generation
    }, target.location.origin);
  };

  const closePrepare = (): boolean => {
    const changed = lease.enabled || transport.boosted;
    lease = emptyPrepareLease();
    transport.boosted = false;
    return changed;
  };

  const expirePrepare = (now: number): void => {
    if (!lease.enabled || isPrepareActive(lease, now, transport.conversationId, transport.generation)) return;
    if (closePrepare()) broadcast();
  };

  const synchronizeRoute = (): void => {
    const current = conversationIdFromUrl(target.location.href);
    if (current === transport.conversationId) return;
    closePrepare();
    pendingRequests = 0;
    transport = emptyTransportState(current, transport.generation + 1);
    broadcast();
    emitRoute();
  };

  patchHistoryMethod(target.history, "pushState", synchronizeRoute);
  patchHistoryMethod(target.history, "replaceState", synchronizeRoute);
  target.addEventListener("popstate", synchronizeRoute);
  target.addEventListener("pageshow", synchronizeRoute);
  target.addEventListener("pagehide", () => {
    if (closePrepare()) broadcast();
  });
  target.addEventListener("message", (event) => {
    if (event.source !== target || event.origin !== target.location.origin) return;
    const message = record(event.data);
    if (message?.channel !== NATIVE_NAV_CHANNEL) return;
    synchronizeRoute();
    if (message.kind === "hello") {
      broadcast();
      return;
    }
    const handshake = parsePrepareHandshake(message);
    if (!handshake || !acceptPrepareHandshake(handshake, {
      conversationId: transport.conversationId,
      generation: transport.generation
    })) return;

    lease = applyPrepareHandshake(handshake, Date.now());
    transport.boosted = handshake.enabled;
    if (!handshake.enabled) closePrepare();
    broadcast();
  });

  target.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    synchronizeRoute();
    const now = Date.now();
    expirePrepare(now);
    const request = historyRequest(input, init, target.location.href);
    if (!request) return nativeFetch.call(this, input, init);

    const expand = shouldExpandHistoryRequest(input, init, target.location.href, {
      visible: target.document.visibilityState === "visible",
      prepareActive: isPrepareActive(lease, now, transport.conversationId, transport.generation)
    });
    const outgoing = expand ? expandHistoryRequest(input, init, target.location.href) : ([input, init] as const);
    const ticket: RequestTicket = {
      conversationId: request.conversationId,
      generation: transport.generation,
      request,
      startedAt: now
    };

    pendingRequests += 1;
    transport.historyRequests += 1;
    if (request.kind === "older") transport.olderRequests += 1;
    transport.requestInFlight = true;
    transport.lastRequestKind = request.kind;
    transport.lastHttpStatus = null;
    transport.lastRequestError = null;
    broadcast();

    let original: Promise<Response>;
    try {
      original = nativeFetch.call(this, outgoing[0], outgoing[1]);
    } catch (error) {
      finish(ticket, null, classifyFetchError(error));
      throw error;
    }

    void original.then(
      (response) => finish(ticket, response.status, response.ok ? null : "http-error"),
      (error) => finish(ticket, null, classifyFetchError(error))
    );
    return original;
  };

  function finish(ticket: RequestTicket, status: number | null, error: HistoryRequestError): void {
    if (transport.generation !== ticket.generation || transport.conversationId !== ticket.conversationId) return;
    pendingRequests = Math.max(0, pendingRequests - 1);
    transport.requestInFlight = pendingRequests > 0;
    transport.lastRequestKind = ticket.request.kind;
    transport.lastHttpStatus = status;
    transport.lastRequestDurationMs = Math.max(0, Date.now() - ticket.startedAt);
    transport.lastRequestAt = Date.now();
    transport.lastRequestError = error;
    broadcast();
  }
}

function classifyFetchError(error: unknown): Exclude<HistoryRequestError, "http-error" | null> {
  return error && typeof error === "object" && "name" in error && (error as { name: unknown }).name === "AbortError"
    ? "aborted"
    : "fetch-error";
}

function patchHistoryMethod(history: History, method: "pushState" | "replaceState", onRoute: () => void): void {
  const original = history[method];
  history[method] = function (this: History, ...args: Parameters<History["pushState"]>): void {
    original.apply(this, args);
    onRoute();
  } as History[typeof method];
}
