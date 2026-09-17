"use strict";
(() => {
  // src/history/historyPage.ts
  var HISTORY_SOURCE = "chatgpt-yada-history";
  var SENTINEL = "conversation-pagination-sentinel";
  var INSTALLED = "__chatgptYadaHistoryPage";
  var generation = 0;
  var sentinel = null;
  var lastFetch = null;
  function conversationIdFromHref(url = location.href) {
    try {
      const parsed = new URL(url);
      return parsed.pathname.match(/^\/c\/([a-z0-9-]+)/i)?.[1] ?? parsed.pathname.match(/^\/g\/[a-z0-9-]+\/c\/([a-z0-9-]+)/i)?.[1] ?? null;
    } catch {
      return url.match(/\/c\/([a-z0-9-]+)/i)?.[1] ?? null;
    }
  }
  function isHistorySentinel(target) {
    if (!(target instanceof Element)) return false;
    const testId = target.getAttribute("data-testid");
    return typeof testId === "string" && testId.includes(SENTINEL);
  }
  function getHistoryPageStatus() {
    const target = sentinel?.target;
    return {
      generation,
      hasSentinel: !!target?.isConnected,
      conversationId: conversationIdFromHref()
    };
  }
  function rewriteConversationHistoryRequest(rawUrl, method, conversationId, extra = {}) {
    if (!conversationId || method.toUpperCase() !== "GET") return null;
    if (extra.accept?.toLowerCase().includes("text/event-stream")) return null;
    let url;
    try {
      url = new URL(rawUrl, location.origin);
    } catch {
      return null;
    }
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
  function wrapFetchForHistory(original, getConversationId) {
    return function patchedFetch(input, init) {
      const request = input instanceof Request ? input : null;
      const method = init?.method ?? request?.method ?? "GET";
      const url = request ? request.url : String(input);
      const headers = new Headers(init?.headers ?? request?.headers);
      const conversationId = getConversationId();
      const rewritten = rewriteConversationHistoryRequest(url, method, conversationId, { accept: headers.get("accept") });
      const nextInput = rewritten ? request ? new Request(rewritten, request) : rewritten : input;
      return original.call(this, nextInput, request && rewritten ? void 0 : init).then((response) => {
        const used = rewritten ?? url;
        if (conversationId && method.toUpperCase() === "GET" && isConversationHistoryUrl(used, conversationId) && !headers.get("accept")?.toLowerCase().includes("text/event-stream")) {
          void noteFetch(response, conversationId);
        }
        return response;
      });
    };
  }
  function isConversationHistoryUrl(rawUrl, conversationId) {
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
  async function noteFetch(response, conversationId) {
    const peek = await peekPageInfo(response);
    lastFetch = { status: response.status, ok: response.ok, conversationId, ...peek };
    post({ type: "fetch-result", ...lastFetch, generation, hasSentinel: getHistoryPageStatus().hasSentinel });
  }
  async function peekPageInfo(response) {
    try {
      const data = await response.clone().json();
      const nested = data && typeof data.conversation === "object" && data.conversation ? data.conversation : null;
      const page = data?.page_info ?? data?.pageInfo ?? nested?.page_info ?? nested?.pageInfo;
      if (!page || typeof page !== "object") return {};
      const has = page.has_previous_page ?? page.hasPreviousPage;
      const cursor = page.start_cursor ?? page.startCursor;
      return {
        hasPreviousPage: typeof has === "boolean" ? has : void 0,
        cursor: typeof cursor === "string" && cursor ? cursor : null
      };
    } catch {
      return {};
    }
  }
  function post(payload) {
    try {
      window.postMessage({ source: HISTORY_SOURCE, ...payload }, location.origin);
    } catch {
    }
  }
  function rememberSentinel(callback, observer, target, entry) {
    const known = sentinel?.target === target && sentinel.observer === observer;
    if (!known) generation += 1;
    sentinel = { callback, observer, target, generation, lastEntry: entry ?? sentinel?.lastEntry ?? null };
    post({ type: "status", ...getHistoryPageStatus() });
  }
  function forgetSentinel(target, observer) {
    if (sentinel?.target === target && sentinel.observer === observer) {
      sentinel = null;
      post({ type: "status", ...getHistoryPageStatus() });
    }
  }
  function syntheticEntry(record) {
    if (record.lastEntry) {
      const forced = Object.create(record.lastEntry);
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
  function triggerLoadPage(conversationId, nonce) {
    const status = getHistoryPageStatus();
    const record = sentinel?.target?.isConnected ? sentinel : null;
    if (!record || conversationId && status.conversationId && conversationId !== status.conversationId) {
      post({ type: "load-result", nonce, triggered: false, ok: false, status: 0, ...status, conversationId: status.conversationId });
      return;
    }
    try {
      record.callback([syntheticEntry(record)], record.observer);
    } catch {
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
  function wrapIntersectionObserver(Native) {
    class YadaHistoryObserver {
      callback;
      native;
      constructor(callback, options) {
        this.callback = callback;
        this.native = new Native((entries) => {
          for (const entry of entries) {
            if (isHistorySentinel(entry.target)) rememberSentinel(this.callback, this, entry.target, entry);
          }
          this.callback(entries, this);
        }, options);
      }
      observe(target) {
        if (isHistorySentinel(target)) rememberSentinel(this.callback, this, target, null);
        this.native.observe(target);
      }
      unobserve(target) {
        this.native.unobserve(target);
        forgetSentinel(target, this);
      }
      disconnect() {
        this.native.disconnect();
        if (sentinel?.observer === this) {
          sentinel = null;
          post({ type: "status", ...getHistoryPageStatus() });
        }
      }
      takeRecords() {
        return this.native.takeRecords();
      }
      get root() {
        return this.native.root;
      }
      get rootMargin() {
        return this.native.rootMargin;
      }
      get thresholds() {
        return this.native.thresholds;
      }
    }
    Object.setPrototypeOf(YadaHistoryObserver.prototype, Native.prototype);
    Object.setPrototypeOf(YadaHistoryObserver, Native);
    Object.defineProperty(YadaHistoryObserver, "name", { value: "IntersectionObserver" });
    return YadaHistoryObserver;
  }
  function onMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== HISTORY_SOURCE) return;
    if (data.type === "query") post({ type: "status", ...getHistoryPageStatus() });
    if (data.type === "load-page") triggerLoadPage(data.conversationId ?? "", Number(data.nonce) || 0);
  }
  function installHistoryPage() {
    const page = globalThis;
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
})();
