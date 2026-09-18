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
    active = /* @__PURE__ */ new Map();
    currentNode = null;
    promptCount = 0;
    nextRequestId = 0;
    latestInitialId = 0;
    routeGeneration = 0;
    snapshot = emptyHistoryState();
    snapshotState() {
      return { ...this.snapshot };
    }
    reset(conversationId = "") {
      this.ids.clear();
      this.seenCursors.clear();
      this.active.clear();
      this.currentNode = null;
      this.promptCount = 0;
      this.latestInitialId = 0;
      this.snapshot = emptyHistoryState(conversationId);
      this.snapshot.generation = this.routeGeneration;
      this.syncPending();
    }
    notifyRoute(conversationId) {
      this.routeGeneration += 1;
      this.reset(conversationId);
      this.snapshot.revision += 1;
      return this.snapshotState();
    }
    matchesContext(ctx) {
      return ctx.conversationId === this.snapshot.conversationId && ctx.routeGeneration === this.snapshot.generation;
    }
    isStale(ctx) {
      if (!this.matchesContext(ctx)) return true;
      if (ctx.kind === "initial") return ctx.requestId !== this.latestInitialId;
      return ctx.initialVersion !== this.snapshot.initialVersion;
    }
    isValidRequest(ctx) {
      return !this.isStale(ctx);
    }
    beginRequest(input) {
      if (!this.snapshot.conversationId) {
        if (this.routeGeneration === 0) this.routeGeneration = 1;
        this.snapshot.conversationId = input.conversationId;
        this.snapshot.generation = this.routeGeneration;
      }
      const ctx = {
        requestId: ++this.nextRequestId,
        conversationId: input.conversationId,
        routeGeneration: this.snapshot.generation,
        initialVersion: this.snapshot.initialVersion,
        kind: input.kind,
        before: input.before
      };
      if (this.matchesContext(ctx) && ctx.kind === "initial") this.latestInitialId = ctx.requestId;
      this.active.set(ctx.requestId, ctx);
      this.snapshot.boosted = this.snapshot.boosted || Boolean(input.boosted);
      this.snapshot.revision += 1;
      this.syncPending();
      return ctx;
    }
    endRequest(requestId) {
      this.active.delete(requestId);
      this.snapshot.revision += 1;
      this.syncPending();
      return this.snapshotState();
    }
    markIssue(issue, ctx) {
      if (ctx && this.isStale(ctx)) return this.snapshotState();
      this.snapshot.issue = issue;
      this.snapshot.revision += 1;
      return this.snapshotState();
    }
    applyInitial(conversationId, payload) {
      if (this.snapshot.conversationId !== conversationId) this.notifyRoute(conversationId);
      const ctx = this.beginRequest({ conversationId, kind: "initial", before: null });
      const state = this.applyInitialFrom(ctx, payload);
      this.endRequest(ctx.requestId);
      return state;
    }
    applyOlder(payload, requestedBefore) {
      return this.applyOlderFrom({
        requestId: ++this.nextRequestId,
        conversationId: this.snapshot.conversationId,
        routeGeneration: this.snapshot.generation,
        initialVersion: this.snapshot.initialVersion,
        kind: "older",
        before: requestedBefore
      }, payload, false);
    }
    applyInitialFrom(ctx, payload) {
      if (!this.matchesContext(ctx) || ctx.kind !== "initial" || ctx.requestId !== this.latestInitialId) {
        return this.snapshotState();
      }
      this.ids.clear();
      this.seenCursors.clear();
      this.promptCount = 0;
      this.snapshot.conversationId = ctx.conversationId;
      this.snapshot.initialVersion += 1;
      this.snapshot.pages = 0;
      this.snapshot.issue = null;
      this.snapshot.boundary = "unknown";
      this.snapshot.cursor = null;
      this.currentNode = typeof payload.current_node === "string" ? payload.current_node : null;
      this.syncPending();
      return this.commitPage(payload, "initial");
    }
    applyOlderFrom(ctx, payload, silentStale = true) {
      if (!this.matchesContext(ctx) || ctx.initialVersion !== this.snapshot.initialVersion) {
        return this.snapshotState();
      }
      if (this.snapshot.pages < 1) {
        return silentStale ? this.snapshotState() : this.markIssue("unlinked");
      }
      if (!ctx.before || ctx.before !== this.snapshot.cursor) {
        return silentStale ? this.snapshotState() : this.fail("unlinked");
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
        this.syncPending();
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
      this.seenCursors.add(this.snapshot.cursor ?? ctx.before);
      this.snapshot.cursor = nextCursor;
      this.snapshot.pages += 1;
      this.snapshot.boundary = "more";
      this.snapshot.issue = null;
      this.snapshot.revision += 1;
      this.syncCounts();
      this.syncPending();
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
    syncPending() {
      let pending = 0;
      for (const ctx of this.active.values()) {
        if (this.isValidRequest(ctx)) pending += 1;
      }
      this.snapshot.pending = pending;
    }
  };

  // src/nativeBootstrap/page.ts
  var FLAG = "__chatgptYadaNativeBootstrapPage";
  var readers = 0;
  var boostUntil = 0;
  var boostConversationId = "";
  var routeConversationId = currentConversationId() ?? "";
  var captures = /* @__PURE__ */ new Map();
  function publish(state) {
    window.postMessage({ source: YADA_PAGE_SOURCE, type: "history-state", state }, location.origin);
  }
  function boostActive(conversationId) {
    return Boolean(conversationId) && boostConversationId === conversationId && Date.now() < boostUntil;
  }
  function isPrepareBoostActive(conversationId = currentConversationId()) {
    return typeof conversationId === "string" && boostActive(conversationId);
  }
  function nativeBootstrapCaptureStats() {
    return { readers, captures: captures.size };
  }
  function cancelHandle(handle) {
    try {
      handle.controller.abort();
    } catch {
    }
    if (handle.reader) {
      void handle.reader.cancel().catch(() => void 0);
      handle.reader = null;
    }
  }
  function cancelCaptures(predicate) {
    for (const [requestId, handle] of captures) {
      if (predicate && !predicate(handle.ctx)) continue;
      cancelHandle(handle);
      captures.delete(requestId);
    }
  }
  function cancelStaleCaptures(tracker) {
    cancelCaptures((ctx) => tracker.isStale(ctx));
  }
  async function readCloneLimited(clone, handle, signal) {
    const body = clone.body;
    if (!body) throw new Error("missing-body");
    const reader = body.getReader();
    handle.reader = reader;
    const chunks = [];
    let total = 0;
    const abortRead = () => {
      void reader.cancel().catch(() => void 0);
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
      }
    }
  }
  async function captureResponse(tracker, promise, ctx, boosted) {
    const handle = { ctx, controller: new AbortController(), reader: null };
    captures.set(ctx.requestId, handle);
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      handle.controller.abort();
    }, MAX_CAPTURE_MS);
    try {
      let response;
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
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        const slim = {
          current_node: typeof payload.current_node === "string" ? payload.current_node : null,
          page_info: payload.page_info,
          messages: Array.isArray(payload.messages) ? payload.messages.map((message) => ({
            id: typeof message?.id === "string" ? message.id : void 0,
            author: { role: message?.author?.role }
          })) : void 0
        };
        const state = ctx.kind === "initial" ? tracker.applyInitialFrom(ctx, slim) : tracker.applyOlderFrom(ctx, slim);
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
        const aborted = handle.controller.signal.aborted || error instanceof DOMException && error.name === "AbortError";
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
  function installRouteWatch(onChange) {
    const nativePush = history.pushState.bind(history);
    const nativeReplace = history.replaceState.bind(history);
    const notify = () => {
      const next = currentConversationId() ?? "";
      if (next === routeConversationId) return;
      routeConversationId = next;
      onChange(next);
    };
    history.pushState = function chatgptYadaPushState(...args) {
      nativePush(...args);
      notify();
    };
    history.replaceState = function chatgptYadaReplaceState(...args) {
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
  function installNativeBootstrapPage() {
    const globalState = globalThis;
    if (globalState[FLAG]) return globalState[FLAG].dispose;
    const tracker = new HistoryTracker();
    const nativeFetch = window.fetch;
    routeConversationId = currentConversationId() ?? "";
    if (routeConversationId) tracker.notifyRoute(routeConversationId);
    const onRoute = (conversationId) => {
      cancelCaptures();
      publish(tracker.notifyRoute(conversationId));
      if (boostConversationId && boostConversationId !== conversationId) {
        boostUntil = 0;
        boostConversationId = "";
      }
    };
    const disposeRoute = installRouteWatch(onRoute);
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
    const dispose = () => {
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
})();
