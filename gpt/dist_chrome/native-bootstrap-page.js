"use strict";
(() => {
  // src/nativeBootstrap/shared.ts
  var TARGET_NUM_TURNS = 100;
  var PREPARE_TTL_MS = 1e4;
  var MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
  var MAX_CAPTURE_MS = 8e3;
  var MAX_CLONE_READERS = 2;
  var MAX_MESSAGE_IDS = 1e4;
  var YADA_PAGE_SOURCE = "chatgpt-yada-page";
  var YADA_CONTENT_SOURCE = "chatgpt-yada-content";
  function emptyHistoryState(conversationId = "") {
    return {
      conversationId,
      generation: 0,
      initialVersion: 0,
      revision: 0,
      pending: 0,
      pages: 0,
      messages: 0,
      prompts: 0,
      boundary: "unknown",
      cursor: null,
      issue: null,
      boosted: false
    };
  }

  // src/platform/chatgptAdapter.ts
  function getConversationIdFromUrl(url = window.location.href) {
    try {
      const parsed = new URL(url);
      return parsed.pathname.match(/^\/c\/([a-z0-9-]+)/i)?.[1] ?? parsed.pathname.match(/^\/g\/[a-z0-9-]+\/c\/([a-z0-9-]+)/i)?.[1] ?? null;
    } catch {
      return url.match(/\/c\/([a-z0-9-]+)/i)?.[1] ?? null;
    }
  }

  // src/nativeBootstrap/history.ts
  var INITIAL_PATH = /^\/backend-api\/conversations\/([^/]+)\/?$/;
  var MESSAGES_PATH = /^\/backend-api\/conversations\/([^/]+)\/messages\/?$/;
  function getFetchUrl(input) {
    if (typeof input === "string") return input;
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
    return input instanceof URL ? input.toString() : "";
  }
  function getFetchMethod(input, init) {
    return (init?.method || (isRequestLike(input) ? input.method : "GET")).toUpperCase();
  }
  function isRequestLike(input) {
    if (!input || typeof input !== "object") return false;
    const request = input;
    return typeof request.method === "string" && request.headers != null && typeof request.url === "string";
  }
  function matchConversationApiUrl(rawUrl, baseUrl) {
    try {
      const pathname = new URL(rawUrl, baseUrl).pathname;
      const messages = pathname.match(MESSAGES_PATH);
      if (messages) {
        const conversationId2 = decodeURIComponent(messages[1]);
        return conversationId2 && conversationId2 !== "init" ? { kind: "paginated-messages", conversationId: conversationId2 } : null;
      }
      const initial = pathname.match(INITIAL_PATH);
      if (!initial) return null;
      const conversationId = decodeURIComponent(initial[1]);
      return conversationId && conversationId !== "init" ? { kind: "paginated-initial", conversationId } : null;
    } catch {
      return null;
    }
  }
  function isMessageDeepLink(url = typeof location === "undefined" ? "" : location.href) {
    try {
      const parsed = new URL(url, "https://chatgpt.com");
      return parsed.searchParams.has("message") || parsed.searchParams.has("messageId");
    } catch {
      return false;
    }
  }
  function currentConversationId(url = typeof location === "undefined" ? "" : location.href) {
    return getConversationIdFromUrl(url);
  }
  function isSameOriginGet(rawUrl, baseUrl, input, init) {
    if (getFetchMethod(input, init) !== "GET") return false;
    try {
      const url = new URL(rawUrl, baseUrl);
      const base = new URL(baseUrl);
      return url.origin === base.origin;
    } catch {
      return false;
    }
  }
  function requestHasEventStream(input, init) {
    const value = headerValue(input, init, "accept") + " " + headerValue(input, init, "content-type");
    return value.includes("text/event-stream");
  }
  function headerValue(input, init, name) {
    const fromInit = readHeader(init?.headers, name);
    if (fromInit) return fromInit;
    return isRequestLike(input) ? readHeader(input.headers, name) : "";
  }
  function readHeader(headers, name) {
    if (!headers) return "";
    if (headers instanceof Headers) return headers.get(name) ?? "";
    if (Array.isArray(headers)) {
      const found = headers.find(([key2]) => key2.toLowerCase() === name.toLowerCase());
      return found?.[1] ?? "";
    }
    const record = headers;
    const key = Object.keys(record).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return key ? record[key] : "";
  }
  function shouldHandleConversationRequest(input, init, baseUrl, conversationId) {
    if (!conversationId) return null;
    if (isMessageDeepLink(baseUrl)) return null;
    const rawUrl = getFetchUrl(input);
    if (!rawUrl) return null;
    if (!isSameOriginGet(rawUrl, baseUrl, input, init)) return null;
    if (requestHasEventStream(input, init)) return null;
    let url;
    try {
      url = new URL(rawUrl, baseUrl);
    } catch {
      return null;
    }
    if (url.searchParams.has("include_message_id")) return null;
    const match = matchConversationApiUrl(url.href, baseUrl);
    if (!match || match.conversationId !== conversationId) return null;
    if (match.kind === "paginated-messages" && !url.searchParams.has("before")) return null;
    return match;
  }
  function boostConversationUrl(rawUrl, baseUrl, match, boostOlder) {
    const url = new URL(rawUrl, baseUrl);
    let boosted = false;
    const requested = Number(url.searchParams.get("num_turns"));
    const missingOrSmall = !Number.isFinite(requested) || requested <= 0 || requested < TARGET_NUM_TURNS;
    if (match.kind === "paginated-initial") {
      if (missingOrSmall) {
        url.searchParams.set("num_turns", String(TARGET_NUM_TURNS));
        boosted = true;
      }
    } else if (boostOlder) {
      if (missingOrSmall) {
        url.searchParams.set("num_turns", String(TARGET_NUM_TURNS));
        boosted = true;
      }
      if (url.searchParams.get("include_has_versions") !== "true") {
        url.searchParams.set("include_has_versions", "true");
        boosted = true;
      }
    }
    return { href: url.href, boosted };
  }
  function rewriteGetRequest(input, init, rewrittenUrl) {
    const requestLike = input;
    if (typeof requestLike.method !== "string" || requestLike.headers == null) {
      return [rewrittenUrl, init];
    }
    if (typeof Request !== "undefined" && isRequestLike(input)) {
      try {
        return [new Request(rewrittenUrl, input), init];
      } catch {
      }
    }
    const rewrittenInit = {
      method: "GET",
      headers: requestLike.headers,
      credentials: requestLike.credentials,
      cache: requestLike.cache,
      redirect: requestLike.redirect,
      referrer: requestLike.referrer,
      referrerPolicy: requestLike.referrerPolicy,
      integrity: requestLike.integrity,
      keepalive: requestLike.keepalive,
      mode: requestLike.mode,
      signal: requestLike.signal,
      ...init
    };
    return [rewrittenUrl, rewrittenInit];
  }
  function pageHasPrevious(payload) {
    const value = payload.page_info?.has_previous_page;
    return typeof value === "boolean" ? value : void 0;
  }
  function pageCursor(payload) {
    const cursor = payload.page_info?.start_cursor;
    return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
  }
  function messageRole(message) {
    return message.author?.role ?? "";
  }
  var HistoryTracker = class {
    ids = /* @__PURE__ */ new Set();
    seenCursors = /* @__PURE__ */ new Set();
    currentNode = null;
    promptCount = 0;
    snapshot = emptyHistoryState();
    snapshotState() {
      return { ...this.snapshot };
    }
    reset(conversationId = "") {
      this.ids.clear();
      this.seenCursors.clear();
      this.currentNode = null;
      this.promptCount = 0;
      this.snapshot = emptyHistoryState(conversationId);
    }
    beginRequest(conversationId, boosted) {
      if (this.snapshot.conversationId !== conversationId) this.reset(conversationId);
      this.snapshot.pending += 1;
      this.snapshot.boosted = this.snapshot.boosted || boosted;
      this.snapshot.revision += 1;
      return this.snapshotState();
    }
    endRequest() {
      this.snapshot.pending = Math.max(0, this.snapshot.pending - 1);
      this.snapshot.revision += 1;
      return this.snapshotState();
    }
    markIssue(issue) {
      this.snapshot.issue = issue;
      this.snapshot.revision += 1;
      return this.snapshotState();
    }
    applyInitial(conversationId, payload) {
      this.ids.clear();
      this.seenCursors.clear();
      this.promptCount = 0;
      this.snapshot.conversationId = conversationId;
      this.snapshot.generation += 1;
      this.snapshot.initialVersion += 1;
      this.snapshot.pages = 0;
      this.snapshot.issue = null;
      this.snapshot.boundary = "unknown";
      this.snapshot.cursor = null;
      this.currentNode = typeof payload.current_node === "string" ? payload.current_node : null;
      return this.commitPage(payload, "initial");
    }
    applyOlder(payload, requestedBefore) {
      if (this.snapshot.pages < 1) {
        return this.markIssue("unlinked");
      }
      if (!requestedBefore || requestedBefore !== this.snapshot.cursor) {
        return this.fail("unlinked");
      }
      const nextNode = typeof payload.current_node === "string" ? payload.current_node : null;
      if (this.currentNode && nextNode && nextNode !== this.currentNode) {
        return this.fail("unlinked");
      }
      const added = this.collectNewIds(payload);
      if (added < 0) return this.markIssue("limit");
      if (added === 0) return this.fail("stalled");
      const previous = pageHasPrevious(payload);
      const nextCursor = pageCursor(payload);
      if (previous === false) {
        this.snapshot.pages += 1;
        this.snapshot.boundary = "complete";
        this.snapshot.cursor = null;
        this.snapshot.issue = null;
        this.snapshot.revision += 1;
        this.syncCounts();
        return this.snapshotState();
      }
      if (previous !== true || !nextCursor) {
        return this.fail("stalled");
      }
      if (nextCursor === this.snapshot.cursor || this.seenCursors.has(nextCursor)) {
        this.snapshot.issue = nextCursor === this.snapshot.cursor ? "stalled" : "limit";
        this.snapshot.revision += 1;
        this.syncCounts();
        return this.snapshotState();
      }
      this.seenCursors.add(this.snapshot.cursor ?? requestedBefore);
      this.snapshot.cursor = nextCursor;
      this.snapshot.pages += 1;
      this.snapshot.boundary = "more";
      this.snapshot.issue = null;
      this.snapshot.revision += 1;
      this.syncCounts();
      return this.snapshotState();
    }
    commitPage(payload, kind) {
      const added = this.collectNewIds(payload);
      if (added < 0) return this.markIssue("limit");
      if (kind === "initial" && added === 0 && !Array.isArray(payload.messages)) {
        return this.markIssue("stalled");
      }
      const previous = pageHasPrevious(payload);
      const cursor = pageCursor(payload);
      this.snapshot.pages += 1;
      if (previous === false) {
        this.snapshot.boundary = "complete";
        this.snapshot.cursor = null;
      } else if (previous === true && cursor) {
        if (this.seenCursors.has(cursor)) {
          this.snapshot.issue = "limit";
          this.syncCounts();
          this.snapshot.revision += 1;
          return this.snapshotState();
        }
        this.snapshot.boundary = "more";
        this.snapshot.cursor = cursor;
      } else {
        this.snapshot.boundary = "unknown";
        this.snapshot.cursor = cursor;
      }
      this.snapshot.issue = null;
      this.snapshot.revision += 1;
      this.syncCounts();
      return this.snapshotState();
    }
    fail(issue) {
      this.snapshot.issue = issue;
      if (this.snapshot.boundary === "complete") this.snapshot.boundary = "unknown";
      this.snapshot.revision += 1;
      return this.snapshotState();
    }
    collectNewIds(payload) {
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      let added = 0;
      for (const message of messages) {
        const id = typeof message.id === "string" ? message.id : "";
        if (!id) continue;
        if (this.ids.has(id)) continue;
        if (this.ids.size >= MAX_MESSAGE_IDS) return -1;
        this.ids.add(id);
        added += 1;
        if (messageRole(message) === "user") this.promptCount += 1;
      }
      return added;
    }
    syncCounts() {
      this.snapshot.messages = this.ids.size;
      this.snapshot.prompts = this.promptCount;
    }
  };

  // src/nativeBootstrap/page.ts
  var FLAG = "__chatgptYadaNativeBootstrapPage";
  var readers = 0;
  var boostUntil = 0;
  var boostConversationId = "";
  var captureControllers = /* @__PURE__ */ new Set();
  function publish(state) {
    window.postMessage({ source: YADA_PAGE_SOURCE, type: "history-state", state }, location.origin);
  }
  function boostActive(conversationId) {
    return Boolean(conversationId) && boostConversationId === conversationId && Date.now() < boostUntil;
  }
  function isPrepareBoostActive(conversationId = currentConversationId()) {
    return typeof conversationId === "string" && boostActive(conversationId);
  }
  function cancelCaptures() {
    for (const controller of captureControllers) controller.abort();
    captureControllers.clear();
  }
  async function captureResponse(tracker, promise, matchKind, conversationId, requestedBefore, boosted) {
    let response;
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
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          if (controller.signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        })
      ]);
      if (buffer.byteLength > MAX_CAPTURE_BYTES) {
        publish(tracker.markIssue("capture-unavailable"));
        return;
      }
      const payload = JSON.parse(new TextDecoder().decode(buffer));
      const slim = {
        current_node: typeof payload.current_node === "string" ? payload.current_node : null,
        page_info: payload.page_info,
        messages: Array.isArray(payload.messages) ? payload.messages.map((message) => ({
          id: typeof message?.id === "string" ? message.id : void 0,
          author: { role: message?.author?.role }
        })) : void 0
      };
      const state = matchKind === "paginated-initial" ? tracker.applyInitial(conversationId, slim) : tracker.applyOlder(slim, requestedBefore);
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
  function installNativeBootstrapPage() {
    const globalState = globalThis;
    if (globalState[FLAG]) return globalState[FLAG].dispose;
    const tracker = new HistoryTracker();
    const nativeFetch = window.fetch;
    const onMessage = (event) => {
      if (event.origin !== location.origin) return;
      const data = event.data;
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
    window.fetch = function chatgptYadaFetch(input, init) {
      const conversationId = currentConversationId();
      const match = shouldHandleConversationRequest(input, init, location.href, conversationId);
      if (!match || !conversationId) return nativeFetch.call(window, input, init);
      const rawUrl = getFetchUrl(input);
      const url = new URL(rawUrl, location.href);
      const olderBoost = match.kind === "paginated-messages" && boostActive(conversationId);
      const rewritten = boostConversationUrl(url.href, location.href, match, olderBoost);
      const [nextInput, nextInit] = rewritten.href === url.href ? [input, init] : rewriteGetRequest(input, init, rewritten.href);
      const requestedBefore = match.kind === "paginated-messages" ? url.searchParams.get("before") : null;
      publish(tracker.beginRequest(conversationId, rewritten.boosted));
      const promise = nativeFetch.call(window, nextInput, nextInit);
      void promise.finally(() => publish(tracker.endRequest()));
      void captureResponse(tracker, promise, match.kind, conversationId, requestedBefore, rewritten.boosted);
      return promise;
    };
    window.addEventListener("message", onMessage);
    const dispose = () => {
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
})();
