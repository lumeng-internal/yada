"use strict";
(() => {
  // src/nativeNavigator/protocol.ts
  var NATIVE_NAV_CHANNEL = "chatgpt-yada:native-nav:v1";
  var MIN_HISTORY_TURNS = 100;
  var PREPARE_LEASE_MS = 1e4;
  function emptyHistory(conversationId, generation = 0) {
    return {
      conversationId,
      generation,
      initialVersion: 0,
      revision: 0,
      pending: 0,
      pages: 0,
      messages: 0,
      prompts: 0,
      boundary: "unknown",
      cursorPresent: false,
      boosted: false,
      issue: null
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
      const marker2 = parts.indexOf("c");
      return marker2 >= 0 && marker2 + 1 < parts.length && /^[A-Za-z0-9_-]{1,128}$/.test(parts[marker2 + 1]) ? parts[marker2 + 1] : null;
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

  // src/nativeNavigator/metadata.ts
  var MAX_HISTORY_IDENTITIES = 1e4;
  function readHistoryMetadata(value, expectedConversationId) {
    const envelope = record(value);
    const payload = record(envelope?.conversation) ?? envelope;
    if (!payload) return null;
    const payloadId = identifier(payload.conversation_id) ?? identifier(payload.id);
    if (payloadId && payloadId !== expectedConversationId) return null;
    const branch = identifier(payload.current_node) ?? identifier(payload.current_node_id);
    if (Array.isArray(payload.messages)) return readPagedMessages(payload, branch);
    return readMappingPath(payload, branch);
  }
  function readPagedMessages(payload, branch) {
    const values = payload.messages;
    if (values.length > MAX_HISTORY_IDENTITIES) return null;
    const messages = [];
    const seen = /* @__PURE__ */ new Set();
    for (const value of values) {
      const identity = messageIdentity(value);
      if (!identity) return { messages, branch, boundary: "unknown", cursor: null };
      if (!seen.has(identity.id)) {
        seen.add(identity.id);
        messages.push(identity);
      }
    }
    const pagination = record(payload.page_info) ?? record(payload.pageInfo);
    const hasPrevious = pagination?.has_previous_page ?? pagination?.hasPreviousPage;
    const cursor = identifier(pagination?.start_cursor) ?? identifier(pagination?.startCursor);
    if (hasPrevious === false) return { messages, branch, boundary: "complete", cursor: null };
    if (hasPrevious === true && cursor) return { messages, branch, boundary: "more", cursor };
    return { messages, branch, boundary: "unknown", cursor };
  }
  function readMappingPath(payload, branch) {
    const mapping = record(payload.mapping);
    if (!mapping || !branch || Object.keys(mapping).length > MAX_HISTORY_IDENTITIES) return null;
    const messages = [];
    const visited = /* @__PURE__ */ new Set();
    let nodeId = branch;
    let foundRoot = false;
    while (nodeId && visited.size < MAX_HISTORY_IDENTITIES) {
      if (visited.has(nodeId)) break;
      visited.add(nodeId);
      const node = record(mapping[nodeId]);
      if (!node) break;
      if (node.message != null) {
        const identity = messageIdentity(node.message);
        if (!identity) break;
        messages.push(identity);
      }
      if (node.parent === null || node.parent === "") {
        foundRoot = true;
        break;
      }
      nodeId = identifier(node.parent);
    }
    return {
      messages,
      branch,
      boundary: foundRoot ? "complete" : "unknown",
      cursor: null
    };
  }
  function messageIdentity(value) {
    const message = record(value);
    const id = identifier(message?.id);
    const role = record(message?.author)?.role;
    if (!id || !["user", "assistant", "system", "tool", "developer"].includes(String(role))) return null;
    const hidden = record(message?.metadata)?.is_visually_hidden_from_conversation === true;
    return { id, prompt: role === "user" && !hidden };
  }
  var HistoryChain = class {
    identities = /* @__PURE__ */ new Map();
    usedCursors = /* @__PURE__ */ new Set();
    selectedBranch = null;
    boundary = "unknown";
    cursor = null;
    pages = 0;
    issue = null;
    get prompts() {
      return [...this.identities.values()].filter(Boolean).length;
    }
    accept(page, requestedBefore) {
      if (requestedBefore === null) this.begin(page.branch);
      else if (!this.continues(requestedBefore, page.branch)) {
        this.fail("unlinked");
        return;
      }
      let additions = 0;
      for (const message of page.messages) {
        if (!this.identities.has(message.id)) additions += 1;
        if (this.identities.size >= MAX_HISTORY_IDENTITIES && !this.identities.has(message.id)) {
          this.fail("limit");
          return;
        }
        this.identities.set(message.id, message.prompt);
      }
      if (page.boundary === "more") {
        if (!page.cursor || this.usedCursors.has(page.cursor) || requestedBefore !== null && additions === 0) {
          this.issue = "stalled";
          if (this.boundary !== "more" || this.cursor === null) this.fail("stalled");
          return;
        }
        this.usedCursors.add(page.cursor);
      }
      this.pages += 1;
      this.boundary = page.boundary;
      this.cursor = page.cursor;
      this.issue = null;
    }
    clearTransientStalled() {
      if (this.issue === "stalled") this.issue = null;
    }
    begin(branch) {
      this.identities.clear();
      this.usedCursors.clear();
      this.selectedBranch = branch;
      this.boundary = "unknown";
      this.cursor = null;
      this.pages = 0;
      this.issue = null;
    }
    continues(before, branch) {
      return this.pages > 0 && this.boundary === "more" && this.cursor === before && !(branch && this.selectedBranch && branch !== this.selectedBranch);
    }
    fail(issue) {
      this.boundary = "unknown";
      this.issue = issue;
    }
  };

  // src/nativeNavigator/mainHook.ts
  var marker = window;
  if (!marker.__chatgptYadaNativeHistoryHook) {
    marker.__chatgptYadaNativeHistoryHook = true;
    install();
  }
  function install() {
    const nativeFetch = window.fetch;
    const readers = /* @__PURE__ */ new Set();
    let historyState = emptyHistory(conversationIdFromUrl(location.href));
    let chain = new HistoryChain();
    let lease = emptyPrepareLease();
    let lastSequence = 0;
    const broadcast = () => {
      historyState.revision += 1;
      window.postMessage({ channel: NATIVE_NAV_CHANNEL, kind: "state", state: { ...historyState } }, location.origin);
    };
    const closePrepare = () => {
      lease = emptyPrepareLease();
      historyState.boosted = false;
    };
    const expirePrepare = (now) => {
      if (!lease.enabled) return;
      if (isPrepareActive(lease, now, historyState.conversationId, historyState.generation)) return;
      closePrepare();
      broadcast();
    };
    const synchronizeRoute = () => {
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
    window.fetch = function(input, init) {
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
      const ticket = {
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
      const expanded = expand ? expandHistoryRequest(input, init, location.href) : [input, init];
      let original;
      try {
        original = nativeFetch.call(this, expanded[0], expanded[1]);
      } catch (error) {
        finishTicket(ticket, "http-error");
        throw error;
      }
      void inspect(original, ticket).finally(() => finishTicket(ticket)).catch(() => void 0);
      return original;
    };
    async function inspect(original, ticket) {
      let response;
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
    function ticketCurrent(ticket) {
      return historyState.generation === ticket.generation && historyState.initialVersion === ticket.initialVersion && historyState.conversationId === ticket.request.conversationId;
    }
    function finishTicket(ticket, issue) {
      if (!ticketCurrent(ticket)) return;
      historyState.pending = Math.max(0, historyState.pending - 1);
      if (issue) historyState.issue = issue;
      broadcast();
    }
  }
  function patchHistoryMethod(method, onRoute) {
    const original = history[method];
    history[method] = function(...args) {
      original.apply(this, args);
      onRoute();
    };
  }
  function updateFromChain(state, chain) {
    state.pages = chain.pages;
    state.messages = chain.identities.size;
    state.prompts = chain.prompts;
    state.boundary = chain.boundary;
    state.cursorPresent = chain.cursor !== null;
    state.issue = chain.issue;
  }
  function cancelReaders(readers) {
    for (const reader of readers) void reader.cancel().catch(() => void 0);
  }
  async function boundedJsonClone(response, activeReaders) {
    const MAX_BYTES = 16 * 1024 * 1024;
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("not-json");
    if (activeReaders.size >= 2) throw new Error("reader-limit");
    const advertised = Number(response.headers.get("content-length"));
    if (Number.isFinite(advertised) && advertised > MAX_BYTES) throw new Error("body-limit");
    const reader = response.clone().body?.getReader();
    if (!reader) throw new Error("missing-body");
    activeReaders.add(reader);
    const pieces = [];
    let total = 0;
    let timeoutReached = false;
    const timeout = window.setTimeout(() => {
      timeoutReached = true;
      void reader.cancel().catch(() => void 0);
    }, 8e3);
    try {
      for (; ; ) {
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
      void reader.cancel().catch(() => void 0);
    }
  }
})();
