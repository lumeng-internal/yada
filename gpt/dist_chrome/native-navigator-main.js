"use strict";
(() => {
  // src/nativeNavigator/protocol.ts
  var NATIVE_NAV_CHANNEL = "chatgpt-yada:native-nav:v1";
  var MIN_HISTORY_TURNS = 100;
  var PREPARE_LEASE_MS = 1e4;
  function emptyTransportState(conversationId, generation = 0) {
    return {
      conversationId,
      generation,
      revision: 0,
      historyRequests: 0,
      olderRequests: 0,
      requestInFlight: false,
      lastRequestKind: null,
      lastHttpStatus: null,
      lastRequestDurationMs: 0,
      lastRequestAt: null,
      lastRequestError: null,
      boosted: false
    };
  }
  function emptyPrepareLease() {
    return { enabled: false, conversationId: null, generation: 0, until: 0 };
  }
  function record(value) {
    return value != null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function identifier(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
  }
  function conversationIdFromUrl(input) {
    try {
      const parts = new URL(input).pathname.split("/").filter(Boolean);
      const marker = parts.indexOf("c");
      return marker >= 0 && marker + 1 < parts.length && /^[A-Za-z0-9_-]{1,128}$/.test(parts[marker + 1]) ? parts[marker + 1] : null;
    } catch {
      return null;
    }
  }
  function isMessageDeepLink(input = location.href) {
    try {
      const params = new URL(input).searchParams;
      return params.has("message") || params.has("messageId");
    } catch {
      return false;
    }
  }
  function historyRequest(input, init, pageUrl) {
    try {
      const page = new URL(pageUrl);
      const current = conversationIdFromUrl(page.href);
      if (page.origin !== "https://chatgpt.com" || !current) return null;
      const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
      if ((init?.method ?? request?.method ?? "GET").toUpperCase() !== "GET") return null;
      const target = new URL(request?.url ?? String(input), page);
      if (target.origin !== page.origin) return null;
      const path = target.pathname.split("/").filter(Boolean);
      if (path[0] !== "backend-api" || path[1] !== "conversation" && path[1] !== "conversations") return null;
      if (path[2] !== current || path.length < 3 || path.length > 4) return null;
      const messages = path.length === 4 && path[3] === "messages";
      if (path.length === 4 && !messages) return null;
      const before = identifier(target.searchParams.get("before"));
      if (messages && !before) return null;
      if (!messages && ["before", "after", "message_id", "include_message_id"].some((key) => target.searchParams.has(key))) {
        return null;
      }
      return {
        conversationId: current,
        kind: messages ? "older" : "initial",
        before,
        plural: path[1] === "conversations"
      };
    } catch {
      return null;
    }
  }
  function canExpandInitial(input, init, pageUrl, visible) {
    if (!visible || isMessageDeepLink(pageUrl)) return false;
    const match = historyRequest(input, init, pageUrl);
    return match != null && match.kind === "initial" && match.plural;
  }
  function shouldExpandHistoryRequest(input, init, pageUrl, options) {
    if (!historyRequest(input, init, pageUrl)) return false;
    return options.prepareActive || canExpandInitial(input, init, pageUrl, options.visible);
  }
  function expandHistoryRequest(input, init, pageUrl) {
    if (!historyRequest(input, init, pageUrl)) return [input, init];
    try {
      const original = typeof Request !== "undefined" && input instanceof Request ? input : null;
      const target = new URL(original?.url ?? String(input), pageUrl);
      const currentBatch = Number(target.searchParams.get("num_turns"));
      if (Number.isFinite(currentBatch) && currentBatch >= MIN_HISTORY_TURNS) return [input, init];
      target.searchParams.set("num_turns", String(MIN_HISTORY_TURNS));
      return [original ? new Request(target.href, requestCloneInit(original)) : target.href, init];
    } catch {
      return [input, init];
    }
  }
  function parsePrepareHandshake(value) {
    const message = record(value);
    if (!message || message.kind !== "prepare" || typeof message.enabled !== "boolean") return null;
    const conversationId = identifier(message.conversationId);
    if (!conversationId || !Number.isSafeInteger(message.generation) || message.generation < 0) return null;
    return {
      enabled: message.enabled,
      conversationId,
      generation: message.generation
    };
  }
  function acceptPrepareHandshake(handshake, context) {
    return handshake.conversationId === context.conversationId && handshake.generation === context.generation;
  }
  function applyPrepareHandshake(handshake, now) {
    if (!handshake.enabled) {
      return { enabled: false, conversationId: handshake.conversationId, generation: handshake.generation, until: 0 };
    }
    return {
      enabled: true,
      conversationId: handshake.conversationId,
      generation: handshake.generation,
      until: now + PREPARE_LEASE_MS
    };
  }
  function isPrepareActive(lease, now, conversationId, generation) {
    return lease.enabled && lease.until > now && conversationId != null && lease.conversationId === conversationId && lease.generation === generation;
  }
  function requestCloneInit(request) {
    return {
      method: request.method,
      headers: request.headers,
      mode: request.mode,
      credentials: request.credentials,
      cache: request.cache,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
      signal: request.signal
    };
  }

  // src/nativeNavigator/mainHook.ts
  function installNativeHistoryHook(target) {
    const flag = target;
    if (flag.__chatgptYadaNativeHistoryHook) return;
    flag.__chatgptYadaNativeHistoryHook = true;
    install(target);
  }
  var runningVitest = Boolean(globalThis.process?.env?.VITEST);
  if (!runningVitest) installNativeHistoryHook(window);
  function install(target) {
    const nativeFetch = target.fetch;
    let transport = emptyTransportState(conversationIdFromUrl(target.location.href));
    let lease = emptyPrepareLease();
    let pendingRequests = 0;
    const broadcast = () => {
      transport.revision += 1;
      target.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "state", state: { ...transport } }, target.location.origin);
    };
    const emitRoute = () => {
      target.postMessage({
        channel: NATIVE_NAV_CHANNEL,
        kind: "route",
        conversationId: transport.conversationId,
        generation: transport.generation
      }, target.location.origin);
    };
    const closePrepare = () => {
      const changed = lease.enabled || transport.boosted;
      lease = emptyPrepareLease();
      transport.boosted = false;
      return changed;
    };
    const expirePrepare = (now) => {
      if (!lease.enabled || isPrepareActive(lease, now, transport.conversationId, transport.generation)) return;
      if (closePrepare()) broadcast();
    };
    const synchronizeRoute = () => {
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
    target.fetch = function(input, init) {
      synchronizeRoute();
      const now = Date.now();
      expirePrepare(now);
      const request = historyRequest(input, init, target.location.href);
      if (!request) return nativeFetch.call(this, input, init);
      const expand = shouldExpandHistoryRequest(input, init, target.location.href, {
        visible: target.document.visibilityState === "visible",
        prepareActive: isPrepareActive(lease, now, transport.conversationId, transport.generation)
      });
      const outgoing = expand ? expandHistoryRequest(input, init, target.location.href) : [input, init];
      const ticket = {
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
      let original;
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
    function finish(ticket, status, error) {
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
  function classifyFetchError(error) {
    return error && typeof error === "object" && "name" in error && error.name === "AbortError" ? "aborted" : "fetch-error";
  }
  function patchHistoryMethod(history, method, onRoute) {
    const original = history[method];
    history[method] = function(...args) {
      original.apply(this, args);
      onRoute();
    };
  }
})();
