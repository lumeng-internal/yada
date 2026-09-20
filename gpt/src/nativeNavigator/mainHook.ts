import { HistoryChain, readHistoryMetadata } from "./metadata";
import {
  NATIVE_NAV_CHANNEL,
  acceptPrepareHandshake,
  applyPrepareHandshake,
  conversationIdFromUrl,
  emptyHistory,
  emptyPrepareLease,
  expandHistoryRequest,
  historyRequest,
  isPrepareActive,
  parsePrepareHandshake,
  record,
  shouldExpandHistoryRequest,
  type HistoryRequest,
  type NativeHistoryState,
  type PrepareLease
} from "./protocol";

const marker = window as Window & { __chatgptYadaNativeHistoryHook?: boolean };
if (!marker.__chatgptYadaNativeHistoryHook) {
  marker.__chatgptYadaNativeHistoryHook = true;
  install();
}

type CaptureTicket = {
  generation: number;
  initialVersion: number;
  sequence: number;
  request: HistoryRequest;
};

function install(): void {
  const nativeFetch = window.fetch;
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  let historyState = emptyHistory(conversationIdFromUrl(location.href));
  let chain = new HistoryChain();
  let lease: PrepareLease = emptyPrepareLease();
  let lastSequence = 0;

  const broadcast = (): void => {
    historyState.revision += 1;
    window.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "state", state: { ...historyState } }, location.origin);
  };

  const closePrepare = (): void => {
    lease = emptyPrepareLease();
    historyState.boosted = false;
  };

  const expirePrepare = (now: number): void => {
    if (!lease.enabled) return;
    if (isPrepareActive(lease, now, historyState.conversationId, historyState.generation)) return;
    closePrepare();
    broadcast();
  };

  const synchronizeRoute = (): void => {
    const current = conversationIdFromUrl(location.href);
    if (current === historyState.conversationId) return;
    cancelReaders(readers);
    closePrepare();
    historyState = emptyHistory(current, historyState.generation + 1);
    chain = new HistoryChain();
    broadcast();
  };

  patchHistoryMethod("pushState", synchronizeRoute);
  patchHistoryMethod("replaceState", synchronizeRoute);
  addEventListener("popstate", synchronizeRoute);
  addEventListener("pageshow", synchronizeRoute);
  addEventListener("pagehide", () => {
    cancelReaders(readers);
    if (!lease.enabled && !historyState.boosted) return;
    closePrepare();
    broadcast();
  });
  addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = record(event.data);
    if (message?.channel !== NATIVE_NAV_CHANNEL) return;
    synchronizeRoute();
    if (message.kind === "hello") {
      broadcast();
      return;
    }
    const handshake = parsePrepareHandshake(message);
    if (!handshake) return;
    if (!acceptPrepareHandshake(handshake, {
      conversationId: historyState.conversationId,
      generation: historyState.generation
    })) return;

    const now = Date.now();
    const wasActive = isPrepareActive(lease, now, historyState.conversationId, historyState.generation);
    lease = applyPrepareHandshake(handshake, now);
    if (handshake.enabled && !wasActive) {
      chain.clearTransientStalled();
      if (historyState.issue === "stalled") historyState.issue = null;
    }
    if (!handshake.enabled) closePrepare();
    else historyState.boosted = true;
    broadcast();
  });

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    synchronizeRoute();
    const now = Date.now();
    expirePrepare(now);
    const request = historyRequest(input, init, location.href);
    if (!request) return nativeFetch.call(this, input, init);

    if (request.kind === "initial") {
      historyState.initialVersion += 1;
      historyState.pending = 0;
      historyState.pages = 0;
      historyState.messages = 0;
      historyState.prompts = 0;
      historyState.boundary = "unknown";
      historyState.cursorPresent = false;
      historyState.issue = null;
      chain = new HistoryChain();
    }
    const ticket: CaptureTicket = {
      generation: historyState.generation,
      initialVersion: historyState.initialVersion,
      sequence: ++lastSequence,
      request
    };
    historyState.pending += 1;
    broadcast();

    const expand = shouldExpandHistoryRequest(input, init, location.href, {
      visible: document.visibilityState === "visible",
      prepareActive: isPrepareActive(lease, now, historyState.conversationId, historyState.generation)
    });
    const expanded = expand
      ? expandHistoryRequest(input, init, location.href)
      : ([input, init] as const);
    let original: Promise<Response>;
    try {
      original = nativeFetch.call(this, expanded[0], expanded[1]);
    } catch (error) {
      finishTicket(ticket, "http-error");
      throw error;
    }

    void inspect(original, ticket).finally(() => finishTicket(ticket)).catch(() => undefined);
    return original;
  };

  async function inspect(original: Promise<Response>, ticket: CaptureTicket): Promise<void> {
    let response: Response;
    try {
      response = await original;
    } catch {
      if (ticketCurrent(ticket)) historyState.issue = "http-error";
      return;
    }
    if (!ticketCurrent(ticket)) return;
    if (!response.ok) {
      historyState.issue = "http-error";
      return;
    }

    try {
      const payload = await boundedJsonClone(response, readers);
      if (!ticketCurrent(ticket)) return;
      if (ticket.sequence !== lastSequence) {
        historyState.boundary = "unknown";
        historyState.issue = "unlinked";
        return;
      }
      const page = readHistoryMetadata(payload, ticket.request.conversationId);
      if (!page) {
        historyState.issue = "capture-unavailable";
        return;
      }
      chain.accept(page, ticket.request.before);
      updateFromChain(historyState, chain);
    } catch {
      if (ticketCurrent(ticket)) historyState.issue = "capture-unavailable";
    }
  }

  function ticketCurrent(ticket: CaptureTicket): boolean {
    return historyState.generation === ticket.generation
      && historyState.initialVersion === ticket.initialVersion
      && historyState.conversationId === ticket.request.conversationId;
  }

  function finishTicket(ticket: CaptureTicket, issue?: NativeHistoryState["issue"]): void {
    if (!ticketCurrent(ticket)) return;
    historyState.pending = Math.max(0, historyState.pending - 1);
    if (issue) historyState.issue = issue;
    broadcast();
  }
}

