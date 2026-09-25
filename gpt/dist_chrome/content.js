"use strict";
(() => {
  // src/nativeNavigator/protocol.ts
  var NATIVE_NAV_CHANNEL = "chatgpt-yada:native-nav:v1";
  var PREPARE_HEARTBEAT_MS = 4e3;
  var PREPARE_ACK_WAIT_MS = 1e3;
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
  function isNativeTransportState(value) {
    const candidate = record(value);
    if (!candidate) return false;
    if (candidate.conversationId !== null && !identifier(candidate.conversationId)) return false;
    if (typeof candidate.requestInFlight !== "boolean" || typeof candidate.boosted !== "boolean") return false;
    if (candidate.lastRequestKind !== null && candidate.lastRequestKind !== "initial" && candidate.lastRequestKind !== "older") return false;
    if (candidate.lastRequestError !== null && candidate.lastRequestError !== "http-error" && candidate.lastRequestError !== "aborted" && candidate.lastRequestError !== "fetch-error") return false;
    if (candidate.lastHttpStatus !== null && (!Number.isSafeInteger(candidate.lastHttpStatus) || candidate.lastHttpStatus < 100 || candidate.lastHttpStatus > 599)) return false;
    if (candidate.lastRequestAt !== null && (!Number.isSafeInteger(candidate.lastRequestAt) || candidate.lastRequestAt < 0)) return false;
    for (const key of ["generation", "revision", "historyRequests", "olderRequests", "lastRequestDurationMs"]) {
      const number = candidate[key];
      if (!Number.isSafeInteger(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) return false;
    }
    return candidate.olderRequests <= candidate.historyRequests;
  }

  // src/core/bootGate.ts
  var BOOT_FALLBACK_MS = 15e3;
  var IDLE_TIMEOUT_MS = 2e3;
  var RESOURCE_SKEW_MS = 1e3;
  var ConversationBootGate = class {
    constructor(sync) {
      this.sync = sync;
    }
    generation = 0;
    conversationId = null;
    hostGeneration = null;
    initialEndedAt = null;
    initialDurationMs = 0;
    observer = null;
    timer = 0;
    idleTimer = 0;
    idleId = 0;
    listening = false;
    transferSeen = false;
    launched = false;
    arm(conversationId) {
      this.stopWatching();
      this.conversationId = conversationId;
      this.hostGeneration = null;
      this.initialEndedAt = null;
      this.initialDurationMs = 0;
      this.transferSeen = false;
      this.launched = false;
      if (!conversationId || document.visibilityState === "hidden") return;
      if (this.sync.hasUsableFullSnapshot(conversationId)) return;
      const generation = ++this.generation;
      this.timer = window.setTimeout(() => this.fallback(generation), BOOT_FALLBACK_MS);
      this.listenMain();
      this.observeResources(conversationId, generation);
      this.requestState();
    }
    isPending() {
      return this.conversationId != null && !this.launched && !this.sync.hasUsableFullSnapshot(this.conversationId) && this.isWatching();
    }
    isActive() {
      return this.launched && this.sync.isReading();
    }
    clear() {
      this.generation += 1;
      this.stopWatching();
      this.conversationId = null;
      this.hostGeneration = null;
      this.initialEndedAt = null;
      this.initialDurationMs = 0;
    }
    dispose() {
      this.clear();
    }
    isWatching() {
      return this.listening || this.observer != null || this.timer !== 0 || this.idleTimer !== 0 || this.idleId !== 0;
    }
    requestState() {
      window.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "hello" }, location.origin);
    }
    observeResources(conversationId, generation) {
      this.inspectResources(conversationId, generation);
      if (typeof PerformanceObserver === "undefined") return;
      this.observer = new PerformanceObserver((list) => {
        void list;
        this.inspectResources(conversationId, generation);
      });
      try {
        this.observer.observe({ type: "resource", buffered: true });
      } catch {
        this.observer.disconnect();
        this.observer = null;
      }
    }
    inspectResources(conversationId, generation) {
      if (generation !== this.generation || this.initialEndedAt == null) return;
      const existing = performance.getEntriesByType?.("resource") ?? [];
      if (existing.some((entry) => this.resourceMatchesCurrentInitial(entry, conversationId))) {
        this.onTransfer(generation);
      }
    }
    resourceMatchesCurrentInitial(entry, conversationId) {
      if (!historyTransferDone(entry, conversationId) || this.initialEndedAt == null) return false;
      const timing = entry;
      const endedAt = performance.timeOrigin + timing.responseEnd;
      const startedAt = this.initialEndedAt - this.initialDurationMs;
      return endedAt >= startedAt - RESOURCE_SKEW_MS && endedAt <= this.initialEndedAt + RESOURCE_SKEW_MS;
    }
    listenMain() {
      if (this.listening) return;
      window.addEventListener("message", this.onMain);
      this.listening = true;
    }
    onMain = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = record(event.data);
      if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "state") return;
      if (!isNativeTransportState(message.state)) return;
      this.onHostState(message.state);
    };
    onHostState(state) {
      if (state.conversationId !== this.conversationId) return;
      if (this.hostGeneration == null) this.hostGeneration = state.generation;
      if (state.generation !== this.hostGeneration) return;
      if (state.lastRequestKind !== "initial" || state.requestInFlight || state.lastRequestAt == null) return;
      this.initialEndedAt = state.lastRequestAt;
      this.initialDurationMs = state.lastRequestDurationMs;
      if (this.observer) {
        this.inspectResources(this.conversationId, this.generation);
        return;
      }
      this.onTransfer(this.generation);
    }
    onTransfer(generation) {
      if (generation !== this.generation || this.transferSeen || this.launched) return;
      this.transferSeen = true;
      const start = () => {
        this.idleId = 0;
        this.idleTimer = 0;
        this.launch(generation);
      };
      if (typeof requestIdleCallback === "function") {
        this.idleId = requestIdleCallback(() => start(), { timeout: IDLE_TIMEOUT_MS });
        return;
      }
      this.idleTimer = window.setTimeout(start, 0);
    }
    fallback(generation) {
      this.timer = 0;
      if (generation !== this.generation || this.launched) return;
      this.launch(generation);
    }
    launch(generation) {
      if (generation !== this.generation || this.launched) return;
      if (!this.canStart()) return;
      this.launched = true;
      this.stopWatching();
      void this.sync.requestFull("boot");
    }
    canStart() {
      if (!this.conversationId || this.sync.getActiveConversationId() !== this.conversationId) return false;
      if (document.visibilityState === "hidden" || isAssistantStreaming()) return false;
      if (this.sync.hasUsableFullSnapshot(this.conversationId)) return false;
      return true;
    }
    stopWatching() {
      this.observer?.disconnect();
      this.observer = null;
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = 0;
      if (this.idleTimer) window.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
      if (this.idleId && typeof cancelIdleCallback === "function") cancelIdleCallback(this.idleId);
      this.idleId = 0;
      if (this.listening) {
        window.removeEventListener("message", this.onMain);
        this.listening = false;
      }
    }
  };
  function historyTransferDone(entry, conversationId) {
    const timing = entry;
    if (!(timing.responseEnd > 0)) return false;
    try {
      const url = new URL(entry.name);
      const path = url.pathname;
      return path === `/backend-api/conversations/${conversationId}` || path === `/backend-api/conversation/${conversationId}` || path === `/backend-api/conversations/${conversationId}/messages`;
    } catch {
      return false;
    }
  }
  function isAssistantStreaming() {
    return Boolean(document.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming'));
  }

  // src/conversation/completeConversation.ts
  var PAGE_NUM_TURNS = 100;
  var RECENT_TURN_BATCH = 16;
  var MAX_PAGES = 500;
  function unwrap(data) {
    return data.conversation ?? data;
  }
  function abortError() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }
  function isCompleteConversationMapping(raw) {
    const data = unwrap(raw), mapping = data.mapping;
    let next = data.current_node ?? data.current_node_id ?? "";
    if (!mapping || !next || !mapping[next]) return false;
    const seen = /* @__PURE__ */ new Set();
    while (next) {
      if (seen.has(next) || !mapping[next]) return false;
      seen.add(next);
      next = mapping[next].parent ?? "";
    }
    return true;
  }
  function getPaginatedConversationApiUrl(conversationId, before = "", numTurns = PAGE_NUM_TURNS) {
    const id = encodeURIComponent(conversationId);
    const path = before ? `/backend-api/conversations/${id}/messages` : `/backend-api/conversations/${id}`;
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    params.set("include_has_versions", "true");
    params.set("num_turns", String(numTurns));
    return `${path}?${params}`;
  }
  function getPaginatedConversationCursor(data) {
    const page = data.page_info ?? data.pageInfo;
    if (!page || typeof (page.has_previous_page ?? page.hasPreviousPage) !== "boolean") throw new Error("Missing pagination completeness metadata");
    const previous = page.has_previous_page === true || page.hasPreviousPage === true;
    const cursor = page.start_cursor ?? page.startCursor ?? "";
    if (previous && !cursor) throw new Error("Pagination requested an older page without a cursor");
    return previous ? cursor : "";
  }
  function mergePaginatedConversationMessages(older, newer) {
    const seen = /* @__PURE__ */ new Set();
    return [...older, ...newer].filter((message) => {
      if (!message?.id) throw new Error("Conversation message has no stable ID");
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    });
  }
  function buildConversationMappingFromMessages(messages, id, current) {
    const rootId = `paginated-root:${id}`;
    const mapping = { [rootId]: { id: rootId, parent: "", children: [] } };
    let parent = rootId;
    for (const message of messages) {
      mapping[parent].children = [message.id];
      mapping[message.id] = { id: message.id, parent, children: [], message };
      parent = message.id;
    }
    if (current && !mapping[current]) throw new Error("Active branch tip missing after pagination");
    return { id, mapping, current_node: current || parent };
  }
  function isTransientTransportError(error) {
    if (isAbortError(error)) return true;
    if (!(error instanceof Error)) return false;
    return /timed out/i.test(error.message) || /API failed: 429\b/.test(error.message) || /API failed: 5\d{2}\b/.test(error.message) || /Failed to fetch|NetworkError|network/i.test(error.message);
  }
  function shouldFallbackToLegacyConversation(error) {
    if (isAbortError(error) || isTransientTransportError(error)) return false;
    if (error instanceof Error && (/API failed: \d+/.test(error.message) || /invalid JSON/i.test(error.message))) return false;
    return true;
  }
  async function wait(ms, signal) {
    if (ms <= 0) return;
    if (signal?.aborted) throw abortError();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  async function readJsonBody(response, controller, external) {
    return await new Promise((resolve, reject) => {
      const fail = () => {
        if (external?.aborted) reject(abortError());
        else reject(new Error("ChatGPT conversation API timed out"));
      };
      if (controller.signal.aborted) {
        fail();
        return;
      }
      const onAbort = () => fail();
      controller.signal.addEventListener("abort", onAbort, { once: true });
      response.json().then((data) => {
        controller.signal.removeEventListener("abort", onAbort);
        if (controller.signal.aborted) {
          fail();
          return;
        }
        resolve(data);
      }, (error) => {
        controller.signal.removeEventListener("abort", onAbort);
        if (external?.aborted) reject(abortError());
        else if (controller.signal.aborted || isAbortError(error)) reject(new Error("ChatGPT conversation API timed out"));
        else reject(new Error("Conversation API returned invalid JSON"));
      });
    });
  }
  function createConversationRequest(headers, signal, requestTimeoutMs, rateLimitWaitMs) {
    const once = async () => {
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      const onTimeout = () => {
        timedOut = true;
        controller.abort();
      };
      signal?.addEventListener("abort", abort);
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(onTimeout, requestTimeoutMs);
      try {
        if (signal?.aborted) throw abortError();
        const response = await fetch(urlFrom(controller), { credentials: "include", cache: "no-store", headers, signal: controller.signal });
        if (signal?.aborted) throw abortError();
        if (timedOut || controller.signal.aborted) throw new Error("ChatGPT conversation API timed out");
        if (response.status === 429) return { status: 429, data: null };
        if (!response.ok) throw new Error(`ChatGPT conversation API failed: ${response.status}`);
        const data = await readJsonBody(response, controller, signal);
        if (!data || typeof data !== "object") throw new Error("Conversation API returned an empty response");
        return { status: response.status, data };
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut || controller.signal.aborted || isAbortError(error) && !signal?.aborted) {
          throw new Error("ChatGPT conversation API timed out");
        }
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    };
    const urlHolder = { current: "" };
    function urlFrom(_controller) {
      return urlHolder.current;
    }
    return async (url) => {
      urlHolder.current = url;
      let payload = await once();
      if (payload.status === 429) {
        await wait(rateLimitWaitMs, signal);
        payload = await once();
      }
      if (payload.status === 429 || !payload.data) throw new Error(`ChatGPT conversation API failed: ${payload.status}`);
      return payload.data;
    };
  }
  async function fetchRecentConversation(id, headers, signal, options = {}) {
    const request = createConversationRequest(
      headers,
      signal,
      options.requestTimeoutMs ?? 3e4,
      options.rateLimitWaitMs ?? 1e3
    );
    const first = unwrap(await request(getPaginatedConversationApiUrl(id, "", RECENT_TURN_BATCH)));
    if (Array.isArray(first.messages)) {
      const messages = mergePaginatedConversationMessages([], first.messages);
      if (!messages.length) throw new Error("Recent conversation page is empty");
      const current = first.current_node ?? first.current_node_id ?? "";
      const rebuilt = buildConversationMappingFromMessages(messages, id, current);
      return { ...first, ...rebuilt, messages };
    }
    if (isCompleteConversationMapping(first)) {
      const data = unwrap(first);
      return { ...data, id: data.id ?? data.conversation_id ?? id, current_node: data.current_node ?? data.current_node_id };
    }
    throw new Error("Recent conversation API returned no messages");
  }
  async function fetchCompleteConversation(id, headers, signal, options = {}) {
    const requestTimeoutMs = options.requestTimeoutMs ?? 3e4;
    const rateLimitWaitMs = options.rateLimitWaitMs ?? 1e3;
    const request = createConversationRequest(headers, signal, requestTimeoutMs, rateLimitWaitMs);
    const complete = (raw) => {
      const data = unwrap(raw);
      if (!isCompleteConversationMapping(raw)) throw new Error("Incomplete active conversation path");
      return { ...data, id: data.id ?? data.conversation_id ?? id, current_node: data.current_node ?? data.current_node_id };
    };
    const base = `/backend-api/conversation/${encodeURIComponent(id)}`;
    let lastError;
    try {
      const first = unwrap(await request(getPaginatedConversationApiUrl(id)));
      if (Array.isArray(first.messages)) {
        let messages = mergePaginatedConversationMessages([], first.messages);
        let cursor = getPaginatedConversationCursor(first);
        const seen = /* @__PURE__ */ new Set();
        let count = 1;
        while (cursor) {
          if (signal?.aborted) throw abortError();
          if (seen.has(cursor) || count >= MAX_PAGES) throw new Error("Conversation pagination stalled");
          seen.add(cursor);
          const page = unwrap(await request(getPaginatedConversationApiUrl(id, cursor)));
          if (!Array.isArray(page.messages)) throw new Error("Conversation message page returned no messages");
          messages = mergePaginatedConversationMessages(page.messages, messages);
          cursor = getPaginatedConversationCursor(page);
          count++;
        }
        if (!messages.length) throw new Error("Paginated conversation is empty");
        const current = first.current_node ?? first.current_node_id ?? "";
        const rebuilt = buildConversationMappingFromMessages(messages, id, current);
        return { ...first, ...rebuilt, messages };
      }
      if (isCompleteConversationMapping(first)) return complete(first);
      throw new Error("Paginated conversation API returned no messages");
    } catch (error) {
      lastError = error;
      if (!shouldFallbackToLegacyConversation(error)) throw error;
    }
    try {
      return complete(await request(`${base}?include_full_conversation=true`));
    } catch (error) {
      lastError = error;
      if (!shouldFallbackToLegacyConversation(error)) throw error;
    }
    for (const url of [base, `${base}?offset=0&limit=100000`]) {
      try {
        return complete(await request(url));
      } catch (error) {
        lastError = error;
        if (!shouldFallbackToLegacyConversation(error)) throw error;
      }
    }
    throw lastError;
  }

  // src/platform/chatgptAdapter.ts
  function isChatGptPage(url = window.location.href) {
    try {
      return new URL(url).hostname === "chatgpt.com";
    } catch {
      return false;
    }
  }
  function getConversationIdFromUrl(url = window.location.href) {
    try {
      const parsed = new URL(url);
      return parsed.pathname.match(/^\/c\/([a-z0-9-]+)/i)?.[1] ?? parsed.pathname.match(/^\/g\/[a-z0-9-]+\/c\/([a-z0-9-]+)/i)?.[1] ?? document.querySelector("[data-conversation-id]")?.dataset.conversationId ?? null;
    } catch {
      return url.match(/\/c\/([a-z0-9-]+)/i)?.[1] ?? document.querySelector("[data-conversation-id]")?.dataset.conversationId ?? null;
    }
  }
  function isChatGptConversationPage(url = window.location.href) {
    return isChatGptPage(url) && getConversationIdFromUrl(url) !== null;
  }

  // src/conversation/fetchConversation.ts
  var sessionTokenPromise = null;
  async function fetchCurrentConversation(conversationId = getConversationIdFromUrl(), signal) {
    if (!conversationId) return null;
    return fetchConversation(conversationId, signal);
  }
  function abortError2() {
    return new DOMException("Aborted", "AbortError");
  }
  var ChatGPTApiTimeoutError = class extends Error {
    constructor() {
      super("ChatGPT API timed out");
      this.name = "ChatGPTApiTimeoutError";
    }
  };
  async function chatgptApiJson(path, init = {}, options = {}) {
    const headers = new Headers(init.headers);
    headers.set("Accept", headers.get("Accept") ?? "application/json");
    const accessToken = await getAccessToken();
    if (accessToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${accessToken}`);
      headers.set("X-Authorization", `Bearer ${accessToken}`);
    }
    const accountId = getChatGptAccountId();
    if (accountId && !headers.has("Chatgpt-Account-Id")) {
      headers.set("Chatgpt-Account-Id", accountId);
    }
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort);
    if (init.signal?.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? 15e3);
    try {
      if (init.signal?.aborted) throw abortError2();
      const response = await fetch(path, { credentials: "include", cache: "no-store", ...init, headers, signal: controller.signal });
      if (init.signal?.aborted) throw abortError2();
      if (timedOut || controller.signal.aborted) throw new ChatGPTApiTimeoutError();
      if (!response.ok) throw new Error(`API failed: ${response.status}`);
      return await new Promise((resolve, reject) => {
        const fail = () => {
          if (init.signal?.aborted) reject(abortError2());
          else reject(new ChatGPTApiTimeoutError());
        };
        if (controller.signal.aborted) {
          fail();
          return;
        }
        const onAbort = () => fail();
        controller.signal.addEventListener("abort", onAbort, { once: true });
        response.json().then((data) => {
          controller.signal.removeEventListener("abort", onAbort);
          if (controller.signal.aborted) fail();
          else resolve(data);
        }, (error) => {
          controller.signal.removeEventListener("abort", onAbort);
          if (init.signal?.aborted) reject(abortError2());
          else if (timedOut || controller.signal.aborted || isAbortError2(error)) reject(new ChatGPTApiTimeoutError());
          else reject(error);
        });
      });
    } catch (error) {
      if (init.signal?.aborted) throw abortError2();
      if (timedOut || error instanceof ChatGPTApiTimeoutError || controller.signal.aborted) throw new ChatGPTApiTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  function isAbortError2(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }
  async function chatgptApi(path, init = {}, options = {}) {
    const headers = new Headers(init.headers);
    headers.set("Accept", headers.get("Accept") ?? "application/json");
    const accessToken = await getAccessToken();
    if (accessToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${accessToken}`);
      headers.set("X-Authorization", `Bearer ${accessToken}`);
    }
    const accountId = getChatGptAccountId();
    if (accountId && !headers.has("Chatgpt-Account-Id")) {
      headers.set("Chatgpt-Account-Id", accountId);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, options.timeoutMs ?? 15e3);
    try {
      if (controller.signal.aborted && init.signal?.aborted) throw abortError2();
      return await fetch(path, { credentials: "include", cache: "no-store", ...init, headers, signal: controller.signal });
    } catch (error) {
      if (init.signal?.aborted) throw abortError2();
      if (controller.signal.aborted) throw new ChatGPTApiTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  async function authorizedHeaders() {
    const headers = { Accept: "application/json" };
    const accessToken = await getAccessToken();
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
      headers["X-Authorization"] = `Bearer ${accessToken}`;
    }
    const accountId = getChatGptAccountId();
    if (accountId) {
      headers["Chatgpt-Account-Id"] = accountId;
    }
    return headers;
  }
  async function fetchConversation(conversationId, signal) {
    return fetchCompleteConversation(conversationId, await authorizedHeaders(), signal);
  }
  async function fetchRecentConversationPage(conversationId, signal) {
    return fetchRecentConversation(conversationId, await authorizedHeaders(), signal);
  }
  async function getAccessToken() {
    sessionTokenPromise ??= fetchSessionToken().then((token) => {
      if (!token) sessionTokenPromise = null;
      return token;
    }, (error) => {
      sessionTokenPromise = null;
      throw error;
    });
    return sessionTokenPromise;
  }
  async function fetchSessionToken() {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) return null;
      const session = await response.json();
      return typeof session.accessToken === "string" ? session.accessToken : null;
    } catch {
      return null;
    }
  }
  function getChatGptAccountId() {
    try {
      const raw = window.localStorage.getItem("_account");
      if (!raw) return null;
      if (/^account-[a-z0-9_-]+$/i.test(raw)) return raw;
      const parsed = JSON.parse(raw);
      return findAccountId(parsed);
    } catch {
      return null;
    }
  }
  function findAccountId(value) {
    if (!value || typeof value !== "object") return null;
    const record2 = value;
    for (const key of ["accountId", "account_id", "currentAccountId", "current_account_id", "id"]) {
      const candidate = record2[key];
      if (typeof candidate === "string" && /^account-[a-z0-9_-]+$/i.test(candidate)) {
        return candidate;
      }
    }
    for (const candidate of Object.values(record2)) {
      const nested = findAccountId(candidate);
      if (nested) return nested;
    }
    return null;
  }

  // src/conversation/composerGuard.ts
  var DIRECT_COMPOSER_SELECTOR = [
    "textarea",
    "input",
    "form",
    "#prompt-textarea",
    '[id*="prompt-textarea" i]',
    '[data-testid*="composer" i]',
    '[data-testid*="prompt-textarea" i]',
    '[data-testid*="send-button" i]',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[class*="composer" i]',
    '[class*="prompt-textarea" i]'
  ].join(", ");
  var COMPOSER_HINT_SELECTOR = [
    "textarea",
    "input",
    "form",
    "#prompt-textarea",
    '[id*="prompt-textarea" i]',
    '[data-testid*="composer" i]',
    '[data-testid*="prompt-textarea" i]',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[class*="composer" i]',
    '[class*="prompt-textarea" i]',
    ".ProseMirror"
  ].join(", ");
  var DRAFT_CONTROL_SELECTOR = [
    "textarea",
    "input",
    "#prompt-textarea",
    '[id*="prompt-textarea" i]',
    '[data-testid*="prompt-textarea" i]',
    '[role="textbox"]',
    '[contenteditable="true"]',
    ".ProseMirror"
  ].join(", ");

  // src/conversation/attachmentSummary.ts
  var FILE_EXTENSION_LABELS = [
    [/\.pdf$/i, "PDF 文件"],
    [/\.(?:md|markdown)$/i, "Markdown 文件"],
    [/\.csv$/i, "CSV 文件"],
    [/\.txt$/i, "文本文件"],
    [/\.json$/i, "JSON 文件"],
    [/\.(?:xlsx|xls)$/i, "Excel 文件"],
    [/\.(?:docx|doc)$/i, "Word 文件"],
    [/\.(?:zip|rar|7z)$/i, "压缩文件"]
  ];
  var IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i;
  function summarizeAttachments(attachments) {
    return attachments.map(formatAttachment).filter(Boolean).join(" ");
  }
  function combineTextAndAttachments(text, attachments) {
    const cleanText = normalizeBlockText(text);
    const summary = summarizeAttachments(attachments);
    if (cleanText && summary) return `${summary}
${cleanText}`;
    if (cleanText) return cleanText;
    if (summary) return summary;
    return "";
  }
  function noTextPlaceholder() {
    return "[无文字消息]";
  }
  function extractApiAttachments(message) {
    const attachments = [];
    const content = readRecord(message.content);
    const metadata = readRecord(message.metadata);
    if (Array.isArray(content?.parts)) {
      for (const part of content.parts) {
        collectAttachmentFromPart(part, attachments);
      }
    }
    const contentHasImage = attachments.some((attachment) => attachment.kind === "image");
    for (const key of ["attachments", "files", "uploaded_files"]) {
      const value = metadata?.[key] ?? message[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          const collected = [];
          collectAttachmentFromPart(item, collected);
          attachments.push(...collected.filter((attachment) => !(contentHasImage && attachment.kind === "image")));
        }
      }
    }
    const aggregateResult = readRecord(metadata?.aggregate_result);
    if (Array.isArray(aggregateResult?.messages)) {
      for (const item of aggregateResult.messages) {
        const record2 = readRecord(item);
        if (record2 && readString(record2, "message_type") === "image") {
          const url = readString(record2, "image_url") ?? readString(record2, "url") ?? void 0;
          attachments.push({ kind: "image", label: "图片", key: makeKey("image", url ?? "aggregate") });
        }
      }
    }
    return dedupeAttachments(attachments);
  }
  function getFileLabel(filename, mimeType) {
    if (mimeType?.includes("pdf")) return "PDF 文件";
    if (mimeType?.includes("markdown")) return "Markdown 文件";
    if (mimeType?.includes("json")) return "JSON 文件";
    if (mimeType?.includes("csv")) return "CSV 文件";
    if (mimeType?.includes("text")) return "文本文件";
    if (mimeType?.includes("spreadsheet") || mimeType?.includes("excel")) return "Excel 文件";
    if (mimeType?.includes("word")) return "Word 文件";
    if (filename) {
      const match = FILE_EXTENSION_LABELS.find(([pattern]) => pattern.test(filename));
      if (match) return match[1];
    }
    return "文件";
  }
  function formatAttachment(attachment) {
    if (attachment.kind === "image") return "[图片]";
    if (attachment.kind === "pasted") return "[粘贴内容]";
    if (attachment.kind === "file") {
      return attachment.filename ? `[${attachment.label}] ${attachment.filename}` : `[${attachment.label}]`;
    }
    return "";
  }
  function collectAttachmentFromPart(part, attachments) {
    const record2 = readRecord(part);
    if (!record2) return;
    const contentType = (readString(record2, "content_type") ?? readString(record2, "type") ?? "").toLowerCase();
    const filename = readString(record2, "file_name") ?? readString(record2, "filename") ?? readString(record2, "name") ?? readString(record2, "title") ?? void 0;
    const mimeType = readString(record2, "mime_type") ?? readString(record2, "mimetype") ?? readString(record2, "mime") ?? void 0;
    const assetPointer = readString(record2, "asset_pointer") ?? readString(record2, "image_asset_pointer") ?? readString(record2, "url") ?? readString(record2, "href") ?? void 0;
    const key = makeKey("api", assetPointer ?? filename ?? mimeType ?? contentType);
    if (isImageContent(contentType, filename, mimeType, assetPointer)) {
      attachments.push({ kind: "image", label: "图片", key });
      return;
    }
    if (contentType.includes("paste") || contentType.includes("pasted") || record2.pasted === true) {
      attachments.push({ kind: "pasted", label: "粘贴内容", key: key ?? "pasted" });
      return;
    }
    if (filename || contentType.includes("file") || mimeType) {
      attachments.push({ kind: "file", label: getFileLabel(filename, mimeType), filename, mimeType, key });
      return;
    }
  }
  function dedupeAttachments(attachments) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    let anonymousImageIndex = 0;
    for (const attachment of attachments) {
      const key = getDedupeKey(attachment, anonymousImageIndex);
      if (attachment.kind === "image" && !attachment.key) anonymousImageIndex += 1;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: attachment.kind,
        label: attachment.label,
        filename: attachment.filename,
        mimeType: attachment.mimeType
      });
    }
    return result;
  }
  function normalizeBlockText(value) {
    return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function readRecord(value) {
    return value && typeof value === "object" ? value : null;
  }
  function readString(record2, key) {
    const value = record2[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  function isImageContent(contentType, filename, mimeType, assetPointer) {
    return contentType.includes("image") || mimeType?.toLowerCase().startsWith("image/") === true || isImageFilename(filename) || assetPointer?.startsWith("sediment://") === true || assetPointer?.startsWith("data:image/") === true;
  }
  function isImageFilename(filename) {
    return Boolean(filename && IMAGE_EXTENSION_PATTERN.test(filename));
  }
  function getDedupeKey(attachment, anonymousImageIndex) {
    if (attachment.key) return `${attachment.kind}:${attachment.key}`;
    if (attachment.kind === "image") return `image:${attachment.filename ?? `anonymous-${anonymousImageIndex}`}`;
    if (attachment.kind === "pasted") return "pasted";
    return `file:${attachment.filename ?? ""}:${attachment.mimeType ?? ""}:${attachment.label}`;
  }
  function makeKey(prefix, value) {
    const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
    return normalized ? `${prefix}:${normalized}` : void 0;
  }

  // src/conversation/normalizeConversation.ts
  function normalizeConversation(conversation) {
    const nodes = getCurrentBranchNodes(conversation);
    const turns = [];
    let pendingUser = null;
    for (const node of nodes) {
      const message = node.message;
      if (!message || shouldSkipMessage(message)) continue;
      const role = readRole(message);
      if (role !== "user" && role !== "assistant") continue;
      const payload = extractMessagePayload(message);
      if (!payload.markdown) continue;
      if (role === "user") {
        if (pendingUser) {
          turns.push(makeTurn(turns.length, pendingUser, null));
        }
        pendingUser = payload;
        continue;
      }
      if (!pendingUser) continue;
      turns.push(makeTurn(turns.length, pendingUser, payload));
      pendingUser = null;
    }
    if (pendingUser) {
      turns.push(makeTurn(turns.length, pendingUser, null));
    }
    return turns;
  }
  function getCurrentBranchNodes(conversation) {
    const mapping = conversation.mapping ?? {};
    const startNodeId = conversation.current_node ?? Object.values(mapping).find((node) => !node.children || node.children.length === 0)?.id;
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    let currentNodeId = startNodeId;
    while (currentNodeId && !seen.has(currentNodeId)) {
      seen.add(currentNodeId);
      const node = mapping[currentNodeId];
      if (!node) break;
      if (node.parent === void 0 && !node.message) break;
      result.unshift(node);
      currentNodeId = node.parent;
    }
    return result;
  }
  function makeTurn(index2, user, assistant) {
    return {
      id: user.messageId ?? assistant?.messageId ?? `api-turn-${index2 + 1}`,
      index: index2,
      globalIndex: index2,
      displayNumber: index2 + 1,
      renderedLocalIndex: null,
      userMessageId: user.messageId,
      assistantMessageId: assistant?.messageId,
      userCreatedAt: user.createdAt,
      assistantCreatedAt: assistant?.createdAt,
      userMarkdown: user.markdown,
      assistantMarkdown: assistant?.markdown ?? "",
      userPreview: user.preview,
      assistantPreview: assistant?.preview ?? "",
      attachments: [...user.attachments, ...assistant?.attachments ?? []]
    };
  }
  function shouldSkipMessage(message) {
    if (!message.content) return true;
    const role = readRole(message);
    if (role === "system" || role === "tool") return true;
    const recipient = message.recipient;
    if (recipient && recipient !== "all") return true;
    const channel = message.channel;
    if (channel && channel !== "final") return true;
    const metadata = message.metadata ?? {};
    if (metadata.is_visually_hidden_from_conversation === true || metadata.is_hidden === true || metadata.hidden === true) {
      return true;
    }
    const contentType = readString2(message.content, "content_type");
    return contentType === "thoughts" || contentType === "reasoning_recap" || contentType === "model_editable_context" || contentType === "user_editable_context";
  }
  function extractMessagePayload(message) {
    const attachments = extractApiAttachments(message);
    const markdown = combineTextAndAttachments(extractApiMarkdown(message), attachments) || noTextPlaceholder();
    return {
      messageId: message.id,
      createdAt: message.create_time,
      markdown,
      preview: makePreview(markdown),
      attachments
    };
  }
  function extractApiMarkdown(message) {
    const content = message.content;
    if (!content) return "";
    const contentType = readString2(content, "content_type");
    if (contentType === "text") {
      return normalizeMarkdown(joinStringParts(content.parts));
    }
    if (contentType === "multimodal_text") {
      return normalizeMarkdown(extractMultimodalText(content.parts));
    }
    if (contentType === "code") {
      const language = readString2(content, "language") ?? "";
      const text = readString2(content, "text") ?? "";
      return text ? `\`\`\`${language}
${text}
\`\`\`` : "";
    }
    if (contentType === "execution_output") {
      const text = readString2(content, "text") ?? "";
      return text ? `Result:
\`\`\`
${text}
\`\`\`` : "";
    }
    if (contentType === "tether_quote") {
      const title = readString2(content, "title") ?? "";
      const text = readString2(content, "text") ?? "";
      return normalizeMarkdown(`> ${title || text}`);
    }
    if (contentType === "tether_browsing_display") {
      const result = readString2(content, "result") ?? readString2(content, "summary") ?? "";
      return normalizeMarkdown(result);
    }
    return "";
  }
  function extractMultimodalText(parts) {
    if (!Array.isArray(parts)) return "";
    return parts.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record2 = part;
      const contentType = readString2(record2, "content_type") ?? readString2(record2, "type") ?? "";
      if (contentType.includes("image") || contentType.includes("file")) return "";
      return readString2(record2, "text") ?? readString2(record2, "content") ?? readString2(record2, "markdown") ?? "";
    }).filter(Boolean).join("\n\n");
  }
  function joinStringParts(parts) {
    if (!Array.isArray(parts)) return "";
    return parts.map((part) => typeof part === "string" ? part : "").filter(Boolean).join("\n\n");
  }
  function readRole(message) {
    return message.author?.role;
  }
  function readString2(record2, key) {
    const value = record2[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  function normalizeMarkdown(value) {
    return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function makePreview(markdown) {
    const plain = markdown.replace(/```[\s\S]*?```/g, "[代码块]").replace(/[#*_>`~-]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return plain.length > 180 ? `${plain.slice(0, 179)}…` : plain;
  }

  // src/quota/vibebar/json.ts
  var VALID_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("ChatGPT Chat response exceeds the read bound or is not an object.");
    }
    return value;
  }
  function parseDate(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.round(value < 1e12 ? value * 1e3 : value);
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function validModel(value) {
    return VALID_MODEL.test(value);
  }

  // src/quota/vibebar/modelLimits.ts
  function modelLimits(data, now) {
    if (!data || typeof data !== "object") return [];
    const rows = data.model_limits;
    if (!Array.isArray(rows)) return [];
    const limits = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record2 = row;
      const model = typeof record2.model_slug === "string" ? record2.model_slug : null;
      if (!model || !validModel(model)) continue;
      const reset = parseDate(record2.resets_after);
      if (reset != null && reset <= now) continue;
      const fallbackRaw = typeof record2.using_default_model_slug === "string" ? record2.using_default_model_slug : null;
      const fallbackModel = fallbackRaw && validModel(fallbackRaw) ? fallbackRaw : null;
      limits.push({ model, resetsAt: reset, fallbackModel });
    }
    return limits;
  }

  // src/quota/vibebar/conversationParser.ts
  var HEX = "0123456789abcdef";
  async function identity(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    const bytes = new Uint8Array(digest);
    let out = "chat-";
    for (const byte of bytes) {
      out += HEX[byte >> 4];
      out += HEX[byte & 15];
    }
    return out;
  }
  function isWork(origin, model) {
    const originKey = origin?.toLowerCase() ?? "";
    const modelKey = model?.toLowerCase() ?? "";
    return ["tpp", "flora", "codex"].includes(originKey) || modelKey.endsWith("-wm") || modelKey.includes("codex");
  }
  function isTemporary(value) {
    if (!value || typeof value !== "object") return false;
    const record2 = value;
    return record2.is_temporary_chat === true || record2.isTemporary === true;
  }
  function conversationOrigin(value) {
    if (!value || typeof value !== "object") return null;
    const origin = value.conversation_origin;
    return typeof origin === "string" && origin.trim() ? origin.trim() : null;
  }
  async function parseConversation(data, id, updatedAt, since) {
    const root = asObject(data);
    const conversationId = typeof root.conversation_id === "string" ? root.conversation_id : typeof root.id === "string" ? root.id : null;
    const mapping = root.mapping;
    if (conversationId !== id || !mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new Error("ChatGPT Chat conversation identity or mapping is missing.");
    }
    const origin = conversationOrigin(root);
    const defaultModel = typeof root.default_model_slug === "string" ? root.default_model_slug : null;
    if (isWork(origin, defaultModel)) {
      return { updatedAt, turns: [], isWork: true, unclassifiedTurns: 0 };
    }
    const knownOrigin = origin == null || origin === "chat" || origin === "chatgpt";
    const nodes = mapping;
    const users = {};
    for (const [key, node] of Object.entries(nodes)) {
      const message = messageOf(node);
      if (roleOf(message) !== "user") continue;
      const created = parseDate(message.create_time);
      if (created != null && created < since) continue;
      users[key] = message;
    }
    const replies = {};
    const owners = new Map(Object.keys(users).map((key) => [key, key]));
    const orphans = /* @__PURE__ */ new Set();
    for (const [key, node] of Object.entries(nodes)) {
      const message = messageOf(node);
      if (!isFinalAssistant(message)) continue;
      let cursor = key;
      const path = [];
      const visited = /* @__PURE__ */ new Set();
      let owner;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const known = owners.get(cursor);
        if (known) {
          owner = known;
          break;
        }
        if (orphans.has(cursor)) break;
        const candidate = messageOf(nodes[cursor]);
        if (roleOf(candidate) === "user") break;
        path.push(cursor);
        cursor = typeof nodes[cursor]?.parent === "string" ? nodes[cursor].parent : null;
      }
      if (owner) {
        for (const nodeId of path) owners.set(nodeId, owner);
        (replies[owner] ??= []).push(message);
      } else {
        for (const nodeId of path) orphans.add(nodeId);
      }
    }
    const turns = /* @__PURE__ */ new Map();
    let unknown = 0;
    for (const [nodeID, user] of Object.entries(users)) {
      const messageID = typeof user.id === "string" ? user.id : "";
      const created = parseDate(user.create_time);
      const reply = newest(replies[nodeID] ?? []);
      const metadata = reply && typeof reply.metadata === "object" && reply.metadata ? reply.metadata : null;
      const model = typeof metadata?.model_slug === "string" ? metadata.model_slug : null;
      if (!knownOrigin || !messageID || created == null || !reply || !model || !validModel(model)) {
        unknown += 1;
        continue;
      }
      if (isWork(origin, model)) continue;
      const key = await identity(`${id}:${messageID}`);
      turns.set(key, { id: key, createdAt: created, model });
    }
    return { updatedAt, turns: [...turns.values()], isWork: false, unclassifiedTurns: unknown };
  }
  function messageOf(node) {
    if (!node || typeof node.message !== "object" || !node.message) return {};
    return node.message;
  }
  function roleOf(message) {
    const author = message.author;
    if (!author || typeof author !== "object") return null;
    const role = author.role;
    return typeof role === "string" ? role : null;
  }
  function isFinalAssistant(message) {
    if (roleOf(message) !== "assistant") return false;
    if (message.recipient !== "all") return false;
    if (message.status !== "finished_successfully") return false;
    if (!(message.channel == null || message.channel === "final")) return false;
    const content = message.content;
    const contentType = content && typeof content === "object" ? content.content_type : null;
    return contentType === "text" || contentType === "multimodal_text";
  }
  function newest(messages) {
    if (!messages.length) return null;
    return messages.reduce((best, current) => {
      const a = parseDate(best.create_time) ?? 0;
      const b = parseDate(current.create_time) ?? 0;
      return b > a ? current : best;
    });
  }

  // src/quota/vibebar/historyReader.ts
  var HISTORY_WINDOW_SECONDS = 7 * 86400;
  var HISTORY_PAGE_SIZE = 50;
  var HISTORY_MAX_PAGES = 4;
  var HISTORY_DETAIL_BUDGET = 24;
  var HISTORY_DEADLINE_MS = 25e3;
  var HISTORY_CACHE_KEY = "chatgpt-yada:quota-history:v2";
  var RetryableHistoryTransportError = class extends Error {
  };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function createChromeHistoryStore() {
    return {
      async load(identity2) {
        const data = await chrome.storage.local.get(HISTORY_CACHE_KEY);
        const all = data[HISTORY_CACHE_KEY] ?? {};
        return all[identity2] ?? { conversations: {} };
      },
      async save(cache, identity2) {
        const data = await chrome.storage.local.get(HISTORY_CACHE_KEY);
        const all = data[HISTORY_CACHE_KEY] ?? {};
        all[identity2] = cache;
        await chrome.storage.local.set({ [HISTORY_CACHE_KEY]: all });
      }
    };
  }
  async function readChatHistory(input) {
    const windowSeconds = input.windowSeconds ?? HISTORY_WINDOW_SECONDS;
    const pageSize = input.pageSize ?? HISTORY_PAGE_SIZE;
    const maxPages = input.maxPages ?? HISTORY_MAX_PAGES;
    const detailBudget = input.detailBudget ?? HISTORY_DETAIL_BUDGET;
    const deadlineMs = input.deadlineMs ?? HISTORY_DEADLINE_MS;
    const clock = input.clock ?? Date.now;
    const cutoff = input.now - windowSeconds * 1e3;
    const deadline = input.now + deadlineMs;
    let cache = await input.store.load(input.identity);
    const keepAfter = input.now - 2 * windowSeconds * 1e3;
    cache = {
      conversations: Object.fromEntries(
        Object.entries(cache.conversations).filter(([, value]) => value.updatedAt >= keepAfter)
      )
    };
    const seen = /* @__PURE__ */ new Set();
    let streamsFinished = 0;
    let failures = 0;
    let retryableFailures = 0;
    let permanentFailures = 0;
    let work = 0;
    let unknown = 0;
    let fetched = 0;
    let fetchedSuccessfully = 0;
    let read = 0;
    let cancelled = false;
    let hitDeadline = false;
    let hitDetailBudget = false;
    let stopSlice = false;
    const turns = [];
    const streams = input.includeArchived === false ? [false] : [false, true];
    const aborted = () => Boolean(input.signal?.aborted);
    const recordFailure = (error) => {
      failures += 1;
      if (error instanceof RetryableHistoryTransportError) retryableFailures += 1;
      else permanentFailures += 1;
    };
    try {
      streamLoop: for (const archived of streams) {
        let offset = 0;
        let reachedEnd = false;
        for (let page = 0; page < maxPages && !stopSlice; page++) {
          if (aborted()) throw abortError3();
          if (clock() >= deadline) {
            hitDeadline = true;
            stopSlice = true;
            break streamLoop;
          }
          const path = `/backend-api/conversations?offset=${offset}&limit=${pageSize}&order=updated&is_archived=${archived}`;
          const data = await input.transport.request(path, input.signal);
          const root = asObject(data);
          const items = Array.isArray(root.items) ? root.items : null;
          if (!items) throw new Error("ChatGPT Chat history list has no items.");
          const before = seen.size;
          for (const item of items) {
            const id = typeof item.id === "string" ? item.id : "";
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const updated = parseDate(item.update_time);
            if (updated != null && updated < cutoff) {
              reachedEnd = true;
              continue;
            }
            if (isWork(typeof item.conversation_origin === "string" ? item.conversation_origin : null, null)) {
              work += 1;
              continue;
            }
            if (item.is_temporary_chat === true) continue;
            if (!UUID.test(id) || updated == null) {
              failures += 1;
              permanentFailures += 1;
              continue;
            }
            const key = await identity(id);
            let parsed = cache.conversations[key];
            if (parsed?.updatedAt !== updated) {
              if (fetched >= detailBudget || clock() >= deadline) {
                if (fetched >= detailBudget) hitDetailBudget = true;
                if (clock() >= deadline) hitDeadline = true;
                stopSlice = true;
                break streamLoop;
              }
              fetched += 1;
              try {
                const detail = await (input.fetchDetail ? input.fetchDetail(id, input.signal) : input.transport.request(`/backend-api/conversation/${id}`, input.signal));
                parsed = await parseConversation(detail, id, updated, cutoff);
                cache.conversations[key] = parsed;
                fetchedSuccessfully += 1;
              } catch (error) {
                if (isAbortError3(error)) throw error;
                recordFailure(error);
              }
            }
            if (parsed) {
              read += 1;
              if (parsed.isWork) work += 1;
              unknown += parsed.unclassifiedTurns;
              turns.push(...parsed.turns);
            }
          }
          offset += items.length;
          if (!items.length || items.length < pageSize) reachedEnd = true;
          if (reachedEnd) break;
          if (seen.size === before) {
            failures += 1;
            permanentFailures += 1;
            break;
          }
        }
        if (stopSlice) break;
        if (reachedEnd) streamsFinished += 1;
      }
    } catch (error) {
      if (isAbortError3(error)) cancelled = true;
      else recordFailure(error);
    }
    if (!cancelled) await input.store.save(cache, input.identity);
    const recent = turns.filter((turn) => turn.createdAt >= cutoff && turn.createdAt <= input.now);
    const complete = streamsFinished === streams.length && failures === 0 && !cancelled && !hitDetailBudget && !hitDeadline;
    const needsContinuation = !complete && !cancelled && permanentFailures === 0 && retryableFailures === 0 && (hitDetailBudget || hitDeadline);
    return {
      turns: recent,
      summary: {
        queriedAt: input.now,
        observedFrom: cutoff,
        complete,
        conversationsRead: read,
        conversationsFetched: fetchedSuccessfully,
        excludedWorkConversations: work,
        unclassifiedTurns: unknown,
        failedConversations: failures,
        retryableFailures,
        permanentFailures,
        cancelled,
        hitDetailBudget,
        hitDeadline,
        needsContinuation
      }
    };
  }
  function abortError3() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError3(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }

  // src/conversation/readConversation.ts
  function abortError4() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError4(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }
  async function readConversation(conversationId, signal) {
    if (signal?.aborted) throw abortError4();
    if (!conversationId) throw new Error("No active ChatGPT conversation");
    const conversation = await fetchCurrentConversation(conversationId, signal);
    if (signal?.aborted) throw abortError4();
    if (!conversation) throw new Error("ChatGPT conversation was not returned");
    const now = Date.now();
    const parsed = await parseConversation(
      conversation,
      conversation.id ?? conversation.conversation_id ?? conversationId,
      now,
      now - HISTORY_WINDOW_SECONDS * 1e3
    );
    return {
      conversationId: conversation.id ?? conversation.conversation_id ?? conversationId,
      revision: 0,
      capturedAt: now,
      activeTurns: normalizeConversation(conversation),
      quotaTurns: parsed.turns,
      quotaIsWork: parsed.isWork,
      quotaUnclassifiedTurns: parsed.unclassifiedTurns,
      quotaOrigin: conversationOrigin(conversation),
      quotaTemporary: isTemporary(conversation),
      title: conversation.title,
      coverage: "full"
    };
  }
  async function readRecentConversation(conversationId, signal) {
    const snapshot = await readConversationWith(conversationId, signal, fetchRecentConversationPage);
    return { ...snapshot, coverage: "recent" };
  }
  async function readConversationWith(conversationId, signal, load) {
    if (signal?.aborted) throw abortError4();
    if (!conversationId) throw new Error("No active ChatGPT conversation");
    const conversation = await load(conversationId, signal);
    if (signal?.aborted) throw abortError4();
    const now = Date.now();
    const parsed = await parseConversation(
      conversation,
      conversation.id ?? conversation.conversation_id ?? conversationId,
      now,
      now - HISTORY_WINDOW_SECONDS * 1e3
    );
    return {
      conversationId: conversation.id ?? conversation.conversation_id ?? conversationId,
      revision: 0,
      capturedAt: now,
      activeTurns: normalizeConversation(conversation),
      quotaTurns: parsed.turns,
      quotaIsWork: parsed.isWork,
      quotaUnclassifiedTurns: parsed.unclassifiedTurns,
      quotaOrigin: conversationOrigin(conversation),
      quotaTemporary: isTemporary(conversation),
      title: conversation.title,
      coverage: "full"
    };
  }

  // src/conversation/mergeRecent.ts
  async function mergeRecentSnapshot(full, recent) {
    if (full.conversationId !== recent.conversationId) return null;
    if (!full.activeTurns.length || !recent.activeTurns.length) return null;
    if (recent.quotaUnclassifiedTurns > 0) return null;
    if (recent.quotaIsWork !== full.quotaIsWork || recent.quotaTemporary !== full.quotaTemporary) return null;
    if (full.quotaOrigin && recent.quotaOrigin && full.quotaOrigin !== recent.quotaOrigin) return null;
    const anchor = findAnchor(full.activeTurns, recent.activeTurns);
    if (!anchor) return null;
    const prefix = full.activeTurns.slice(0, anchor.fullIndex);
    const tail = recent.activeTurns.slice(anchor.recentIndex).map((turn, index2) => renumber(turn, prefix.length + index2));
    const replacedUserIds = full.activeTurns.slice(anchor.fullIndex).map((turn) => turn.userMessageId).filter((id) => Boolean(id));
    const replaced = new Set(await Promise.all(replacedUserIds.map((id) => identity(`${full.conversationId}:${id}`))));
    const kept = full.quotaTurns.filter((turn) => !replaced.has(turn.id));
    const quotaTurns = dedupeTurns([...kept, ...recent.quotaTurns]);
    return {
      ...full,
      revision: full.revision,
      capturedAt: recent.capturedAt,
      activeTurns: [...prefix, ...tail],
      quotaTurns,
      quotaUnclassifiedTurns: full.quotaUnclassifiedTurns,
      title: recent.title ?? full.title,
      coverage: "full"
    };
  }
  function renumber(turn, index2) {
    return { ...turn, index: index2, globalIndex: index2, displayNumber: index2 + 1 };
  }
  function findAnchor(full, recent) {
    for (let fullIndex = full.length - 1; fullIndex >= 0; fullIndex -= 1) {
      const userId = full[fullIndex]?.userMessageId;
      if (!userId) continue;
      const recentIndex = recent.findIndex((turn) => turn.userMessageId === userId);
      if (recentIndex < 0) continue;
      if (tailAgrees(full, recent, fullIndex, recentIndex)) return { fullIndex, recentIndex };
    }
    return null;
  }
  function tailAgrees(full, recent, fullIndex, recentIndex) {
    let offset = 0;
    while (fullIndex + offset < full.length && recentIndex + offset < recent.length) {
      const fullId = full[fullIndex + offset]?.userMessageId;
      const recentId = recent[recentIndex + offset]?.userMessageId;
      if (!fullId || !recentId) return false;
      if (fullId !== recentId) return replacementAgrees(full, recent, fullIndex + offset, recentIndex + offset);
      offset += 1;
    }
    if (recentIndex + offset >= recent.length && fullIndex + offset < full.length) return false;
    return extensionIsNew(full, recent.slice(recentIndex + offset));
  }
  function replacementAgrees(full, recent, fullIndex, recentIndex) {
    const earlier = new Set(full.slice(0, fullIndex).map((turn) => turn.userMessageId));
    const replaced = new Set(full.slice(fullIndex).map((turn) => turn.userMessageId));
    for (const turn of recent.slice(recentIndex)) {
      const id = turn.userMessageId;
      if (!id || earlier.has(id) || replaced.has(id)) return false;
    }
    return true;
  }
  function extensionIsNew(full, extra) {
    const known = new Set(full.map((turn) => turn.userMessageId));
    return extra.every((turn) => Boolean(turn.userMessageId) && !known.has(turn.userMessageId));
  }
  function dedupeTurns(turns) {
    const byId = /* @__PURE__ */ new Map();
    for (const turn of turns) byId.set(turn.id, turn);
    return [...byId.values()];
  }

  // src/core/conversationSync.ts
  var SIGNAL_INSPECTION_DEBOUNCE_MS = 250;
  var FALLBACK_IDLE_MS = 1e3;
  var ConversationSync = class {
    activeConversationId = null;
    generation = 0;
    runningPromise = null;
    desired = null;
    active = null;
    abortController = null;
    latestSnapshot = null;
    fullStale = false;
    lastError = null;
    listeners = /* @__PURE__ */ new Set();
    fullWaiters = [];
    observer = null;
    visibilityListening = false;
    signalTimer = 0;
    fallbackTimer = 0;
    fallbackIdle = 0;
    lastStreamingState = false;
    seenAssistantMessageIds = /* @__PURE__ */ new Set();
    disposed = false;
    published = 0;
    readFull;
    readRecent;
    constructor(options = {}) {
      this.readFull = options.readConversation ?? readConversation;
      this.readRecent = options.readRecentConversation === void 0 ? options.readConversation ? null : readRecentConversation : options.readRecentConversation;
    }
    subscribe(listener) {
      this.listeners.add(listener);
      this.deliver(listener, this.latestSnapshot);
      return () => this.listeners.delete(listener);
    }
    requestSync(reason) {
      return this.request(this.modeForReason(reason));
    }
    requestRecent(reason) {
      void reason;
      return this.request("recent");
    }
    requestFull(reason) {
      void reason;
      return this.request("full");
    }
    isReading() {
      return this.runningPromise != null || this.desired != null || this.active != null;
    }
    setActiveConversation(conversationId) {
      if (this.activeConversationId === conversationId) return;
      this.generation += 1;
      this.clearSignalTimer();
      this.clearFallback();
      this.abortController?.abort();
      this.abortController = null;
      this.activeConversationId = conversationId;
      this.seenAssistantMessageIds.clear();
      this.lastStreamingState = false;
      this.fullStale = false;
      this.latestSnapshot = null;
      this.lastError = null;
      this.desired = null;
      this.rejectFullWaiters(abortError4());
      if (!conversationId) {
        this.publish(null);
        return;
      }
      this.seedRenderedAssistants();
    }
    getSnapshot() {
      return this.latestSnapshot;
    }
    hasUsableFullSnapshot(conversationId = this.activeConversationId) {
      return Boolean(
        conversationId && this.latestSnapshot?.conversationId === conversationId && !this.fullStale && this.latestSnapshot.coverage !== "recent"
      );
    }
    getLastError() {
      return this.lastError;
    }
    getActiveConversationId() {
      return this.activeConversationId;
    }
    mountPageObserver(root = document.documentElement) {
      if (!this.visibilityListening) {
        document.addEventListener("visibilitychange", this.onVisibility);
        this.visibilityListening = true;
      }
      if (this.observer || typeof MutationObserver === "undefined") return;
      this.observer = new MutationObserver((records) => {
        for (const record2 of records) {
          if (record2.attributeName === "data-is-streaming" && record2.target instanceof Element && record2.target.getAttribute("data-is-streaming") === "true") {
            this.lastStreamingState = true;
          }
        }
        this.scheduleSignalInspection();
      });
      this.observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-is-streaming", "data-message-id", "data-message-author-role"]
      });
    }
    dispose() {
      this.disposed = true;
      this.generation += 1;
      this.clearSignalTimer();
      this.clearFallback();
      this.abortController?.abort();
      this.abortController = null;
      this.desired = null;
      this.observer?.disconnect();
      this.observer = null;
      if (this.visibilityListening) {
        document.removeEventListener("visibilitychange", this.onVisibility);
        this.visibilityListening = false;
      }
      this.rejectFullWaiters(abortError4());
      this.listeners.clear();
      this.latestSnapshot = null;
      this.runningPromise = null;
      this.seenAssistantMessageIds.clear();
    }
    modeForReason(reason) {
      if (reason === "streaming-end" || reason === "new-assistant") return this.liveMode();
      return "full";
    }
    liveMode() {
      return this.hasUsableFullSnapshot() ? "recent" : "full";
    }
    request(mode) {
      if (this.disposed) return Promise.reject(abortError4());
      const effective = mode === "recent" && !this.hasUsableFullSnapshot() ? "full" : mode;
      this.desired = this.desired === "full" || effective === "full" ? "full" : "recent";
      if (effective === "full") this.clearFallback();
      const waitForTrailingFull = effective === "full" && this.active === "recent";
      if (!this.runningPromise) {
        this.runningPromise = Promise.resolve().then(() => this.pump()).finally(() => {
          this.runningPromise = null;
          this.active = null;
          if (this.desired && !this.disposed) void this.request(this.desired);
        });
      }
      if (waitForTrailingFull) {
        return new Promise((resolve, reject) => {
          this.fullWaiters.push({ resolve, reject });
        });
      }
      return this.runningPromise;
    }
    async pump() {
      while (this.desired && !this.disposed) {
        const mode = this.desired;
        this.desired = null;
        this.active = mode;
        const conversationId = this.activeConversationId;
        const generation = this.generation;
        if (!conversationId) {
          this.publish(null);
          this.settleFullWaiters();
          continue;
        }
        this.abortController?.abort();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        try {
          const raw = mode === "recent" && this.readRecent ? await this.readRecent(conversationId, signal) : await this.readFull(conversationId, signal);
          if (this.disposed || signal.aborted || this.generation !== generation) throw abortError4();
          if (this.activeConversationId !== conversationId) throw abortError4();
          if (mode === "recent" && this.readRecent && this.latestSnapshot) {
            const merged = await mergeRecentSnapshot(this.latestSnapshot, { ...raw, coverage: "recent" });
            if (!merged) {
              this.fullStale = true;
              this.scheduleIdleFull();
              continue;
            }
            merged.revision = ++this.published;
            this.fullStale = false;
            this.lastError = null;
            this.publish(merged);
          } else {
            raw.revision = ++this.published;
            raw.coverage = "full";
            this.fullStale = false;
            this.lastError = null;
            this.publish(raw);
          }
          if (mode === "full") this.settleFullWaiters();
        } catch (error) {
          if (this.disposed) return;
          if (isAbortError4(error) || this.generation !== generation) continue;
          if (this.activeConversationId === conversationId) {
            this.lastError = error instanceof Error ? error : new Error(String(error));
            if (!this.latestSnapshot) this.publish(null);
            if (mode === "full") this.settleFullWaiters(this.lastError);
          }
        }
      }
    }
    publish(snapshot) {
      this.latestSnapshot = snapshot;
      if (snapshot) {
        for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
        for (const turn of snapshot.activeTurns) {
          if (turn.assistantMessageId) this.seenAssistantMessageIds.add(turn.assistantMessageId);
        }
      }
      for (const listener of [...this.listeners]) this.deliver(listener, snapshot);
    }
    deliver(listener, snapshot) {
      try {
        const result = listener(snapshot);
        if (result && typeof result.then === "function") {
          void Promise.resolve(result).catch(() => void 0);
        }
      } catch {
      }
    }
    settleFullWaiters(error) {
      const waiters = this.fullWaiters.splice(0);
      for (const waiter of waiters) {
        if (error) waiter.reject(error);
        else waiter.resolve();
      }
    }
    rejectFullWaiters(error) {
      this.settleFullWaiters(error);
    }
    scheduleSignalInspection() {
      if (this.disposed) return;
      const generation = this.generation;
      this.clearSignalTimer();
      this.signalTimer = window.setTimeout(() => {
        this.signalTimer = 0;
        if (this.disposed || this.generation !== generation) return;
        this.inspectPageSignals();
      }, SIGNAL_INSPECTION_DEBOUNCE_MS);
    }
    clearSignalTimer() {
      if (!this.signalTimer) return;
      window.clearTimeout(this.signalTimer);
      this.signalTimer = 0;
    }
    seedRenderedAssistants() {
      for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
    }
    inspectPageSignals() {
      if (this.disposed || !this.activeConversationId) return;
      const streaming = isAssistantStreaming2();
      const wasStreaming = this.lastStreamingState;
      this.lastStreamingState = streaming;
      if (streaming) return;
      if (wasStreaming) {
        for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
        void this.request(this.liveMode());
        return;
      }
      let unseen = false;
      for (const id of collectStableAssistantMessageIds()) {
        if (this.seenAssistantMessageIds.has(id)) continue;
        this.seenAssistantMessageIds.add(id);
        unseen = true;
      }
      if (unseen) void this.request(this.liveMode());
    }
    scheduleIdleFull() {
      if (this.fallbackTimer || this.fallbackIdle || this.disposed || !this.fullStale) return;
      const generation = this.generation;
      const run = () => {
        this.fallbackTimer = 0;
        this.fallbackIdle = 0;
        if (this.disposed || this.generation !== generation || !this.fullStale) return;
        if (document.visibilityState === "hidden" || isAssistantStreaming2()) {
          this.scheduleIdleFull();
          return;
        }
        void this.requestFull("fallback");
      };
      if (typeof requestIdleCallback === "function") {
        this.fallbackIdle = requestIdleCallback(() => run(), { timeout: FALLBACK_IDLE_MS });
        return;
      }
      this.fallbackTimer = window.setTimeout(run, FALLBACK_IDLE_MS);
    }
    clearFallback() {
      if (this.fallbackTimer) window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = 0;
      if (this.fallbackIdle && typeof cancelIdleCallback === "function") cancelIdleCallback(this.fallbackIdle);
      this.fallbackIdle = 0;
    }
    onVisibility = () => {
      if (document.visibilityState !== "visible" || !this.fullStale) return;
      this.scheduleIdleFull();
    };
  };
  function isAssistantStreaming2(root = document) {
    return Boolean(
      root.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming')
    );
  }
  function collectStableAssistantMessageIds(root = document) {
    const ids = [];
    for (const node of root.querySelectorAll('[data-message-author-role="assistant"][data-message-id]')) {
      if (node.getAttribute("data-is-streaming") === "true" || node.classList.contains("result-streaming")) continue;
      const id = node.dataset.messageId;
      if (id) ids.push(id);
    }
    return ids;
  }

  // src/nativeNavigator/dom.ts
  var MESSAGE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  var OFFICIAL_ROOT_SELECTOR = [
    'main [class$="_convSearchResultHighlightRoot"]',
    'main [class*="_convSearchResultHighlightRoot "]'
  ].join(",");
  var OFFICIAL_CONTAINER_TOKENS = ["fixed", "inset-e-4", "top-1/2", "z-20", "-translate-y-1/2"];
  var SENTINEL_SELECTOR = '[data-testid="conversation-pagination-sentinel"]';
  function conversationScroller() {
    const surface = document.querySelector("main, [role=main]") ?? document;
    const message = surface.querySelector(MESSAGE_SELECTOR);
    if (!message) return null;
    let ancestor = message.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (ancestor.clientHeight > 100 && ["auto", "scroll", "overlay"].some((value) => style.overflowY.includes(value))) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    return document.scrollingElement;
  }
  function viewportTop(scroller) {
    if (scroller === document.scrollingElement) return 0;
    const rectangle = scroller.getBoundingClientRect();
    return rectangle.top + scroller.clientTop;
  }
  function readNativePrompts(root = document) {
    const candidates = [...root.querySelectorAll(OFFICIAL_ROOT_SELECTOR)];
    if (candidates.length !== 1) return emptyNativePromptState();
    const container = [...candidates[0].children].find(
      (child) => child instanceof HTMLElement && OFFICIAL_CONTAINER_TOKENS.every((token) => child.classList.contains(token)) && !child.closest("[data-yada-root]")
    );
    if (!container || !layoutVisible(candidates[0], false) || !layoutVisible(container, true)) {
      return emptyNativePromptState();
    }
    const buttons = [...container.querySelectorAll("button")];
    const indexes = buttons.map(readPromptIndex);
    if (!indexes.length || indexes.some((index2) => index2 === null)) return emptyNativePromptState();
    const numeric = indexes;
    if (new Set(numeric).size !== numeric.length) return emptyNativePromptState();
    const first = Math.min(...numeric);
    const ordered = [...numeric].map((index2) => index2 - (first === 1 ? 1 : 0)).sort((left, right) => left - right);
    if (!ordered.every((index2, position) => index2 === position)) return emptyNativePromptState();
    return {
      found: buttons.length,
      visible: buttons.filter((button) => layoutVisible(button, true)).length,
      root: candidates[0],
      container
    };
  }
  function saveReadingPosition() {
    const scroller = conversationScroller();
    if (!scroller) return null;
    const top = viewportTop(scroller);
    const bottom = Math.min(innerHeight, top + scroller.clientHeight);
    const onScreen = [...document.querySelectorAll(MESSAGE_SELECTOR)].filter((message) => {
      const rectangle = message.getBoundingClientRect();
      return rectangle.bottom > top + 8 && rectangle.top < bottom - 8;
    });
    const anchor = onScreen.find((message) => message.getBoundingClientRect().top >= top) ?? onScreen[0];
    if (!anchor) return null;
    return {
      identity: stableMessageIdentity(anchor),
      element: anchor,
      offset: anchor.getBoundingClientRect().top - top,
      scroller
    };
  }
  function readingPositionDrift(position) {
    if (!position.scroller.isConnected || conversationScroller() !== position.scroller) return null;
    let anchor = position.element.isConnected ? position.element : null;
    if (position.identity) anchor = findStableMessage(position.identity);
    if (!anchor) return null;
    return anchor.getBoundingClientRect().top - viewportTop(position.scroller) - position.offset;
  }
  function stableLayoutAvailable() {
    const scroller = conversationScroller();
    if (!scroller || getComputedStyle(scroller).overflowAnchor === "none") return false;
    return !document.querySelector(
      '[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming, button[data-testid="stop-button"], [data-stream-active="true"]'
    );
  }
  function safeDesktopLayout() {
    return document.visibilityState === "visible" && innerWidth >= 1024 && matchMedia("(hover: hover)").matches && stableLayoutAvailable();
  }
  function exposePaginationSentinel(scroller) {
    const matches2 = [...scroller.querySelectorAll(SENTINEL_SELECTOR)];
    if (matches2.length !== 1) return null;
    const element = matches2[0];
    const rectangle = element.getBoundingClientRect();
    if (!element.isConnected || element.getClientRects().length === 0 || rectangle.height > 100) return null;
    const ownedStyles = /* @__PURE__ */ new Map([
      ["position", "sticky"],
      ["top", "80px"],
      ["opacity", "0"],
      ["pointer-events", "none"]
    ]);
    const previous = /* @__PURE__ */ new Map();
    for (const [property, value] of ownedStyles) {
      previous.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property)
      });
      element.style.setProperty(property, value, "important");
    }
    let active = true;
    return {
      element,
      release() {
        if (!active) return;
        active = false;
        for (const [property, value] of ownedStyles) {
          if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== "important") continue;
          const original = previous.get(property);
          if (original.value) element.style.setProperty(property, original.value, original.priority);
          else element.style.removeProperty(property);
        }
      }
    };
  }
  function readPromptIndex(button) {
    const explicit = button.dataset.tocItemIndex;
    if (explicit && /^\d+$/.test(explicit)) return Number(explicit);
    for (const name of ["aria-label", "aria-description"]) {
      const match = /^prompt\s+(\d+)(?:\b|:)/i.exec(button.getAttribute(name) ?? "");
      if (match) return Number(match[1]);
    }
    return null;
  }
  function emptyNativePromptState() {
    return { found: 0, visible: 0, root: null, container: null };
  }
  function layoutVisible(element, requireRectangle) {
    if (!element.isConnected || requireRectangle && element.getClientRects().length === 0) return false;
    let ancestor = element;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (ancestor.hidden || ancestor.getAttribute("aria-hidden") === "true" || style.visibility === "hidden" || style.display === "none" || style.opacity !== "" && Number(style.opacity) === 0) return false;
      ancestor = ancestor.parentElement;
    }
    if (!requireRectangle) return true;
    const rectangle = element.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.height > 0 && rectangle.right > 0 && rectangle.left < innerWidth && rectangle.bottom > 0 && rectangle.top < innerHeight;
  }
  function stableMessageIdentity(element) {
    let node = element;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      for (const attribute of ["data-message-id", "data-turn-id", "data-turn-id-container"]) {
        const value = node.getAttribute(attribute);
        if (value && value.length <= 256) return { attribute, value };
      }
      if (node.tagName === "ARTICLE") break;
    }
    return null;
  }
  function findStableMessage(identity2) {
    const matches2 = [...document.querySelectorAll(`[${identity2.attribute}="${CSS.escape(identity2.value)}"]`)];
    if (matches2.length !== 1) return null;
    return matches2[0].matches(MESSAGE_SELECTOR) ? matches2[0] : matches2[0].querySelector(MESSAGE_SELECTOR);
  }

  // src/nativeNavigator/hydrator.ts
  var ACTIVE_LIMIT_MS = 6e4;
  var ADDITIONAL_PAGE_LIMIT = 20;
  var PAGE_PROGRESS_LIMIT_MS = 12e3;
  var READY_STABILITY_MS = 300;
  var RECOVERY_IDLE_MS = 2500;
  var MAX_RECOVERIES = 3;
  var DEBUG_KEY = "chatgpt-yada:native-nav-debug";
  function officialNavigatorReadiness(native, expectedPrompts, stableChecks) {
    if (expectedPrompts <= 0) return "waiting";
    if (native.found !== expectedPrompts || native.visible <= 0) return "incomplete";
    return stableChecks >= 2 ? "ready" : "stabilizing";
  }
  var OfficialNavigatorHydrator = class {
    constructor(sync) {
      this.sync = sync;
    }
    state = emptyTransportState(conversationIdFromUrl(location.href));
    expectedPrompts = 0;
    connected = false;
    context = "";
    firstOlderRequest = 0;
    activeMs = 0;
    recoveries = 0;
    peakDrift = 0;
    phase = "waiting";
    sleepReason = null;
    readyStableChecks = 0;
    stableRoot = null;
    stableContainer = null;
    stableFound = 0;
    stableCheckedAt = 0;
    lastUserInput = performance.now() - RECOVERY_IDLE_MS;
    prepareEnabled = false;
    heartbeat = 0;
    operation = null;
    timer = 0;
    mutations = null;
    unsubscribe = null;
    disposed = false;
    heavyArmed = false;
    awaitingSnapshot = false;
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => {
        const nextExpected = snapshot?.conversationId === this.state.conversationId ? snapshot.activeTurns.length : 0;
        const changed = nextExpected !== this.expectedPrompts;
        this.expectedPrompts = nextExpected;
        if (this.phase === "stopped") {
          this.publishDiagnostics();
          return;
        }
        if (snapshot) this.awaitingSnapshot = false;
        if (this.phase === "sleeping" || this.phase === "ready" && changed) this.wake("snapshot");
        else if (this.phase !== "ready") this.maybeArmHeavyWork();
        if (this.heavyArmed && this.phase !== "ready") this.schedule();
        this.publishDiagnostics();
      });
      addEventListener("message", this.onMessage);
      document.addEventListener("visibilitychange", this.onVisibility);
      this.requestState();
    }
    resetRoute() {
      this.cancel("route");
      const current = conversationIdFromUrl(location.href);
      this.state = emptyTransportState(current, this.state.generation);
      this.connected = false;
      this.expectedPrompts = this.sync.getSnapshot()?.conversationId === current ? this.sync.getSnapshot().activeTurns.length : 0;
      this.resetContext("");
      this.awaitingSnapshot = true;
      this.parkHeavyWork();
      this.setPhase("waiting");
      this.requestState();
    }
    isMaintenanceBlocked() {
      return this.phase === "preparing" || this.heavyArmed;
    }
    isHeavyWorkArmed() {
      return this.heavyArmed && this.mutations != null;
    }
    isParked() {
      return !this.heavyArmed && (this.phase === "sleeping" || this.phase === "ready" || this.phase === "stopped");
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.cancel("dispose");
      clearTimeout(this.timer);
      this.timer = 0;
      this.parkHeavyWork();
      this.unsubscribe?.();
      this.unsubscribe = null;
      removeEventListener("message", this.onMessage);
      document.removeEventListener("visibilitychange", this.onVisibility);
      delete globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__;
    }
    onMessage = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = record(event.data);
      if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "state" || !isNativeTransportState(message.state)) return;
      const incoming = message.state;
      if (incoming.conversationId !== conversationIdFromUrl(location.href)) return;
      if (incoming.generation < this.state.generation) return;
      if (incoming.generation === this.state.generation && incoming.revision < this.state.revision) return;
      const incomingContext = `${incoming.conversationId ?? ""}:${incoming.generation}`;
      if (incomingContext !== this.context) {
        this.cancel("context");
        this.resetContext(incomingContext, incoming.olderRequests);
      }
      const hasNewEvidence = incoming.revision > this.state.revision;
      this.state = incoming;
      this.connected = true;
      this.maybeArmHeavyWork();
      if (this.phase === "sleeping" && hasNewEvidence) this.wake("transport");
      else if (this.heavyArmed && this.phase !== "ready" && this.phase !== "stopped") this.schedule();
      this.publishDiagnostics();
    };
    onUserInput = () => {
      this.lastUserInput = performance.now();
      if (this.operation) this.cancel("user");
      else this.schedule(RECOVERY_IDLE_MS);
    };
    onEnvironment = () => {
      if (this.operation) this.cancel("layout");
      else this.schedule(180);
    };
    onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (this.phase === "sleeping") this.wake("visible");
        return;
      }
      if (this.phase === "ready" || this.phase === "stopped") return;
      if (this.operation) this.cancel("hidden");
      else this.sleep("hidden");
    };
    schedule(delayMs = 180) {
      if (this.disposed || this.phase === "sleeping" || this.phase === "ready" || this.phase === "stopped") return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        void this.evaluate();
      }, Math.max(0, delayMs));
    }
    async evaluate() {
      if (this.disposed || this.operation || this.phase === "sleeping" || this.phase === "ready" || this.phase === "stopped") return;
      const native = readNativePrompts();
      if (this.awaitingSnapshot || !this.connected || !this.state.conversationId || this.expectedPrompts <= 0) {
        this.resetReadyStability();
        this.setPhase("waiting");
        return;
      }
      this.maybeArmHeavyWork();
      if (isMessageDeepLink()) {
        this.stop("deep-link");
        return;
      }
      if (this.checkReady(native)) return;
      if (this.limitReached()) {
        this.stop("limit");
        return;
      }
      if (document.visibilityState !== "visible") {
        this.sleep("hidden");
        return;
      }
      if (!safeDesktopLayout()) {
        this.setPhase("waiting");
        return;
      }
      const idleFor = performance.now() - this.lastUserInput;
      if (idleFor < RECOVERY_IDLE_MS) {
        this.setPhase("waiting");
        this.schedule(RECOVERY_IDLE_MS - idleFor);
        return;
      }
      await this.launchAttempt();
    }
    checkReady(native) {
      const readiness = officialNavigatorReadiness(native, this.expectedPrompts, this.readyStableChecks);
      if (readiness === "waiting" || readiness === "incomplete") {
        this.resetReadyStability();
        return false;
      }
      const now = performance.now();
      const same = this.stableRoot === native.root && this.stableContainer === native.container && this.stableFound === native.found && native.root?.isConnected === true && native.container?.isConnected === true;
      if (!same) {
        this.stableRoot = native.root;
        this.stableContainer = native.container;
        this.stableFound = native.found;
        this.readyStableChecks = 1;
        this.stableCheckedAt = now;
        this.setPhase("waiting");
        this.schedule(READY_STABILITY_MS);
        return true;
      }
      if (this.readyStableChecks < 2) {
        const remaining = READY_STABILITY_MS - (now - this.stableCheckedAt);
        if (remaining > 0) {
          this.setPhase("waiting");
          this.schedule(remaining);
          return true;
        }
        this.readyStableChecks = 2;
      }
      this.parkHeavyWork();
      this.setPhase("ready");
      return true;
    }
    async launchAttempt() {
      const controller = new AbortController();
      const attemptContext = this.context;
      const started = performance.now();
      this.operation = controller;
      this.setPhase("preparing");
      let outcome;
      try {
        this.startPrepare();
        await this.waitForBoostedAck(controller.signal);
        outcome = await this.hydrate(controller.signal, attemptContext);
      } catch {
        const reason = String(controller.signal.reason ?? "changed");
        outcome = reason === "user" || reason === "hidden" || reason === "layout" ? { kind: "interrupted", reason } : { kind: "changed" };
      } finally {
        this.stopPrepare();
        this.activeMs += Math.max(0, performance.now() - started);
        if (this.operation === controller) this.operation = null;
      }
      if (this.disposed || attemptContext !== this.context) return;
      if (outcome.kind === "match") {
        this.setPhase("waiting");
        this.schedule(0);
        return;
      }
      if (outcome.kind === "changed") return;
      if (outcome.kind === "stopped") {
        this.stop(outcome.reason);
        return;
      }
      if (outcome.kind === "interrupted" && outcome.reason === "user") {
        if (this.recoveries >= MAX_RECOVERIES || this.limitReached()) {
          this.stop("recovery-limit");
          return;
        }
        this.recoveries += 1;
        this.setPhase("waiting");
        this.schedule(RECOVERY_IDLE_MS);
        return;
      }
      this.sleep(outcome.reason);
    }
    async hydrate(signal, context) {
      const position = saveReadingPosition();
      if (!position || !stableLayoutAvailable()) return { kind: "sleep", reason: "layout-unavailable" };
      const activeDeadline = performance.now() + Math.max(0, ACTIVE_LIMIT_MS - this.activeMs);
      let exposure = null;
      const release = () => {
        exposure?.release();
        exposure = null;
      };
      const watch = watchReadingPosition(
        position,
        signal,
        (drift) => {
          this.peakDrift = Math.max(this.peakDrift, Math.abs(drift));
        },
        release
      );
      signal.addEventListener("abort", release, { once: true });
      const problem = () => {
        if (signal.aborted) throw signal.reason;
        if (context !== this.context || this.state.conversationId !== conversationIdFromUrl(location.href)) return { kind: "changed" };
        const layoutProblem = watch.problem();
        if (layoutProblem) return { kind: "sleep", reason: layoutProblem };
        if (document.visibilityState !== "visible") return { kind: "interrupted", reason: "hidden" };
        if (performance.now() >= activeDeadline || this.limitReached()) return { kind: "stopped", reason: "limit" };
        return null;
      };
      try {
        for (; ; ) {
          const currentProblem = problem();
          if (currentProblem) return currentProblem;
          const native = readNativePrompts();
          if (officialNavigatorReadiness(native, this.expectedPrompts, 0) === "stabilizing") {
            return { kind: "match" };
          }
          if (this.state.requestInFlight) {
            const waitingFor = this.state.historyRequests;
            while (this.state.requestInFlight && this.state.historyRequests === waitingFor) {
              const requestProblem = problem();
              if (requestProblem) return requestProblem;
              await abortableDelay(40, signal);
            }
            if (this.state.lastRequestError) return { kind: "sleep", reason: this.state.lastRequestError };
            await abortableDelay(240, signal);
            continue;
          }
          const requestsAtStart = this.state.historyRequests;
          exposure = exposePaginationSentinel(position.scroller);
          if (!exposure) return { kind: "sleep", reason: "sentinel-unavailable" };
          const pageDeadline = Math.min(activeDeadline, performance.now() + PAGE_PROGRESS_LIMIT_MS);
          while (performance.now() < pageDeadline && this.state.historyRequests === requestsAtStart) {
            await abortableDelay(20, signal);
            const waitProblem = problem();
            if (waitProblem) return waitProblem;
            const rectangle = exposure.element.getBoundingClientRect();
            const top = position.scroller === document.scrollingElement ? 0 : position.scroller.getBoundingClientRect().top + position.scroller.clientTop;
            if (!exposure.element.isConnected || rectangle.bottom < top || rectangle.top > top + position.scroller.clientHeight) {
              return { kind: "sleep", reason: "layout-changed" };
            }
          }
          release();
          if (this.state.historyRequests === requestsAtStart) return { kind: "sleep", reason: "no-host-request" };
          while (this.state.requestInFlight) {
            const completionProblem = problem();
            if (completionProblem) return completionProblem;
            if (performance.now() >= pageDeadline) return { kind: "sleep", reason: "request-timeout" };
            await abortableDelay(40, signal);
          }
          if (this.state.lastRequestError) return { kind: "sleep", reason: this.state.lastRequestError };
          await abortableDelay(240, signal);
        }
      } finally {
        release();
        watch.dispose();
        signal.removeEventListener("abort", release);
      }
    }
    limitReached() {
      return this.activeMs >= ACTIVE_LIMIT_MS || this.state.olderRequests - this.firstOlderRequest >= ADDITIONAL_PAGE_LIMIT;
    }
    cancel(reason) {
      this.operation?.abort(reason);
      this.stopPrepare();
    }
    startPrepare() {
      this.sendPrepare(true);
      this.clearHeartbeat();
      this.heartbeat = window.setInterval(() => this.sendPrepare(true), PREPARE_HEARTBEAT_MS);
    }
    stopPrepare() {
      this.clearHeartbeat();
      if (this.prepareEnabled) this.sendPrepare(false);
    }
    sendPrepare(enabled) {
      if (!this.state.conversationId) {
        this.prepareEnabled = false;
        return;
      }
      this.prepareEnabled = enabled;
      window.postMessage({
        channel: NATIVE_NAV_CHANNEL,
        kind: "prepare",
        enabled,
        conversationId: this.state.conversationId,
        generation: this.state.generation
      }, location.origin);
    }
    clearHeartbeat() {
      if (!this.heartbeat) return;
      clearInterval(this.heartbeat);
      this.heartbeat = 0;
    }
    async waitForBoostedAck(signal) {
      const until = performance.now() + PREPARE_ACK_WAIT_MS;
      while (!this.state.boosted && performance.now() < until) await abortableDelay(40, signal);
    }
    sleep(reason) {
      if (this.phase === "ready" || this.phase === "stopped") return;
      this.sleepReason = reason;
      this.parkHeavyWork();
      this.setPhase("sleeping");
    }
    wake(_reason) {
      if (this.disposed || this.phase === "stopped") return;
      this.sleepReason = null;
      this.resetReadyStability();
      this.setPhase("waiting");
      this.maybeArmHeavyWork();
      if (this.heavyArmed) this.schedule(0);
    }
    stop(reason) {
      this.sleepReason = reason;
      this.parkHeavyWork();
      this.setPhase("stopped");
    }
    maybeArmHeavyWork() {
      if (this.disposed || this.awaitingSnapshot) return;
      if (this.phase === "ready" || this.phase === "sleeping" || this.phase === "stopped") return;
      if (this.expectedPrompts <= 0 || !this.connected) return;
      this.armHeavyWork();
    }
    armHeavyWork() {
      if (this.disposed) return;
      if (!this.heavyArmed) {
        addEventListener("wheel", this.onUserInput, { capture: true, passive: true });
        addEventListener("touchstart", this.onUserInput, { capture: true, passive: true });
        addEventListener("pointerdown", this.onUserInput, { capture: true, passive: true });
        addEventListener("keydown", this.onUserInput, { capture: true, passive: true });
        addEventListener("resize", this.onEnvironment, { passive: true });
        this.heavyArmed = true;
      }
      if (!this.mutations) {
        this.mutations = new MutationObserver(() => this.schedule());
        this.mutations.observe(document.documentElement, { subtree: true, childList: true });
      }
    }
    parkHeavyWork() {
      clearTimeout(this.timer);
      this.timer = 0;
      this.stopPrepare();
      this.mutations?.disconnect();
      this.mutations = null;
      if (!this.heavyArmed) return;
      removeEventListener("wheel", this.onUserInput, true);
      removeEventListener("touchstart", this.onUserInput, true);
      removeEventListener("pointerdown", this.onUserInput, true);
      removeEventListener("keydown", this.onUserInput, true);
      removeEventListener("resize", this.onEnvironment);
      this.heavyArmed = false;
    }
    resetContext(context, firstOlderRequest = 0) {
      this.context = context;
      this.firstOlderRequest = firstOlderRequest;
      this.activeMs = 0;
      this.recoveries = 0;
      this.peakDrift = 0;
      this.sleepReason = null;
      this.resetReadyStability();
    }
    resetReadyStability() {
      this.readyStableChecks = 0;
      this.stableRoot = null;
      this.stableContainer = null;
      this.stableFound = 0;
      this.stableCheckedAt = 0;
    }
    setPhase(phase) {
      this.phase = phase;
      this.publishDiagnostics();
    }
    publishDiagnostics() {
      if (!debugEnabled()) {
        delete globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__;
        return;
      }
      const native = readNativePrompts();
      globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__ = {
        phase: this.phase,
        conversationId: this.state.conversationId,
        expectedPrompts: this.expectedPrompts,
        nativeFound: native.found,
        nativeVisible: native.visible,
        historyRequests: this.state.historyRequests,
        olderRequests: this.state.olderRequests,
        requestInFlight: this.state.requestInFlight,
        lastRequestKind: this.state.lastRequestKind,
        lastHttpStatus: this.state.lastHttpStatus,
        lastRequestDurationMs: this.state.lastRequestDurationMs,
        lastRequestAt: this.state.lastRequestAt,
        lastRequestError: this.state.lastRequestError,
        prepareActive: this.prepareEnabled,
        boosted: this.state.boosted,
        recoveryCount: this.recoveries,
        elapsedActiveMs: Math.round(this.activeMs),
        maxObservedDriftPx: Math.round(this.peakDrift * 10) / 10,
        sleepReason: this.sleepReason,
        readyStableChecks: this.readyStableChecks
      };
    }
    requestState() {
      window.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "hello" }, location.origin);
    }
  };
  function watchReadingPosition(position, signal, onDrift, onUnsafe) {
    let issue = null;
    let missingFrames = 0;
    let frame = 0;
    let active = true;
    const inspect = () => {
      if (!active || signal.aborted) return;
      const drift = readingPositionDrift(position);
      if (drift === null) missingFrames += 1;
      else {
        missingFrames = 0;
        onDrift(drift);
      }
      if (drift !== null && Math.abs(drift) > 8 || missingFrames > 3 || !stableLayoutAvailable()) {
        issue = "layout-changed";
        onUnsafe();
        return;
      }
      frame = requestAnimationFrame(inspect);
    };
    frame = requestAnimationFrame(inspect);
    return {
      problem: () => issue,
      dispose() {
        active = false;
        cancelAnimationFrame(frame);
      }
    };
  }
  function debugEnabled() {
    try {
      return localStorage.getItem(DEBUG_KEY) === "1";
    } catch {
      return false;
    }
  }
  function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timer = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  // src/shared/timeout.ts
  function withTimeout(promise, timeoutMs, message = "timeout") {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error(message));
    }
    let timer;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  // src/shared/messages.ts
  var MESSAGE_TIMEOUT_MS = 15e3;
  var REFRESH_TIMEOUT_MS = 45e3;
  function sendRuntimeMessage(message, timeoutMs = MESSAGE_TIMEOUT_MS) {
    return withTimeout(Promise.resolve(chrome.runtime.sendMessage(message)), timeoutMs, "扩展消息超时");
  }

  // src/quota/vibebar/allowances.ts
  var WEEK_SECONDS = 7 * 86400;
  function parsePlanType(value) {
    if (!value || typeof value !== "object") return null;
    const raw = value.plan_type;
    if (typeof raw !== "string") return null;
    const plan = raw.trim().toLowerCase();
    if (plan === "pro" || plan === "prolite") return plan;
    return null;
  }

  // src/quota/pageClient.ts
  var ACCOUNT_CACHE_TTL_MS = 30 * 60 * 1e3;
  var MODEL_LIMITS_CACHE_TTL_MS = 10 * 60 * 1e3;
  var accountCache = null;
  var limitsCache = null;
  async function readChatAccount(signal, options = {}) {
    const now = options.now ?? Date.now();
    const cheapId = getChatGptAccountId();
    if (!options.force && accountCache && now - accountCache.fetchedAt < ACCOUNT_CACHE_TTL_MS) {
      if (cheapId && accountCache.value.accountId && cheapId !== accountCache.value.accountId) {
        accountCache = null;
      } else {
        return accountCache.value;
      }
    }
    let userId = null;
    let plan = null;
    try {
      const session = await chatgptApi("/api/auth/session", { signal });
      if (session.ok) {
        const data = await session.json();
        userId = typeof data.user?.id === "string" ? data.user.id : null;
      }
    } catch {
      userId = null;
    }
    try {
      const usage = await chatgptApi("/backend-api/wham/usage", { signal });
      if (usage.ok) {
        const data = await usage.json();
        if (!userId) userId = typeof data.user_id === "string" ? data.user_id : typeof data.account_id === "string" ? data.account_id : null;
        plan = parsePlanType(data);
      }
    } catch {
      plan = null;
    }
    const accountId = cheapId ?? getChatGptAccountId();
    const identityKey = await identity(`${userId ?? "unknown"}:${accountId ?? "personal"}`);
    const value = { userId, accountId, plan, identity: identityKey };
    accountCache = { value, fetchedAt: now };
    return value;
  }
  async function readModelLimits(now = Date.now(), signal, options = {}) {
    if (!options.force && limitsCache && now - limitsCache.fetchedAt < MODEL_LIMITS_CACHE_TTL_MS) {
      return limitsCache.value;
    }
    try {
      const offsetMin = -Math.round((/* @__PURE__ */ new Date()).getTimezoneOffset());
      const response = await chatgptApi("/backend-api/conversation/init", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: null,
          gizmo_id: null,
          requested_default_model: null,
          system_hints: [],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timezone_offset_min: offsetMin
        })
      });
      if (!response.ok) return [];
      const value = modelLimits(await response.json(), now);
      limitsCache = { value, fetchedAt: now };
      return value;
    } catch {
      return [];
    }
  }

  // src/quota/tracker.ts
  var HISTORY_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1e3;
  var HISTORY_SLICE_DETAIL_BUDGET = 6;
  var SLICE_IDLE_MS = 2e3;
  var BUSY_RETRY_MS = 6e4;
  var MAX_TRANSIENT_RETRIES = 2;
  var HISTORY_LIST_TIMEOUT_MS = 45e3;
  var HISTORY_RECONCILE_LOCK = "chatgpt-yada:quota-history-reconcile";
  var HISTORY_LOCK_RETRY_MS = 6e4;
  async function withHistoryReconcileLock(task, locks) {
    if (!locks) return "unsupported";
    let acquired = false;
    await locks.request(
      HISTORY_RECONCILE_LOCK,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return;
        acquired = true;
        await task();
      }
    );
    return acquired ? "acquired" : "busy";
  }
  async function requestHistoryList(path, signal) {
    try {
      return await chatgptApiJson(path, { signal }, { timeoutMs: HISTORY_LIST_TIMEOUT_MS });
    } catch (error) {
      if (signal?.aborted || error instanceof DOMException && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : "";
      const status = Number(/API failed: (\d+)/.exec(message)?.[1] ?? 0);
      if (status === 401 || status === 403) throw Object.assign(new Error("login"), { name: "AbortError" });
      if ([408, 500, 502, 503, 504].includes(status)) throw new RetryableHistoryTransportError(`history ${status}`);
      if (status) throw new Error(`history ${status}`);
      if (error instanceof ChatGPTApiTimeoutError || error instanceof TypeError) {
        throw new RetryableHistoryTransportError("History list transport interrupted");
      }
      throw error;
    }
  }
  async function requestHistoryDetail(id, signal) {
    try {
      return await fetchConversation(id, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!signal?.aborted && (error instanceof TypeError || error instanceof ChatGPTApiTimeoutError || /API timed out|API failed: (408|500|502|503|504)\b/.test(message))) {
        throw new RetryableHistoryTransportError("History detail transport interrupted");
      }
      throw error;
    }
  }
  function shouldReconcileHistory(snapshot, now) {
    return !snapshot.historyComplete || !snapshot.lastHistorySuccessAt || now - snapshot.lastHistorySuccessAt >= HISTORY_DAILY_INTERVAL_MS;
  }
  var QuotaTracker = class {
    constructor(sync, options = {}) {
      this.sync = sync;
      this.locks = options.locks !== void 0 ? options.locks : typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null;
      this.blocked = options.blocked ?? (() => false);
    }
    unsubscribe = null;
    ingestQueue = Promise.resolve();
    ingestTail = Promise.resolve();
    history = createChromeHistoryStore();
    disposed = false;
    historyFlight = null;
    historyTimer = 0;
    historyIdle = 0;
    historyAbort = null;
    nextHistoryAt = 0;
    forceMode = null;
    historyIdentity = null;
    bypassCaches = false;
    transientRetries = 0;
    limitsFingerprint = null;
    lightRefreshPromise = null;
    locks;
    blocked;
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
      document.addEventListener("visibilitychange", this.onVisibility);
      this.scheduleSlice(SLICE_IDLE_MS);
    }
    async refreshCurrent() {
      this.bypassCaches = true;
      try {
        await withTimeout(this.sync.requestFull("popup"), REFRESH_TIMEOUT_MS, "同步超时");
        await withTimeout(this.ingestQueue, MESSAGE_TIMEOUT_MS, "账本写入超时");
      } finally {
        this.forceMode = "full";
        this.transientRetries = 0;
        this.scheduleSlice(0);
        this.bypassCaches = false;
      }
    }
    refreshCurrentLight(snapshot = null) {
      if (this.lightRefreshPromise) return this.lightRefreshPromise;
      const work = this.performLightRefresh(snapshot);
      const wrapped = work.finally(() => {
        if (this.lightRefreshPromise === wrapped) this.lightRefreshPromise = null;
      });
      this.lightRefreshPromise = wrapped;
      return wrapped;
    }
    dispose() {
      this.disposed = true;
      this.historyAbort?.abort();
      this.clearSliceSchedule();
      this.unsubscribe?.();
      this.unsubscribe = null;
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    onSnapshot(snapshot) {
      const work = this.ingestQueue.then(() => this.writeLedger(snapshot));
      this.ingestTail = work;
      this.ingestQueue = work.catch(() => void 0);
    }
    async performLightRefresh(snapshot) {
      if (this.disposed) throw abortError4();
      const conversationId = getConversationIdFromUrl();
      const activeId = this.sync.getActiveConversationId();
      if (isChatGptConversationPage() && conversationId && activeId === conversationId) {
        const ingestBefore = this.ingestTail;
        await this.refreshConversationLight(conversationId);
        if (this.ingestTail !== ingestBefore) {
          await withTimeout(this.ingestTail, MESSAGE_TIMEOUT_MS, "账本写入超时");
        }
      }
      this.requestHistoryRepair(snapshot);
    }
    async refreshConversationLight(conversationId) {
      const errorBefore = this.sync.getLastError();
      if (this.sync.hasUsableFullSnapshot(conversationId)) {
        await withTimeout(this.sync.requestRecent("quota-inline-refresh"), REFRESH_TIMEOUT_MS, "同步超时");
        this.assertLightRefreshStillOn(conversationId);
        if (!this.sync.hasUsableFullSnapshot(conversationId)) {
          await withTimeout(this.sync.requestFull("quota-inline-refresh-fallback"), REFRESH_TIMEOUT_MS, "同步超时");
          this.assertLightRefreshStillOn(conversationId);
        }
      } else {
        await withTimeout(this.sync.requestFull("quota-inline-refresh"), REFRESH_TIMEOUT_MS, "同步超时");
        this.assertLightRefreshStillOn(conversationId);
      }
      const errorAfter = this.sync.getLastError();
      if (errorAfter && errorAfter !== errorBefore) throw errorAfter;
    }
    assertLightRefreshStillOn(conversationId) {
      if (this.disposed) throw abortError4();
      if (this.sync.getActiveConversationId() !== conversationId) throw abortError4();
      if (getConversationIdFromUrl() !== conversationId) throw abortError4();
    }
    requestHistoryRepair(snapshot) {
      if (this.disposed || !snapshot) return;
      let mode = null;
      if (!snapshot.historyComplete) mode = "full";
      else if (snapshot.lastHistoryError != null) mode = "daily";
      if (!mode) return;
      if (mode === "full") this.forceMode = "full";
      else if (this.forceMode !== "full") this.forceMode = "daily";
      this.transientRetries = 0;
      this.scheduleSlice(0);
    }
    scheduleSlice(delayMs) {
      if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
      this.clearSliceSchedule();
      const wait2 = Math.max(0, delayMs);
      if (wait2 > 0) {
        this.historyTimer = window.setTimeout(() => {
          this.historyTimer = 0;
          this.armIdleSlice();
        }, wait2);
        return;
      }
      this.armIdleSlice();
    }
    armIdleSlice() {
      if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
      if (this.historyIdle || this.historyTimer) return;
      const onIdle = () => {
        this.historyIdle = 0;
        this.historyTimer = 0;
        this.onSliceOpportunity();
      };
      if (typeof requestIdleCallback === "function") {
        this.historyIdle = requestIdleCallback(() => onIdle());
        return;
      }
      this.historyTimer = window.setTimeout(onIdle, 0);
    }
    onSliceOpportunity() {
      if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
      if (!this.sliceIntended()) {
        if (this.nextHistoryAt > Date.now()) this.scheduleSlice(this.nextHistoryAt - Date.now());
        return;
      }
      if (this.blocked()) {
        this.scheduleSlice(BUSY_RETRY_MS);
        return;
      }
      this.startSlice();
    }
    sliceIntended() {
      return this.forceMode != null || this.nextHistoryAt <= Date.now();
    }
    clearSliceSchedule() {
      if (this.historyTimer) window.clearTimeout(this.historyTimer);
      this.historyTimer = 0;
      if (this.historyIdle && typeof cancelIdleCallback === "function") cancelIdleCallback(this.historyIdle);
      this.historyIdle = 0;
    }
    startSlice() {
      if (this.disposed || this.historyFlight || document.visibilityState === "hidden") return;
      if (this.blocked()) {
        this.scheduleSlice(BUSY_RETRY_MS);
        return;
      }
      const controller = new AbortController();
      this.historyAbort = controller;
      this.historyFlight = this.runLockedSlice(controller.signal).catch(() => void 0).finally(() => {
        this.historyAbort = null;
        this.historyFlight = null;
        if (this.disposed || document.visibilityState === "hidden") return;
        if (this.nextHistoryAt <= Date.now()) return;
        this.scheduleSlice(Math.max(SLICE_IDLE_MS, this.nextHistoryAt - Date.now()));
      });
    }
    async runLockedSlice(signal) {
      const result = await withHistoryReconcileLock(() => this.runSlice(signal), this.locks);
      if (result === "unsupported") {
        await this.runSlice(signal);
        return;
      }
      if (result === "busy") {
        this.nextHistoryAt = Date.now() + HISTORY_LOCK_RETRY_MS;
      }
    }
    async runSlice(signal) {
      const account = await readChatAccount(signal, { force: this.forceMode === "full" || this.bypassCaches });
      if (signal.aborted || this.disposed) return;
      if (!account.userId) throw new Error("login");
      const response = await sendRuntimeMessage({
        type: "quota/get-state",
        accountKey: account.identity,
        plan: account.plan ?? void 0
      });
      if (!response.snapshot || response.error) throw new Error("quota state unavailable");
      const baseline = response.snapshot;
      const forced = this.forceMode;
      this.forceMode = null;
      const maintenance = baseline.historyMaintenance;
      const mode = forced ?? (maintenance?.pending ? maintenance.mode : !baseline.historyComplete ? "full" : "daily");
      const now = Date.now();
      if (!forced && !maintenance?.pending && !shouldReconcileHistory(baseline, now)) {
        this.nextHistoryAt = (baseline.lastHistorySuccessAt ?? now) + HISTORY_DAILY_INTERVAL_MS;
        return;
      }
      if (!forced && baseline.lastHistoryError && now < (baseline.lastHistoryAttemptAt ?? 0) + HISTORY_DAILY_INTERVAL_MS && !maintenance?.pending) {
        this.nextHistoryAt = (baseline.lastHistoryAttemptAt ?? now) + HISTORY_DAILY_INTERVAL_MS;
        return;
      }
      if (signal.aborted) return;
      this.historyIdentity = account.identity;
      const attemptAt = maintenance?.attemptStartedAt ?? now;
      if (!baseline.historyComplete) {
        await this.publish(account, { syncStatus: "backfill", lastHistoryAttemptAt: attemptAt });
      }
      try {
        let cache = structuredClone(await this.history.load(account.identity));
        const store = {
          load: async () => cache,
          save: async (next) => {
            cache = next;
          }
        };
        const result = await readChatHistory({
          transport: { request: requestHistoryList },
          fetchDetail: requestHistoryDetail,
          store,
          identity: account.identity,
          now,
          signal,
          includeArchived: mode === "full",
          detailBudget: HISTORY_SLICE_DETAIL_BUDGET
        });
        if (signal.aborted || this.disposed) return;
        const summary = result.summary;
        if (summary.cancelled) throw new Error("login");
        if (summary.permanentFailures > 0) throw new Error("历史数据暂不完整");
        if (summary.retryableFailures > 0) {
          if (this.transientRetries >= MAX_TRANSIENT_RETRIES) throw new Error("历史接口暂不可用");
          this.transientRetries += 1;
          this.forceMode = mode;
          this.nextHistoryAt = Date.now() + SLICE_IDLE_MS;
          await this.persistProgress(account, cache, mode, attemptAt, baseline, false);
          return;
        }
        this.transientRetries = 0;
        if (summary.complete) {
          const successAt = Date.now();
          await this.publish(account, {
            events: toEvents(result.turns, account.identity, "personal"),
            historyCache: cache,
            historyComplete: true,
            syncStatus: "ready",
            unclassifiedTurns: summary.unclassifiedTurns,
            lastHistorySuccessAt: successAt,
            lastHistoryAttemptAt: attemptAt,
            lastHistoryError: null,
            historyMaintenance: maintenanceState(mode, attemptAt, successAt, baseline, false)
          });
          this.nextHistoryAt = successAt + HISTORY_DAILY_INTERVAL_MS;
          return;
        }
        if (summary.needsContinuation || historyNeedsAnotherPass(summary)) {
          await this.persistProgress(account, cache, mode, attemptAt, baseline, true);
          this.forceMode = mode;
          this.nextHistoryAt = Date.now() + SLICE_IDLE_MS;
          return;
        }
        throw new Error("历史数据暂不完整");
      } catch (error) {
        if (signal.aborted || this.disposed) return;
        await this.publish(account, {
          syncStatus: "error",
          lastHistoryAttemptAt: attemptAt,
          lastHistoryError: conciseError(error),
          historyMaintenance: maintenanceState(mode, attemptAt, baseline.lastHistorySuccessAt, baseline, false)
        });
        this.forceMode = null;
        this.nextHistoryAt = Date.now() + HISTORY_DAILY_INTERVAL_MS;
      }
    }
    async persistProgress(account, cache, mode, attemptAt, baseline, pending) {
      await this.publish(account, {
        historyCache: cache,
        historyMaintenance: maintenanceState(mode, attemptAt, baseline.lastHistorySuccessAt, baseline, pending)
      });
    }
    async publish(account, extras) {
      const response = await sendRuntimeMessage({
        type: "quota/ingest",
        events: [],
        plan: account.plan ?? void 0,
        accountKey: account.identity,
        ...extras
      });
      if (response?.error) throw new Error(response.error);
    }
    async writeLedger(snapshot) {
      if (this.disposed || !snapshot) return;
      const account = await readChatAccount(void 0, { force: this.bypassCaches });
      if (this.disposed || !account.userId) return;
      const accountChanged = this.historyIdentity !== null && this.historyIdentity !== account.identity;
      if (accountChanged) {
        this.historyAbort?.abort();
        this.limitsFingerprint = null;
        this.forceMode = "full";
        this.nextHistoryAt = 0;
      }
      this.historyIdentity = account.identity;
      const classification = classifySnapshot(snapshot);
      const events = snapshot.quotaIsWork ? [] : toEvents(snapshot.quotaTurns, account.identity, classification);
      const workspaceKind = snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal";
      await this.publish(account, { events, workspaceKind });
      if (accountChanged) this.scheduleSlice(SLICE_IDLE_MS);
      const limits = await readModelLimits(Date.now(), void 0, { force: this.bypassCaches });
      if (this.disposed) return;
      const fingerprint = JSON.stringify(limits);
      if (fingerprint === this.limitsFingerprint) return;
      this.limitsFingerprint = fingerprint;
      await this.publish(account, { limits, workspaceKind });
    }
    onVisibility = () => {
      if (document.visibilityState === "hidden") {
        this.clearSliceSchedule();
        return;
      }
      if (!this.historyFlight) this.scheduleSlice(SLICE_IDLE_MS);
    };
  };
  function maintenanceState(mode, attemptStartedAt, successAt, baseline, pending) {
    return {
      pending,
      mode,
      attemptStartedAt,
      lastIncrementalSuccessAt: successAt,
      lastFullSuccessAt: mode === "full" && !pending ? successAt : baseline.historyMaintenance?.lastFullSuccessAt
    };
  }
  function classifySnapshot(snapshot) {
    if (snapshot.quotaIsWork) return "work";
    if (snapshot.quotaTemporary) return "temporary";
    if (snapshot.quotaOrigin && snapshot.quotaOrigin !== "chat" && snapshot.quotaOrigin !== "chatgpt") return "unknown";
    return "personal";
  }
  function toEvents(turns, accountKey, classification) {
    return turns.map((turn) => ({
      id: turn.id,
      accountKey,
      createdAt: turn.createdAt,
      model: turn.model,
      classification
    }));
  }
  function conciseError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/login/i.test(message)) return "ChatGPT 登录状态不可用";
    if (/timeout|timed out|超时/i.test(message)) return "历史读取超时";
    if (/history \d+/.test(message)) return "历史接口暂不可用";
    return "历史读取失败";
  }
  function historyNeedsAnotherPass(summary) {
    return !summary.complete && !summary.cancelled && summary.permanentFailures === 0 && summary.retryableFailures === 0 && summary.conversationsFetched > 0 && (summary.hitDetailBudget || summary.hitDeadline || summary.needsContinuation === true);
  }

  // node_modules/sortablejs/modular/sortable.esm.js
  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      if (enumerableOnly) {
        symbols = symbols.filter(function(sym) {
          return Object.getOwnPropertyDescriptor(object, sym).enumerable;
        });
      }
      keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread2(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      if (i % 2) {
        ownKeys(Object(source), true).forEach(function(key) {
          _defineProperty(target, key, source[key]);
        });
      } else if (Object.getOwnPropertyDescriptors) {
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
      } else {
        ownKeys(Object(source)).forEach(function(key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
      }
    }
    return target;
  }
  function _typeof(obj) {
    "@babel/helpers - typeof";
    if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
      _typeof = function(obj2) {
        return typeof obj2;
      };
    } else {
      _typeof = function(obj2) {
        return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
      };
    }
    return _typeof(obj);
  }
  function _defineProperty(obj, key, value) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }
  function _extends() {
    _extends = Object.assign || function(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
      return target;
    };
    return _extends.apply(this, arguments);
  }
  function _objectWithoutPropertiesLoose(source, excluded) {
    if (source == null) return {};
    var target = {};
    var sourceKeys = Object.keys(source);
    var key, i;
    for (i = 0; i < sourceKeys.length; i++) {
      key = sourceKeys[i];
      if (excluded.indexOf(key) >= 0) continue;
      target[key] = source[key];
    }
    return target;
  }
  function _objectWithoutProperties(source, excluded) {
    if (source == null) return {};
    var target = _objectWithoutPropertiesLoose(source, excluded);
    var key, i;
    if (Object.getOwnPropertySymbols) {
      var sourceSymbolKeys = Object.getOwnPropertySymbols(source);
      for (i = 0; i < sourceSymbolKeys.length; i++) {
        key = sourceSymbolKeys[i];
        if (excluded.indexOf(key) >= 0) continue;
        if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
        target[key] = source[key];
      }
    }
    return target;
  }
  var version = "1.15.6";
  function userAgent(pattern) {
    if (typeof window !== "undefined" && window.navigator) {
      return !!/* @__PURE__ */ navigator.userAgent.match(pattern);
    }
  }
  var IE11OrLess = userAgent(/(?:Trident.*rv[ :]?11\.|msie|iemobile|Windows Phone)/i);
  var Edge = userAgent(/Edge/i);
  var FireFox = userAgent(/firefox/i);
  var Safari = userAgent(/safari/i) && !userAgent(/chrome/i) && !userAgent(/android/i);
  var IOS = userAgent(/iP(ad|od|hone)/i);
  var ChromeForAndroid = userAgent(/chrome/i) && userAgent(/android/i);
  var captureMode = {
    capture: false,
    passive: false
  };
  function on(el, event, fn) {
    el.addEventListener(event, fn, !IE11OrLess && captureMode);
  }
  function off(el, event, fn) {
    el.removeEventListener(event, fn, !IE11OrLess && captureMode);
  }
  function matches(el, selector) {
    if (!selector) return;
    selector[0] === ">" && (selector = selector.substring(1));
    if (el) {
      try {
        if (el.matches) {
          return el.matches(selector);
        } else if (el.msMatchesSelector) {
          return el.msMatchesSelector(selector);
        } else if (el.webkitMatchesSelector) {
          return el.webkitMatchesSelector(selector);
        }
      } catch (_) {
        return false;
      }
    }
    return false;
  }
  function getParentOrHost(el) {
    return el.host && el !== document && el.host.nodeType ? el.host : el.parentNode;
  }
  function closest(el, selector, ctx, includeCTX) {
    if (el) {
      ctx = ctx || document;
      do {
        if (selector != null && (selector[0] === ">" ? el.parentNode === ctx && matches(el, selector) : matches(el, selector)) || includeCTX && el === ctx) {
          return el;
        }
        if (el === ctx) break;
      } while (el = getParentOrHost(el));
    }
    return null;
  }
  var R_SPACE = /\s+/g;
  function toggleClass(el, name, state) {
    if (el && name) {
      if (el.classList) {
        el.classList[state ? "add" : "remove"](name);
      } else {
        var className = (" " + el.className + " ").replace(R_SPACE, " ").replace(" " + name + " ", " ");
        el.className = (className + (state ? " " + name : "")).replace(R_SPACE, " ");
      }
    }
  }
  function css(el, prop, val) {
    var style = el && el.style;
    if (style) {
      if (val === void 0) {
        if (document.defaultView && document.defaultView.getComputedStyle) {
          val = document.defaultView.getComputedStyle(el, "");
        } else if (el.currentStyle) {
          val = el.currentStyle;
        }
        return prop === void 0 ? val : val[prop];
      } else {
        if (!(prop in style) && prop.indexOf("webkit") === -1) {
          prop = "-webkit-" + prop;
        }
        style[prop] = val + (typeof val === "string" ? "" : "px");
      }
    }
  }
  function matrix(el, selfOnly) {
    var appliedTransforms = "";
    if (typeof el === "string") {
      appliedTransforms = el;
    } else {
      do {
        var transform = css(el, "transform");
        if (transform && transform !== "none") {
          appliedTransforms = transform + " " + appliedTransforms;
        }
      } while (!selfOnly && (el = el.parentNode));
    }
    var matrixFn = window.DOMMatrix || window.WebKitCSSMatrix || window.CSSMatrix || window.MSCSSMatrix;
    return matrixFn && new matrixFn(appliedTransforms);
  }
  function find(ctx, tagName, iterator) {
    if (ctx) {
      var list = ctx.getElementsByTagName(tagName), i = 0, n = list.length;
      if (iterator) {
        for (; i < n; i++) {
          iterator(list[i], i);
        }
      }
      return list;
    }
    return [];
  }
  function getWindowScrollingElement() {
    var scrollingElement = document.scrollingElement;
    if (scrollingElement) {
      return scrollingElement;
    } else {
      return document.documentElement;
    }
  }
  function getRect(el, relativeToContainingBlock, relativeToNonStaticParent, undoScale, container) {
    if (!el.getBoundingClientRect && el !== window) return;
    var elRect, top, left, bottom, right, height, width;
    if (el !== window && el.parentNode && el !== getWindowScrollingElement()) {
      elRect = el.getBoundingClientRect();
      top = elRect.top;
      left = elRect.left;
      bottom = elRect.bottom;
      right = elRect.right;
      height = elRect.height;
      width = elRect.width;
    } else {
      top = 0;
      left = 0;
      bottom = window.innerHeight;
      right = window.innerWidth;
      height = window.innerHeight;
      width = window.innerWidth;
    }
    if ((relativeToContainingBlock || relativeToNonStaticParent) && el !== window) {
      container = container || el.parentNode;
      if (!IE11OrLess) {
        do {
          if (container && container.getBoundingClientRect && (css(container, "transform") !== "none" || relativeToNonStaticParent && css(container, "position") !== "static")) {
            var containerRect = container.getBoundingClientRect();
            top -= containerRect.top + parseInt(css(container, "border-top-width"));
            left -= containerRect.left + parseInt(css(container, "border-left-width"));
            bottom = top + elRect.height;
            right = left + elRect.width;
            break;
          }
        } while (container = container.parentNode);
      }
    }
    if (undoScale && el !== window) {
      var elMatrix = matrix(container || el), scaleX = elMatrix && elMatrix.a, scaleY = elMatrix && elMatrix.d;
      if (elMatrix) {
        top /= scaleY;
        left /= scaleX;
        width /= scaleX;
        height /= scaleY;
        bottom = top + height;
        right = left + width;
      }
    }
    return {
      top,
      left,
      bottom,
      right,
      width,
      height
    };
  }
  function isScrolledPast(el, elSide, parentSide) {
    var parent = getParentAutoScrollElement(el, true), elSideVal = getRect(el)[elSide];
    while (parent) {
      var parentSideVal = getRect(parent)[parentSide], visible = void 0;
      if (parentSide === "top" || parentSide === "left") {
        visible = elSideVal >= parentSideVal;
      } else {
        visible = elSideVal <= parentSideVal;
      }
      if (!visible) return parent;
      if (parent === getWindowScrollingElement()) break;
      parent = getParentAutoScrollElement(parent, false);
    }
    return false;
  }
  function getChild(el, childNum, options, includeDragEl) {
    var currentChild = 0, i = 0, children = el.children;
    while (i < children.length) {
      if (children[i].style.display !== "none" && children[i] !== Sortable.ghost && (includeDragEl || children[i] !== Sortable.dragged) && closest(children[i], options.draggable, el, false)) {
        if (currentChild === childNum) {
          return children[i];
        }
        currentChild++;
      }
      i++;
    }
    return null;
  }
  function lastChild(el, selector) {
    var last = el.lastElementChild;
    while (last && (last === Sortable.ghost || css(last, "display") === "none" || selector && !matches(last, selector))) {
      last = last.previousElementSibling;
    }
    return last || null;
  }
  function index(el, selector) {
    var index2 = 0;
    if (!el || !el.parentNode) {
      return -1;
    }
    while (el = el.previousElementSibling) {
      if (el.nodeName.toUpperCase() !== "TEMPLATE" && el !== Sortable.clone && (!selector || matches(el, selector))) {
        index2++;
      }
    }
    return index2;
  }
  function getRelativeScrollOffset(el) {
    var offsetLeft = 0, offsetTop = 0, winScroller = getWindowScrollingElement();
    if (el) {
      do {
        var elMatrix = matrix(el), scaleX = elMatrix.a, scaleY = elMatrix.d;
        offsetLeft += el.scrollLeft * scaleX;
        offsetTop += el.scrollTop * scaleY;
      } while (el !== winScroller && (el = el.parentNode));
    }
    return [offsetLeft, offsetTop];
  }
  function indexOfObject(arr, obj) {
    for (var i in arr) {
      if (!arr.hasOwnProperty(i)) continue;
      for (var key in obj) {
        if (obj.hasOwnProperty(key) && obj[key] === arr[i][key]) return Number(i);
      }
    }
    return -1;
  }
  function getParentAutoScrollElement(el, includeSelf) {
    if (!el || !el.getBoundingClientRect) return getWindowScrollingElement();
    var elem = el;
    var gotSelf = false;
    do {
      if (elem.clientWidth < elem.scrollWidth || elem.clientHeight < elem.scrollHeight) {
        var elemCSS = css(elem);
        if (elem.clientWidth < elem.scrollWidth && (elemCSS.overflowX == "auto" || elemCSS.overflowX == "scroll") || elem.clientHeight < elem.scrollHeight && (elemCSS.overflowY == "auto" || elemCSS.overflowY == "scroll")) {
          if (!elem.getBoundingClientRect || elem === document.body) return getWindowScrollingElement();
          if (gotSelf || includeSelf) return elem;
          gotSelf = true;
        }
      }
    } while (elem = elem.parentNode);
    return getWindowScrollingElement();
  }
  function extend(dst, src) {
    if (dst && src) {
      for (var key in src) {
        if (src.hasOwnProperty(key)) {
          dst[key] = src[key];
        }
      }
    }
    return dst;
  }
  function isRectEqual(rect1, rect2) {
    return Math.round(rect1.top) === Math.round(rect2.top) && Math.round(rect1.left) === Math.round(rect2.left) && Math.round(rect1.height) === Math.round(rect2.height) && Math.round(rect1.width) === Math.round(rect2.width);
  }
  var _throttleTimeout;
  function throttle(callback, ms) {
    return function() {
      if (!_throttleTimeout) {
        var args = arguments, _this = this;
        if (args.length === 1) {
          callback.call(_this, args[0]);
        } else {
          callback.apply(_this, args);
        }
        _throttleTimeout = setTimeout(function() {
          _throttleTimeout = void 0;
        }, ms);
      }
    };
  }
  function cancelThrottle() {
    clearTimeout(_throttleTimeout);
    _throttleTimeout = void 0;
  }
  function scrollBy(el, x, y) {
    el.scrollLeft += x;
    el.scrollTop += y;
  }
  function clone(el) {
    var Polymer = window.Polymer;
    var $ = window.jQuery || window.Zepto;
    if (Polymer && Polymer.dom) {
      return Polymer.dom(el).cloneNode(true);
    } else if ($) {
      return $(el).clone(true)[0];
    } else {
      return el.cloneNode(true);
    }
  }
  function getChildContainingRectFromElement(container, options, ghostEl2) {
    var rect = {};
    Array.from(container.children).forEach(function(child) {
      var _rect$left, _rect$top, _rect$right, _rect$bottom;
      if (!closest(child, options.draggable, container, false) || child.animated || child === ghostEl2) return;
      var childRect = getRect(child);
      rect.left = Math.min((_rect$left = rect.left) !== null && _rect$left !== void 0 ? _rect$left : Infinity, childRect.left);
      rect.top = Math.min((_rect$top = rect.top) !== null && _rect$top !== void 0 ? _rect$top : Infinity, childRect.top);
      rect.right = Math.max((_rect$right = rect.right) !== null && _rect$right !== void 0 ? _rect$right : -Infinity, childRect.right);
      rect.bottom = Math.max((_rect$bottom = rect.bottom) !== null && _rect$bottom !== void 0 ? _rect$bottom : -Infinity, childRect.bottom);
    });
    rect.width = rect.right - rect.left;
    rect.height = rect.bottom - rect.top;
    rect.x = rect.left;
    rect.y = rect.top;
    return rect;
  }
  var expando = "Sortable" + (/* @__PURE__ */ new Date()).getTime();
  function AnimationStateManager() {
    var animationStates = [], animationCallbackId;
    return {
      captureAnimationState: function captureAnimationState() {
        animationStates = [];
        if (!this.options.animation) return;
        var children = [].slice.call(this.el.children);
        children.forEach(function(child) {
          if (css(child, "display") === "none" || child === Sortable.ghost) return;
          animationStates.push({
            target: child,
            rect: getRect(child)
          });
          var fromRect = _objectSpread2({}, animationStates[animationStates.length - 1].rect);
          if (child.thisAnimationDuration) {
            var childMatrix = matrix(child, true);
            if (childMatrix) {
              fromRect.top -= childMatrix.f;
              fromRect.left -= childMatrix.e;
            }
          }
          child.fromRect = fromRect;
        });
      },
      addAnimationState: function addAnimationState(state) {
        animationStates.push(state);
      },
      removeAnimationState: function removeAnimationState(target) {
        animationStates.splice(indexOfObject(animationStates, {
          target
        }), 1);
      },
      animateAll: function animateAll(callback) {
        var _this = this;
        if (!this.options.animation) {
          clearTimeout(animationCallbackId);
          if (typeof callback === "function") callback();
          return;
        }
        var animating = false, animationTime = 0;
        animationStates.forEach(function(state) {
          var time = 0, target = state.target, fromRect = target.fromRect, toRect = getRect(target), prevFromRect = target.prevFromRect, prevToRect = target.prevToRect, animatingRect = state.rect, targetMatrix = matrix(target, true);
          if (targetMatrix) {
            toRect.top -= targetMatrix.f;
            toRect.left -= targetMatrix.e;
          }
          target.toRect = toRect;
          if (target.thisAnimationDuration) {
            if (isRectEqual(prevFromRect, toRect) && !isRectEqual(fromRect, toRect) && // Make sure animatingRect is on line between toRect & fromRect
            (animatingRect.top - toRect.top) / (animatingRect.left - toRect.left) === (fromRect.top - toRect.top) / (fromRect.left - toRect.left)) {
              time = calculateRealTime(animatingRect, prevFromRect, prevToRect, _this.options);
            }
          }
          if (!isRectEqual(toRect, fromRect)) {
            target.prevFromRect = fromRect;
            target.prevToRect = toRect;
            if (!time) {
              time = _this.options.animation;
            }
            _this.animate(target, animatingRect, toRect, time);
          }
          if (time) {
            animating = true;
            animationTime = Math.max(animationTime, time);
            clearTimeout(target.animationResetTimer);
            target.animationResetTimer = setTimeout(function() {
              target.animationTime = 0;
              target.prevFromRect = null;
              target.fromRect = null;
              target.prevToRect = null;
              target.thisAnimationDuration = null;
            }, time);
            target.thisAnimationDuration = time;
          }
        });
        clearTimeout(animationCallbackId);
        if (!animating) {
          if (typeof callback === "function") callback();
        } else {
          animationCallbackId = setTimeout(function() {
            if (typeof callback === "function") callback();
          }, animationTime);
        }
        animationStates = [];
      },
      animate: function animate(target, currentRect, toRect, duration) {
        if (duration) {
          css(target, "transition", "");
          css(target, "transform", "");
          var elMatrix = matrix(this.el), scaleX = elMatrix && elMatrix.a, scaleY = elMatrix && elMatrix.d, translateX = (currentRect.left - toRect.left) / (scaleX || 1), translateY = (currentRect.top - toRect.top) / (scaleY || 1);
          target.animatingX = !!translateX;
          target.animatingY = !!translateY;
          css(target, "transform", "translate3d(" + translateX + "px," + translateY + "px,0)");
          this.forRepaintDummy = repaint(target);
          css(target, "transition", "transform " + duration + "ms" + (this.options.easing ? " " + this.options.easing : ""));
          css(target, "transform", "translate3d(0,0,0)");
          typeof target.animated === "number" && clearTimeout(target.animated);
          target.animated = setTimeout(function() {
            css(target, "transition", "");
            css(target, "transform", "");
            target.animated = false;
            target.animatingX = false;
            target.animatingY = false;
          }, duration);
        }
      }
    };
  }
  function repaint(target) {
    return target.offsetWidth;
  }
  function calculateRealTime(animatingRect, fromRect, toRect, options) {
    return Math.sqrt(Math.pow(fromRect.top - animatingRect.top, 2) + Math.pow(fromRect.left - animatingRect.left, 2)) / Math.sqrt(Math.pow(fromRect.top - toRect.top, 2) + Math.pow(fromRect.left - toRect.left, 2)) * options.animation;
  }
  var plugins = [];
  var defaults = {
    initializeByDefault: true
  };
  var PluginManager = {
    mount: function mount(plugin) {
      for (var option2 in defaults) {
        if (defaults.hasOwnProperty(option2) && !(option2 in plugin)) {
          plugin[option2] = defaults[option2];
        }
      }
      plugins.forEach(function(p) {
        if (p.pluginName === plugin.pluginName) {
          throw "Sortable: Cannot mount plugin ".concat(plugin.pluginName, " more than once");
        }
      });
      plugins.push(plugin);
    },
    pluginEvent: function pluginEvent(eventName, sortable, evt) {
      var _this = this;
      this.eventCanceled = false;
      evt.cancel = function() {
        _this.eventCanceled = true;
      };
      var eventNameGlobal = eventName + "Global";
      plugins.forEach(function(plugin) {
        if (!sortable[plugin.pluginName]) return;
        if (sortable[plugin.pluginName][eventNameGlobal]) {
          sortable[plugin.pluginName][eventNameGlobal](_objectSpread2({
            sortable
          }, evt));
        }
        if (sortable.options[plugin.pluginName] && sortable[plugin.pluginName][eventName]) {
          sortable[plugin.pluginName][eventName](_objectSpread2({
            sortable
          }, evt));
        }
      });
    },
    initializePlugins: function initializePlugins(sortable, el, defaults2, options) {
      plugins.forEach(function(plugin) {
        var pluginName = plugin.pluginName;
        if (!sortable.options[pluginName] && !plugin.initializeByDefault) return;
        var initialized = new plugin(sortable, el, sortable.options);
        initialized.sortable = sortable;
        initialized.options = sortable.options;
        sortable[pluginName] = initialized;
        _extends(defaults2, initialized.defaults);
      });
      for (var option2 in sortable.options) {
        if (!sortable.options.hasOwnProperty(option2)) continue;
        var modified = this.modifyOption(sortable, option2, sortable.options[option2]);
        if (typeof modified !== "undefined") {
          sortable.options[option2] = modified;
        }
      }
    },
    getEventProperties: function getEventProperties(name, sortable) {
      var eventProperties = {};
      plugins.forEach(function(plugin) {
        if (typeof plugin.eventProperties !== "function") return;
        _extends(eventProperties, plugin.eventProperties.call(sortable[plugin.pluginName], name));
      });
      return eventProperties;
    },
    modifyOption: function modifyOption(sortable, name, value) {
      var modifiedValue;
      plugins.forEach(function(plugin) {
        if (!sortable[plugin.pluginName]) return;
        if (plugin.optionListeners && typeof plugin.optionListeners[name] === "function") {
          modifiedValue = plugin.optionListeners[name].call(sortable[plugin.pluginName], value);
        }
      });
      return modifiedValue;
    }
  };
  function dispatchEvent(_ref) {
    var sortable = _ref.sortable, rootEl2 = _ref.rootEl, name = _ref.name, targetEl = _ref.targetEl, cloneEl2 = _ref.cloneEl, toEl = _ref.toEl, fromEl = _ref.fromEl, oldIndex2 = _ref.oldIndex, newIndex2 = _ref.newIndex, oldDraggableIndex2 = _ref.oldDraggableIndex, newDraggableIndex2 = _ref.newDraggableIndex, originalEvent = _ref.originalEvent, putSortable2 = _ref.putSortable, extraEventProperties = _ref.extraEventProperties;
    sortable = sortable || rootEl2 && rootEl2[expando];
    if (!sortable) return;
    var evt, options = sortable.options, onName = "on" + name.charAt(0).toUpperCase() + name.substr(1);
    if (window.CustomEvent && !IE11OrLess && !Edge) {
      evt = new CustomEvent(name, {
        bubbles: true,
        cancelable: true
      });
    } else {
      evt = document.createEvent("Event");
      evt.initEvent(name, true, true);
    }
    evt.to = toEl || rootEl2;
    evt.from = fromEl || rootEl2;
    evt.item = targetEl || rootEl2;
    evt.clone = cloneEl2;
    evt.oldIndex = oldIndex2;
    evt.newIndex = newIndex2;
    evt.oldDraggableIndex = oldDraggableIndex2;
    evt.newDraggableIndex = newDraggableIndex2;
    evt.originalEvent = originalEvent;
    evt.pullMode = putSortable2 ? putSortable2.lastPutMode : void 0;
    var allEventProperties = _objectSpread2(_objectSpread2({}, extraEventProperties), PluginManager.getEventProperties(name, sortable));
    for (var option2 in allEventProperties) {
      evt[option2] = allEventProperties[option2];
    }
    if (rootEl2) {
      rootEl2.dispatchEvent(evt);
    }
    if (options[onName]) {
      options[onName].call(sortable, evt);
    }
  }
  var _excluded = ["evt"];
  var pluginEvent2 = function pluginEvent3(eventName, sortable) {
    var _ref = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {}, originalEvent = _ref.evt, data = _objectWithoutProperties(_ref, _excluded);
    PluginManager.pluginEvent.bind(Sortable)(eventName, sortable, _objectSpread2({
      dragEl,
      parentEl,
      ghostEl,
      rootEl,
      nextEl,
      lastDownEl,
      cloneEl,
      cloneHidden,
      dragStarted: moved,
      putSortable,
      activeSortable: Sortable.active,
      originalEvent,
      oldIndex,
      oldDraggableIndex,
      newIndex,
      newDraggableIndex,
      hideGhostForTarget: _hideGhostForTarget,
      unhideGhostForTarget: _unhideGhostForTarget,
      cloneNowHidden: function cloneNowHidden() {
        cloneHidden = true;
      },
      cloneNowShown: function cloneNowShown() {
        cloneHidden = false;
      },
      dispatchSortableEvent: function dispatchSortableEvent(name) {
        _dispatchEvent({
          sortable,
          name,
          originalEvent
        });
      }
    }, data));
  };
  function _dispatchEvent(info) {
    dispatchEvent(_objectSpread2({
      putSortable,
      cloneEl,
      targetEl: dragEl,
      rootEl,
      oldIndex,
      oldDraggableIndex,
      newIndex,
      newDraggableIndex
    }, info));
  }
  var dragEl;
  var parentEl;
  var ghostEl;
  var rootEl;
  var nextEl;
  var lastDownEl;
  var cloneEl;
  var cloneHidden;
  var oldIndex;
  var newIndex;
  var oldDraggableIndex;
  var newDraggableIndex;
  var activeGroup;
  var putSortable;
  var awaitingDragStarted = false;
  var ignoreNextClick = false;
  var sortables = [];
  var tapEvt;
  var touchEvt;
  var lastDx;
  var lastDy;
  var tapDistanceLeft;
  var tapDistanceTop;
  var moved;
  var lastTarget;
  var lastDirection;
  var pastFirstInvertThresh = false;
  var isCircumstantialInvert = false;
  var targetMoveDistance;
  var ghostRelativeParent;
  var ghostRelativeParentInitialScroll = [];
  var _silent = false;
  var savedInputChecked = [];
  var documentExists = typeof document !== "undefined";
  var PositionGhostAbsolutely = IOS;
  var CSSFloatProperty = Edge || IE11OrLess ? "cssFloat" : "float";
  var supportDraggable = documentExists && !ChromeForAndroid && !IOS && "draggable" in document.createElement("div");
  var supportCssPointerEvents = (function() {
    if (!documentExists) return;
    if (IE11OrLess) {
      return false;
    }
    var el = document.createElement("x");
    el.style.cssText = "pointer-events:auto";
    return el.style.pointerEvents === "auto";
  })();
  var _detectDirection = function _detectDirection2(el, options) {
    var elCSS = css(el), elWidth = parseInt(elCSS.width) - parseInt(elCSS.paddingLeft) - parseInt(elCSS.paddingRight) - parseInt(elCSS.borderLeftWidth) - parseInt(elCSS.borderRightWidth), child1 = getChild(el, 0, options), child2 = getChild(el, 1, options), firstChildCSS = child1 && css(child1), secondChildCSS = child2 && css(child2), firstChildWidth = firstChildCSS && parseInt(firstChildCSS.marginLeft) + parseInt(firstChildCSS.marginRight) + getRect(child1).width, secondChildWidth = secondChildCSS && parseInt(secondChildCSS.marginLeft) + parseInt(secondChildCSS.marginRight) + getRect(child2).width;
    if (elCSS.display === "flex") {
      return elCSS.flexDirection === "column" || elCSS.flexDirection === "column-reverse" ? "vertical" : "horizontal";
    }
    if (elCSS.display === "grid") {
      return elCSS.gridTemplateColumns.split(" ").length <= 1 ? "vertical" : "horizontal";
    }
    if (child1 && firstChildCSS["float"] && firstChildCSS["float"] !== "none") {
      var touchingSideChild2 = firstChildCSS["float"] === "left" ? "left" : "right";
      return child2 && (secondChildCSS.clear === "both" || secondChildCSS.clear === touchingSideChild2) ? "vertical" : "horizontal";
    }
    return child1 && (firstChildCSS.display === "block" || firstChildCSS.display === "flex" || firstChildCSS.display === "table" || firstChildCSS.display === "grid" || firstChildWidth >= elWidth && elCSS[CSSFloatProperty] === "none" || child2 && elCSS[CSSFloatProperty] === "none" && firstChildWidth + secondChildWidth > elWidth) ? "vertical" : "horizontal";
  };
  var _dragElInRowColumn = function _dragElInRowColumn2(dragRect, targetRect, vertical) {
    var dragElS1Opp = vertical ? dragRect.left : dragRect.top, dragElS2Opp = vertical ? dragRect.right : dragRect.bottom, dragElOppLength = vertical ? dragRect.width : dragRect.height, targetS1Opp = vertical ? targetRect.left : targetRect.top, targetS2Opp = vertical ? targetRect.right : targetRect.bottom, targetOppLength = vertical ? targetRect.width : targetRect.height;
    return dragElS1Opp === targetS1Opp || dragElS2Opp === targetS2Opp || dragElS1Opp + dragElOppLength / 2 === targetS1Opp + targetOppLength / 2;
  };
  var _detectNearestEmptySortable = function _detectNearestEmptySortable2(x, y) {
    var ret;
    sortables.some(function(sortable) {
      var threshold = sortable[expando].options.emptyInsertThreshold;
      if (!threshold || lastChild(sortable)) return;
      var rect = getRect(sortable), insideHorizontally = x >= rect.left - threshold && x <= rect.right + threshold, insideVertically = y >= rect.top - threshold && y <= rect.bottom + threshold;
      if (insideHorizontally && insideVertically) {
        return ret = sortable;
      }
    });
    return ret;
  };
  var _prepareGroup = function _prepareGroup2(options) {
    function toFn(value, pull) {
      return function(to, from, dragEl2, evt) {
        var sameGroup = to.options.group.name && from.options.group.name && to.options.group.name === from.options.group.name;
        if (value == null && (pull || sameGroup)) {
          return true;
        } else if (value == null || value === false) {
          return false;
        } else if (pull && value === "clone") {
          return value;
        } else if (typeof value === "function") {
          return toFn(value(to, from, dragEl2, evt), pull)(to, from, dragEl2, evt);
        } else {
          var otherGroup = (pull ? to : from).options.group.name;
          return value === true || typeof value === "string" && value === otherGroup || value.join && value.indexOf(otherGroup) > -1;
        }
      };
    }
    var group = {};
    var originalGroup = options.group;
    if (!originalGroup || _typeof(originalGroup) != "object") {
      originalGroup = {
        name: originalGroup
      };
    }
    group.name = originalGroup.name;
    group.checkPull = toFn(originalGroup.pull, true);
    group.checkPut = toFn(originalGroup.put);
    group.revertClone = originalGroup.revertClone;
    options.group = group;
  };
  var _hideGhostForTarget = function _hideGhostForTarget2() {
    if (!supportCssPointerEvents && ghostEl) {
      css(ghostEl, "display", "none");
    }
  };
  var _unhideGhostForTarget = function _unhideGhostForTarget2() {
    if (!supportCssPointerEvents && ghostEl) {
      css(ghostEl, "display", "");
    }
  };
  if (documentExists && !ChromeForAndroid) {
    document.addEventListener("click", function(evt) {
      if (ignoreNextClick) {
        evt.preventDefault();
        evt.stopPropagation && evt.stopPropagation();
        evt.stopImmediatePropagation && evt.stopImmediatePropagation();
        ignoreNextClick = false;
        return false;
      }
    }, true);
  }
  var nearestEmptyInsertDetectEvent = function nearestEmptyInsertDetectEvent2(evt) {
    if (dragEl) {
      evt = evt.touches ? evt.touches[0] : evt;
      var nearest = _detectNearestEmptySortable(evt.clientX, evt.clientY);
      if (nearest) {
        var event = {};
        for (var i in evt) {
          if (evt.hasOwnProperty(i)) {
            event[i] = evt[i];
          }
        }
        event.target = event.rootEl = nearest;
        event.preventDefault = void 0;
        event.stopPropagation = void 0;
        nearest[expando]._onDragOver(event);
      }
    }
  };
  var _checkOutsideTargetEl = function _checkOutsideTargetEl2(evt) {
    if (dragEl) {
      dragEl.parentNode[expando]._isOutsideThisEl(evt.target);
    }
  };
  function Sortable(el, options) {
    if (!(el && el.nodeType && el.nodeType === 1)) {
      throw "Sortable: `el` must be an HTMLElement, not ".concat({}.toString.call(el));
    }
    this.el = el;
    this.options = options = _extends({}, options);
    el[expando] = this;
    var defaults2 = {
      group: null,
      sort: true,
      disabled: false,
      store: null,
      handle: null,
      draggable: /^[uo]l$/i.test(el.nodeName) ? ">li" : ">*",
      swapThreshold: 1,
      // percentage; 0 <= x <= 1
      invertSwap: false,
      // invert always
      invertedSwapThreshold: null,
      // will be set to same as swapThreshold if default
      removeCloneOnHide: true,
      direction: function direction() {
        return _detectDirection(el, this.options);
      },
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",
      ignore: "a, img",
      filter: null,
      preventOnFilter: true,
      animation: 0,
      easing: null,
      setData: function setData(dataTransfer, dragEl2) {
        dataTransfer.setData("Text", dragEl2.textContent);
      },
      dropBubble: false,
      dragoverBubble: false,
      dataIdAttr: "data-id",
      delay: 0,
      delayOnTouchOnly: false,
      touchStartThreshold: (Number.parseInt ? Number : window).parseInt(window.devicePixelRatio, 10) || 1,
      forceFallback: false,
      fallbackClass: "sortable-fallback",
      fallbackOnBody: false,
      fallbackTolerance: 0,
      fallbackOffset: {
        x: 0,
        y: 0
      },
      // Disabled on Safari: #1571; Enabled on Safari IOS: #2244
      supportPointer: Sortable.supportPointer !== false && "PointerEvent" in window && (!Safari || IOS),
      emptyInsertThreshold: 5
    };
    PluginManager.initializePlugins(this, el, defaults2);
    for (var name in defaults2) {
      !(name in options) && (options[name] = defaults2[name]);
    }
    _prepareGroup(options);
    for (var fn in this) {
      if (fn.charAt(0) === "_" && typeof this[fn] === "function") {
        this[fn] = this[fn].bind(this);
      }
    }
    this.nativeDraggable = options.forceFallback ? false : supportDraggable;
    if (this.nativeDraggable) {
      this.options.touchStartThreshold = 1;
    }
    if (options.supportPointer) {
      on(el, "pointerdown", this._onTapStart);
    } else {
      on(el, "mousedown", this._onTapStart);
      on(el, "touchstart", this._onTapStart);
    }
    if (this.nativeDraggable) {
      on(el, "dragover", this);
      on(el, "dragenter", this);
    }
    sortables.push(this.el);
    options.store && options.store.get && this.sort(options.store.get(this) || []);
    _extends(this, AnimationStateManager());
  }
  Sortable.prototype = /** @lends Sortable.prototype */
  {
    constructor: Sortable,
    _isOutsideThisEl: function _isOutsideThisEl(target) {
      if (!this.el.contains(target) && target !== this.el) {
        lastTarget = null;
      }
    },
    _getDirection: function _getDirection(evt, target) {
      return typeof this.options.direction === "function" ? this.options.direction.call(this, evt, target, dragEl) : this.options.direction;
    },
    _onTapStart: function _onTapStart(evt) {
      if (!evt.cancelable) return;
      var _this = this, el = this.el, options = this.options, preventOnFilter = options.preventOnFilter, type = evt.type, touch = evt.touches && evt.touches[0] || evt.pointerType && evt.pointerType === "touch" && evt, target = (touch || evt).target, originalTarget = evt.target.shadowRoot && (evt.path && evt.path[0] || evt.composedPath && evt.composedPath()[0]) || target, filter = options.filter;
      _saveInputCheckedState(el);
      if (dragEl) {
        return;
      }
      if (/mousedown|pointerdown/.test(type) && evt.button !== 0 || options.disabled) {
        return;
      }
      if (originalTarget.isContentEditable) {
        return;
      }
      if (!this.nativeDraggable && Safari && target && target.tagName.toUpperCase() === "SELECT") {
        return;
      }
      target = closest(target, options.draggable, el, false);
      if (target && target.animated) {
        return;
      }
      if (lastDownEl === target) {
        return;
      }
      oldIndex = index(target);
      oldDraggableIndex = index(target, options.draggable);
      if (typeof filter === "function") {
        if (filter.call(this, evt, target, this)) {
          _dispatchEvent({
            sortable: _this,
            rootEl: originalTarget,
            name: "filter",
            targetEl: target,
            toEl: el,
            fromEl: el
          });
          pluginEvent2("filter", _this, {
            evt
          });
          preventOnFilter && evt.preventDefault();
          return;
        }
      } else if (filter) {
        filter = filter.split(",").some(function(criteria) {
          criteria = closest(originalTarget, criteria.trim(), el, false);
          if (criteria) {
            _dispatchEvent({
              sortable: _this,
              rootEl: criteria,
              name: "filter",
              targetEl: target,
              fromEl: el,
              toEl: el
            });
            pluginEvent2("filter", _this, {
              evt
            });
            return true;
          }
        });
        if (filter) {
          preventOnFilter && evt.preventDefault();
          return;
        }
      }
      if (options.handle && !closest(originalTarget, options.handle, el, false)) {
        return;
      }
      this._prepareDragStart(evt, touch, target);
    },
    _prepareDragStart: function _prepareDragStart(evt, touch, target) {
      var _this = this, el = _this.el, options = _this.options, ownerDocument = el.ownerDocument, dragStartFn;
      if (target && !dragEl && target.parentNode === el) {
        var dragRect = getRect(target);
        rootEl = el;
        dragEl = target;
        parentEl = dragEl.parentNode;
        nextEl = dragEl.nextSibling;
        lastDownEl = target;
        activeGroup = options.group;
        Sortable.dragged = dragEl;
        tapEvt = {
          target: dragEl,
          clientX: (touch || evt).clientX,
          clientY: (touch || evt).clientY
        };
        tapDistanceLeft = tapEvt.clientX - dragRect.left;
        tapDistanceTop = tapEvt.clientY - dragRect.top;
        this._lastX = (touch || evt).clientX;
        this._lastY = (touch || evt).clientY;
        dragEl.style["will-change"] = "all";
        dragStartFn = function dragStartFn2() {
          pluginEvent2("delayEnded", _this, {
            evt
          });
          if (Sortable.eventCanceled) {
            _this._onDrop();
            return;
          }
          _this._disableDelayedDragEvents();
          if (!FireFox && _this.nativeDraggable) {
            dragEl.draggable = true;
          }
          _this._triggerDragStart(evt, touch);
          _dispatchEvent({
            sortable: _this,
            name: "choose",
            originalEvent: evt
          });
          toggleClass(dragEl, options.chosenClass, true);
        };
        options.ignore.split(",").forEach(function(criteria) {
          find(dragEl, criteria.trim(), _disableDraggable);
        });
        on(ownerDocument, "dragover", nearestEmptyInsertDetectEvent);
        on(ownerDocument, "mousemove", nearestEmptyInsertDetectEvent);
        on(ownerDocument, "touchmove", nearestEmptyInsertDetectEvent);
        if (options.supportPointer) {
          on(ownerDocument, "pointerup", _this._onDrop);
          !this.nativeDraggable && on(ownerDocument, "pointercancel", _this._onDrop);
        } else {
          on(ownerDocument, "mouseup", _this._onDrop);
          on(ownerDocument, "touchend", _this._onDrop);
          on(ownerDocument, "touchcancel", _this._onDrop);
        }
        if (FireFox && this.nativeDraggable) {
          this.options.touchStartThreshold = 4;
          dragEl.draggable = true;
        }
        pluginEvent2("delayStart", this, {
          evt
        });
        if (options.delay && (!options.delayOnTouchOnly || touch) && (!this.nativeDraggable || !(Edge || IE11OrLess))) {
          if (Sortable.eventCanceled) {
            this._onDrop();
            return;
          }
          if (options.supportPointer) {
            on(ownerDocument, "pointerup", _this._disableDelayedDrag);
            on(ownerDocument, "pointercancel", _this._disableDelayedDrag);
          } else {
            on(ownerDocument, "mouseup", _this._disableDelayedDrag);
            on(ownerDocument, "touchend", _this._disableDelayedDrag);
            on(ownerDocument, "touchcancel", _this._disableDelayedDrag);
          }
          on(ownerDocument, "mousemove", _this._delayedDragTouchMoveHandler);
          on(ownerDocument, "touchmove", _this._delayedDragTouchMoveHandler);
          options.supportPointer && on(ownerDocument, "pointermove", _this._delayedDragTouchMoveHandler);
          _this._dragStartTimer = setTimeout(dragStartFn, options.delay);
        } else {
          dragStartFn();
        }
      }
    },
    _delayedDragTouchMoveHandler: function _delayedDragTouchMoveHandler(e) {
      var touch = e.touches ? e.touches[0] : e;
      if (Math.max(Math.abs(touch.clientX - this._lastX), Math.abs(touch.clientY - this._lastY)) >= Math.floor(this.options.touchStartThreshold / (this.nativeDraggable && window.devicePixelRatio || 1))) {
        this._disableDelayedDrag();
      }
    },
    _disableDelayedDrag: function _disableDelayedDrag() {
      dragEl && _disableDraggable(dragEl);
      clearTimeout(this._dragStartTimer);
      this._disableDelayedDragEvents();
    },
    _disableDelayedDragEvents: function _disableDelayedDragEvents() {
      var ownerDocument = this.el.ownerDocument;
      off(ownerDocument, "mouseup", this._disableDelayedDrag);
      off(ownerDocument, "touchend", this._disableDelayedDrag);
      off(ownerDocument, "touchcancel", this._disableDelayedDrag);
      off(ownerDocument, "pointerup", this._disableDelayedDrag);
      off(ownerDocument, "pointercancel", this._disableDelayedDrag);
      off(ownerDocument, "mousemove", this._delayedDragTouchMoveHandler);
      off(ownerDocument, "touchmove", this._delayedDragTouchMoveHandler);
      off(ownerDocument, "pointermove", this._delayedDragTouchMoveHandler);
    },
    _triggerDragStart: function _triggerDragStart(evt, touch) {
      touch = touch || evt.pointerType == "touch" && evt;
      if (!this.nativeDraggable || touch) {
        if (this.options.supportPointer) {
          on(document, "pointermove", this._onTouchMove);
        } else if (touch) {
          on(document, "touchmove", this._onTouchMove);
        } else {
          on(document, "mousemove", this._onTouchMove);
        }
      } else {
        on(dragEl, "dragend", this);
        on(rootEl, "dragstart", this._onDragStart);
      }
      try {
        if (document.selection) {
          _nextTick(function() {
            document.selection.empty();
          });
        } else {
          window.getSelection().removeAllRanges();
        }
      } catch (err) {
      }
    },
    _dragStarted: function _dragStarted(fallback, evt) {
      awaitingDragStarted = false;
      if (rootEl && dragEl) {
        pluginEvent2("dragStarted", this, {
          evt
        });
        if (this.nativeDraggable) {
          on(document, "dragover", _checkOutsideTargetEl);
        }
        var options = this.options;
        !fallback && toggleClass(dragEl, options.dragClass, false);
        toggleClass(dragEl, options.ghostClass, true);
        Sortable.active = this;
        fallback && this._appendGhost();
        _dispatchEvent({
          sortable: this,
          name: "start",
          originalEvent: evt
        });
      } else {
        this._nulling();
      }
    },
    _emulateDragOver: function _emulateDragOver() {
      if (touchEvt) {
        this._lastX = touchEvt.clientX;
        this._lastY = touchEvt.clientY;
        _hideGhostForTarget();
        var target = document.elementFromPoint(touchEvt.clientX, touchEvt.clientY);
        var parent = target;
        while (target && target.shadowRoot) {
          target = target.shadowRoot.elementFromPoint(touchEvt.clientX, touchEvt.clientY);
          if (target === parent) break;
          parent = target;
        }
        dragEl.parentNode[expando]._isOutsideThisEl(target);
        if (parent) {
          do {
            if (parent[expando]) {
              var inserted = void 0;
              inserted = parent[expando]._onDragOver({
                clientX: touchEvt.clientX,
                clientY: touchEvt.clientY,
                target,
                rootEl: parent
              });
              if (inserted && !this.options.dragoverBubble) {
                break;
              }
            }
            target = parent;
          } while (parent = getParentOrHost(parent));
        }
        _unhideGhostForTarget();
      }
    },
    _onTouchMove: function _onTouchMove(evt) {
      if (tapEvt) {
        var options = this.options, fallbackTolerance = options.fallbackTolerance, fallbackOffset = options.fallbackOffset, touch = evt.touches ? evt.touches[0] : evt, ghostMatrix = ghostEl && matrix(ghostEl, true), scaleX = ghostEl && ghostMatrix && ghostMatrix.a, scaleY = ghostEl && ghostMatrix && ghostMatrix.d, relativeScrollOffset = PositionGhostAbsolutely && ghostRelativeParent && getRelativeScrollOffset(ghostRelativeParent), dx = (touch.clientX - tapEvt.clientX + fallbackOffset.x) / (scaleX || 1) + (relativeScrollOffset ? relativeScrollOffset[0] - ghostRelativeParentInitialScroll[0] : 0) / (scaleX || 1), dy = (touch.clientY - tapEvt.clientY + fallbackOffset.y) / (scaleY || 1) + (relativeScrollOffset ? relativeScrollOffset[1] - ghostRelativeParentInitialScroll[1] : 0) / (scaleY || 1);
        if (!Sortable.active && !awaitingDragStarted) {
          if (fallbackTolerance && Math.max(Math.abs(touch.clientX - this._lastX), Math.abs(touch.clientY - this._lastY)) < fallbackTolerance) {
            return;
          }
          this._onDragStart(evt, true);
        }
        if (ghostEl) {
          if (ghostMatrix) {
            ghostMatrix.e += dx - (lastDx || 0);
            ghostMatrix.f += dy - (lastDy || 0);
          } else {
            ghostMatrix = {
              a: 1,
              b: 0,
              c: 0,
              d: 1,
              e: dx,
              f: dy
            };
          }
          var cssMatrix = "matrix(".concat(ghostMatrix.a, ",").concat(ghostMatrix.b, ",").concat(ghostMatrix.c, ",").concat(ghostMatrix.d, ",").concat(ghostMatrix.e, ",").concat(ghostMatrix.f, ")");
          css(ghostEl, "webkitTransform", cssMatrix);
          css(ghostEl, "mozTransform", cssMatrix);
          css(ghostEl, "msTransform", cssMatrix);
          css(ghostEl, "transform", cssMatrix);
          lastDx = dx;
          lastDy = dy;
          touchEvt = touch;
        }
        evt.cancelable && evt.preventDefault();
      }
    },
    _appendGhost: function _appendGhost() {
      if (!ghostEl) {
        var container = this.options.fallbackOnBody ? document.body : rootEl, rect = getRect(dragEl, true, PositionGhostAbsolutely, true, container), options = this.options;
        if (PositionGhostAbsolutely) {
          ghostRelativeParent = container;
          while (css(ghostRelativeParent, "position") === "static" && css(ghostRelativeParent, "transform") === "none" && ghostRelativeParent !== document) {
            ghostRelativeParent = ghostRelativeParent.parentNode;
          }
          if (ghostRelativeParent !== document.body && ghostRelativeParent !== document.documentElement) {
            if (ghostRelativeParent === document) ghostRelativeParent = getWindowScrollingElement();
            rect.top += ghostRelativeParent.scrollTop;
            rect.left += ghostRelativeParent.scrollLeft;
          } else {
            ghostRelativeParent = getWindowScrollingElement();
          }
          ghostRelativeParentInitialScroll = getRelativeScrollOffset(ghostRelativeParent);
        }
        ghostEl = dragEl.cloneNode(true);
        toggleClass(ghostEl, options.ghostClass, false);
        toggleClass(ghostEl, options.fallbackClass, true);
        toggleClass(ghostEl, options.dragClass, true);
        css(ghostEl, "transition", "");
        css(ghostEl, "transform", "");
        css(ghostEl, "box-sizing", "border-box");
        css(ghostEl, "margin", 0);
        css(ghostEl, "top", rect.top);
        css(ghostEl, "left", rect.left);
        css(ghostEl, "width", rect.width);
        css(ghostEl, "height", rect.height);
        css(ghostEl, "opacity", "0.8");
        css(ghostEl, "position", PositionGhostAbsolutely ? "absolute" : "fixed");
        css(ghostEl, "zIndex", "100000");
        css(ghostEl, "pointerEvents", "none");
        Sortable.ghost = ghostEl;
        container.appendChild(ghostEl);
        css(ghostEl, "transform-origin", tapDistanceLeft / parseInt(ghostEl.style.width) * 100 + "% " + tapDistanceTop / parseInt(ghostEl.style.height) * 100 + "%");
      }
    },
    _onDragStart: function _onDragStart(evt, fallback) {
      var _this = this;
      var dataTransfer = evt.dataTransfer;
      var options = _this.options;
      pluginEvent2("dragStart", this, {
        evt
      });
      if (Sortable.eventCanceled) {
        this._onDrop();
        return;
      }
      pluginEvent2("setupClone", this);
      if (!Sortable.eventCanceled) {
        cloneEl = clone(dragEl);
        cloneEl.removeAttribute("id");
        cloneEl.draggable = false;
        cloneEl.style["will-change"] = "";
        this._hideClone();
        toggleClass(cloneEl, this.options.chosenClass, false);
        Sortable.clone = cloneEl;
      }
      _this.cloneId = _nextTick(function() {
        pluginEvent2("clone", _this);
        if (Sortable.eventCanceled) return;
        if (!_this.options.removeCloneOnHide) {
          rootEl.insertBefore(cloneEl, dragEl);
        }
        _this._hideClone();
        _dispatchEvent({
          sortable: _this,
          name: "clone"
        });
      });
      !fallback && toggleClass(dragEl, options.dragClass, true);
      if (fallback) {
        ignoreNextClick = true;
        _this._loopId = setInterval(_this._emulateDragOver, 50);
      } else {
        off(document, "mouseup", _this._onDrop);
        off(document, "touchend", _this._onDrop);
        off(document, "touchcancel", _this._onDrop);
        if (dataTransfer) {
          dataTransfer.effectAllowed = "move";
          options.setData && options.setData.call(_this, dataTransfer, dragEl);
        }
        on(document, "drop", _this);
        css(dragEl, "transform", "translateZ(0)");
      }
      awaitingDragStarted = true;
      _this._dragStartId = _nextTick(_this._dragStarted.bind(_this, fallback, evt));
      on(document, "selectstart", _this);
      moved = true;
      window.getSelection().removeAllRanges();
      if (Safari) {
        css(document.body, "user-select", "none");
      }
    },
    // Returns true - if no further action is needed (either inserted or another condition)
    _onDragOver: function _onDragOver(evt) {
      var el = this.el, target = evt.target, dragRect, targetRect, revert, options = this.options, group = options.group, activeSortable = Sortable.active, isOwner = activeGroup === group, canSort = options.sort, fromSortable = putSortable || activeSortable, vertical, _this = this, completedFired = false;
      if (_silent) return;
      function dragOverEvent(name, extra) {
        pluginEvent2(name, _this, _objectSpread2({
          evt,
          isOwner,
          axis: vertical ? "vertical" : "horizontal",
          revert,
          dragRect,
          targetRect,
          canSort,
          fromSortable,
          target,
          completed,
          onMove: function onMove(target2, after2) {
            return _onMove(rootEl, el, dragEl, dragRect, target2, getRect(target2), evt, after2);
          },
          changed
        }, extra));
      }
      function capture() {
        dragOverEvent("dragOverAnimationCapture");
        _this.captureAnimationState();
        if (_this !== fromSortable) {
          fromSortable.captureAnimationState();
        }
      }
      function completed(insertion) {
        dragOverEvent("dragOverCompleted", {
          insertion
        });
        if (insertion) {
          if (isOwner) {
            activeSortable._hideClone();
          } else {
            activeSortable._showClone(_this);
          }
          if (_this !== fromSortable) {
            toggleClass(dragEl, putSortable ? putSortable.options.ghostClass : activeSortable.options.ghostClass, false);
            toggleClass(dragEl, options.ghostClass, true);
          }
          if (putSortable !== _this && _this !== Sortable.active) {
            putSortable = _this;
          } else if (_this === Sortable.active && putSortable) {
            putSortable = null;
          }
          if (fromSortable === _this) {
            _this._ignoreWhileAnimating = target;
          }
          _this.animateAll(function() {
            dragOverEvent("dragOverAnimationComplete");
            _this._ignoreWhileAnimating = null;
          });
          if (_this !== fromSortable) {
            fromSortable.animateAll();
            fromSortable._ignoreWhileAnimating = null;
          }
        }
        if (target === dragEl && !dragEl.animated || target === el && !target.animated) {
          lastTarget = null;
        }
        if (!options.dragoverBubble && !evt.rootEl && target !== document) {
          dragEl.parentNode[expando]._isOutsideThisEl(evt.target);
          !insertion && nearestEmptyInsertDetectEvent(evt);
        }
        !options.dragoverBubble && evt.stopPropagation && evt.stopPropagation();
        return completedFired = true;
      }
      function changed() {
        newIndex = index(dragEl);
        newDraggableIndex = index(dragEl, options.draggable);
        _dispatchEvent({
          sortable: _this,
          name: "change",
          toEl: el,
          newIndex,
          newDraggableIndex,
          originalEvent: evt
        });
      }
      if (evt.preventDefault !== void 0) {
        evt.cancelable && evt.preventDefault();
      }
      target = closest(target, options.draggable, el, true);
      dragOverEvent("dragOver");
      if (Sortable.eventCanceled) return completedFired;
      if (dragEl.contains(evt.target) || target.animated && target.animatingX && target.animatingY || _this._ignoreWhileAnimating === target) {
        return completed(false);
      }
      ignoreNextClick = false;
      if (activeSortable && !options.disabled && (isOwner ? canSort || (revert = parentEl !== rootEl) : putSortable === this || (this.lastPutMode = activeGroup.checkPull(this, activeSortable, dragEl, evt)) && group.checkPut(this, activeSortable, dragEl, evt))) {
        vertical = this._getDirection(evt, target) === "vertical";
        dragRect = getRect(dragEl);
        dragOverEvent("dragOverValid");
        if (Sortable.eventCanceled) return completedFired;
        if (revert) {
          parentEl = rootEl;
          capture();
          this._hideClone();
          dragOverEvent("revert");
          if (!Sortable.eventCanceled) {
            if (nextEl) {
              rootEl.insertBefore(dragEl, nextEl);
            } else {
              rootEl.appendChild(dragEl);
            }
          }
          return completed(true);
        }
        var elLastChild = lastChild(el, options.draggable);
        if (!elLastChild || _ghostIsLast(evt, vertical, this) && !elLastChild.animated) {
          if (elLastChild === dragEl) {
            return completed(false);
          }
          if (elLastChild && el === evt.target) {
            target = elLastChild;
          }
          if (target) {
            targetRect = getRect(target);
          }
          if (_onMove(rootEl, el, dragEl, dragRect, target, targetRect, evt, !!target) !== false) {
            capture();
            if (elLastChild && elLastChild.nextSibling) {
              el.insertBefore(dragEl, elLastChild.nextSibling);
            } else {
              el.appendChild(dragEl);
            }
            parentEl = el;
            changed();
            return completed(true);
          }
        } else if (elLastChild && _ghostIsFirst(evt, vertical, this)) {
          var firstChild = getChild(el, 0, options, true);
          if (firstChild === dragEl) {
            return completed(false);
          }
          target = firstChild;
          targetRect = getRect(target);
          if (_onMove(rootEl, el, dragEl, dragRect, target, targetRect, evt, false) !== false) {
            capture();
            el.insertBefore(dragEl, firstChild);
            parentEl = el;
            changed();
            return completed(true);
          }
        } else if (target.parentNode === el) {
          targetRect = getRect(target);
          var direction = 0, targetBeforeFirstSwap, differentLevel = dragEl.parentNode !== el, differentRowCol = !_dragElInRowColumn(dragEl.animated && dragEl.toRect || dragRect, target.animated && target.toRect || targetRect, vertical), side1 = vertical ? "top" : "left", scrolledPastTop = isScrolledPast(target, "top", "top") || isScrolledPast(dragEl, "top", "top"), scrollBefore = scrolledPastTop ? scrolledPastTop.scrollTop : void 0;
          if (lastTarget !== target) {
            targetBeforeFirstSwap = targetRect[side1];
            pastFirstInvertThresh = false;
            isCircumstantialInvert = !differentRowCol && options.invertSwap || differentLevel;
          }
          direction = _getSwapDirection(evt, target, targetRect, vertical, differentRowCol ? 1 : options.swapThreshold, options.invertedSwapThreshold == null ? options.swapThreshold : options.invertedSwapThreshold, isCircumstantialInvert, lastTarget === target);
          var sibling;
          if (direction !== 0) {
            var dragIndex = index(dragEl);
            do {
              dragIndex -= direction;
              sibling = parentEl.children[dragIndex];
            } while (sibling && (css(sibling, "display") === "none" || sibling === ghostEl));
          }
          if (direction === 0 || sibling === target) {
            return completed(false);
          }
          lastTarget = target;
          lastDirection = direction;
          var nextSibling = target.nextElementSibling, after = false;
          after = direction === 1;
          var moveVector = _onMove(rootEl, el, dragEl, dragRect, target, targetRect, evt, after);
          if (moveVector !== false) {
            if (moveVector === 1 || moveVector === -1) {
              after = moveVector === 1;
            }
            _silent = true;
            setTimeout(_unsilent, 30);
            capture();
            if (after && !nextSibling) {
              el.appendChild(dragEl);
            } else {
              target.parentNode.insertBefore(dragEl, after ? nextSibling : target);
            }
            if (scrolledPastTop) {
              scrollBy(scrolledPastTop, 0, scrollBefore - scrolledPastTop.scrollTop);
            }
            parentEl = dragEl.parentNode;
            if (targetBeforeFirstSwap !== void 0 && !isCircumstantialInvert) {
              targetMoveDistance = Math.abs(targetBeforeFirstSwap - getRect(target)[side1]);
            }
            changed();
            return completed(true);
          }
        }
        if (el.contains(dragEl)) {
          return completed(false);
        }
      }
      return false;
    },
    _ignoreWhileAnimating: null,
    _offMoveEvents: function _offMoveEvents() {
      off(document, "mousemove", this._onTouchMove);
      off(document, "touchmove", this._onTouchMove);
      off(document, "pointermove", this._onTouchMove);
      off(document, "dragover", nearestEmptyInsertDetectEvent);
      off(document, "mousemove", nearestEmptyInsertDetectEvent);
      off(document, "touchmove", nearestEmptyInsertDetectEvent);
    },
    _offUpEvents: function _offUpEvents() {
      var ownerDocument = this.el.ownerDocument;
      off(ownerDocument, "mouseup", this._onDrop);
      off(ownerDocument, "touchend", this._onDrop);
      off(ownerDocument, "pointerup", this._onDrop);
      off(ownerDocument, "pointercancel", this._onDrop);
      off(ownerDocument, "touchcancel", this._onDrop);
      off(document, "selectstart", this);
    },
    _onDrop: function _onDrop(evt) {
      var el = this.el, options = this.options;
      newIndex = index(dragEl);
      newDraggableIndex = index(dragEl, options.draggable);
      pluginEvent2("drop", this, {
        evt
      });
      parentEl = dragEl && dragEl.parentNode;
      newIndex = index(dragEl);
      newDraggableIndex = index(dragEl, options.draggable);
      if (Sortable.eventCanceled) {
        this._nulling();
        return;
      }
      awaitingDragStarted = false;
      isCircumstantialInvert = false;
      pastFirstInvertThresh = false;
      clearInterval(this._loopId);
      clearTimeout(this._dragStartTimer);
      _cancelNextTick(this.cloneId);
      _cancelNextTick(this._dragStartId);
      if (this.nativeDraggable) {
        off(document, "drop", this);
        off(el, "dragstart", this._onDragStart);
      }
      this._offMoveEvents();
      this._offUpEvents();
      if (Safari) {
        css(document.body, "user-select", "");
      }
      css(dragEl, "transform", "");
      if (evt) {
        if (moved) {
          evt.cancelable && evt.preventDefault();
          !options.dropBubble && evt.stopPropagation();
        }
        ghostEl && ghostEl.parentNode && ghostEl.parentNode.removeChild(ghostEl);
        if (rootEl === parentEl || putSortable && putSortable.lastPutMode !== "clone") {
          cloneEl && cloneEl.parentNode && cloneEl.parentNode.removeChild(cloneEl);
        }
        if (dragEl) {
          if (this.nativeDraggable) {
            off(dragEl, "dragend", this);
          }
          _disableDraggable(dragEl);
          dragEl.style["will-change"] = "";
          if (moved && !awaitingDragStarted) {
            toggleClass(dragEl, putSortable ? putSortable.options.ghostClass : this.options.ghostClass, false);
          }
          toggleClass(dragEl, this.options.chosenClass, false);
          _dispatchEvent({
            sortable: this,
            name: "unchoose",
            toEl: parentEl,
            newIndex: null,
            newDraggableIndex: null,
            originalEvent: evt
          });
          if (rootEl !== parentEl) {
            if (newIndex >= 0) {
              _dispatchEvent({
                rootEl: parentEl,
                name: "add",
                toEl: parentEl,
                fromEl: rootEl,
                originalEvent: evt
              });
              _dispatchEvent({
                sortable: this,
                name: "remove",
                toEl: parentEl,
                originalEvent: evt
              });
              _dispatchEvent({
                rootEl: parentEl,
                name: "sort",
                toEl: parentEl,
                fromEl: rootEl,
                originalEvent: evt
              });
              _dispatchEvent({
                sortable: this,
                name: "sort",
                toEl: parentEl,
                originalEvent: evt
              });
            }
            putSortable && putSortable.save();
          } else {
            if (newIndex !== oldIndex) {
              if (newIndex >= 0) {
                _dispatchEvent({
                  sortable: this,
                  name: "update",
                  toEl: parentEl,
                  originalEvent: evt
                });
                _dispatchEvent({
                  sortable: this,
                  name: "sort",
                  toEl: parentEl,
                  originalEvent: evt
                });
              }
            }
          }
          if (Sortable.active) {
            if (newIndex == null || newIndex === -1) {
              newIndex = oldIndex;
              newDraggableIndex = oldDraggableIndex;
            }
            _dispatchEvent({
              sortable: this,
              name: "end",
              toEl: parentEl,
              originalEvent: evt
            });
            this.save();
          }
        }
      }
      this._nulling();
    },
    _nulling: function _nulling() {
      pluginEvent2("nulling", this);
      rootEl = dragEl = parentEl = ghostEl = nextEl = cloneEl = lastDownEl = cloneHidden = tapEvt = touchEvt = moved = newIndex = newDraggableIndex = oldIndex = oldDraggableIndex = lastTarget = lastDirection = putSortable = activeGroup = Sortable.dragged = Sortable.ghost = Sortable.clone = Sortable.active = null;
      savedInputChecked.forEach(function(el) {
        el.checked = true;
      });
      savedInputChecked.length = lastDx = lastDy = 0;
    },
    handleEvent: function handleEvent(evt) {
      switch (evt.type) {
        case "drop":
        case "dragend":
          this._onDrop(evt);
          break;
        case "dragenter":
        case "dragover":
          if (dragEl) {
            this._onDragOver(evt);
            _globalDragOver(evt);
          }
          break;
        case "selectstart":
          evt.preventDefault();
          break;
      }
    },
    /**
     * Serializes the item into an array of string.
     * @returns {String[]}
     */
    toArray: function toArray() {
      var order = [], el, children = this.el.children, i = 0, n = children.length, options = this.options;
      for (; i < n; i++) {
        el = children[i];
        if (closest(el, options.draggable, this.el, false)) {
          order.push(el.getAttribute(options.dataIdAttr) || _generateId(el));
        }
      }
      return order;
    },
    /**
     * Sorts the elements according to the array.
     * @param  {String[]}  order  order of the items
     */
    sort: function sort(order, useAnimation) {
      var items = {}, rootEl2 = this.el;
      this.toArray().forEach(function(id, i) {
        var el = rootEl2.children[i];
        if (closest(el, this.options.draggable, rootEl2, false)) {
          items[id] = el;
        }
      }, this);
      useAnimation && this.captureAnimationState();
      order.forEach(function(id) {
        if (items[id]) {
          rootEl2.removeChild(items[id]);
          rootEl2.appendChild(items[id]);
        }
      });
      useAnimation && this.animateAll();
    },
    /**
     * Save the current sorting
     */
    save: function save() {
      var store = this.options.store;
      store && store.set && store.set(this);
    },
    /**
     * For each element in the set, get the first element that matches the selector by testing the element itself and traversing up through its ancestors in the DOM tree.
     * @param   {HTMLElement}  el
     * @param   {String}       [selector]  default: `options.draggable`
     * @returns {HTMLElement|null}
     */
    closest: function closest$1(el, selector) {
      return closest(el, selector || this.options.draggable, this.el, false);
    },
    /**
     * Set/get option
     * @param   {string} name
     * @param   {*}      [value]
     * @returns {*}
     */
    option: function option(name, value) {
      var options = this.options;
      if (value === void 0) {
        return options[name];
      } else {
        var modifiedValue = PluginManager.modifyOption(this, name, value);
        if (typeof modifiedValue !== "undefined") {
          options[name] = modifiedValue;
        } else {
          options[name] = value;
        }
        if (name === "group") {
          _prepareGroup(options);
        }
      }
    },
    /**
     * Destroy
     */
    destroy: function destroy() {
      pluginEvent2("destroy", this);
      var el = this.el;
      el[expando] = null;
      off(el, "mousedown", this._onTapStart);
      off(el, "touchstart", this._onTapStart);
      off(el, "pointerdown", this._onTapStart);
      if (this.nativeDraggable) {
        off(el, "dragover", this);
        off(el, "dragenter", this);
      }
      Array.prototype.forEach.call(el.querySelectorAll("[draggable]"), function(el2) {
        el2.removeAttribute("draggable");
      });
      this._onDrop();
      this._disableDelayedDragEvents();
      sortables.splice(sortables.indexOf(this.el), 1);
      this.el = el = null;
    },
    _hideClone: function _hideClone() {
      if (!cloneHidden) {
        pluginEvent2("hideClone", this);
        if (Sortable.eventCanceled) return;
        css(cloneEl, "display", "none");
        if (this.options.removeCloneOnHide && cloneEl.parentNode) {
          cloneEl.parentNode.removeChild(cloneEl);
        }
        cloneHidden = true;
      }
    },
    _showClone: function _showClone(putSortable2) {
      if (putSortable2.lastPutMode !== "clone") {
        this._hideClone();
        return;
      }
      if (cloneHidden) {
        pluginEvent2("showClone", this);
        if (Sortable.eventCanceled) return;
        if (dragEl.parentNode == rootEl && !this.options.group.revertClone) {
          rootEl.insertBefore(cloneEl, dragEl);
        } else if (nextEl) {
          rootEl.insertBefore(cloneEl, nextEl);
        } else {
          rootEl.appendChild(cloneEl);
        }
        if (this.options.group.revertClone) {
          this.animate(dragEl, cloneEl);
        }
        css(cloneEl, "display", "");
        cloneHidden = false;
      }
    }
  };
  function _globalDragOver(evt) {
    if (evt.dataTransfer) {
      evt.dataTransfer.dropEffect = "move";
    }
    evt.cancelable && evt.preventDefault();
  }
  function _onMove(fromEl, toEl, dragEl2, dragRect, targetEl, targetRect, originalEvent, willInsertAfter) {
    var evt, sortable = fromEl[expando], onMoveFn = sortable.options.onMove, retVal;
    if (window.CustomEvent && !IE11OrLess && !Edge) {
      evt = new CustomEvent("move", {
        bubbles: true,
        cancelable: true
      });
    } else {
      evt = document.createEvent("Event");
      evt.initEvent("move", true, true);
    }
    evt.to = toEl;
    evt.from = fromEl;
    evt.dragged = dragEl2;
    evt.draggedRect = dragRect;
    evt.related = targetEl || toEl;
    evt.relatedRect = targetRect || getRect(toEl);
    evt.willInsertAfter = willInsertAfter;
    evt.originalEvent = originalEvent;
    fromEl.dispatchEvent(evt);
    if (onMoveFn) {
      retVal = onMoveFn.call(sortable, evt, originalEvent);
    }
    return retVal;
  }
  function _disableDraggable(el) {
    el.draggable = false;
  }
  function _unsilent() {
    _silent = false;
  }
  function _ghostIsFirst(evt, vertical, sortable) {
    var firstElRect = getRect(getChild(sortable.el, 0, sortable.options, true));
    var childContainingRect = getChildContainingRectFromElement(sortable.el, sortable.options, ghostEl);
    var spacer = 10;
    return vertical ? evt.clientX < childContainingRect.left - spacer || evt.clientY < firstElRect.top && evt.clientX < firstElRect.right : evt.clientY < childContainingRect.top - spacer || evt.clientY < firstElRect.bottom && evt.clientX < firstElRect.left;
  }
  function _ghostIsLast(evt, vertical, sortable) {
    var lastElRect = getRect(lastChild(sortable.el, sortable.options.draggable));
    var childContainingRect = getChildContainingRectFromElement(sortable.el, sortable.options, ghostEl);
    var spacer = 10;
    return vertical ? evt.clientX > childContainingRect.right + spacer || evt.clientY > lastElRect.bottom && evt.clientX > lastElRect.left : evt.clientY > childContainingRect.bottom + spacer || evt.clientX > lastElRect.right && evt.clientY > lastElRect.top;
  }
  function _getSwapDirection(evt, target, targetRect, vertical, swapThreshold, invertedSwapThreshold, invertSwap, isLastTarget) {
    var mouseOnAxis = vertical ? evt.clientY : evt.clientX, targetLength = vertical ? targetRect.height : targetRect.width, targetS1 = vertical ? targetRect.top : targetRect.left, targetS2 = vertical ? targetRect.bottom : targetRect.right, invert = false;
    if (!invertSwap) {
      if (isLastTarget && targetMoveDistance < targetLength * swapThreshold) {
        if (!pastFirstInvertThresh && (lastDirection === 1 ? mouseOnAxis > targetS1 + targetLength * invertedSwapThreshold / 2 : mouseOnAxis < targetS2 - targetLength * invertedSwapThreshold / 2)) {
          pastFirstInvertThresh = true;
        }
        if (!pastFirstInvertThresh) {
          if (lastDirection === 1 ? mouseOnAxis < targetS1 + targetMoveDistance : mouseOnAxis > targetS2 - targetMoveDistance) {
            return -lastDirection;
          }
        } else {
          invert = true;
        }
      } else {
        if (mouseOnAxis > targetS1 + targetLength * (1 - swapThreshold) / 2 && mouseOnAxis < targetS2 - targetLength * (1 - swapThreshold) / 2) {
          return _getInsertDirection(target);
        }
      }
    }
    invert = invert || invertSwap;
    if (invert) {
      if (mouseOnAxis < targetS1 + targetLength * invertedSwapThreshold / 2 || mouseOnAxis > targetS2 - targetLength * invertedSwapThreshold / 2) {
        return mouseOnAxis > targetS1 + targetLength / 2 ? 1 : -1;
      }
    }
    return 0;
  }
  function _getInsertDirection(target) {
    if (index(dragEl) < index(target)) {
      return 1;
    } else {
      return -1;
    }
  }
  function _generateId(el) {
    var str = el.tagName + el.className + el.src + el.href + el.textContent, i = str.length, sum = 0;
    while (i--) {
      sum += str.charCodeAt(i);
    }
    return sum.toString(36);
  }
  function _saveInputCheckedState(root) {
    savedInputChecked.length = 0;
    var inputs = root.getElementsByTagName("input");
    var idx = inputs.length;
    while (idx--) {
      var el = inputs[idx];
      el.checked && savedInputChecked.push(el);
    }
  }
  function _nextTick(fn) {
    return setTimeout(fn, 0);
  }
  function _cancelNextTick(id) {
    return clearTimeout(id);
  }
  if (documentExists) {
    on(document, "touchmove", function(evt) {
      if ((Sortable.active || awaitingDragStarted) && evt.cancelable) {
        evt.preventDefault();
      }
    });
  }
  Sortable.utils = {
    on,
    off,
    css,
    find,
    is: function is(el, selector) {
      return !!closest(el, selector, el, false);
    },
    extend,
    throttle,
    closest,
    toggleClass,
    clone,
    index,
    nextTick: _nextTick,
    cancelNextTick: _cancelNextTick,
    detectDirection: _detectDirection,
    getChild,
    expando
  };
  Sortable.get = function(element) {
    return element[expando];
  };
  Sortable.mount = function() {
    for (var _len = arguments.length, plugins2 = new Array(_len), _key = 0; _key < _len; _key++) {
      plugins2[_key] = arguments[_key];
    }
    if (plugins2[0].constructor === Array) plugins2 = plugins2[0];
    plugins2.forEach(function(plugin) {
      if (!plugin.prototype || !plugin.prototype.constructor) {
        throw "Sortable: Mounted plugin must be a constructor function, not ".concat({}.toString.call(plugin));
      }
      if (plugin.utils) Sortable.utils = _objectSpread2(_objectSpread2({}, Sortable.utils), plugin.utils);
      PluginManager.mount(plugin);
    });
  };
  Sortable.create = function(el, options) {
    return new Sortable(el, options);
  };
  Sortable.version = version;
  var autoScrolls = [];
  var scrollEl;
  var scrollRootEl;
  var scrolling = false;
  var lastAutoScrollX;
  var lastAutoScrollY;
  var touchEvt$1;
  var pointerElemChangedInterval;
  function AutoScrollPlugin() {
    function AutoScroll() {
      this.defaults = {
        scroll: true,
        forceAutoScrollFallback: false,
        scrollSensitivity: 30,
        scrollSpeed: 10,
        bubbleScroll: true
      };
      for (var fn in this) {
        if (fn.charAt(0) === "_" && typeof this[fn] === "function") {
          this[fn] = this[fn].bind(this);
        }
      }
    }
    AutoScroll.prototype = {
      dragStarted: function dragStarted(_ref) {
        var originalEvent = _ref.originalEvent;
        if (this.sortable.nativeDraggable) {
          on(document, "dragover", this._handleAutoScroll);
        } else {
          if (this.options.supportPointer) {
            on(document, "pointermove", this._handleFallbackAutoScroll);
          } else if (originalEvent.touches) {
            on(document, "touchmove", this._handleFallbackAutoScroll);
          } else {
            on(document, "mousemove", this._handleFallbackAutoScroll);
          }
        }
      },
      dragOverCompleted: function dragOverCompleted(_ref2) {
        var originalEvent = _ref2.originalEvent;
        if (!this.options.dragOverBubble && !originalEvent.rootEl) {
          this._handleAutoScroll(originalEvent);
        }
      },
      drop: function drop3() {
        if (this.sortable.nativeDraggable) {
          off(document, "dragover", this._handleAutoScroll);
        } else {
          off(document, "pointermove", this._handleFallbackAutoScroll);
          off(document, "touchmove", this._handleFallbackAutoScroll);
          off(document, "mousemove", this._handleFallbackAutoScroll);
        }
        clearPointerElemChangedInterval();
        clearAutoScrolls();
        cancelThrottle();
      },
      nulling: function nulling() {
        touchEvt$1 = scrollRootEl = scrollEl = scrolling = pointerElemChangedInterval = lastAutoScrollX = lastAutoScrollY = null;
        autoScrolls.length = 0;
      },
      _handleFallbackAutoScroll: function _handleFallbackAutoScroll(evt) {
        this._handleAutoScroll(evt, true);
      },
      _handleAutoScroll: function _handleAutoScroll(evt, fallback) {
        var _this = this;
        var x = (evt.touches ? evt.touches[0] : evt).clientX, y = (evt.touches ? evt.touches[0] : evt).clientY, elem = document.elementFromPoint(x, y);
        touchEvt$1 = evt;
        if (fallback || this.options.forceAutoScrollFallback || Edge || IE11OrLess || Safari) {
          autoScroll(evt, this.options, elem, fallback);
          var ogElemScroller = getParentAutoScrollElement(elem, true);
          if (scrolling && (!pointerElemChangedInterval || x !== lastAutoScrollX || y !== lastAutoScrollY)) {
            pointerElemChangedInterval && clearPointerElemChangedInterval();
            pointerElemChangedInterval = setInterval(function() {
              var newElem = getParentAutoScrollElement(document.elementFromPoint(x, y), true);
              if (newElem !== ogElemScroller) {
                ogElemScroller = newElem;
                clearAutoScrolls();
              }
              autoScroll(evt, _this.options, newElem, fallback);
            }, 10);
            lastAutoScrollX = x;
            lastAutoScrollY = y;
          }
        } else {
          if (!this.options.bubbleScroll || getParentAutoScrollElement(elem, true) === getWindowScrollingElement()) {
            clearAutoScrolls();
            return;
          }
          autoScroll(evt, this.options, getParentAutoScrollElement(elem, false), false);
        }
      }
    };
    return _extends(AutoScroll, {
      pluginName: "scroll",
      initializeByDefault: true
    });
  }
  function clearAutoScrolls() {
    autoScrolls.forEach(function(autoScroll2) {
      clearInterval(autoScroll2.pid);
    });
    autoScrolls = [];
  }
  function clearPointerElemChangedInterval() {
    clearInterval(pointerElemChangedInterval);
  }
  var autoScroll = throttle(function(evt, options, rootEl2, isFallback) {
    if (!options.scroll) return;
    var x = (evt.touches ? evt.touches[0] : evt).clientX, y = (evt.touches ? evt.touches[0] : evt).clientY, sens = options.scrollSensitivity, speed = options.scrollSpeed, winScroller = getWindowScrollingElement();
    var scrollThisInstance = false, scrollCustomFn;
    if (scrollRootEl !== rootEl2) {
      scrollRootEl = rootEl2;
      clearAutoScrolls();
      scrollEl = options.scroll;
      scrollCustomFn = options.scrollFn;
      if (scrollEl === true) {
        scrollEl = getParentAutoScrollElement(rootEl2, true);
      }
    }
    var layersOut = 0;
    var currentParent = scrollEl;
    do {
      var el = currentParent, rect = getRect(el), top = rect.top, bottom = rect.bottom, left = rect.left, right = rect.right, width = rect.width, height = rect.height, canScrollX = void 0, canScrollY = void 0, scrollWidth = el.scrollWidth, scrollHeight = el.scrollHeight, elCSS = css(el), scrollPosX = el.scrollLeft, scrollPosY = el.scrollTop;
      if (el === winScroller) {
        canScrollX = width < scrollWidth && (elCSS.overflowX === "auto" || elCSS.overflowX === "scroll" || elCSS.overflowX === "visible");
        canScrollY = height < scrollHeight && (elCSS.overflowY === "auto" || elCSS.overflowY === "scroll" || elCSS.overflowY === "visible");
      } else {
        canScrollX = width < scrollWidth && (elCSS.overflowX === "auto" || elCSS.overflowX === "scroll");
        canScrollY = height < scrollHeight && (elCSS.overflowY === "auto" || elCSS.overflowY === "scroll");
      }
      var vx = canScrollX && (Math.abs(right - x) <= sens && scrollPosX + width < scrollWidth) - (Math.abs(left - x) <= sens && !!scrollPosX);
      var vy = canScrollY && (Math.abs(bottom - y) <= sens && scrollPosY + height < scrollHeight) - (Math.abs(top - y) <= sens && !!scrollPosY);
      if (!autoScrolls[layersOut]) {
        for (var i = 0; i <= layersOut; i++) {
          if (!autoScrolls[i]) {
            autoScrolls[i] = {};
          }
        }
      }
      if (autoScrolls[layersOut].vx != vx || autoScrolls[layersOut].vy != vy || autoScrolls[layersOut].el !== el) {
        autoScrolls[layersOut].el = el;
        autoScrolls[layersOut].vx = vx;
        autoScrolls[layersOut].vy = vy;
        clearInterval(autoScrolls[layersOut].pid);
        if (vx != 0 || vy != 0) {
          scrollThisInstance = true;
          autoScrolls[layersOut].pid = setInterval(function() {
            if (isFallback && this.layer === 0) {
              Sortable.active._onTouchMove(touchEvt$1);
            }
            var scrollOffsetY = autoScrolls[this.layer].vy ? autoScrolls[this.layer].vy * speed : 0;
            var scrollOffsetX = autoScrolls[this.layer].vx ? autoScrolls[this.layer].vx * speed : 0;
            if (typeof scrollCustomFn === "function") {
              if (scrollCustomFn.call(Sortable.dragged.parentNode[expando], scrollOffsetX, scrollOffsetY, evt, touchEvt$1, autoScrolls[this.layer].el) !== "continue") {
                return;
              }
            }
            scrollBy(autoScrolls[this.layer].el, scrollOffsetX, scrollOffsetY);
          }.bind({
            layer: layersOut
          }), 24);
        }
      }
      layersOut++;
    } while (options.bubbleScroll && currentParent !== winScroller && (currentParent = getParentAutoScrollElement(currentParent, false)));
    scrolling = scrollThisInstance;
  }, 30);
  var drop = function drop2(_ref) {
    var originalEvent = _ref.originalEvent, putSortable2 = _ref.putSortable, dragEl2 = _ref.dragEl, activeSortable = _ref.activeSortable, dispatchSortableEvent = _ref.dispatchSortableEvent, hideGhostForTarget = _ref.hideGhostForTarget, unhideGhostForTarget = _ref.unhideGhostForTarget;
    if (!originalEvent) return;
    var toSortable = putSortable2 || activeSortable;
    hideGhostForTarget();
    var touch = originalEvent.changedTouches && originalEvent.changedTouches.length ? originalEvent.changedTouches[0] : originalEvent;
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    unhideGhostForTarget();
    if (toSortable && !toSortable.el.contains(target)) {
      dispatchSortableEvent("spill");
      this.onSpill({
        dragEl: dragEl2,
        putSortable: putSortable2
      });
    }
  };
  function Revert() {
  }
  Revert.prototype = {
    startIndex: null,
    dragStart: function dragStart(_ref2) {
      var oldDraggableIndex2 = _ref2.oldDraggableIndex;
      this.startIndex = oldDraggableIndex2;
    },
    onSpill: function onSpill(_ref3) {
      var dragEl2 = _ref3.dragEl, putSortable2 = _ref3.putSortable;
      this.sortable.captureAnimationState();
      if (putSortable2) {
        putSortable2.captureAnimationState();
      }
      var nextSibling = getChild(this.sortable.el, this.startIndex, this.options);
      if (nextSibling) {
        this.sortable.el.insertBefore(dragEl2, nextSibling);
      } else {
        this.sortable.el.appendChild(dragEl2);
      }
      this.sortable.animateAll();
      if (putSortable2) {
        putSortable2.animateAll();
      }
    },
    drop
  };
  _extends(Revert, {
    pluginName: "revertOnSpill"
  });
  function Remove() {
  }
  Remove.prototype = {
    onSpill: function onSpill2(_ref4) {
      var dragEl2 = _ref4.dragEl, putSortable2 = _ref4.putSortable;
      var parentSortable = putSortable2 || this.sortable;
      parentSortable.captureAnimationState();
      dragEl2.parentNode && dragEl2.parentNode.removeChild(dragEl2);
      parentSortable.animateAll();
    },
    drop
  };
  _extends(Remove, {
    pluginName: "removeOnSpill"
  });
  Sortable.mount(new AutoScrollPlugin());
  Sortable.mount(Remove, Revert);
  var sortable_esm_default = Sortable;

  // inline-css:./panel.css
  var panel_default = '/* Modal adapted from GPT Conversation Toolkit. Copyright (c) 2026 bujue3709.\n * MIT; see THIRD_PARTY_NOTICES.md. Compact copy-only UI is a Yada adapter. */\n:host { font:13px/1.5 system-ui; color-scheme:light; }\n:host([hidden]), [hidden] { display:none !important; }\n* { box-sizing:border-box; }\n.yada-prompt-modal { position:fixed; inset:0; z-index:2147483647; --bg:#fff; --text:#303030; --muted:#666; --border:#8884; --hover:#8881; color:var(--text); overscroll-behavior:contain; }\n.yada-prompt-modal[data-toolkit-theme="dark"] { --bg:#272727; --text:#eee; --muted:#bbb; --hover:#fff1; color-scheme:dark; }\n.yada-prompt-backdrop { position:absolute; inset:0; background:#0006; touch-action:none; }\n.yada-prompt-panel { position:absolute; right:20px; bottom:20px; width:min(620px, calc(100vw - 24px)); min-height:0; height:auto; max-height:min(72vh, 680px); display:flex; flex-direction:column; gap:12px; padding:16px; overflow:hidden; background:var(--bg); border:1px solid var(--border); border-radius:16px; box-shadow:0 12px 40px #0003; }\n.yada-prompt-header, .yada-prompt-item-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }\n.yada-prompt-header { flex-shrink:0; }\n.yada-prompt-header strong { font-size:16px; }\n.yada-prompt-header-actions, .yada-prompt-item-actions { display:flex; gap:4px; flex-shrink:0; }\nbutton { font:inherit; color:inherit; background:transparent; border:1px solid var(--border); border-radius:8px; padding:5px 9px; cursor:pointer; }\nbutton:hover { background:var(--hover); }\nbutton:focus-visible, input:focus-visible, textarea:focus-visible { outline:2px solid #10a37f; outline-offset:2px; }\n[data-prompt-action="add"], .yada-prompt-add { color:#fff; background:#10a37f; border-color:#10a37f; }\n[data-prompt-action="add"]:hover, .yada-prompt-add:hover { background:#0c8567; }\n.yada-prompt-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; display:flex; flex-direction:column; gap:10px; scrollbar-width:thin; }\n.yada-prompt-item { border:1px solid var(--border); border-radius:10px; padding:10px 12px; flex-shrink:0; cursor:default; }\n.yada-prompt-item-title { flex:1; margin:0; font-size:13px; overflow-wrap:anywhere; min-width:0; }\n.yada-prompt-icon { width:30px; height:30px; padding:6px; border-color:transparent; display:grid; place-items:center; }\n.yada-prompt-icon[data-prompt-action="delete"] { color:#c86464; }\n.yada-prompt-item-content { margin:6px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:5; overflow:hidden; }\n.yada-prompt-empty { margin:0; padding:12px; text-align:center; color:var(--muted); }\n.yada-prompt-editor { display:grid; grid-template-columns:1fr 1fr; gap:10px; min-height:0; flex-shrink:0; }\n.yada-prompt-editor input, .yada-prompt-editor textarea { grid-column:1 / -1; width:100%; background:var(--bg); color:inherit; border:1px solid var(--border); border-radius:8px; padding:8px; font:inherit; }\n.yada-prompt-editor textarea { height:clamp(50px, 20vh, 180px); min-height:0; resize:none; overscroll-behavior:contain; }\n[role="alert"] { margin:0; color:#c86464; }\n.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }\n@media (max-width:640px) { .yada-prompt-panel { right:12px; bottom:12px; } .yada-prompt-header { gap:6px; } }\n\n.yada-prompt-grip { width:18px; height:18px; flex:0 0 18px; display:grid; place-items:center; color:var(--muted); cursor:grab; touch-action:none; }\n.yada-prompt-chosen .yada-prompt-grip { cursor:grabbing; }\n.yada-prompt-ghost { opacity:0.45; }\n';

  // src/export/clipboard.ts
  async function writeTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    document.documentElement.append(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) throw new Error("Clipboard fallback failed");
  }

  // src/prompts/storage.ts
  var PROMPT_KEY = "chatgpt-yada:prompt-library:v1";
  function parseLibrary(value) {
    if (value === void 0) return { version: 2, prompts: [] };
    if (!value || typeof value !== "object") throw new Error("提示词数据无效");
    const data = value;
    if (data.version !== 1 && data.version !== 2 || !Array.isArray(data.prompts)) throw new Error("提示词版本不支持");
    const ids = /* @__PURE__ */ new Set();
    for (const p of data.prompts) {
      if (!p || typeof p.id !== "string" || !p.id || ids.has(p.id) || typeof p.title !== "string" || typeof p.content !== "string" || !Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt)) throw new Error("提示词数据无效");
      ids.add(p.id);
    }
    return { version: 2, prompts: data.version === 1 ? [...data.prompts].sort((a, b) => b.updatedAt - a.updatedAt) : [...data.prompts] };
  }
  async function readLibrary() {
    const raw = (await chrome.storage.local.get(PROMPT_KEY))[PROMPT_KEY];
    const library = parseLibrary(raw);
    if (raw?.version === 1) await saveLibrary(library);
    return library;
  }
  async function saveLibrary(library) {
    await chrome.storage.local.set({ [PROMPT_KEY]: parseLibrary(library) });
  }

  // src/ui/theme.ts
  function detectYadaTheme() {
    const html = document.documentElement;
    const themeAttr = safeGetAttribute(html, "data-theme") ?? safeGetAttribute(document.body, "data-theme");
    if (themeAttr?.toLowerCase().includes("dark")) return "dark";
    if (themeAttr?.toLowerCase().includes("light")) return "light";
    if (html.classList.contains("dark")) return "dark";
    if (html.classList.contains("light")) return "light";
    const colorScheme = getComputedStyle(html).colorScheme;
    if (colorScheme.includes("dark")) return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function safeGetAttribute(node, name) {
    return node instanceof Element ? node.getAttribute(name) : null;
  }
  function observeYadaTheme(onChange) {
    const applyTheme = () => onChange(detectYadaTheme());
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    applyTheme();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", applyTheme);
    };
  }

  // src/prompts/panel.ts
  var svg = (body) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  var ICONS = {
    grip: svg('<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
    edit: svg('<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>'),
    delete: svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'),
    check: svg('<path d="m5 12 4 4L19 6"/>')
  };
  var PROMPT_HOST_ID = "chatgpt-yada-prompt-host";
  var PromptPanel = class {
    constructor(button) {
      this.button = button;
      document.getElementById(PROMPT_HOST_ID)?.remove();
      this.host.id = PROMPT_HOST_ID;
      this.host.dataset.yadaRoot = "true";
      this.host.hidden = true;
      this.root = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = panel_default;
      this.modal = document.createElement("section");
      this.modal.className = "yada-prompt-modal is-visible";
      this.modal.innerHTML = `
      <div class="yada-prompt-backdrop" data-prompt-action="close"></div>
      <div class="yada-prompt-panel" role="dialog" aria-modal="true" aria-label="提示词收藏库">
        <div class="yada-prompt-header"><strong>提示词收藏库</strong>
          <div class="yada-prompt-header-actions"><button type="button" data-prompt-action="add">新增提示词</button>
          <button type="button" data-prompt-action="close">关闭</button></div></div>
        <div class="yada-prompt-list"></div>
        <p class="yada-prompt-empty">暂无提示词</p>
        <form class="yada-prompt-editor" hidden>
          <input name="title" placeholder="标题" aria-label="标题" required>
          <textarea name="content" rows="4" placeholder="正文" aria-label="正文" required></textarea>
          <button type="submit" class="yada-prompt-add">保存</button>
          <button type="button" class="yada-prompt-close" data-prompt-action="cancel">取消</button>
        </form>
        <p class="sr-only" role="status" aria-live="polite"></p>
        <p role="alert" hidden></p>
      </div>`;
      this.root.append(style, this.modal);
      document.body.append(this.host);
      this.modal.dataset.toolkitTheme = detectYadaTheme();
      button.addEventListener("click", this.toggle);
      this.modal.addEventListener("click", this.handleClick);
      this.query("form").addEventListener("submit", (event) => {
        event.preventDefault();
        void this.saveEditor();
      });
      this.modal.addEventListener("wheel", this.stopPageScroll, { passive: false });
      this.modal.addEventListener("touchmove", this.stopPageScroll, { passive: false });
    }
    host = document.createElement("div");
    root;
    modal;
    library = { version: 2, prompts: [] };
    copyTimers = /* @__PURE__ */ new Map();
    generation = 0;
    busy = false;
    sortable = null;
    disposed = false;
    editing = null;
    globalsAttached = false;
    disposeTheme = null;
    documentListenersAttached() {
      return this.globalsAttached;
    }
    stopPageScroll = (event) => {
      const node = event.target instanceof Element ? event.target : null;
      const scrollable = node?.closest(".yada-prompt-list, textarea");
      if (!scrollable || scrollable.scrollHeight <= scrollable.clientHeight) {
        event.preventDefault();
        return;
      }
      if (event instanceof WheelEvent && (event.deltaY < 0 && scrollable.scrollTop <= 0 || event.deltaY > 0 && scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight)) event.preventDefault();
    };
    query(selector) {
      return this.root.querySelector(selector);
    }
    close = () => {
      this.destroySortable();
      this.detachGlobals();
      this.generation++;
      for (const [button, timer] of this.copyTimers) {
        clearTimeout(timer);
        button.innerHTML = ICONS.copy;
      }
      this.copyTimers.clear();
      this.host.hidden = true;
      this.button.setAttribute("aria-expanded", "false");
    };
    dispose() {
      this.disposed = true;
      this.close();
      this.host.remove();
      this.button.removeEventListener("click", this.toggle);
    }
    toggle = async () => {
      if (!this.host.hidden) {
        this.close();
        return;
      }
      if (this.busy) return;
      const generation = ++this.generation;
      if (!this.host.isConnected) document.body.append(this.host);
      this.attachGlobals();
      this.host.hidden = false;
      this.button.setAttribute("aria-expanded", "true");
      this.query('[role="alert"]').hidden = true;
      this.query("form").hidden = true;
      try {
        const library = await readLibrary();
        if (this.disposed || generation !== this.generation) return;
        this.library = library;
        this.renderList();
        this.query('[data-prompt-action="add"]').focus();
      } catch {
        if (generation === this.generation) this.error("无法读取提示词，请重新打开重试。");
      }
    };
    attachGlobals() {
      if (this.globalsAttached) return;
      this.globalsAttached = true;
      this.modal.dataset.toolkitTheme = detectYadaTheme();
      this.disposeTheme = observeYadaTheme((theme) => {
        this.modal.dataset.toolkitTheme = theme;
      });
      document.addEventListener("pointerdown", this.outside, true);
      document.addEventListener("keydown", this.keydown, true);
    }
    detachGlobals() {
      if (!this.globalsAttached) return;
      this.globalsAttached = false;
      this.disposeTheme?.();
      this.disposeTheme = null;
      document.removeEventListener("pointerdown", this.outside, true);
      document.removeEventListener("keydown", this.keydown, true);
    }
    outside = (event) => {
      if (!this.host.hidden && !event.composedPath().includes(this.host) && !event.composedPath().includes(this.button)) this.close();
    };
    keydown = (event) => {
      if (this.host.hidden) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
        this.button.focus();
      }
      if (event.key === "Tab") {
        const items = [...this.modal.querySelectorAll("button, input, textarea")].filter((e) => e.getClientRects().length && !e.disabled);
        const first = items[0], last = items.at(-1), active = this.root.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    handleClick = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest("[data-prompt-action]");
      if (!action || this.host.hidden) return;
      const kind = action.dataset.promptAction;
      if (kind === "close") {
        this.close();
        this.button.focus();
        return;
      }
      if (this.busy) return;
      const prompt = this.library.prompts.find((item) => item.id === action.dataset.promptId);
      if (kind === "add") this.edit();
      if (kind === "cancel") {
        this.query("form").hidden = true;
        this.renderList();
      }
      if (kind === "edit" && prompt) this.edit(prompt);
      if (kind === "delete" && prompt) void this.persist({ version: 2, prompts: this.library.prompts.filter((item) => item.id !== prompt.id) });
      if (kind === "copy" && prompt) void this.copy(prompt, action);
    };
    renderList() {
      this.destroySortable();
      const items = this.library.prompts;
      const list = this.query(".yada-prompt-list");
      list.replaceChildren();
      list.hidden = false;
      this.query(".yada-prompt-empty").hidden = items.length > 0;
      const fragment = document.createDocumentFragment();
      for (const item of items) {
        const article = document.createElement("article");
        article.className = "yada-prompt-item";
        article.dataset.promptId = item.id;
        const header = document.createElement("div");
        header.className = "yada-prompt-item-header";
        const title = document.createElement("h4");
        title.className = "yada-prompt-item-title";
        title.textContent = item.title;
        const content = document.createElement("p");
        content.className = "yada-prompt-item-content";
        content.textContent = item.content;
        const actions = document.createElement("div");
        actions.className = "yada-prompt-item-actions";
        actions.append(this.action("复制提示词", "copy", item.id), this.action("编辑提示词", "edit", item.id), this.action("删除提示词", "delete", item.id));
        const grip = document.createElement("span");
        grip.className = "yada-prompt-grip";
        grip.title = "拖拽排序";
        grip.setAttribute("aria-label", "拖拽排序");
        grip.innerHTML = ICONS.grip;
        header.append(grip, title, actions);
        article.append(header, content);
        fragment.append(article);
      }
      list.append(fragment);
      if (this.disposed || this.host.hidden) return;
      this.sortable = new sortable_esm_default(list, {
        handle: ".yada-prompt-grip",
        draggable: ".yada-prompt-item",
        dataIdAttr: "data-prompt-id",
        animation: 150,
        ghostClass: "yada-prompt-ghost",
        chosenClass: "yada-prompt-chosen",
        scroll: list,
        bubbleScroll: false,
        onEnd: () => {
          void this.saveOrder();
        }
      });
    }
    destroySortable() {
      this.sortable?.destroy();
      this.sortable = null;
    }
    async saveOrder() {
      if (!this.sortable || this.busy) return;
      const ids = this.sortable.toArray();
      if (ids.every((id, index2) => id === this.library.prompts[index2]?.id)) return;
      const byId = new Map(this.library.prompts.map((item) => [item.id, item]));
      if (ids.length !== byId.size || new Set(ids).size !== byId.size || ids.some((id) => !byId.has(id))) {
        this.renderList();
        return;
      }
      await this.persist({ version: 2, prompts: ids.map((id) => byId.get(id)) }, true);
    }
    action(text, action, id) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yada-prompt-icon";
      button.setAttribute("aria-label", text);
      button.title = text;
      button.innerHTML = ICONS[action];
      button.dataset.promptAction = action;
      button.dataset.promptId = id;
      return button;
    }
    edit(prompt) {
      this.destroySortable();
      this.editing = prompt ?? null;
      this.query("form").hidden = false;
      this.query(".yada-prompt-list").hidden = true;
      this.query(".yada-prompt-empty").hidden = true;
      this.query('[name="title"]').value = prompt?.title ?? "";
      this.query('[name="content"]').value = prompt?.content ?? "";
      this.query('[name="title"]').focus();
    }
    async saveEditor() {
      const title = this.query('[name="title"]').value.trim();
      const content = this.query('[name="content"]').value;
      if (!title || !content.trim() || this.busy) return;
      const previous = this.editing, now = Date.now();
      const item = { id: previous?.id ?? crypto.randomUUID(), title, content, createdAt: previous?.createdAt ?? now, updatedAt: now };
      await this.persist({ version: 2, prompts: previous ? this.library.prompts.map((p) => p.id === previous.id ? item : p) : [item, ...this.library.prompts] });
    }
    async persist(next, sorting = false) {
      if (this.busy) return;
      this.busy = true;
      this.sortable?.option("disabled", true);
      const generation = this.generation;
      try {
        await saveLibrary(next);
        this.library = next;
        if (!this.disposed && generation === this.generation) {
          this.renderList();
          this.query("form").hidden = true;
        }
      } catch {
        if (generation === this.generation) {
          if (sorting) this.renderList();
          this.error(sorting ? "排序保存失败，请重试" : "保存失败，内容仍保留，请重试。");
        }
      } finally {
        this.busy = false;
        this.sortable?.option("disabled", false);
      }
    }
    async copy(prompt, button) {
      const generation = this.generation;
      try {
        await writeTextToClipboard(prompt.content);
        if (this.disposed || generation !== this.generation || !button.isConnected) return;
        clearTimeout(this.copyTimers.get(button));
        button.innerHTML = ICONS.check;
        this.query('[role="status"]').textContent = "提示词已复制";
        this.copyTimers.set(button, window.setTimeout(() => {
          button.innerHTML = ICONS.copy;
          this.copyTimers.delete(button);
          this.query('[role="status"]').textContent = "";
        }, 1300));
      } catch {
        if (generation === this.generation) this.error("复制失败，请重试。");
      }
    }
    error(message) {
      const alert = this.query('[role="alert"]');
      alert.textContent = message;
      alert.hidden = false;
    }
  };

  // src/export/markdownFormatter.ts
  function formatTurnsAsMarkdown(turns) {
    const markdown = turns.map(formatTurn).filter(Boolean).join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
    return markdown ? `${markdown}
` : "";
  }
  function formatTurn(turn) {
    const sections = [
      formatSection("User", turn.userMarkdown, turn.userCreatedAt),
      formatSection("ChatGPT", turn.assistantMarkdown, turn.assistantCreatedAt)
    ].filter(Boolean);
    return sections.join("\n\n");
  }
  function formatSection(role, markdown, createdAt) {
    const content = markdown.trim();
    if (!content) return "";
    const timestamp = formatTimestamp(createdAt);
    return `# ${role}

${timestamp ? `${timestamp}

` : ""}${content}`;
  }
  function formatTimestamp(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
    const date = new Date(seconds * 1e3);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (value) => String(value).padStart(2, "0");
    return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  // src/styles.ts
  var YADA_ACCENT = "#10A37F";
  var YADA_ACCENT_SOFT = "rgba(16, 163, 127, 0.14)";
  var YADA_TOOLBAR_HOST_ID = "chatgpt-yada-toolbar-host";

  // src/quota/iconRenderer.ts
  var COLORS = {
    outer: "#ff375f",
    middle: "#9cd326",
    inner: "#1ad6d0",
    track: "rgba(255,255,255,0.18)"
  };
  var DARK_ICON_PALETTE = {
    track: COLORS.track,
    center: "#f5f5f7"
  };
  var LIGHT_ICON_PALETTE = {
    track: "rgba(32, 33, 35, 0.18)",
    center: "#202123"
  };
  function remainingToRatio(remaining, limit) {
    if (limit <= 0) return 0;
    return Math.max(0, Math.min(1, remaining / limit));
  }
  function ringGeometry(size) {
    const padding = Math.max(1, size * 0.045);
    const outerWidth = Math.max(1.5, size * 0.11);
    const gap = Math.max(0.75, size * 0.045);
    const cx = size / 2;
    const outerRadius = cx - padding - outerWidth / 2;
    const middleWidth = outerWidth * 0.92;
    const innerWidth2 = outerWidth * 0.84;
    const middleRadius = outerRadius - outerWidth / 2 - gap - middleWidth / 2;
    const innerRadius = middleRadius - middleWidth / 2 - gap - innerWidth2 / 2;
    return [
      { radius: outerRadius, width: outerWidth },
      { radius: middleRadius, width: middleWidth },
      { radius: innerRadius, width: innerWidth2 }
    ];
  }
  function drawQuotaRings(ctx, size, rings, palette = DARK_ICON_PALETTE) {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const geometry = ringGeometry(size);
    const values = [rings.outer, rings.middle, rings.inner];
    const colors = [COLORS.outer, COLORS.middle, COLORS.inner];
    geometry.forEach((ring, index2) => {
      drawTrack(ctx, cx, cy, ring.radius, ring.width, palette.track);
      drawArc(ctx, cx, cy, ring.radius, ring.width, colors[index2], values[index2]);
    });
    if (size >= 32 && rings.center) {
      ctx.fillStyle = palette.center;
      const symbolic = rings.center === "…" || rings.center === "—" || rings.center === "!";
      ctx.font = `600 ${Math.round(size * (symbolic ? 0.42 : 0.34))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(rings.center, cx, cy + size * 0.02);
    }
  }
  function paintQuotaCanvas(canvas, rings, palette = DARK_ICON_PALETTE) {
    const size = canvas.width || 32;
    let ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;
    drawQuotaRings(ctx, size, rings, palette);
  }
  function drawTrack(ctx, cx, cy, radius, width, color) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  function drawArc(ctx, cx, cy, radius, width, color, ratio) {
    const filled = Math.max(0, Math.min(0.999, ratio));
    if (filled <= 0) return;
    const start = -Math.PI / 2;
    const end = start + filled * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();
  }

  // src/quota/presentation.ts
  function metricRemainingLabel(metric) {
    if (!metric) return "当前套餐无此桶";
    return `已用 ${metric.used} / ${metric.limit}`;
  }
  function metricPercentLabel(metric) {
    if (!metric || metric.remainingRatio == null) return "—";
    return `${Math.round(metric.remainingRatio * 100)}%`;
  }
  function quotaDetailsQuiet(snapshot) {
    return snapshot.historyComplete && snapshot.syncStatus === "ready" && !snapshot.historyError && !snapshot.lastHistoryError;
  }
  function historySyncLabel(snapshot) {
    if (quotaDetailsQuiet(snapshot)) return "";
    switch (snapshot.syncStatus) {
      case "loading":
        return "正在读取额度";
      case "backfill":
        return `正在首次同步最近 7 天 ChatGPT 历史… · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次`;
      case "error":
        return snapshot.historyError ? `最近历史刷新失败 · ${snapshot.historyError}` : "最近历史刷新失败";
      case "ready":
        return snapshot.lastHistoryError ? "最近历史刷新失败" : "";
      default:
        return snapshot.historyError ? snapshot.historyError : `历史暂未补齐 · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次，暂不猜剩余次数`;
    }
  }
  function planStatusNote(snapshot) {
    if (!snapshot.plan) return "未确认 ChatGPT 套餐，不猜测额度桶。";
    return null;
  }
  function workspaceStatusNote(snapshot) {
    return snapshot.personalProEligible ? null : "当前工作区不计入个人 Pro Chat 额度";
  }
  function snapshotBucketViews(snapshot) {
    if (!snapshot.plan) return [];
    if (snapshot.plan === "prolite") {
      return [{ title: "GPT-6 Pro+5.6 Sol Pro", period: "7days", metric: snapshot.combinedDaily }];
    }
    return [
      { title: "GPT-6 Pro", period: "7days", metric: snapshot.gpt6ProWeekly },
      { title: "GPT-5.6 Sol Pro", period: "24h", metric: snapshot.solProDaily },
      { title: "GPT-6 Pro+5.6 Sol Pro", period: "24h", metric: snapshot.combinedDaily }
    ];
  }

  // src/quota/iconState.ts
  function snapshotToRings(snapshot) {
    const center = snapshot.syncStatus === "loading" || snapshot.syncStatus === "backfill" ? "…" : snapshot.syncStatus === "error" ? "!" : snapshot.syncStatus === "partial" || snapshot.tightestRemainingPercent == null ? "—" : String(snapshot.tightestRemainingPercent);
    return {
      outer: remainingToRatio(snapshot.gpt6ProWeekly?.estimatedRemaining ?? 0, snapshot.gpt6ProWeekly?.limit ?? 1),
      middle: remainingToRatio(snapshot.solProDaily?.estimatedRemaining ?? 0, snapshot.solProDaily?.limit ?? 1),
      inner: remainingToRatio(snapshot.combinedDaily?.estimatedRemaining ?? 0, snapshot.combinedDaily?.limit ?? 1),
      center
    };
  }
  function snapshotTitle(snapshot) {
    const workspace = snapshot.personalProEligible ? "" : "\n当前工作区不计入个人 Pro Chat 额度";
    return [
      "ChatGPT Yada Pro 额度",
      "",
      metricLine("GPT-6 Pro", snapshot.gpt6ProWeekly),
      metricLine("GPT-5.6 Sol Pro", snapshot.solProDaily),
      metricLine("GPT-6 Pro+5.6 Sol Pro", snapshot.combinedDaily),
      "",
      quotaDetailsQuiet(snapshot) ? snapshot.updatedLabel : `历史同步：${historySyncLabel(snapshot)}`,
      `未分类轮次：${snapshot.unclassifiedTurns}`,
      snapshot.updatedLabel,
      workspace
    ].join("\n").trim();
  }
  function metricLine(label, metric) {
    if (!metric) return `${label}：当前套餐无此桶`;
    return `${label}：已用 ${metric.used} / ${metric.limit}`;
  }

  // src/quota/types.ts
  var LEDGER_KEY = "chatgpt-yada:quota-ledger:v2";
  var STATE_KEY = "chatgpt-yada:quota-state:v2";
  var EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1e3;

  // src/quota/heatmap.ts
  var HOUR_MS = 60 * 60 * 1e3;

  // src/ui/quotaHeatmap.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  var AXIS_HEIGHT = 16;
  var ROW_LABEL_WIDTH = 32;
  var AXIS_COLUMNS = [0, 6, 12, 18, 23];
  var PANEL_COLORS = [
    "var(--yada-heatmap-empty)",
    "var(--yada-heatmap-level-1)",
    "var(--yada-heatmap-level-2)",
    "var(--yada-heatmap-level-3)",
    "var(--yada-heatmap-level-4)"
  ];
  var WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var HEATMAP_CELL_SIZE = 8;
  var HEATMAP_GAP = 2;
  var HEATMAP_RADIUS = 2;
  var QUOTA_HEATMAP_CSS = `
  :host {
    --yada-heatmap-empty: #ebedf0;
    --yada-heatmap-level-1: #c6e48b;
    --yada-heatmap-level-2: #7bc96f;
    --yada-heatmap-level-3: #239a3b;
    --yada-heatmap-level-4: #196127;
    --yada-heatmap-hover: rgba(0, 0, 0, 0.34);
    --yada-tooltip-bg: #222;
    --yada-tooltip-text: #f2f2f2;
  }
  :host([data-yada-theme="dark"]) {
    --yada-heatmap-empty: #2d333b;
    --yada-heatmap-level-1: #0e4429;
    --yada-heatmap-level-2: #006d32;
    --yada-heatmap-level-3: #26a641;
    --yada-heatmap-level-4: #39d353;
    --yada-heatmap-hover: #8c959f;
    --yada-tooltip-bg: #636e7b;
    --yada-tooltip-text: #f0f3f6;
  }
  [data-quota-heatmap] {
    display: block;
    width: 100%;
    margin-top: 6px;
    overflow: hidden;
  }
  [data-quota-heatmap] svg {
    display: block;
    max-width: 100%;
    overflow: visible;
    color: var(--yada-muted);
    font: 8px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none;
  }
  [data-heatmap-axis], [data-heatmap-row-label] {
    fill: currentColor;
    pointer-events: none;
  }
  [data-heatmap-cell] {
    cursor: pointer;
  }
  [data-heatmap-cell]:hover {
    stroke: var(--yada-heatmap-hover);
    stroke-width: 1px;
  }
  [data-heatmap-tooltip] {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    padding: 5px 8px;
    border-radius: 4px;
    background: var(--yada-tooltip-bg);
    color: var(--yada-tooltip-text);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.24);
    font: 11px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
    white-space: nowrap;
  }
  [data-heatmap-tooltip][hidden] { display: none !important; }
`;
  var QuotaHeatmapRenderer = class {
    constructor(eventRoot) {
      this.eventRoot = eventRoot;
      this.tooltip = document.createElement("div");
      this.tooltip.dataset.heatmapTooltip = "true";
      this.tooltip.setAttribute("role", "tooltip");
      this.tooltip.hidden = true;
      this.eventRoot.append(this.tooltip);
      this.eventRoot.addEventListener("pointerover", this.onPointerOver);
      this.eventRoot.addEventListener("pointerout", this.onPointerOut);
      this.listening = true;
    }
    tooltip;
    rendered = [];
    listening = false;
    render(bucket, container) {
      const heatmap = document.createElement("div");
      heatmap.dataset.quotaHeatmap = bucket.id;
      heatmap.append(renderSvg(bucket));
      container.append(heatmap);
      this.rendered.push(heatmap);
    }
    dispose() {
      if (this.listening) {
        this.eventRoot.removeEventListener("pointerover", this.onPointerOver);
        this.eventRoot.removeEventListener("pointerout", this.onPointerOut);
        this.listening = false;
      }
      for (const node of this.rendered) node.remove();
      this.rendered.length = 0;
      this.tooltip.remove();
    }
    onPointerOver = (event) => {
      const cell = heatmapCell(event.target);
      if (!cell) return;
      const usageHourStart = Number(cell.dataset.usageHourStart);
      const count = Number(cell.dataset.count);
      if (!Number.isFinite(usageHourStart) || !Number.isFinite(count)) return;
      this.tooltip.textContent = formatQuotaHeatmapTooltip(usageHourStart, count);
      this.tooltip.hidden = false;
      placeTooltip(this.tooltip, cell.getBoundingClientRect());
    };
    onPointerOut = (event) => {
      if (!heatmapCell(event.target)) return;
      this.tooltip.hidden = true;
    };
  };
  function formatQuotaHeatmapTooltip(usageHourStart, count) {
    const date = new Date(usageHourStart);
    return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]} ${pad2(date.getHours())}:00 使用${count}次`;
  }
  function renderSvg(bucket) {
    const stride = HEATMAP_CELL_SIZE + HEATMAP_GAP;
    const gridWidth = bucket.columns * HEATMAP_CELL_SIZE + (bucket.columns - 1) * HEATMAP_GAP;
    const gridHeight = bucket.rows * HEATMAP_CELL_SIZE + (bucket.rows - 1) * HEATMAP_GAP;
    const width = ROW_LABEL_WIDTH + gridWidth;
    const height = AXIS_HEIGHT + gridHeight;
    const svg2 = svgElement("svg");
    svg2.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg2.setAttribute("width", String(width));
    svg2.setAttribute("height", String(height));
    svg2.setAttribute("role", "img");
    svg2.setAttribute("aria-label", `${bucket.windowHours} 小时滚动使用热力图`);
    for (const column of AXIS_COLUMNS) {
      const releaseHour = new Date(bucket.firstReleaseHour + column * HOUR_MS).getHours();
      const label = svgElement("text");
      label.dataset.heatmapAxis = "true";
      label.dataset.heatmapColumn = String(column);
      label.setAttribute("x", String(ROW_LABEL_WIDTH + column * stride + HEATMAP_CELL_SIZE / 2));
      label.setAttribute("y", "8");
      label.setAttribute("text-anchor", "middle");
      label.textContent = pad2(releaseHour);
      svg2.append(label);
    }
    const grid = svgElement("g");
    grid.setAttribute("transform", `translate(${ROW_LABEL_WIDTH}, ${AXIS_HEIGHT})`);
    for (let row = 0; row < bucket.rows; row += 1) {
      const labelDate = new Date(bucket.rows === 7 ? bucket.cells[(row + 1) * bucket.columns - 1]?.usageHourStart ?? bucket.firstReleaseHour + row * 24 * HOUR_MS : bucket.firstReleaseHour + row * 24 * HOUR_MS);
      const rowLabel = svgElement("text");
      rowLabel.dataset.heatmapRowLabel = "true";
      rowLabel.setAttribute("x", String(-HEATMAP_GAP));
      rowLabel.setAttribute("y", String(row * stride + HEATMAP_CELL_SIZE - 1));
      rowLabel.setAttribute("text-anchor", "end");
      rowLabel.textContent = `${pad2(labelDate.getMonth() + 1)}/${pad2(labelDate.getDate())}`;
      grid.append(rowLabel);
      const rowGroup = svgElement("g");
      rowGroup.dataset.heatmapRow = String(row);
      for (let column = 0; column < bucket.columns; column += 1) {
        const index2 = row * bucket.columns + column;
        const cell = bucket.cells[index2];
        if (!cell) continue;
        const rect = svgElement("rect");
        rect.dataset.heatmapCell = "true";
        rect.dataset.heatmapIndex = String(index2);
        rect.dataset.heatmapRow = String(row);
        rect.dataset.heatmapColumn = String(column);
        rect.dataset.releaseHourStart = String(cell.releaseHourStart);
        rect.dataset.usageHourStart = String(cell.usageHourStart);
        rect.dataset.count = String(cell.count);
        rect.setAttribute("x", String(column * stride));
        rect.setAttribute("y", String(row * stride));
        rect.setAttribute("width", String(HEATMAP_CELL_SIZE));
        rect.setAttribute("height", String(HEATMAP_CELL_SIZE));
        rect.setAttribute("rx", String(HEATMAP_RADIUS));
        rect.setAttribute("ry", String(HEATMAP_RADIUS));
        rect.setAttribute("fill", panelColor(cell.count, bucket.maxCount));
        rect.setAttribute("aria-label", formatQuotaHeatmapTooltip(cell.usageHourStart, cell.count));
        rowGroup.append(rect);
      }
      grid.append(rowGroup);
    }
    svg2.append(grid);
    return svg2;
  }
  function panelColor(count, maxCount) {
    if (count <= 0 || maxCount <= 0) return PANEL_COLORS[0];
    const step = Math.max(1, Math.ceil(maxCount / (PANEL_COLORS.length - 1)));
    let color = PANEL_COLORS[1];
    for (let level = 1; level < PANEL_COLORS.length; level += 1) {
      const threshold = level * step;
      color = PANEL_COLORS[level];
      if (threshold > count) break;
    }
    return color;
  }
  function placeTooltip(tooltip, cellRect) {
    const gutter = 8;
    const offset = 6;
    const tooltipRect = tooltip.getBoundingClientRect();
    const maximumLeft = Math.max(gutter, window.innerWidth - gutter - tooltipRect.width);
    const left = clamp(cellRect.left + (cellRect.width - tooltipRect.width) / 2, gutter, maximumLeft);
    const above = cellRect.top - tooltipRect.height - offset;
    const below = cellRect.bottom + offset;
    const maximumTop = Math.max(gutter, window.innerHeight - gutter - tooltipRect.height);
    const top = clamp(above >= gutter ? above : below, gutter, maximumTop);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function heatmapCell(target) {
    return target instanceof Element ? target.closest("[data-heatmap-cell]") : null;
  }
  function svgElement(name) {
    return document.createElementNS(SVG_NS, name);
  }
  function pad2(value) {
    return String(value).padStart(2, "0");
  }
  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  // src/ui/quotaIndicator.ts
  var QUOTA_INDICATOR_DEBOUNCE_MS = 80;
  var QUOTA_POPOVER_HOST_ID = "chatgpt-yada-quota-popover-host";
  var UNKNOWN_QUOTA_RINGS = { outer: 0, middle: 0, inner: 0, center: "…" };
  var QUOTA_REFRESH_LABEL = "刷新当前额度";
  var QUOTA_REFRESHING_LABEL = "正在刷新当前额度";
  var QUOTA_REFRESHED_LIVE = "当前额度已刷新";
  var QUOTA_REFRESH_ERROR = "刷新失败，继续显示上次数据";
  var HEROICON_ARROW_PATH_D = "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99";
  var ERROR_QUOTA_RINGS = { outer: 0, middle: 0, inner: 0, center: "!" };
  var POPOVER_WIDTH = 312;
  var VIEWPORT_GUTTER = 8;
  var POPOVER_CSS = `
  :host {
    --yada-text: #202123;
    --yada-muted: rgba(32, 33, 35, 0.64);
    --yada-border: rgba(32, 33, 35, 0.16);
    color-scheme: light;
    pointer-events: none;
  }
  :host([data-yada-theme="dark"]) {
    --yada-text: #ececec;
    --yada-muted: rgba(236, 236, 236, 0.66);
    --yada-border: rgba(236, 236, 236, 0.16);
    color-scheme: dark;
  }
  [data-quota-popover] {
    position: fixed;
    z-index: 2147483646;
    box-sizing: border-box;
    width: min(${POPOVER_WIDTH}px, calc(100vw - ${VIEWPORT_GUTTER * 2}px));
    max-height: calc(100vh - ${VIEWPORT_GUTTER * 2}px);
    overflow: auto;
    overscroll-behavior: contain;
    padding: 14px;
    border: 1px solid var(--yada-border);
    border-radius: 12px;
    background: #fff;
    color: var(--yada-text);
    box-shadow: 0 12px 32px rgba(15, 15, 15, 0.18);
    font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: left;
    white-space: normal;
    pointer-events: auto;
  }
  [data-quota-popover][hidden] { display: none !important; }
  :host([data-yada-theme="dark"]) [data-quota-popover] {
    background: #2a2a2a;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.46);
  }
  [data-quota-header] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 8px;
  }
  [data-quota-header] h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    min-width: 0;
  }
  [data-quota-refresh] {
    appearance: none;
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--yada-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
  }
  [data-quota-refresh] svg {
    display: block;
    width: 16px;
    height: 16px;
  }
  [data-quota-refresh]:hover:not(:disabled) {
    background: rgba(32, 33, 35, 0.06);
  }
  [data-quota-refresh]:active:not(:disabled) {
    background: rgba(32, 33, 35, 0.12);
  }
  :host([data-yada-theme="dark"]) [data-quota-refresh]:hover:not(:disabled) {
    background: rgba(236, 236, 236, 0.08);
  }
  :host([data-yada-theme="dark"]) [data-quota-refresh]:active:not(:disabled) {
    background: rgba(236, 236, 236, 0.16);
  }
  [data-quota-refresh]:focus-visible {
    outline: 2px solid rgba(16, 163, 127, 0.72);
    outline-offset: 1px;
  }
  [data-quota-refresh]:disabled {
    cursor: default;
  }
  [data-quota-refresh][aria-busy="true"] svg {
    animation: yada-quota-refresh-spin 1s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    [data-quota-refresh][aria-busy="true"] svg {
      animation: none;
      opacity: 0.55;
    }
  }
  @keyframes yada-quota-refresh-spin {
    to { transform: rotate(360deg); }
  }
  [data-quota-live] {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  [data-quota-refresh-error] {
    margin-top: 8px;
    font-size: 11px;
    color: var(--yada-muted);
  }
  [data-quota-popover] [data-quota-bucket] { margin-top: 10px; }
  [data-quota-popover] [data-quota-row] {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  [data-quota-popover] [data-quota-name] { margin: 0; font-size: 12px; font-weight: 700; }
  [data-quota-popover] [data-quota-meta] {
    margin: 0;
    color: var(--yada-muted);
    white-space: nowrap;
  }
  [data-quota-popover] [data-quota-remaining] { margin: 2px 0 0; }
  [data-quota-popover] p { margin: 0; }
  [data-quota-popover] [data-quota-note],
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] {
    margin-top: 8px;
    font-size: 11px;
    color: var(--yada-muted);
  }
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] { color: var(--yada-text); }
  ${QUOTA_HEATMAP_CSS}
`;
  var QuotaIndicator = class {
    constructor(button, options = {}) {
      this.button = button;
      this.send = options.send ?? ((message, timeoutMs) => sendRuntimeMessage(message, timeoutMs));
      this.onRefresh = options.onRefresh ?? null;
      this.debounceMs = options.debounceMs ?? QUOTA_INDICATOR_DEBOUNCE_MS;
      this.canvas = button.querySelector("canvas") ?? button.appendChild(document.createElement("canvas"));
      this.canvas.setAttribute("aria-hidden", "true");
      this.themeValue = detectYadaTheme();
      this.disposeTheme = observeYadaTheme((theme) => {
        this.themeValue = theme;
        if (this.portalHost) this.portalHost.dataset.yadaTheme = theme;
        this.paint(this.rings);
      });
      this.button.setAttribute("aria-haspopup", "dialog");
      this.button.addEventListener("click", this.onClick);
      chrome.storage?.onChanged?.addListener(this.onStorageChanged);
      document.addEventListener("visibilitychange", this.onVisibility);
      this.apply(null, "loading");
      void this.loadState();
    }
    send;
    onRefresh;
    debounceMs;
    canvas;
    portalHost = null;
    popover = null;
    refreshButton = null;
    liveRegion = null;
    disposeTheme;
    disposed = false;
    generation = 0;
    refreshGeneration = 0;
    refreshUiGeneration = 0;
    refreshTimer = 0;
    refreshPromise = null;
    refreshFailed = false;
    status = "loading";
    snapshot = null;
    rings = UNKNOWN_QUOTA_RINGS;
    themeValue;
    quotaDirty = false;
    heatmapVisibilityDirty = false;
    popoverListeners = false;
    heatmapRenderer = null;
    heatmapGeneration = 0;
    heatmapHourTimer = 0;
    close = () => {
      this.refreshGeneration += 1;
      this.refreshFailed = false;
      this.setRefreshUi("idle");
      this.setLiveMessage("");
      this.stopHeatmapLifecycle();
      if (this.popover) this.popover.hidden = true;
      this.button.setAttribute("aria-expanded", "false");
      this.detachPopoverListeners();
    };
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.close();
      this.generation += 1;
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = 0;
      this.refreshPromise = null;
      this.disposeTheme();
      this.button.removeEventListener("click", this.onClick);
      this.refreshButton?.removeEventListener("click", this.onRefreshClick);
      chrome.storage?.onChanged?.removeListener(this.onStorageChanged);
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.portalHost?.remove();
      this.portalHost = null;
      this.popover = null;
      this.refreshButton = null;
      this.liveRegion = null;
    }
    onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.popover?.hidden !== false) this.open();
      else this.close();
    };
    onPointerDown = (event) => {
      if (!this.popover || this.popover.hidden) return;
      const path = event.composedPath();
      if (path.includes(this.button) || path.includes(this.popover) || this.portalHost && path.includes(this.portalHost)) return;
      this.close();
    };
    onKeyDown = (event) => {
      if (!this.popover || this.popover.hidden || event.key !== "Escape") return;
      event.stopPropagation();
      this.close();
      this.button.focus();
    };
    onViewportChange = () => {
      if (this.popover && !this.popover.hidden) this.positionPopover();
    };
    onStorageChanged = (changes, area) => {
      if (this.disposed || area !== "local") return;
      if (!changes[LEDGER_KEY] && !changes[STATE_KEY]) return;
      if (document.visibilityState === "hidden") {
        this.quotaDirty = true;
        return;
      }
      this.queueLoad();
    };
    onVisibility = () => {
      if (this.disposed) return;
      if (document.visibilityState !== "visible") {
        if (this.popover?.hidden === false) {
          this.heatmapVisibilityDirty = true;
          this.heatmapGeneration += 1;
          window.clearTimeout(this.heatmapHourTimer);
          this.heatmapHourTimer = 0;
        }
        return;
      }
      if (!this.quotaDirty && !this.heatmapVisibilityDirty) return;
      this.quotaDirty = false;
      this.heatmapVisibilityDirty = false;
      void this.loadState();
    };
    queueLoad() {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = 0;
        void this.loadState();
      }, this.debounceMs);
    }
    async loadState(options = {}) {
      const generation = ++this.generation;
      try {
        const response = await this.send({ type: "quota/get-state" });
        if (this.disposed || generation !== this.generation) return false;
        if (response?.error) throw new Error(response.error);
        if (!response?.snapshot) throw new Error("无法读取额度账本");
        this.apply(response.snapshot, "ready");
        return true;
      } catch {
        if (this.disposed || generation !== this.generation) return false;
        if (options.retainOnError && this.snapshot && this.status !== "error") return false;
        this.apply(null, "error");
        return false;
      }
    }
    apply(snapshot, status) {
      this.snapshot = snapshot;
      this.status = status;
      const rings = status === "error" ? ERROR_QUOTA_RINGS : snapshot ? snapshotToRings(snapshot) : UNKNOWN_QUOTA_RINGS;
      this.paint(rings);
      this.setTitle(
        status === "error" ? "Pro 额度暂不可用" : snapshot ? snapshotTitle(snapshot) : "Pro 额度：读取中"
      );
      if (this.popover && !this.popover.hidden) {
        this.disposeHeatmapRenderer();
        this.renderPopover();
        this.positionPopover();
        this.refreshHeatmap();
      }
    }
    paint(rings) {
      this.rings = rings;
      this.canvas.dataset.quotaCenter = rings.center ?? "";
      this.canvas.dataset.quotaOuter = String(rings.outer);
      this.canvas.dataset.quotaMiddle = String(rings.middle);
      this.canvas.dataset.quotaInner = String(rings.inner);
      paintQuotaCanvas(
        this.canvas,
        rings,
        this.themeValue === "light" ? LIGHT_ICON_PALETTE : DARK_ICON_PALETTE
      );
    }
    setTitle(title) {
      this.button.title = title;
      this.button.setAttribute("aria-label", title);
    }
    open() {
      this.ensurePopover();
      this.renderPopover();
      this.popover.hidden = false;
      this.button.setAttribute("aria-expanded", "true");
      this.attachPopoverListeners();
      this.positionPopover();
      this.refreshHeatmap();
    }
    ensurePopover() {
      if (this.popover) return;
      document.getElementById(QUOTA_POPOVER_HOST_ID)?.remove();
      this.portalHost = document.createElement("div");
      this.portalHost.id = QUOTA_POPOVER_HOST_ID;
      this.portalHost.dataset.yadaRoot = "true";
      this.portalHost.dataset.yadaTheme = this.themeValue;
      const portal = this.portalHost.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = POPOVER_CSS;
      this.popover = document.createElement("div");
      this.popover.hidden = true;
      this.popover.dataset.quotaPopover = "true";
      this.popover.setAttribute("role", "dialog");
      this.popover.setAttribute("aria-label", "Pro 模型额度");
      portal.append(style, this.popover);
      (document.body ?? document.documentElement).append(this.portalHost);
    }
    attachPopoverListeners() {
      if (this.popoverListeners) return;
      this.popoverListeners = true;
      document.addEventListener("pointerdown", this.onPointerDown, true);
      document.addEventListener("keydown", this.onKeyDown, true);
      window.addEventListener("resize", this.onViewportChange, { passive: true });
      window.addEventListener("scroll", this.onViewportChange, { passive: true, capture: true });
    }
    detachPopoverListeners() {
      if (!this.popoverListeners) return;
      this.popoverListeners = false;
      document.removeEventListener("pointerdown", this.onPointerDown, true);
      document.removeEventListener("keydown", this.onKeyDown, true);
      window.removeEventListener("resize", this.onViewportChange);
      window.removeEventListener("scroll", this.onViewportChange, true);
    }
    renderPopover() {
      if (!this.popover) return;
      this.popover.replaceChildren();
      this.popover.append(this.headerRow());
      if (this.status === "error" || this.status === "ready" && !this.snapshot) {
        this.popover.append(note("无法读取额度账本", "quota-error"));
        this.appendRefreshStatus();
        return;
      }
      if (!this.snapshot) {
        this.popover.append(note("正在读取额度", "quota-note"));
        this.appendRefreshStatus();
        return;
      }
      const statusNote = historySyncLabel(this.snapshot);
      if (statusNote) {
        this.popover.append(note(statusNote, this.snapshot.syncStatus === "error" ? "quota-error" : "quota-note"));
      }
      if (this.snapshot.syncStatus === "error") {
        this.popover.append(note(this.snapshot.updatedLabel, "quota-note"));
        return;
      }
      const planNote = planStatusNote(this.snapshot);
      if (planNote) this.popover.append(note(planNote, "quota-warn"));
      else if (this.snapshot.syncStatus === "ready" || quotaDetailsQuiet(this.snapshot) || this.snapshot.plan) {
        if (this.snapshot.plan) {
          for (const bucket of snapshotBucketViews(this.snapshot)) {
            const section = document.createElement("section");
            section.dataset.quotaBucket = "true";
            const row = document.createElement("div");
            row.dataset.quotaRow = "true";
            const title = document.createElement("p");
            title.dataset.quotaName = "true";
            title.textContent = bucket.title;
            const meta = document.createElement("p");
            meta.dataset.quotaMeta = "true";
            meta.textContent = `${bucket.period}   ${metricPercentLabel(bucket.metric)}`;
            row.append(title, meta);
            const remaining = document.createElement("p");
            remaining.dataset.quotaRemaining = "true";
            remaining.textContent = metricRemainingLabel(bucket.metric);
            if (bucket.metric) section.dataset.quotaBucketId = bucket.metric.id;
            section.append(row, remaining);
            this.popover.append(section);
          }
        }
      }
      this.popover.append(note(this.snapshot.updatedLabel, "quota-note"));
      const workspace = workspaceStatusNote(this.snapshot);
      if (workspace) this.popover.append(note(workspace, "quota-warn"));
      this.appendRefreshStatus();
    }
    headerRow() {
      const row = document.createElement("div");
      row.dataset.quotaHeader = "true";
      const heading = document.createElement("h2");
      heading.textContent = "Pro 模型额度";
      row.append(heading, this.ensureRefreshButton());
      return row;
    }
    ensureRefreshButton() {
      if (this.refreshButton) {
        this.setRefreshUi(this.isRefreshUiActive() ? "refreshing" : "idle");
        return this.refreshButton;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.quotaRefresh = "true";
      button.append(createRefreshIcon());
      button.addEventListener("click", this.onRefreshClick);
      this.refreshButton = button;
      this.setRefreshUi("idle");
      return button;
    }
    appendRefreshStatus() {
      if (!this.popover) return;
      this.popover.append(this.ensureLiveRegion());
      this.ensureRefreshError();
    }
    ensureRefreshError() {
      if (!this.refreshFailed || !this.popover || this.popover.hidden) return;
      if (this.popover.querySelector("[data-quota-refresh-error]")) return;
      const error = document.createElement("p");
      error.dataset.quotaRefreshError = "true";
      error.textContent = QUOTA_REFRESH_ERROR;
      this.popover.append(error);
    }
    ensureLiveRegion() {
      if (this.liveRegion) return this.liveRegion;
      const live = document.createElement("p");
      live.dataset.quotaLive = "true";
      live.setAttribute("aria-live", "polite");
      this.liveRegion = live;
      return live;
    }
    onRefreshClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.startRefresh();
    };
    isRefreshUiActive() {
      return this.refreshPromise != null && this.refreshUiGeneration === this.refreshGeneration && this.popover?.hidden === false;
    }
    startRefresh() {
      if (this.refreshPromise && this.refreshUiGeneration === this.refreshGeneration) return this.refreshPromise;
      const generation = this.refreshGeneration;
      this.refreshUiGeneration = generation;
      this.setRefreshUi("refreshing");
      const work = this.runRefresh(generation);
      const wrapped = work.finally(() => {
        if (this.refreshPromise === wrapped) this.refreshPromise = null;
      });
      this.refreshPromise = wrapped;
      return wrapped;
    }
    async runRefresh(generation) {
      try {
        const refresh = this.onRefresh;
        if (!refresh) throw new Error("额度刷新暂不可用");
        await refresh(this.snapshot);
        if (this.disposed) return;
        this.refreshFailed = false;
        const loaded = await this.loadState({ retainOnError: true });
        if (this.disposed || generation !== this.refreshGeneration) return;
        if (!loaded) {
          if (this.snapshot && this.status !== "error") {
            this.refreshFailed = true;
            this.ensureRefreshError();
          }
          return;
        }
        if (this.popover?.hidden === false) {
          this.setLiveMessage("");
          this.setLiveMessage(QUOTA_REFRESHED_LIVE);
        }
      } catch {
        if (this.disposed || generation !== this.refreshGeneration) return;
        this.refreshFailed = true;
        this.ensureRefreshError();
      } finally {
        if (!this.disposed) this.setRefreshUi("idle");
      }
    }
    setRefreshUi(state) {
      const button = this.refreshButton;
      if (!button) return;
      const refreshing = state === "refreshing";
      button.disabled = refreshing;
      if (refreshing) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
      const label = refreshing ? QUOTA_REFRESHING_LABEL : QUOTA_REFRESH_LABEL;
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    setLiveMessage(text) {
      const live = this.ensureLiveRegion();
      live.textContent = text;
    }
    refreshHeatmap() {
      window.clearTimeout(this.heatmapHourTimer);
      this.heatmapHourTimer = 0;
      if (!this.heatmapEligible()) {
        this.disposeHeatmapRenderer();
        return;
      }
      void this.requestHeatmap();
      this.scheduleHeatmapHourRefresh();
    }
    async requestHeatmap() {
      if (!this.popover || this.popover.hidden || !this.heatmapEligible()) return;
      const snapshot = this.snapshot;
      const generation = ++this.heatmapGeneration;
      try {
        const response = await this.send({
          type: "quota/get-heatmap",
          accountKey: snapshot.accountKey,
          plan: snapshot.plan
        });
        if (this.disposed || generation !== this.heatmapGeneration || this.popover.hidden) return;
        const heatmap = response.heatmap;
        if (response.error || !heatmap || !heatmap.historyComplete || heatmap.accountKey !== snapshot.accountKey) return;
        this.disposeHeatmapRenderer();
        this.heatmapRenderer = new QuotaHeatmapRenderer(this.popover);
        for (const bucket of heatmap.buckets) {
          const container = [...this.popover.querySelectorAll("[data-quota-bucket-id]")].find((node) => node.dataset.quotaBucketId === bucket.id);
          if (container) this.heatmapRenderer.render(bucket, container);
        }
        this.positionPopover();
      } catch {
      }
    }
    heatmapEligible() {
      return this.popover?.hidden === false && document.visibilityState !== "hidden" && this.snapshot?.historyComplete === true && this.snapshot.syncStatus === "ready" && this.snapshot.plan != null && this.snapshot.personalProEligible === true;
    }
    scheduleHeatmapHourRefresh() {
      window.clearTimeout(this.heatmapHourTimer);
      if (!this.heatmapEligible()) {
        this.heatmapHourTimer = 0;
        return;
      }
      const now = /* @__PURE__ */ new Date();
      const next = new Date(now.getTime());
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      this.heatmapHourTimer = window.setTimeout(() => {
        this.heatmapHourTimer = 0;
        if (!this.heatmapEligible()) return;
        void this.requestHeatmap();
        this.scheduleHeatmapHourRefresh();
      }, Math.max(1, next.getTime() - now.getTime() + 50));
    }
    stopHeatmapLifecycle() {
      this.heatmapGeneration += 1;
      window.clearTimeout(this.heatmapHourTimer);
      this.heatmapHourTimer = 0;
      this.heatmapVisibilityDirty = false;
      this.disposeHeatmapRenderer();
    }
    disposeHeatmapRenderer() {
      this.heatmapRenderer?.dispose();
      this.heatmapRenderer = null;
    }
    positionPopover() {
      if (!this.popover) return;
      const buttonRect = this.button.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2));
      const left = clamp2(
        buttonRect.right - width,
        VIEWPORT_GUTTER,
        Math.max(VIEWPORT_GUTTER, window.innerWidth - VIEWPORT_GUTTER - width)
      );
      this.popover.style.width = `${width}px`;
      this.popover.style.left = `${left}px`;
      this.popover.style.right = "auto";
      this.popover.style.top = `${VIEWPORT_GUTTER}px`;
      const rect = this.popover.getBoundingClientRect();
      const height = Math.min(rect.height, Math.max(0, window.innerHeight - VIEWPORT_GUTTER * 2));
      const below = buttonRect.bottom + 6;
      const above = buttonRect.top - height - 6;
      const top = below + height <= window.innerHeight - VIEWPORT_GUTTER ? below : above >= VIEWPORT_GUTTER ? above : VIEWPORT_GUTTER;
      this.popover.style.top = `${top}px`;
    }
  };
  function clamp2(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }
  function note(text, kind) {
    const node = document.createElement("p");
    node.dataset[kind === "quota-note" ? "quotaNote" : kind === "quota-warn" ? "quotaWarn" : "quotaError"] = "true";
    node.textContent = text;
    return node;
  }
  function createRefreshIcon() {
    const svg2 = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg2.setAttribute("viewBox", "0 0 24 24");
    svg2.setAttribute("fill", "none");
    svg2.setAttribute("stroke", "currentColor");
    svg2.setAttribute("stroke-width", "1.5");
    svg2.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("d", HEROICON_ARROW_PATH_D);
    svg2.append(path);
    return svg2;
  }

  // src/ui/toolbar.ts
  var YadaToolbar = class {
    constructor(sync = null) {
      this.sync = sync;
    }
    host = null;
    shadow = null;
    disposeTheme = null;
    copyResetTimer = 0;
    copyBusy = false;
    placementObserver = null;
    placementTimer = 0;
    prompts = null;
    quota = null;
    observedTarget = null;
    observedParent = null;
    setConversationSync(sync) {
      this.sync = sync;
    }
    closePanels() {
      this.prompts?.close();
      this.quota?.close();
    }
    mount() {
      this.mountShell();
      try {
        this.attachQuotaIndicator();
      } catch (error) {
        console.error("ChatGPT Yada: quota indicator failed", error);
        this.showQuotaFault();
      }
    }
    mountShell() {
      if (this.host?.isConnected) return;
      document.getElementById(YADA_TOOLBAR_HOST_ID)?.remove();
      this.host = document.createElement("div");
      this.host.id = YADA_TOOLBAR_HOST_ID;
      this.host.dataset.yadaRoot = "true";
      this.host.dataset.placement = "fixed";
      this.host.dataset.visible = "false";
      this.host.setAttribute("data-yada-theme", detectYadaTheme());
      this.shadow = this.host.attachShadow({ mode: "open" });
      document.documentElement.append(this.host);
      this.render();
      this.query("[data-copy-all]")?.addEventListener("click", () => {
        void this.copyAll();
      });
      this.query("[data-prompts]")?.addEventListener("click", this.onPromptsClick);
      this.disposeTheme = observeYadaTheme((theme) => {
        this.host?.setAttribute("data-yada-theme", theme);
      });
      window.addEventListener("resize", this.handleViewportChange, { passive: true });
      this.ensurePlacement();
    }
    attachQuotaIndicator(options = {}) {
      if (this.quota) return;
      const button = this.query("[data-quota]");
      if (!button) throw new Error("Quota button is missing");
      this.quota = new QuotaIndicator(button, options);
    }
    showQuotaFault() {
      const button = this.query("[data-quota]");
      if (!button) return;
      button.setAttribute("aria-label", "Pro 额度：异常");
      button.title = "Pro 额度：异常";
      const canvas = button.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) return;
      try {
        paintQuotaCanvas(canvas, { outer: 0, middle: 0, inner: 0, center: "!" });
      } catch {
        button.textContent = "!";
      }
    }
    isMounted() {
      return Boolean(this.host?.isConnected);
    }
    hasQuotaIndicator() {
      return this.quota !== null;
    }
    setVisible(visible) {
      this.host?.setAttribute("data-visible", visible ? "true" : "false");
    }
    ensurePlacement() {
      if (!this.host) return;
      const target = findHeaderActions();
      if (target) {
        if (this.host.parentElement !== target) {
          target.insertBefore(this.host, target.firstElementChild);
        }
        this.host.dataset.placement = "inline";
        this.observeHeader(target);
        return;
      }
      if (this.host.parentElement !== document.documentElement) {
        document.documentElement.append(this.host);
      }
      this.host.dataset.placement = "fixed";
      this.observeHeader(null);
    }
    dispose() {
      this.quota?.dispose();
      this.quota = null;
      this.prompts?.dispose();
      window.clearTimeout(this.copyResetTimer);
      window.clearTimeout(this.placementTimer);
      this.placementObserver?.disconnect();
      this.placementObserver = null;
      this.observedTarget = null;
      this.observedParent = null;
      this.disposeTheme?.();
      window.removeEventListener("resize", this.handleViewportChange);
      this.host?.remove();
      this.host = null;
      this.shadow = null;
    }
    render() {
      if (!this.shadow) return;
      this.shadow.innerHTML = `
      <style>
        :host {
          --yada-primary: ${YADA_ACCENT};
          --yada-primary-soft: ${YADA_ACCENT_SOFT};
          --yada-text: #202123;
          --yada-muted: rgba(32, 33, 35, 0.64);
          --yada-button-bg: rgba(255, 255, 255, 0.68);
          --yada-button-border: rgba(32, 33, 35, 0.16);
          display: inline-flex;
          align-items: center;
          gap: 5px;
          position: relative;
          z-index: 2147483500;
          color-scheme: light;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
        }

        :host([data-visible="false"]) {
          display: none;
        }

        :host([data-placement="fixed"]) {
          position: fixed;
          top: 16px;
          right: 88px;
        }

        :host([data-placement="inline"]) {
          margin-right: 2px;
        }

        :host([data-yada-theme="dark"]) {
          --yada-text: #ececec;
          --yada-muted: rgba(236, 236, 236, 0.66);
          --yada-button-bg: rgba(32, 33, 35, 0.68);
          --yada-button-border: rgba(236, 236, 236, 0.16);
          color-scheme: dark;
        }

        button {
          appearance: none;
          height: 29px;
          padding: 0 10px;
          border: 1px solid var(--yada-button-border);
          border-radius: 999px;
          background: var(--yada-button-bg);
          color: var(--yada-text);
          cursor: pointer;
          font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
          white-space: nowrap;
        }

        button:hover,
        button:focus-visible {
          border-color: rgba(16, 163, 127, 0.45);
          color: var(--yada-primary);
          outline: none;
        }

        button[data-state="pending"] {
          background: rgba(32, 33, 35, 0.05);
          color: var(--yada-muted);
        }

        button[data-state="success"] {
          border-color: rgba(16, 163, 127, 0.32);
          background: var(--yada-primary-soft);
          color: var(--yada-primary);
        }

        button[data-state="error"],
        button[data-state="empty"] {
          border-color: rgba(209, 67, 67, 0.28);
          background: rgba(209, 67, 67, 0.1);
          color: #d14343;
        }

        button:disabled {
          cursor: default;
          opacity: 0.66;
        }
        button[data-quota] {
          padding: 0;
          width: 20px;
          height: 20px;
          border: 0;
          background: transparent;
          border-radius: 50%;
          flex-shrink: 0;
          line-height: 0;
        }
        button[data-quota] canvas {
          display: block;
          width: 20px;
          height: 20px;
        }
      </style>
      <button type="button" data-quota aria-haspopup="dialog" aria-expanded="false" aria-label="Pro 额度：读取中" title="Pro 额度：读取中"><canvas width="32" height="32" aria-hidden="true"></canvas></button>
      <button type="button" data-copy-all data-state="idle">复制全部</button>
      <button type="button" data-prompts aria-expanded="false">提示词</button>
    `;
    }
    async copyAll() {
      if (this.copyBusy) return;
      this.copyBusy = true;
      this.setCopyState("pending", "复制中...", 0);
      try {
        const id = getConversationIdFromUrl();
        if (id && this.sync && this.sync.getActiveConversationId() !== id) this.sync.setActiveConversation(id);
        let snapshot = this.sync?.getSnapshot() ?? null;
        if (this.sync) {
          await this.sync.requestFull("copy");
          snapshot = this.sync.getSnapshot();
        }
        if (!snapshot) throw new Error("No conversation snapshot");
        const turns = snapshot.activeTurns;
        const markdown = formatTurnsAsMarkdown(turns);
        if (!markdown) {
          this.setCopyState("empty", "没有可复制内容");
          return;
        }
        await writeTextToClipboard(markdown);
        this.setCopyState("success", `已复制 ${turns.length} 轮`);
      } catch (error) {
        console.error("ChatGPT Yada: copy all failed", error);
        this.setCopyState("error", "复制失败");
      } finally {
        this.copyBusy = false;
        const button = this.query("[data-copy-all]");
        if (button?.dataset.state !== "pending") button?.removeAttribute("disabled");
      }
    }
    setCopyState(state, label = "复制全部", resetAfterMs = 1800) {
      window.clearTimeout(this.copyResetTimer);
      const button = this.query("[data-copy-all]");
      if (!button) return;
      button.dataset.state = state;
      button.textContent = label;
      button.disabled = state === "pending";
      if (resetAfterMs > 0 && state !== "idle") {
        this.copyResetTimer = window.setTimeout(() => {
          if (!button.isConnected) return;
          button.dataset.state = "idle";
          button.textContent = "复制全部";
          button.disabled = false;
        }, resetAfterMs);
      }
    }
    onPromptsClick = () => {
      const button = this.query("[data-prompts]");
      if (!button) return;
      if (!this.prompts) {
        try {
          this.prompts = new PromptPanel(button);
        } catch (error) {
          console.error("ChatGPT Yada: prompt panel failed", error);
          return;
        }
        void this.prompts.toggle();
      }
    };
    observeHeader(target) {
      const parent = target?.parentElement ?? null;
      if (target === this.observedTarget && parent === this.observedParent) return;
      this.placementObserver?.disconnect();
      this.placementObserver = null;
      this.observedTarget = target;
      this.observedParent = parent;
      if (!target) return;
      this.placementObserver = new MutationObserver(() => this.schedulePlacement());
      this.placementObserver.observe(target, { childList: true });
      if (parent) this.placementObserver.observe(parent, { childList: true });
    }
    schedulePlacement() {
      window.clearTimeout(this.placementTimer);
      this.placementTimer = window.setTimeout(() => this.ensurePlacement(), 180);
    }
    handleViewportChange = () => {
      this.ensurePlacement();
    };
    query(selector) {
      return this.shadow?.querySelector(selector) ?? null;
    }
  };
  function findHeaderActions() {
    const direct = document.querySelector("#page-header #conversation-header-actions");
    if (direct) return direct;
    const candidates = [
      "#conversation-header-actions",
      '[data-testid="conversation-header-actions"]',
      'header [aria-label*="Share" i]',
      'header [data-testid*="share" i]',
      "main ~ div header button"
    ];
    for (const selector of candidates) {
      const element = document.querySelector(selector);
      const parent = element?.parentElement;
      if (parent && isUsableHeaderTarget(parent)) return parent;
    }
    const header = document.querySelector("header");
    const button = header?.querySelector('button, [role="button"]');
    return button?.parentElement && isUsableHeaderTarget(button.parentElement) ? button.parentElement : null;
  }
  function isUsableHeaderTarget(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top < 120 && rect.right > window.innerWidth * 0.45;
  }

  // src/content.ts
  var USER_IDLE_MS = 1500;
  function startIsolated(start) {
    try {
      return { value: start(), error: null };
    } catch (error) {
      return { value: null, error };
    }
  }
  var ChatGptYadaApp = class {
    sync = null;
    hydrator = null;
    toolbar = null;
    quota = null;
    boot = null;
    messageDispose = null;
    routeListening = false;
    visibilityListening = false;
    inputListening = false;
    lastUserInput = 0;
    moduleErrors = /* @__PURE__ */ new Map();
    mount(page = isChatGptPage()) {
      if (!page) return;
      this.ensureSync();
      this.ensureToolbar();
      this.toolbar?.setVisible(true);
      this.syncPageState();
      this.ensureBoot();
      this.ensureSyncObserver();
      this.ensureNavigator();
      this.ensureQuota();
      this.ensureQuotaIndicator();
      this.ensureListeners();
    }
    recover() {
      if (!isChatGptPage()) return;
      this.mount();
      if (document.visibilityState === "visible") this.boot?.arm(getConversationIdFromUrl());
    }
    dispose = () => {
      if (this.routeListening) removeEventListener("message", this.onRouteMessage);
      this.routeListening = false;
      if (this.visibilityListening) document.removeEventListener("visibilitychange", this.onVisibility);
      this.visibilityListening = false;
      this.detachInput();
      this.messageDispose?.();
      this.messageDispose = null;
      this.boot?.dispose();
      this.boot = null;
      this.hydrator?.dispose();
      this.hydrator = null;
      this.quota?.dispose();
      this.quota = null;
      this.toolbar?.dispose();
      this.toolbar = null;
      this.sync?.dispose();
      this.sync = null;
      this.moduleErrors.clear();
    };
    ensureSync() {
      if (this.sync) return;
      const started = startIsolated(() => new ConversationSync());
      this.sync = started.value;
      if (started.error) this.moduleErrors.set("sync", started.error);
    }
    ensureToolbar() {
      if (this.toolbar?.isMounted()) return;
      const started = startIsolated(() => {
        const toolbar = new YadaToolbar();
        toolbar.setConversationSync(this.sync);
        toolbar.mountShell();
        return toolbar;
      });
      if (started.error || !started.value) {
        this.moduleErrors.set("toolbar", started.error ?? new Error("toolbar missing"));
        return;
      }
      this.toolbar = started.value;
      this.moduleErrors.delete("toolbar");
    }
    ensureBoot() {
      if (!this.sync) return;
      if (!this.boot) this.boot = new ConversationBootGate(this.sync);
      if (document.visibilityState === "visible") this.boot.arm(this.sync.getActiveConversationId());
    }
    ensureSyncObserver() {
      if (!this.sync) return;
      const started = startIsolated(() => this.sync?.mountPageObserver());
      if (started.error) this.moduleErrors.set("sync-observer", started.error);
      else this.moduleErrors.delete("sync-observer");
    }
    ensureNavigator() {
      if (this.hydrator || !this.sync) return;
      const started = startIsolated(() => {
        const hydrator = new OfficialNavigatorHydrator(this.sync);
        try {
          hydrator.mount();
        } catch (error) {
          hydrator.dispose();
          throw error;
        }
        return hydrator;
      });
      if (started.error || !started.value) {
        this.moduleErrors.set("navigator", started.error ?? new Error("navigator missing"));
        return;
      }
      this.hydrator = started.value;
      this.moduleErrors.delete("navigator");
    }
    ensureQuota() {
      if (this.quota || !this.sync) return;
      const started = startIsolated(() => {
        const tracker = new QuotaTracker(this.sync, {
          blocked: () => this.maintenanceBlocked()
        });
        try {
          tracker.mount();
        } catch (error) {
          tracker.dispose();
          throw error;
        }
        return tracker;
      });
      if (started.error || !started.value) {
        this.moduleErrors.set("quota", started.error ?? new Error("quota missing"));
        return;
      }
      this.quota = started.value;
      this.moduleErrors.delete("quota");
    }
    ensureQuotaIndicator() {
      if (!this.toolbar || this.toolbar.hasQuotaIndicator()) return;
      const started = startIsolated(() => this.toolbar?.attachQuotaIndicator({
        onRefresh: (snapshot) => this.refreshQuotaLight(snapshot)
      }));
      if (started.error) {
        this.moduleErrors.set("quota-indicator", started.error);
        this.toolbar.showQuotaFault();
        return;
      }
      this.moduleErrors.delete("quota-indicator");
    }
    async refreshQuotaLight(snapshot) {
      if (!this.quota) throw new Error("额度模块暂不可用");
      await this.quota.refreshCurrentLight(snapshot);
    }
    ensureListeners() {
      if (!this.routeListening) {
        addEventListener("message", this.onRouteMessage);
        this.routeListening = true;
      }
      if (!this.visibilityListening) {
        document.addEventListener("visibilitychange", this.onVisibility);
        this.visibilityListening = true;
      }
      if (!this.inputListening) {
        addEventListener("pointerdown", this.onUserInput, { capture: true, passive: true });
        addEventListener("keydown", this.onUserInput, { capture: true, passive: true });
        this.inputListening = true;
      }
      if (this.messageDispose) return;
      const onMessage = (message, _sender, sendResponse) => {
        if (message?.type !== "quota/refresh-current") return false;
        void this.quota?.refreshCurrent().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: String(error) }));
        return true;
      };
      chrome.runtime.onMessage.addListener(onMessage);
      this.messageDispose = () => chrome.runtime.onMessage.removeListener(onMessage);
    }
    detachInput() {
      if (!this.inputListening) return;
      removeEventListener("pointerdown", this.onUserInput, true);
      removeEventListener("keydown", this.onUserInput, true);
      this.inputListening = false;
    }
    onUserInput = () => {
      this.lastUserInput = Date.now();
    };
    onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      this.recover();
    };
    onRouteMessage = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = record(event.data);
      if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "route") return;
      this.toolbar?.closePanels();
      this.boot?.clear();
      this.hydrator?.resetRoute();
      this.syncPageState();
      this.recover();
    };
    syncPageState() {
      this.toolbar?.ensurePlacement();
      this.toolbar?.setVisible(isChatGptPage());
      const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector("[data-copy-all]");
      if (copy) copy.hidden = !isChatGptConversationPage();
      this.sync?.setActiveConversation(getConversationIdFromUrl());
    }
    maintenanceBlocked() {
      if (Date.now() - this.lastUserInput < USER_IDLE_MS) return true;
      if (document.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming')) return true;
      if (this.boot?.isPending() || this.boot?.isActive()) return true;
      if (this.sync?.isReading()) return true;
      return this.hydrator?.isMaintenanceBlocked() === true;
    }
  };
  if (isChatGptPage()) {
    const key = "__chatgptYadaDispose";
    const state = globalThis;
    state[key]?.();
    const app = new ChatGptYadaApp();
    app.mount();
    const onPageHide = () => app.dispose();
    const onPageShow = (event) => {
      if (event.persisted) app.recover();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    state[key] = () => {
      app.dispose();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }
})();
/*! Bundled license information:

sortablejs/modular/sortable.esm.js:
  (**!
   * Sortable 1.15.6
   * @author	RubaXa   <trash@rubaxa.org>
   * @author	owenm    <owen23355@gmail.com>
   * @license MIT
   *)
*/