function patchHistoryMethod(method: "pushState" | "replaceState", onRoute: () => void): void {
  const original = history[method];
  history[method] = function (this: History, ...args: Parameters<History["pushState"]>): void {
    original.apply(this, args);
    onRoute();
  } as History[typeof method];
}

function updateFromChain(state: NativeHistoryState, chain: HistoryChain): void {
  state.pages = chain.pages;
  state.messages = chain.identities.size;
  state.prompts = chain.prompts;
  state.boundary = chain.boundary;
  state.cursorPresent = chain.cursor !== null;
  state.issue = chain.issue;
}

function cancelReaders(readers: Set<ReadableStreamDefaultReader<Uint8Array>>): void {
  for (const reader of readers) void reader.cancel().catch(() => undefined);
}

async function boundedJsonClone(
  response: Response,
  activeReaders: Set<ReadableStreamDefaultReader<Uint8Array>>
): Promise<unknown> {
  const MAX_BYTES = 16 * 1024 * 1024;
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("not-json");
  if (activeReaders.size >= 2) throw new Error("reader-limit");
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > MAX_BYTES) throw new Error("body-limit");

  const reader = response.clone().body?.getReader();
  if (!reader) throw new Error("missing-body");
  activeReaders.add(reader);
  const pieces: Uint8Array[] = [];
  let total = 0;
  let timeoutReached = false;
  const timeout = window.setTimeout(() => {
    timeoutReached = true;
    void reader.cancel().catch(() => undefined);
  }, 8_000);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (timeoutReached) throw new Error("read-timeout");
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BYTES) throw new Error("body-limit");
      pieces.push(chunk.value);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const piece of pieces) {
      joined.set(piece, offset);
      offset += piece.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(joined));
  } finally {
    window.clearTimeout(timeout);
    activeReaders.delete(reader);
    void reader.cancel().catch(() => undefined);
  }
}
