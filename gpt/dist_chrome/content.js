"use strict";
(() => {
  // src/conversation/completeConversation.ts
  var PAGE_NUM_TURNS = 100;
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
  function getPaginatedConversationApiUrl(conversationId, before = "") {
    const id = encodeURIComponent(conversationId);
    const path = before ? `/backend-api/conversations/${id}/messages` : `/backend-api/conversations/${id}`;
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    params.set("include_has_versions", "true");
    params.set("num_turns", String(PAGE_NUM_TURNS));
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
    if (error instanceof Error && /API failed: \d+/.test(error.message)) return false;
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
  async function fetchCompleteConversation(id, headers, signal, options = {}) {
    const requestTimeoutMs = options.requestTimeoutMs ?? 1e4;
    const rateLimitWaitMs = options.rateLimitWaitMs ?? 1e3;
    const request = async (url) => {
      const once = async () => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) controller.abort();
        const timer = setTimeout(abort, requestTimeoutMs);
        try {
          if (signal?.aborted || controller.signal.aborted) throw abortError();
          const response2 = await fetch(url, { credentials: "include", cache: "no-store", headers, signal: controller.signal });
          if (signal?.aborted) throw abortError();
          if (controller.signal.aborted) throw new Error("ChatGPT conversation API timed out");
          return response2;
        } catch (error) {
          if (signal?.aborted) throw abortError();
          if (controller.signal.aborted || isAbortError(error) && !signal?.aborted) {
            throw new Error("ChatGPT conversation API timed out");
          }
          throw error;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        }
      };
      let response = await once();
      if (response.status === 429) {
        await wait(rateLimitWaitMs, signal);
        response = await once();
      }
      if (!response.ok) throw new Error(`ChatGPT conversation API failed: ${response.status}`);
      const data = await response.json();
      if (!data || typeof data !== "object") throw new Error("Conversation API returned an empty response");
      return data;
    };
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
  async function chatgptApi(path, init = {}) {
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
    const timer = setTimeout(abort, 15e3);
    try {
      if (controller.signal.aborted && init.signal?.aborted) throw abortError2();
      return await fetch(path, { credentials: "include", cache: "no-store", ...init, headers, signal: controller.signal });
    } catch (error) {
      if (init.signal?.aborted) throw abortError2();
      if (controller.signal.aborted) throw new Error("ChatGPT API timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  async function fetchConversation(conversationId, signal) {
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
    return fetchCompleteConversation(conversationId, headers, signal);
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
    const record = value;
    for (const key of ["accountId", "account_id", "currentAccountId", "current_account_id", "id"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && /^account-[a-z0-9_-]+$/i.test(candidate)) {
        return candidate;
      }
    }
    for (const candidate of Object.values(record)) {
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
  function isComposerElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.matches(DIRECT_COMPOSER_SELECTOR)) return true;
    const className = String(element.getAttribute("class") ?? "");
    if (/\bProseMirror\b/i.test(className) && hasComposerAncestor(element)) return true;
    if (/prompt/i.test(className) && hasComposerEvidence(element)) return true;
    if (isStickyBottomComposerContainer(element)) return true;
    return false;
  }
  function isInsideComposer(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest(DIRECT_COMPOSER_SELECTOR)) return true;
    let current = element;
    while (current && current !== document.documentElement) {
      if (isComposerElement(current)) return true;
      current = current.parentElement;
    }
    return false;
  }
  function hasUnsentComposerDraft(root = document) {
    try {
      for (const node of root.querySelectorAll(DRAFT_CONTROL_SELECTOR)) {
        if (!(node instanceof HTMLElement)) continue;
        if (!isComposerElement(node) && !isInsideComposer(node)) continue;
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
          if (node.value.trim()) return true;
          continue;
        }
        if ((node.innerText || node.textContent || "").trim()) return true;
      }
    } catch {
      return false;
    }
    return false;
  }
  function hasComposerAncestor(element) {
    return Boolean(element.closest([
      "form",
      "#prompt-textarea",
      '[id*="prompt-textarea" i]',
      '[data-testid*="composer" i]',
      '[data-testid*="prompt-textarea" i]',
      '[class*="composer" i]',
      '[class*="prompt-textarea" i]'
    ].join(", ")));
  }
  function hasComposerEvidence(element) {
    return hasComposerAncestor(element) || Boolean(element.querySelector(DRAFT_CONTROL_SELECTOR)) || isStickyBottomComposerContainer(element);
  }
  function isStickyBottomComposerContainer(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (!element.querySelector(DRAFT_CONTROL_SELECTOR)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const nearBottom = rect.bottom >= window.innerHeight - 180 && rect.top >= window.innerHeight * 0.35;
    const compactEnough = rect.height > 0 && rect.height <= Math.max(460, window.innerHeight * 0.55);
    const positionedAtBottom = style.position === "fixed" || style.position === "sticky";
    return (positionedAtBottom || nearBottom) && compactEnough;
  }

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
        const record = readRecord(item);
        if (record && readString(record, "message_type") === "image") {
          const url = readString(record, "image_url") ?? readString(record, "url") ?? void 0;
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
    const record = readRecord(part);
    if (!record) return;
    const contentType = (readString(record, "content_type") ?? readString(record, "type") ?? "").toLowerCase();
    const filename = readString(record, "file_name") ?? readString(record, "filename") ?? readString(record, "name") ?? readString(record, "title") ?? void 0;
    const mimeType = readString(record, "mime_type") ?? readString(record, "mimetype") ?? readString(record, "mime") ?? void 0;
    const assetPointer = readString(record, "asset_pointer") ?? readString(record, "image_asset_pointer") ?? readString(record, "url") ?? readString(record, "href") ?? void 0;
    const key = makeKey("api", assetPointer ?? filename ?? mimeType ?? contentType);
    if (isImageContent(contentType, filename, mimeType, assetPointer)) {
      attachments.push({ kind: "image", label: "图片", key });
      return;
    }
    if (contentType.includes("paste") || contentType.includes("pasted") || record.pasted === true) {
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
  function readString(record, key) {
    const value = record[key];
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
  function makeTurn(index, user, assistant) {
    return {
      id: user.messageId ?? assistant?.messageId ?? `api-turn-${index + 1}`,
      index,
      globalIndex: index,
      displayNumber: index + 1,
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
      const record = part;
      const contentType = readString2(record, "content_type") ?? readString2(record, "type") ?? "";
      if (contentType.includes("image") || contentType.includes("file")) return "";
      return readString2(record, "text") ?? readString2(record, "content") ?? readString2(record, "markdown") ?? "";
    }).filter(Boolean).join("\n\n");
  }
  function joinStringParts(parts) {
    if (!Array.isArray(parts)) return "";
    return parts.map((part) => typeof part === "string" ? part : "").filter(Boolean).join("\n\n");
  }
  function readRole(message) {
    return message.author?.role;
  }
  function readString2(record, key) {
    const value = record[key];
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
      const record = row;
      const model = typeof record.model_slug === "string" ? record.model_slug : null;
      if (!model || !validModel(model)) continue;
      const reset = parseDate(record.resets_after);
      if (reset != null && reset <= now) continue;
      const fallbackRaw = typeof record.using_default_model_slug === "string" ? record.using_default_model_slug : null;
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
    const record = value;
    return record.is_temporary_chat === true || record.isTemporary === true;
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
    let work = 0;
    let unknown = 0;
    let fetched = 0;
    let read = 0;
    let cancelled = false;
    let hitDeadline = false;
    let hitDetailBudget = false;
    const turns = [];
    const aborted = () => Boolean(input.signal?.aborted);
    try {
      for (const archived of [false, true]) {
        let offset = 0;
        let reachedEnd = false;
        for (let page = 0; page < maxPages; page++) {
          if (aborted()) throw abortError3();
          if (clock() >= deadline) {
            hitDeadline = true;
            break;
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
              continue;
            }
            const key = await identity(id);
            let parsed = cache.conversations[key];
            if (parsed?.updatedAt !== updated) {
              if (fetched < detailBudget && clock() < deadline) {
                fetched += 1;
                try {
                  const detail = await (input.fetchDetail ? input.fetchDetail(id, input.signal) : input.transport.request(`/backend-api/conversation/${id}`, input.signal));
                  parsed = await parseConversation(detail, id, updated, cutoff);
                  cache.conversations[key] = parsed;
                } catch (error) {
                  if (isAbortError2(error)) throw error;
                  failures += 1;
                }
              } else {
                if (fetched >= detailBudget) hitDetailBudget = true;
                if (clock() >= deadline) hitDeadline = true;
                failures += 1;
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
            break;
          }
        }
        if (reachedEnd) streamsFinished += 1;
      }
    } catch (error) {
      if (isAbortError2(error)) cancelled = true;
      else failures += 1;
    }
    if (!cancelled) await input.store.save(cache, input.identity);
    const recent = turns.filter((turn) => turn.createdAt >= cutoff && turn.createdAt <= input.now);
    const complete = streamsFinished === 2 && failures === 0 && !cancelled && !hitDetailBudget && !hitDeadline;
    return {
      turns: recent,
      summary: {
        queriedAt: input.now,
        observedFrom: cutoff,
        complete,
        conversationsRead: read,
        excludedWorkConversations: work,
        unclassifiedTurns: unknown,
        failedConversations: failures,
        cancelled,
        hitDetailBudget,
        hitDeadline
      }
    };
  }
  function abortError3() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError2(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }

  // src/conversation/readConversation.ts
  function abortError4() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError3(error) {
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
      title: conversation.title
    };
  }

  // src/core/conversationSync.ts
  var ConversationSync = class {
    activeConversationId = null;
    generation = 0;
    runningPromise = null;
    dirty = false;
    abortController = null;
    latestSnapshot = null;
    lastError = null;
    listeners = /* @__PURE__ */ new Set();
    observer = null;
    lastStreamingState = false;
    seenAssistantMessageIds = /* @__PURE__ */ new Set();
    disposed = false;
    published = 0;
    read;
    constructor(options = {}) {
      this.read = options.readConversation ?? readConversation;
    }
    subscribe(listener) {
      this.listeners.add(listener);
      void listener(this.latestSnapshot);
      return () => this.listeners.delete(listener);
    }
    requestSync(_reason) {
      if (this.disposed) return Promise.reject(abortError4());
      this.dirty = true;
      if (this.runningPromise) return this.runningPromise;
      this.runningPromise = Promise.resolve().then(() => this.runLoop());
      return this.runningPromise;
    }
    setActiveConversation(conversationId) {
      if (this.activeConversationId === conversationId) return;
      this.generation += 1;
      this.abortController?.abort();
      this.abortController = null;
      this.activeConversationId = conversationId;
      this.seenAssistantMessageIds.clear();
      this.lastStreamingState = false;
      this.latestSnapshot = null;
      this.lastError = null;
      if (!conversationId) {
        this.dirty = false;
        void this.publish(null);
        return;
      }
      this.dirty = true;
      void this.requestSync("route");
    }
    getSnapshot() {
      return this.latestSnapshot;
    }
    getLastError() {
      return this.lastError;
    }
    getActiveConversationId() {
      return this.activeConversationId;
    }
    mountPageObserver(root = document.documentElement) {
      if (this.observer || typeof MutationObserver === "undefined") return;
      this.observer = new MutationObserver(() => this.inspectPageSignals());
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
      this.abortController?.abort();
      this.abortController = null;
      this.dirty = false;
      this.observer?.disconnect();
      this.observer = null;
      this.listeners.clear();
      this.latestSnapshot = null;
      this.runningPromise = null;
      this.seenAssistantMessageIds.clear();
    }
    async runLoop() {
      try {
        while (this.dirty && !this.disposed) {
          this.dirty = false;
          const conversationId = this.activeConversationId;
          const generation = this.generation;
          if (!conversationId) {
            await this.publish(null);
            continue;
          }
          this.abortController?.abort();
          this.abortController = new AbortController();
          const signal = this.abortController.signal;
          try {
            const snapshot = await this.read(conversationId, signal);
            if (this.disposed || signal.aborted) throw abortError4();
            if (this.activeConversationId === conversationId && this.generation === generation) {
              snapshot.revision = ++this.published;
              this.lastError = null;
              await this.publish(snapshot);
            }
          } catch (error) {
            if (this.disposed) return;
            if (isAbortError3(error) || this.generation !== generation) continue;
            if (this.activeConversationId === conversationId) {
              this.lastError = error instanceof Error ? error : new Error(String(error));
              if (!this.latestSnapshot) await this.publish(null);
            }
          }
        }
      } finally {
        this.runningPromise = null;
        if (this.dirty && !this.disposed) {
          await this.requestSync("drain");
        }
      }
    }
    async publish(snapshot) {
      this.latestSnapshot = snapshot;
      if (snapshot) {
        for (const id of collectStableAssistantMessageIds()) this.seenAssistantMessageIds.add(id);
        for (const turn of snapshot.activeTurns) {
          if (turn.assistantMessageId) this.seenAssistantMessageIds.add(turn.assistantMessageId);
        }
      }
      await Promise.all([...this.listeners].map((listener) => listener(snapshot)));
    }
    inspectPageSignals() {
      if (this.disposed || !this.activeConversationId) return;
      const streaming = isAssistantStreaming();
      const wasStreaming = this.lastStreamingState;
      this.lastStreamingState = streaming;
      if (streaming) return;
      if (wasStreaming) void this.requestSync("streaming-end");
      for (const id of collectStableAssistantMessageIds()) {
        if (this.seenAssistantMessageIds.has(id)) continue;
        this.seenAssistantMessageIds.add(id);
        void this.requestSync("new-assistant");
      }
    }
  };
  function isAssistantStreaming(root = document) {
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

  // src/navigation/config.ts
  var NATIVE_NAV_CONFIG = {
    timeoutMs: 15e3,
    directViewportMs: 320,
    pollMs: 32,
    alignmentQuietMs: 80,
    alignmentTolerancePx: 8,
    maxAlignmentAttempts: 2,
    failStyleMs: 1500,
    prepWaitMs: 3e3
  };

  // src/navigation/nativeCapability.ts
  var CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR = [
    `main [class$="_convSearchResultHighlightRoot"]`,
    `main [class*="_convSearchResultHighlightRoot "]`
  ].join(",");
  var CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR = [
    "fixed",
    "inset-e-4",
    "top-1/2",
    "z-20",
    "-translate-y-1/2"
  ];
  var CANCEL_KEYS = /* @__PURE__ */ new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space"]);
  function cssEscape(value) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
  }
  function isOfficialFixedChild(element) {
    return element instanceof HTMLElement && CHATGPT_OFFICIAL_NAV_FIXED_CHILD_SELECTOR.every((token) => element.classList.contains(token)) && !element.closest("[data-yada-root]");
  }
  function listOfficialNavigationRoots(root = document) {
    return [...root.querySelectorAll(CHATGPT_OFFICIAL_NAV_ROOT_SELECTOR)].filter((node) => [...node.children].some(isOfficialFixedChild));
  }
  function parsePromptNumber(button) {
    const toc = button.dataset.tocItemIndex;
    if (toc != null && /^\d+$/.test(toc)) return Number(toc);
    const label = button.getAttribute("aria-label") ?? "";
    const description = button.getAttribute("aria-description") ?? "";
    const match = /Prompt\s+(\d+)/i.exec(label) || /Prompt\s+(\d+)/i.exec(description);
    return match ? Number(match[1]) : null;
  }
  function readOfficialButtonsFromRoot(root) {
    const fixed = [...root.children].find(isOfficialFixedChild);
    if (!fixed) return null;
    const buttons = [...fixed.querySelectorAll("button")].filter((node) => node instanceof HTMLButtonElement);
    if (!buttons.length) return null;
    const parsed = buttons.map((element) => ({ element, raw: parsePromptNumber(element) }));
    if (parsed.some((item) => item.raw == null)) return null;
    const values = parsed.map((item) => item.raw);
    if (new Set(values).size !== values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const zeroBased = min === 0 && max === values.length - 1;
    const oneBased = min === 1 && max === values.length;
    if (!zeroBased && !oneBased) return null;
    const offset = oneBased ? 1 : 0;
    return parsed.map((item) => ({ element: item.element, index: item.raw - offset })).sort((left, right) => left.index - right.index);
  }
  function collectOfficialButtons(root = document) {
    const navRoots = listOfficialNavigationRoots(root);
    if (navRoots.length !== 1) return [];
    return readOfficialButtonsFromRoot(navRoots[0]) ?? [];
  }
  function isOfficialNavigationComplete(expectedTurnCount, conversationId, root = document) {
    if (expectedTurnCount <= 0) return false;
    const pageId = getConversationIdFromUrl();
    if (pageId && pageId !== conversationId) return false;
    const buttons = collectOfficialButtons(root);
    if (buttons.length !== expectedTurnCount) return false;
    return buttons.every((button, index) => button.index === index);
  }
  function isEphemeralTurnIndexMarker(id) {
    return /^conversation-turn-\d+$/i.test(id.trim());
  }
  function slotRole(slot) {
    const known = /* @__PURE__ */ new Set();
    if (slot.matches('[data-message-author-role="user"]')) known.add("user");
    if (slot.matches('[data-message-author-role="assistant"]')) known.add("assistant");
    for (const node of slot.querySelectorAll("[data-message-author-role]")) {
      const role = node.getAttribute("data-message-author-role");
      if (role === "user" || role === "assistant") known.add(role);
    }
    if (known.size === 1) return [...known][0];
    return "unknown";
  }
  function collectStableSlots(root = document) {
    const containers = [...root.querySelectorAll("[data-turn-id-container]")];
    const groups = /* @__PURE__ */ new Map();
    for (const container of containers) {
      const parent = container.parentElement;
      if (!parent) continue;
      const group = groups.get(parent);
      if (group) group.push(container);
      else groups.set(parent, [container]);
    }
    const largest = [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
    const seen = /* @__PURE__ */ new Map();
    const duplicates = /* @__PURE__ */ new Set();
    for (const element of largest) {
      const id = element.getAttribute("data-turn-id-container")?.trim() ?? "";
      if (!id || id === "client-created-root" || isEphemeralTurnIndexMarker(id)) continue;
      if (duplicates.has(id)) continue;
      if (seen.has(id)) {
        seen.delete(id);
        duplicates.add(id);
        continue;
      }
      seen.set(id, element);
    }
    return [...seen.entries()].map(([id, element]) => ({ id, element, role: slotRole(element) }));
  }
  function isStableSlotsComplete(turns, root = document) {
    if (!turns.length) return false;
    const slots = collectStableSlots(root);
    if (slots.length < turns.length) return false;
    return turns.every((turn) => resolveStableSlot(turn, slots) != null);
  }
  function resolveStableSlot(turn, slots) {
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const user = turn.userMessageId ? byId.get(turn.userMessageId) : void 0;
    if (user && (user.role === "user" || user.role === "unknown")) return user.element;
    const round = byId.get(turn.id);
    if (round && (round.role === "user" || round.role === "unknown")) return round.element;
    const assistant = turn.assistantMessageId ? byId.get(turn.assistantMessageId) : void 0;
    if (assistant && (assistant.role === "assistant" || assistant.role === "unknown") && !user) {
      return assistant.element;
    }
    return null;
  }
  function countMountedUserMessages(root = document) {
    let count = 0;
    for (const node of root.querySelectorAll('[data-message-author-role="user"][data-message-id]')) {
      if (isInsideComposer(node)) continue;
      if (node.dataset.messageId) count += 1;
    }
    return count;
  }
  function findMountedUserMessage(messageId, root = document) {
    const exact = root.querySelector(`[data-message-author-role="user"][data-message-id="${cssEscape(messageId)}"]`);
    if (exact && !isInsideComposer(exact) && readMessageId(exact) === messageId) return exact;
    for (const node of root.querySelectorAll("[data-message-id]")) {
      if (isInsideComposer(node)) continue;
      if (readMessageId(node) !== messageId) continue;
      const role = node.getAttribute("data-message-author-role") ?? node.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");
      if (role === "user") return node;
    }
    return null;
  }
  function readMessageId(element) {
    return element.dataset.messageId ?? element.closest("[data-message-id]")?.dataset.messageId ?? null;
  }
  function scrollElementIntoView(element) {
    if (typeof element.scrollIntoView !== "function") return;
    try {
      element.scrollIntoView({ behavior: "auto", block: "start" });
    } catch {
    }
  }
  function pageConversationMatches(conversationId) {
    const pageId = getConversationIdFromUrl();
    return !pageId || pageId === conversationId;
  }
  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    if (!element.isConnected) return false;
    if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) return true;
    const height = window.innerHeight || 800;
    return rect.bottom > 8 && rect.top < height - 8;
  }
  function isChatGptGenerating(root = document) {
    return Boolean(
      root.querySelector('[data-is-streaming="true"], [data-message-author-role="assistant"].result-streaming, button[data-testid="stop-button"]')
    );
  }
  function composerHasDraft() {
    return hasUnsentComposerDraft();
  }
  function attachUserNavigationCancel(abort) {
    const onWheel = () => abort();
    const onTouch = () => abort();
    const onPointer = (event) => {
      if (event.pointerType === "mouse" && event.buttons === 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-yada-root]")) return;
      abort();
    };
    const onKey = (event) => {
      if (CANCEL_KEYS.has(event.key)) abort();
    };
    window.addEventListener("wheel", onWheel, { passive: true, capture: true });
    window.addEventListener("touchstart", onTouch, { passive: true, capture: true });
    window.addEventListener("touchmove", onTouch, { passive: true, capture: true });
    window.addEventListener("pointerdown", onPointer, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("touchstart", onTouch, true);
      window.removeEventListener("touchmove", onTouch, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }
  function readNativeCapability(turns, conversationId, root = document) {
    const officialButtons = collectOfficialButtons(root);
    const slots = collectStableSlots(root);
    return {
      officialButtonCount: officialButtons.length,
      officialComplete: isOfficialNavigationComplete(turns.length, conversationId, root),
      slotCount: slots.length,
      slotsComplete: isStableSlotsComplete(turns, root),
      mountedUserCount: countMountedUserMessages(root),
      generating: isChatGptGenerating(root),
      composerDraft: composerHasDraft()
    };
  }

  // src/navigation/nativePreparation.ts
  var defaultHost = {
    getSession(key) {
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setSession(key, value) {
      try {
        sessionStorage.setItem(key, value);
      } catch {
      }
    },
    locationHref: () => location.href,
    assign: (url) => {
      location.assign(url);
    },
    replaceUrl: (url) => {
      history.replaceState(history.state, "", url);
    }
  };
  var PREP_MUTATION_SELECTOR = [
    `[class*="_convSearchResultHighlightRoot"]`,
    "[data-turn-id-container]",
    "button[data-toc-item-index]",
    `button[aria-label^="Prompt "]`
  ].join(",");
  function nativePrepKey(conversationId) {
    return `chatgpt-yada:native-prepared:${conversationId}`;
  }
  function readNativePrepState(conversationId, host = defaultHost) {
    const value = host.getSession(nativePrepKey(conversationId));
    if (value === "attempted" || value === "ready" || value === "unsupported") return value;
    return "unseen";
  }
  function writeNativePrepState(conversationId, state, host = defaultHost) {
    host.setSession(nativePrepKey(conversationId), state);
  }
  function nativePrepReloadAttempted(conversationId, host = defaultHost) {
    return readNativePrepState(conversationId, host) !== "unseen";
  }
  function messageQueryValue(href) {
    try {
      const url = new URL(href, "https://chatgpt.com");
      if (!url.searchParams.has("message")) return null;
      return url.searchParams.get("message") ?? "";
    } catch {
      return null;
    }
  }
  function hasNonEmptyMessageQuery(href) {
    const value = messageQueryValue(href);
    return value != null && value !== "";
  }
  function hasEmptyMessageQuery(href) {
    return messageQueryValue(href) === "";
  }
  function withEmptyMessageTrigger(href) {
    if (hasNonEmptyMessageQuery(href)) return null;
    try {
      const url = new URL(href, "https://chatgpt.com");
      url.searchParams.set("message", "");
      return url.toString();
    } catch {
      return null;
    }
  }
  function stripEmptyMessageQuery(href) {
    try {
      const url = new URL(href, "https://chatgpt.com");
      if (url.searchParams.get("message") === "") url.searchParams.delete("message");
      return url.toString();
    } catch {
      return href;
    }
  }
  function shouldAttemptNativePreparation(turns, capability) {
    if (!turns.length) return false;
    if (capability.generating || capability.composerDraft) return false;
    if (capability.officialComplete || capability.slotsComplete) return false;
    return turns.length > capability.mountedUserCount;
  }
  function decideNativePreparation(conversationId, turns, href, capability, host = defaultHost) {
    const state = readNativePrepState(conversationId, host);
    if (hasNonEmptyMessageQuery(href)) return { action: "none", state };
    if (state === "ready" || state === "unsupported") return { action: "none", state };
    const complete = capability.officialComplete || capability.slotsComplete;
    if (state === "attempted") {
      if (complete) {
        writeNativePrepState(conversationId, "ready", host);
        return { action: "ready", state: "ready", url: stripEmptyMessageQuery(href) };
      }
      if (!hasEmptyMessageQuery(href)) return { action: "none", state: "attempted" };
      return { action: "wait", state: "attempted" };
    }
    if (hasEmptyMessageQuery(href)) {
      writeNativePrepState(conversationId, "attempted", host);
      if (complete) {
        writeNativePrepState(conversationId, "ready", host);
        return { action: "ready", state: "ready", url: stripEmptyMessageQuery(href) };
      }
      return { action: "wait", state: "attempted" };
    }
    if (!shouldAttemptNativePreparation(turns, capability)) return { action: "none", state: "unseen" };
    const next = withEmptyMessageTrigger(href);
    if (!next) return { action: "none", state: "unseen" };
    writeNativePrepState(conversationId, "attempted", host);
    return { action: "assign", state: "attempted", url: next };
  }
  function mutationTouchesNativeSkeleton(records) {
    for (const record of records) {
      if (record.target instanceof Element && record.target.closest(PREP_MUTATION_SELECTOR)) return true;
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (!(node instanceof Element)) continue;
        if (node.matches(PREP_MUTATION_SELECTOR) || node.querySelector(PREP_MUTATION_SELECTOR)) return true;
      }
    }
    return false;
  }
  var NativePrepWaiter = class {
    constructor(conversationId, turns, host, onSettled) {
      this.conversationId = conversationId;
      this.host = host;
      this.onSettled = onSettled;
      this.turns = turns;
      this.observer = new MutationObserver((records) => {
        if (mutationTouchesNativeSkeleton(records)) this.scheduleCheck();
      });
      this.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "data-toc-item-index", "aria-label", "aria-description", "data-turn-id-container"]
      });
      this.timer = window.setTimeout(() => this.finish("unsupported"), NATIVE_NAV_CONFIG.prepWaitMs);
      this.scheduleCheck();
    }
    observer = null;
    raf = 0;
    timer = 0;
    active = true;
    turns;
    isActive() {
      return this.active;
    }
    hasObserver() {
      return this.observer != null;
    }
    updateTurns(turns) {
      this.turns = turns;
      this.scheduleCheck();
    }
    dispose() {
      this.stop();
    }
    scheduleCheck() {
      if (!this.active || this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.check();
      });
    }
    check() {
      if (!this.active) return;
      const capability = readNativeCapability(this.turns, this.conversationId);
      if (capability.officialComplete || capability.slotsComplete) this.finish("ready");
    }
    finish(result) {
      if (!this.active) return;
      writeNativePrepState(this.conversationId, result, this.host);
      if (result === "ready") this.host.replaceUrl(stripEmptyMessageQuery(this.host.locationHref()));
      this.stop();
      this.onSettled();
    }
    stop() {
      this.active = false;
      this.observer?.disconnect();
      this.observer = null;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
  };
  var NativePreparationController = class {
    constructor(host = defaultHost) {
      this.host = host;
      window.addEventListener("pagehide", this.onPageHide);
      window.addEventListener("beforeunload", this.onPageHide);
    }
    wait = null;
    onPageHide = () => {
      this.cancelWait();
    };
    evaluate(conversationId, turns) {
      if (!conversationId || !turns.length) {
        this.cancelWait();
        return { action: "none", state: "unseen" };
      }
      if (this.wait && this.wait.conversationId !== conversationId) this.cancelWait();
      const href = this.host.locationHref();
      const capability = readNativeCapability(turns, conversationId);
      const decision = decideNativePreparation(conversationId, turns, href, capability, this.host);
      if (decision.action === "assign") {
        this.cancelWait();
        this.host.assign(decision.url);
      } else if (decision.action === "ready") {
        this.cancelWait();
        this.host.replaceUrl(decision.url);
      } else if (decision.action === "wait") {
        this.ensureWait(conversationId, turns);
      }
      return decision;
    }
    cancelWait() {
      this.wait?.dispose();
      this.wait = null;
    }
    isWaiting() {
      return this.wait?.isActive() === true;
    }
    waitingConversationId() {
      return this.wait?.isActive() ? this.wait.conversationId : null;
    }
    hasActiveObserver() {
      return this.wait?.hasObserver() === true;
    }
    dispose() {
      window.removeEventListener("pagehide", this.onPageHide);
      window.removeEventListener("beforeunload", this.onPageHide);
      this.cancelWait();
    }
    ensureWait(conversationId, turns) {
      if (this.wait?.isActive() && this.wait.conversationId === conversationId) {
        this.wait.updateTurns(turns);
        return;
      }
      this.cancelWait();
      this.wait = new NativePrepWaiter(conversationId, turns, this.host, () => {
        if (this.wait?.conversationId === conversationId && !this.wait.isActive()) this.wait = null;
      });
    }
  };

  // src/navigation/diagnostics.ts
  var DEBUG_KEY = "chatgpt-yada:nav-debug";
  function isNavDebugEnabled() {
    try {
      return localStorage.getItem(DEBUG_KEY) === "1";
    } catch {
      return false;
    }
  }
  function publishNavigationDiagnostics(snapshot) {
    if (!isNavDebugEnabled() || !snapshot) {
      delete globalThis.__YADA_NAV_DIAGNOSTICS__;
      return;
    }
    globalThis.__YADA_NAV_DIAGNOSTICS__ = snapshot;
  }

  // src/navigation/identity.ts
  function findTurn(turns, turnId) {
    return turns.filter(
      (turn) => turn.id === turnId || turn.userMessageId === turnId || turn.assistantMessageId === turnId
    );
  }
  function resolveNavigationTurn(turns, turnId) {
    const matches = findTurn(turns, turnId);
    if (matches.length > 1) return { ok: false, status: "identity-conflict" };
    if (matches.length === 0) return { ok: false, status: "stale-target" };
    return { ok: true, turn: matches[0] };
  }
  function turnUserMessageId(turn) {
    return turn.userMessageId ?? turn.id;
  }

  // src/navigation/wait.ts
  function abortError5() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError4(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError5());
        return;
      }
      const timer = window.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, Math.max(0, ms));
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(abortError5());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  function nextFrame(signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError5());
        return;
      }
      const canRaf = typeof requestAnimationFrame === "function";
      const id = canRaf ? requestAnimationFrame(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }) : window.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, 16);
      const onAbort = () => {
        if (canRaf) cancelAnimationFrame(id);
        else window.clearTimeout(id);
        reject(abortError5());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  // src/navigation/nativeButtonDriver.ts
  async function jumpOfficialButton(conversationId, expectedTurnCount, targetIndex, userMessageId, signal, timeoutAt) {
    if (!isOfficialNavigationComplete(expectedTurnCount, conversationId)) return "unavailable";
    const buttons = collectOfficialButtons();
    const target = buttons[targetIndex];
    if (!target || target.index !== targetIndex) return "unavailable";
    if (signal.aborted) return "cancelled";
    try {
      target.element.click();
    } catch {
      return "failed";
    }
    try {
      while (Date.now() < timeoutAt) {
        if (signal.aborted) return "cancelled";
        const node = findMountedUserMessage(userMessageId);
        if (node && readMessageId(node) === userMessageId && isInViewport(node)) return "ok";
        await sleep(NATIVE_NAV_CONFIG.pollMs, signal);
      }
      return "timeout";
    } catch (error) {
      if (signal.aborted || isAbortError4(error)) return "cancelled";
      return "failed";
    }
  }

  // src/navigation/stableSlotDriver.ts
  function isAligned(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && rect.top === 0) return true;
    return Math.abs(rect.top) <= NATIVE_NAV_CONFIG.alignmentTolerancePx;
  }
  async function jumpStableSlot(turn, signal, timeoutAt) {
    const userMessageId = turn.userMessageId ?? turn.id;
    const slots = collectStableSlots();
    const slot = resolveStableSlot(turn, slots);
    if (!slot?.isConnected) {
      return { status: "unavailable", alignmentAttempts: 0, coarseLocates: 0 };
    }
    let coarseLocates = 0;
    let alignmentAttempts = 0;
    try {
      coarseLocates = 1;
      scrollElementIntoView(slot);
      let mounted = null;
      while (Date.now() < timeoutAt) {
        if (signal.aborted) return { status: "cancelled", alignmentAttempts, coarseLocates };
        mounted = findMountedUserMessage(userMessageId);
        if (mounted && readMessageId(mounted) === userMessageId) break;
        await sleep(NATIVE_NAV_CONFIG.pollMs, signal);
      }
      if (!mounted || readMessageId(mounted) !== userMessageId) {
        return { status: Date.now() >= timeoutAt ? "timeout" : "failed", alignmentAttempts, coarseLocates };
      }
      while (alignmentAttempts < NATIVE_NAV_CONFIG.maxAlignmentAttempts && Date.now() < timeoutAt) {
        if (signal.aborted) return { status: "cancelled", alignmentAttempts, coarseLocates };
        if (isInViewport(mounted) && isAligned(mounted) && readMessageId(mounted) === userMessageId) {
          return { status: "ok", alignmentAttempts, coarseLocates };
        }
        alignmentAttempts += 1;
        scrollElementIntoView(mounted);
        await sleep(NATIVE_NAV_CONFIG.alignmentQuietMs, signal);
        mounted = findMountedUserMessage(userMessageId) ?? mounted;
      }
      if (mounted && readMessageId(mounted) === userMessageId && isInViewport(mounted)) {
        return { status: "ok", alignmentAttempts, coarseLocates };
      }
      return { status: Date.now() >= timeoutAt ? "timeout" : "failed", alignmentAttempts, coarseLocates };
    } catch (error) {
      if (signal.aborted || isAbortError4(error)) return { status: "cancelled", alignmentAttempts, coarseLocates };
      return { status: "failed", alignmentAttempts, coarseLocates };
    }
  }

  // src/navigation/nativeNavigationPort.ts
  function directJump(status, coarseLocates) {
    return { status, coarseLocates, alignmentAttempts: 0 };
  }
  function targetKey(conversationId, turn) {
    return `${conversationId}|${turnUserMessageId(turn)}|${turn.index}`;
  }
  function linkAbortSignal(source, target) {
    if (!source) return () => void 0;
    const abort = () => target.abort();
    if (source.aborted) target.abort();
    source.addEventListener("abort", abort, { once: true });
    return () => source.removeEventListener("abort", abort);
  }
  async function jumpDirect(userMessageId, conversationId, signal, timeoutAt) {
    if (signal.aborted) return directJump("cancelled", 0);
    if (!pageConversationMatches(conversationId)) return directJump("stale-target", 0);
    const node = findMountedUserMessage(userMessageId);
    if (!node || !node.isConnected || readMessageId(node) !== userMessageId) return directJump("miss", 0);
    scrollElementIntoView(node);
    const coarseLocates = 1;
    const deadline = Math.min(timeoutAt, Date.now() + NATIVE_NAV_CONFIG.directViewportMs);
    try {
      while (true) {
        if (signal.aborted) return directJump("cancelled", coarseLocates);
        if (!pageConversationMatches(conversationId)) return directJump("stale-target", coarseLocates);
        const current = findMountedUserMessage(userMessageId);
        if (current?.isConnected && readMessageId(current) === userMessageId && isInViewport(current)) {
          return directJump("ok", coarseLocates);
        }
        if (Date.now() >= deadline) return directJump("miss", coarseLocates);
        await nextFrame(signal);
      }
    } catch (error) {
      if (signal.aborted || isAbortError4(error)) return directJump("cancelled", coarseLocates);
      throw error;
    }
  }
  var NativeNavigationPort = class {
    active = null;
    interrupt = null;
    lastDiagnostics = null;
    navigateTo(turnId, turns, conversationId, options = {}) {
      const resolved = resolveNavigationTurn(turns, turnId);
      if (!resolved.ok) return Promise.resolve(resolved);
      const key = targetKey(conversationId, resolved.turn);
      if (this.active?.key === key) return this.active.promise;
      this.cancel();
      const controller = new AbortController();
      const unlink = linkAbortSignal(options.signal, controller);
      const promise = this.run(resolved.turn, turns, conversationId, controller, options.timeoutMs).finally(() => {
        unlink();
        if (this.active?.controller === controller) this.active = null;
      });
      this.active = { key, controller, promise };
      return promise;
    }
    cancel() {
      this.active?.controller.abort();
      this.active = null;
      this.detachInterrupt();
    }
    dispose() {
      this.cancel();
      this.lastDiagnostics = null;
      publishNavigationDiagnostics(null);
    }
    async run(turn, turns, conversationId, controller, timeoutMs) {
      const started = Date.now();
      const limit = Math.max(1, Math.min(NATIVE_NAV_CONFIG.timeoutMs, timeoutMs ?? NATIVE_NAV_CONFIG.timeoutMs));
      const timeoutAt = started + limit;
      let timedOut = false;
      const timeoutTimer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Math.max(1, timeoutAt - Date.now()));
      this.attachInterrupt(() => controller.abort());
      const userMessageId = turnUserMessageId(turn);
      const capability = readNativeCapability(turns, conversationId);
      let path = null;
      let coarseLocates = 0;
      let alignmentAttempts = 0;
      let result = { ok: false, status: "failed" };
      try {
        if (controller.signal.aborted && !timedOut) return { ok: false, status: "cancelled" };
        const mounted = findMountedUserMessage(userMessageId);
        if (mounted && readMessageId(mounted) === userMessageId) {
          const jumped = await jumpDirect(userMessageId, conversationId, controller.signal, timeoutAt);
          coarseLocates += jumped.coarseLocates;
          alignmentAttempts += jumped.alignmentAttempts;
          if (jumped.status === "ok") {
            path = "direct";
            result = { ok: true, path: "direct" };
            return result;
          }
          if (jumped.status === "cancelled") {
            result = { ok: false, status: timedOut ? "timeout" : "cancelled" };
            return result;
          }
          if (jumped.status === "stale-target") {
            result = { ok: false, status: "stale-target" };
            return result;
          }
        }
        if (isOfficialNavigationComplete(turns.length, conversationId)) {
          path = "official-button";
          const jumped = await jumpOfficialButton(
            conversationId,
            turns.length,
            turn.index,
            userMessageId,
            controller.signal,
            timeoutAt
          );
          if (jumped === "ok") result = { ok: true, path: "official-button" };
          else if (jumped === "cancelled") result = { ok: false, status: timedOut ? "timeout" : "cancelled" };
          else if (jumped === "timeout") result = { ok: false, status: "timeout" };
          else if (jumped === "unavailable") result = { ok: false, status: "unsupported" };
          else result = { ok: false, status: "failed" };
          return result;
        }
        if (isStableSlotsComplete(turns)) {
          path = "stable-slot";
          const jumped = await jumpStableSlot(turn, controller.signal, timeoutAt);
          coarseLocates += jumped.coarseLocates;
          alignmentAttempts += jumped.alignmentAttempts;
          if (jumped.status === "ok") result = { ok: true, path: "stable-slot" };
          else if (jumped.status === "cancelled") result = { ok: false, status: timedOut ? "timeout" : "cancelled" };
          else if (jumped.status === "timeout") result = { ok: false, status: "timeout" };
          else if (jumped.status === "unavailable") result = { ok: false, status: "unsupported" };
          else result = { ok: false, status: "failed" };
          return result;
        }
        result = { ok: false, status: "unsupported" };
        return result;
      } catch (error) {
        if (timedOut) result = { ok: false, status: "timeout" };
        else if (controller.signal.aborted || isAbortError4(error)) result = { ok: false, status: "cancelled" };
        else result = { ok: false, status: "failed" };
        return result;
      } finally {
        window.clearTimeout(timeoutTimer);
        this.detachInterrupt();
        this.lastDiagnostics = {
          conversationId,
          targetIndex: turn.index,
          targetMessageId: userMessageId,
          path: result.ok ? result.path : path,
          officialButtonCount: capability.officialButtonCount,
          expectedTurnCount: turns.length,
          slotCount: capability.slotCount,
          reloadAttempted: nativePrepReloadAttempted(conversationId),
          coarseLocates,
          alignmentAttempts,
          yadaScrollWrites: coarseLocates + alignmentAttempts,
          result: result.ok ? result.path : result.status,
          duration: Date.now() - started
        };
        publishNavigationDiagnostics(this.lastDiagnostics);
      }
    }
    attachInterrupt(abort) {
      this.detachInterrupt();
      this.interrupt = attachUserNavigationCancel(abort);
    }
    detachInterrupt() {
      this.interrupt?.();
      this.interrupt = null;
    }
  };

  // src/navigation/navigatorController.ts
  var NavigatorController = class {
    constructor(sync) {
      this.sync = sync;
    }
    port = new NativeNavigationPort();
    snapshot = null;
    unsubscribe = null;
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => {
        this.snapshot = snapshot;
      });
    }
    async navigateTo(turnId, signal) {
      const snapshot = this.snapshot ?? this.sync.getSnapshot();
      if (!snapshot) return { ok: false, status: "failed" };
      return this.port.navigateTo(turnId, snapshot.activeTurns, snapshot.conversationId, { signal });
    }
    cancel() {
      this.port.cancel();
    }
    currentTurns() {
      return this.snapshot?.activeTurns ?? [];
    }
    lastDiagnostics() {
      return this.port.lastDiagnostics;
    }
    dispose() {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.port.dispose();
    }
  };

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

  // src/rail/preview.ts
  function formatPreviewTime(seconds) {
    if (seconds === void 0 || !Number.isFinite(seconds)) return "";
    const date = new Date(seconds * 1e3);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  function renderPreviewContent(preview, turn, assistant) {
    const title = document.createElement("strong");
    title.textContent = `第 ${turn.index + 1} 轮`;
    const heading = document.createElement("div");
    heading.className = "preview-header";
    heading.append(title);
    const timestamp = formatPreviewTime(turn.userCreatedAt);
    if (timestamp) {
      const time = document.createElement("time");
      time.textContent = timestamp;
      heading.append(time);
    }
    preview.replaceChildren(heading, block("Harson", turn.userPreview));
    if (assistant) preview.append(block("ChatGPT", turn.assistantPreview || "该轮暂无 ChatGPT 回复"));
  }
  function block(role, text) {
    const section = document.createElement("section");
    section.dataset.previewRole = role;
    const label = document.createElement("strong");
    label.textContent = role;
    const summary = document.createElement("p");
    summary.textContent = text;
    section.append(label, summary);
    return section;
  }

  // src/rail/view.ts
  var RAIL_HOST_ID = "chatgpt-yada-rail-host";
  var RailView = class {
    host = document.createElement("div");
    marks = document.createElement("div");
    preview = document.createElement("div");
    turns = [];
    buttons = [];
    active = -1;
    hovered = -1;
    assistant = false;
    timer = 0;
    pending = -1;
    failed = -1;
    themeDispose = null;
    constructor(onJump) {
      document.querySelectorAll(`[id="${RAIL_HOST_ID}"]`).forEach((node) => node.remove());
      this.host.id = RAIL_HOST_ID;
      this.host.dataset.yadaRoot = "true";
      this.host.setAttribute("data-yada-theme", detectYadaTheme());
      const shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
      :host { position: fixed; width: 58px; z-index: 2147483400; font: 12px/1.5 system-ui; --text:#303030; --bg:#fff; --bar:#aaa8; color:var(--text); background: transparent; }
      :host([hidden]) { display:none; }
      :host([data-yada-theme="dark"]) { --text:#eee; --bg:#272727; --bar:#aaa7; color-scheme:dark; }
      .marks { height:100%; display:flex; flex-direction:column; background: transparent; }
      .mark { position:relative; flex:1 1 0; min-height:0; padding:0; border:0; width:58px; background:transparent; display:flex; align-items:center; justify-content:flex-end; cursor:pointer; outline-offset:2px; }
      .mark-bar { display:block; height:1px; width:16px; border-radius:2px; background:var(--bar); transition:width .12s, background .12s; }
      .number { position:absolute; right:37px; color:var(--text); opacity:0; font:10px/1 system-ui; }
      .mark[data-active="true"] .mark-bar { width:24px; background:#10a37f; height:2px; }
      .mark[data-active="true"] .number, .mark[data-distance="0"] .number, .mark:focus-visible .number { opacity:1; }
      .mark[data-pending="true"] .mark-bar { width:22px; background:#10a37f88; }
      .mark[data-pending="true"] .number { opacity:1; }
      .mark[data-failed="true"] .mark-bar { background:#c0392b; }
      .mark[data-distance="3"] .mark-bar { width:19px; background:#10a37f66; }
      .mark[data-distance="2"] .mark-bar { width:23px; background:#10a37f99; }
      .mark[data-distance="1"] .mark-bar { width:28px; background:#10a37fcc; }
      .mark[data-distance="0"] .mark-bar { width:33px; background:#10a37f; height:2px; }
      .preview { position:fixed; box-sizing:border-box; width:min(340px, calc(100vw - 24px)); background:var(--bg); color:var(--text); border:1px solid #8884; box-shadow:0 5px 20px #0002; padding:10px 12px; border-radius:10px; pointer-events:none; overflow:hidden; }
      .preview[hidden] { display:none; }
      .preview strong { display:block; margin-bottom:4px; font-size:11px; }
      .preview section strong { color:#10a37f; font-weight:700; }
      .preview-header { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px; font-size:10px; }
      .preview-header strong { margin:0; white-space:nowrap; }
      .preview time { white-space:nowrap; opacity:.7; }
      .preview section + section { margin-top:8px; }
      .preview p { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
      .preview[data-expanded="true"] p { -webkit-line-clamp:5; }
      @media (prefers-reduced-motion:reduce) { .mark-bar { transition:none; } }
    `;
      this.marks.className = "marks";
      this.marks.dataset.marks = "true";
      this.marks.setAttribute("role", "navigation");
      this.marks.setAttribute("aria-label", "对话轮次");
      this.preview.className = "preview";
      this.preview.hidden = true;
      this.preview.style.pointerEvents = "none";
      shadow.append(style, this.marks, this.preview);
      document.documentElement.append(this.host);
      this.host.hidden = true;
      this.marks.addEventListener("pointermove", (event) => {
        const rect = this.marks.getBoundingClientRect();
        if (!rect.height || !this.turns.length) return;
        this.hover(Math.max(0, Math.min(this.turns.length - 1, Math.floor((event.clientY - rect.top) / rect.height * this.turns.length))));
      });
      this.marks.addEventListener("pointerleave", () => this.clearHover());
      this.marks.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        const turn = button && this.turns[Number(button.dataset.index)];
        if (turn) onJump(turn.userMessageId ?? turn.id);
      });
      this.marks.addEventListener("focusin", (event) => {
        const button = event.target.closest("button");
        if (button) this.hover(Number(button.dataset.index));
      });
      this.marks.addEventListener("focusout", () => this.clearHover());
      this.themeDispose = observeYadaTheme((theme) => this.host.setAttribute("data-yada-theme", theme));
    }
    setTurns(turns) {
      const changed = turns.length !== this.turns.length || turns.some((turn, index) => (turn.userMessageId ?? turn.id) !== (this.turns[index]?.userMessageId ?? this.turns[index]?.id));
      this.turns = turns;
      if (!changed) {
        if (this.hovered >= 0) this.showPreview();
        this.host.hidden = !turns.length;
        return;
      }
      this.clearHover();
      this.active = -1;
      this.pending = -1;
      this.failed = -1;
      this.buttons = turns.map((turn) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mark";
        button.dataset.index = String(turn.index);
        button.setAttribute("aria-label", `跳到第 ${turn.index + 1} 轮`);
        const number = document.createElement("span");
        number.className = "number";
        number.textContent = String(turn.index + 1);
        const bar = document.createElement("span");
        bar.className = "mark-bar";
        button.append(number, bar);
        return button;
      });
      this.marks.replaceChildren(...this.buttons);
      this.host.hidden = !turns.length;
    }
    setPending(index) {
      const previous = this.buttons[this.pending];
      if (previous) {
        delete previous.dataset.pending;
        previous.removeAttribute("aria-busy");
      }
      this.pending = index ?? -1;
      const next = index == null ? void 0 : this.buttons[index];
      if (next) {
        next.dataset.pending = "true";
        next.setAttribute("aria-busy", "true");
      }
    }
    setFailed(index) {
      const previous = this.buttons[this.failed];
      if (previous) delete previous.dataset.failed;
      this.failed = index ?? -1;
      const next = index == null ? void 0 : this.buttons[index];
      if (next) next.dataset.failed = "true";
    }
    setActive(index) {
      if (this.active === index) return;
      const old = this.buttons[this.active];
      if (old) {
        delete old.dataset.active;
        old.removeAttribute("aria-current");
      }
      this.active = index;
      const next = this.buttons[index];
      if (next) {
        next.dataset.active = "true";
        next.setAttribute("aria-current", "step");
      }
    }
    setPreviewMode(assistant) {
      this.assistant = assistant;
      if (this.hovered >= 0) this.showPreview();
    }
    clearHover() {
      window.clearTimeout(this.timer);
      this.timer = 0;
      for (const button of this.buttons.slice(Math.max(0, this.hovered - 3), this.hovered + 4)) delete button.dataset.distance;
      this.hovered = -1;
      this.preview.hidden = true;
    }
    dispose() {
      this.clearHover();
      this.themeDispose?.();
      this.host.remove();
    }
    previewIndex(index) {
      this.hover(index);
    }
    hover(index) {
      if (index === this.hovered || !this.turns[index]) return;
      this.clearHover();
      this.hovered = index;
      for (let n = Math.max(0, index - 3); n <= Math.min(this.buttons.length - 1, index + 3); n++) {
        this.buttons[n].dataset.distance = String(Math.abs(n - index));
      }
      this.preview.dataset.expanded = "false";
      this.showPreview();
      this.timer = window.setTimeout(() => {
        this.preview.dataset.expanded = "true";
        this.showPreview();
      }, 1e3);
    }
    showPreview() {
      const turn = this.turns[this.hovered];
      const button = this.buttons[this.hovered];
      if (!turn || !button) return;
      renderPreviewContent(this.preview, turn, this.assistant);
      this.preview.hidden = false;
      const rect = button.getBoundingClientRect();
      const width = this.preview.getBoundingClientRect().width || Math.min(340, innerWidth - 24);
      this.preview.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left - width - 12))}px`;
      this.preview.style.maxHeight = `${innerHeight - 16}px`;
      const height = this.preview.getBoundingClientRect().height;
      this.preview.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, rect.top + rect.height / 2 - height / 2))}px`;
    }
  };

  // src/navigation/officialVisibility.ts
  var OFFICIAL_NAV_STYLE_ID = "chatgpt-yada-official-nav-visibility-style";
  var ROOT_AT_END = `main [class$="_convSearchResultHighlightRoot"]`;
  var ROOT_BEFORE_SPACE = `main [class*="_convSearchResultHighlightRoot "]`;
  var FIXED_CHILD = '> [class~="fixed"][class~="inset-e-4"][class~="top-1/2"][class~="z-20"][class~="-translate-y-1/2"]:not([data-yada-root])';
  function officialNavigationHideGate(options) {
    const host = document.getElementById(RAIL_HOST_ID);
    return {
      yadaReady: Boolean(
        options.conversationPage && options.snapshot && options.snapshot.activeTurns.length > 0 && host && !host.hidden
      ),
      officialReady: listOfficialNavigationRoots().length === 1
    };
  }
  var OfficialNavigationVisibilityController = class {
    yadaReady = false;
    observer = null;
    raf = 0;
    update(gate) {
      this.yadaReady = gate.yadaReady;
      this.apply();
      if (this.yadaReady) this.ensureWatch();
      else this.stopWatch();
    }
    dispose() {
      this.yadaReady = false;
      this.stopWatch();
      this.removeStyle();
    }
    apply() {
      this.setHidden(this.yadaReady && listOfficialNavigationRoots().length === 1);
    }
    setHidden(hidden) {
      if (hidden) this.ensureStyle();
      else this.removeStyle();
    }
    ensureWatch() {
      if (this.observer) return;
      this.observer = new MutationObserver(() => this.scheduleApply());
      this.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class"]
      });
    }
    stopWatch() {
      this.observer?.disconnect();
      this.observer = null;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    scheduleApply() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.apply();
      });
    }
    ensureStyle() {
      if (document.getElementById(OFFICIAL_NAV_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = OFFICIAL_NAV_STYLE_ID;
      style.textContent = `
${ROOT_AT_END} ${FIXED_CHILD},
${ROOT_BEFORE_SPACE} ${FIXED_CHILD} {
  opacity: 0 !important;
  pointer-events: none !important;
}
`;
      document.head.append(style);
    }
    removeStyle() {
      document.getElementById(OFFICIAL_NAV_STYLE_ID)?.remove();
    }
  };

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
  async function readChatAccount(signal) {
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
    const accountId = getChatGptAccountId();
    const identityKey = await identity(`${userId ?? "unknown"}:${accountId ?? "personal"}`);
    return { userId, accountId, plan, identity: identityKey };
  }
  async function readModelLimits(now = Date.now(), signal) {
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
      return modelLimits(await response.json(), now);
    } catch {
      return [];
    }
  }

  // src/quota/tracker.ts
  var QuotaTracker = class {
    constructor(sync) {
      this.sync = sync;
    }
    unsubscribe = null;
    ingestQueue = Promise.resolve();
    history = createChromeHistoryStore();
    disposed = false;
    historyStarted = false;
    historyTimer = 0;
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
      document.addEventListener("visibilitychange", this.onVisibility);
      this.historyTimer = window.setTimeout(() => {
        void this.startHistoryScan();
      }, 4e3);
    }
    async refreshCurrent() {
      await withTimeout(this.sync.requestSync("popup"), REFRESH_TIMEOUT_MS, "同步超时");
      await withTimeout(this.ingestQueue, MESSAGE_TIMEOUT_MS, "账本写入超时");
    }
    dispose() {
      this.disposed = true;
      window.clearTimeout(this.historyTimer);
      this.unsubscribe?.();
      this.unsubscribe = null;
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    onSnapshot(snapshot) {
      const work = this.writeLedger(snapshot);
      this.ingestQueue = this.ingestQueue.then(() => work, () => work);
      if (snapshot) void this.startHistoryScan();
      return work;
    }
    startHistoryScan() {
      if (this.historyStarted || this.disposed) return;
      this.historyStarted = true;
      window.clearTimeout(this.historyTimer);
      void this.scanHistory();
    }
    async writeLedger(snapshot) {
      if (this.disposed || !snapshot) return;
      const account = await readChatAccount();
      const limits = await readModelLimits();
      const classification = classifySnapshot(snapshot);
      const events = snapshot.quotaIsWork ? [] : toEvents(snapshot.quotaTurns, account.identity, classification);
      await sendRuntimeMessage({
        type: "quota/ingest",
        events,
        plan: account.plan,
        unclassifiedTurns: snapshot.quotaUnclassifiedTurns,
        workspaceKind: snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal",
        limits,
        historyComplete: void 0,
        accountKey: account.identity
      });
    }
    async scanHistory() {
      if (this.disposed || document.visibilityState === "hidden") return;
      const account = await readChatAccount();
      const result = await readChatHistory({
        transport: {
          async request(path, signal) {
            const response = await chatgptApi(path, { signal });
            if (response.status === 401 || response.status === 403) throw Object.assign(new Error("login"), { name: "AbortError" });
            if (!response.ok) throw new Error(`history ${response.status}`);
            return response.json();
          }
        },
        fetchDetail: (id, signal) => fetchConversation(id, signal),
        store: this.history,
        identity: account.identity,
        now: Date.now()
      });
      if (this.disposed) return;
      const events = toEvents(result.turns, account.identity, "personal");
      await sendRuntimeMessage({
        type: "quota/ingest",
        events,
        plan: account.plan,
        unclassifiedTurns: result.summary.unclassifiedTurns,
        historyComplete: result.summary.complete,
        workspaceKind: "personal",
        accountKey: account.identity
      });
    }
    onVisibility = () => {
      if (document.visibilityState === "visible") void this.startHistoryScan();
    };
  };
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

  // src/rail/active.ts
  function viewport(root) {
    if (root === document.scrollingElement || root === document.documentElement) {
      return { top: 0, height: innerHeight };
    }
    const rect = root.getBoundingClientRect();
    const top = Math.max(0, rect.top + root.clientTop);
    return { top, height: Math.max(0, Math.min(innerHeight, rect.bottom) - top) };
  }
  function findScrollRoot() {
    const sample = document.querySelector('[data-message-author-role="user"], [data-message-author-role="assistant"]');
    let parent = sample?.parentElement ?? null;
    while (parent && parent !== document.body) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return parent;
      parent = parent.parentElement;
    }
    return document.scrollingElement ?? document.documentElement;
  }
  function readVisibleUserMessageId(root) {
    const area = viewport(root);
    const nodes = [...document.querySelectorAll('[data-message-author-role="user"][data-message-id], [data-message-author-role="user"]')];
    let best = null;
    for (const node of nodes) {
      const id = node.dataset.messageId ?? node.closest("[data-message-id]")?.dataset.messageId;
      if (!id) continue;
      const rect = node.getBoundingClientRect();
      if (rect.bottom < area.top || rect.top > area.top + area.height) continue;
      const distance = Math.abs(rect.top - (area.top + 80));
      if (!best || distance < best.distance) best = { id, distance };
    }
    return best?.id ?? null;
  }

  // src/rail/layout.ts
  function placeRail(host, root, count) {
    const main = document.querySelector("main");
    const bounds = [main, root === document.scrollingElement ? null : root].filter((element) => !!element).map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 100 && rect.height > 100);
    let right = 60;
    if (bounds.length) {
      right = Math.max(44, innerWidth - Math.min(...bounds.map((rect) => rect.right)) + 24);
    } else {
      for (const panel of document.querySelectorAll('aside, [role="complementary"], [data-testid*="panel"]')) {
        const rect = panel.getBoundingClientRect();
        if (["fixed", "sticky"].includes(getComputedStyle(panel).position) && rect.width > 100 && rect.height > 150 && rect.left > innerWidth / 2 && rect.right > innerWidth - 80) {
          right = Math.max(right, innerWidth - rect.left + 24);
        }
      }
    }
    const composer = document.querySelector("#prompt-textarea, form textarea, [data-testid*='composer' i]");
    const composerTop = composer?.getBoundingClientRect().top ?? innerHeight - 80;
    const area = viewport(root);
    const top = Math.max(90, area.top + 50);
    const bottomLimit = Math.min(area.top + area.height - 24, composerTop - 24, innerHeight - 24);
    const available = Math.max(30, bottomLimit - top);
    const height = Math.min(available, Math.max(count * 4, Math.min(count * 17, available)));
    host.style.right = `${Math.min(Math.max(8, innerWidth - 70), right)}px`;
    host.style.top = `${top + Math.max(0, (available - height) / 2)}px`;
    host.style.height = `${height}px`;
  }

  // src/rail/controller.ts
  var YadaRailController = class {
    constructor(sync, navigator2) {
      this.sync = sync;
      this.navigator = navigator2;
      this.view = new RailView((id) => {
        void this.jump(id);
      });
    }
    view;
    unsubscribe = null;
    snapshot = null;
    root = null;
    disposed = false;
    raf = 0;
    jumping = false;
    jumpGeneration = 0;
    jumpTarget = null;
    failTimer = 0;
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
      window.addEventListener("resize", this.onLayout, { passive: true });
      window.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
      this.root = findScrollRoot();
      this.root.addEventListener("scroll", this.onScroll, { passive: true });
    }
    setPreviewMode(assistant) {
      this.view.setPreviewMode(assistant);
    }
    clear() {
      this.snapshot = null;
      this.jumping = false;
      this.jumpTarget = null;
      window.clearTimeout(this.failTimer);
      this.view.setTurns([]);
      this.view.clearHover();
      this.view.setPending(null);
      this.view.setFailed(null);
    }
    dispose() {
      this.disposed = true;
      this.unsubscribe?.();
      this.unsubscribe = null;
      window.cancelAnimationFrame(this.raf);
      window.clearTimeout(this.failTimer);
      window.removeEventListener("resize", this.onLayout);
      window.removeEventListener("scroll", this.onScroll, true);
      this.root?.removeEventListener("scroll", this.onScroll);
      this.view.dispose();
    }
    onSnapshot(snapshot) {
      if (this.disposed) return;
      this.snapshot = snapshot;
      const turns = snapshot?.activeTurns ?? [];
      this.view.setTurns(turns);
      if (turns.length) {
        this.layout();
        if (!this.jumping) this.syncActive();
      }
    }
    async jump(turnId) {
      if (this.jumping && this.jumpTarget === turnId) return;
      const generation = ++this.jumpGeneration;
      this.jumpTarget = turnId;
      window.clearTimeout(this.failTimer);
      this.view.setFailed(null);
      this.jumping = true;
      const index = this.turnIndex(turnId);
      this.view.setPending(index);
      try {
        const result = await this.navigator.navigateTo(turnId);
        if (generation !== this.jumpGeneration) return;
        this.view.setPending(null);
        if (!result.ok && result.status === "cancelled") {
          this.syncActive();
          return;
        }
        if (!result.ok) {
          this.view.setFailed(index);
          this.failTimer = window.setTimeout(() => {
            if (generation !== this.jumpGeneration) return;
            this.view.setFailed(null);
            this.syncActive();
          }, NATIVE_NAV_CONFIG.failStyleMs);
          return;
        }
        if (index >= 0) this.view.setActive(index);
      } finally {
        if (generation === this.jumpGeneration) {
          this.jumping = false;
          this.jumpTarget = null;
        }
      }
    }
    turnIndex(turnId) {
      const turns = this.snapshot?.activeTurns ?? [];
      return turns.findIndex((turn) => turn.id === turnId || turn.userMessageId === turnId);
    }
    onLayout = () => {
      this.layout();
    };
    onScroll = () => {
      if (this.raf) return;
      this.raf = window.requestAnimationFrame(() => {
        this.raf = 0;
        this.syncActive();
      });
    };
    layout() {
      this.root = findScrollRoot();
      placeRail(this.view.host, this.root, this.snapshot?.activeTurns.length ?? 0);
    }
    syncActive() {
      if (this.jumping) return;
      const turns = this.snapshot?.activeTurns ?? [];
      if (!turns.length) return;
      this.root = findScrollRoot();
      const visibleId = readVisibleUserMessageId(this.root);
      const index = visibleId ? turns.findIndex((turn) => turn.userMessageId === visibleId || turn.id === visibleId) : -1;
      if (index >= 0) this.view.setActive(index);
    }
  };

  // inline-css:/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-optimization-20260916/gpt/src/prompts/panel.css
  var panel_default = '/* Modal adapted from GPT Conversation Toolkit. Copyright (c) 2026 bujue3709.\n * MIT; see THIRD_PARTY_NOTICES.md. Compact copy-only UI is a Yada adapter. */\n:host { font:13px/1.5 system-ui; color-scheme:light; }\n:host([hidden]), [hidden] { display:none !important; }\n* { box-sizing:border-box; }\n.yada-prompt-modal { position:fixed; inset:0; z-index:2147483647; --bg:#fff; --text:#303030; --muted:#666; --border:#8884; --hover:#8881; color:var(--text); overscroll-behavior:contain; }\n.yada-prompt-modal[data-toolkit-theme="dark"] { --bg:#272727; --text:#eee; --muted:#bbb; --hover:#fff1; color-scheme:dark; }\n.yada-prompt-backdrop { position:absolute; inset:0; background:#0006; touch-action:none; }\n.yada-prompt-panel { position:absolute; right:20px; bottom:20px; width:min(620px, calc(100vw - 24px)); min-height:0; height:auto; max-height:min(72vh, 680px); display:flex; flex-direction:column; gap:12px; padding:16px; overflow:hidden; background:var(--bg); border:1px solid var(--border); border-radius:16px; box-shadow:0 12px 40px #0003; }\n.yada-prompt-header, .yada-prompt-item-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }\n.yada-prompt-header { flex-shrink:0; }\n.yada-prompt-header strong { font-size:16px; }\n.yada-prompt-header-actions, .yada-prompt-item-actions { display:flex; gap:4px; flex-shrink:0; }\nbutton { font:inherit; color:inherit; background:transparent; border:1px solid var(--border); border-radius:8px; padding:5px 9px; cursor:pointer; }\nbutton:hover { background:var(--hover); }\nbutton:focus-visible, input:focus-visible, textarea:focus-visible { outline:2px solid #10a37f; outline-offset:2px; }\n[data-prompt-action="add"], .yada-prompt-add { color:#fff; background:#10a37f; border-color:#10a37f; }\n[data-prompt-action="add"]:hover, .yada-prompt-add:hover { background:#0c8567; }\n.yada-prompt-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; display:flex; flex-direction:column; gap:10px; scrollbar-width:thin; }\n.yada-prompt-item { border:1px solid var(--border); border-radius:10px; padding:10px 12px; flex-shrink:0; cursor:default; }\n.yada-prompt-item-title { margin:0; font-size:13px; overflow-wrap:anywhere; min-width:0; }\n.yada-prompt-icon { width:30px; height:30px; padding:6px; border-color:transparent; display:grid; place-items:center; }\n.yada-prompt-icon[data-prompt-action="delete"] { color:#c86464; }\n.yada-prompt-item-content { margin:6px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:5; overflow:hidden; }\n.yada-prompt-empty { margin:0; padding:12px; text-align:center; color:var(--muted); }\n.yada-prompt-editor { display:grid; grid-template-columns:1fr 1fr; gap:10px; min-height:0; flex-shrink:0; }\n.yada-prompt-editor input, .yada-prompt-editor textarea { grid-column:1 / -1; width:100%; background:var(--bg); color:inherit; border:1px solid var(--border); border-radius:8px; padding:8px; font:inherit; }\n.yada-prompt-editor textarea { height:clamp(50px, 20vh, 180px); min-height:0; resize:none; overscroll-behavior:contain; }\n[role="alert"] { margin:0; color:#c86464; }\n.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }\n@media (max-width:640px) { .yada-prompt-panel { right:12px; bottom:12px; } .yada-prompt-header { gap:6px; } }\n';

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
  var PREVIEW_KEY = "chatgpt-yada:preview-assistant:v1";
  function parseLibrary(value) {
    if (value === void 0) return { version: 1, prompts: [] };
    if (!value || typeof value !== "object") throw new Error("提示词数据无效");
    const data = value;
    if (data.version !== 1 || !Array.isArray(data.prompts)) throw new Error("提示词版本不支持");
    const ids = /* @__PURE__ */ new Set();
    for (const p of data.prompts) {
      if (!p || typeof p.id !== "string" || !p.id || ids.has(p.id) || typeof p.title !== "string" || typeof p.content !== "string" || !Number.isFinite(p.createdAt) || !Number.isFinite(p.updatedAt)) throw new Error("提示词数据无效");
      ids.add(p.id);
    }
    return data;
  }
  async function readLibrary() {
    return parseLibrary((await chrome.storage.local.get(PROMPT_KEY))[PROMPT_KEY]);
  }
  async function saveLibrary(library) {
    await chrome.storage.local.set({ [PROMPT_KEY]: parseLibrary(library) });
  }

  // src/prompts/panel.ts
  var svg = (body) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  var ICONS = {
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
      this.disposeTheme = observeYadaTheme((theme) => {
        this.modal.dataset.toolkitTheme = theme;
      });
      button.addEventListener("click", this.toggle);
      this.modal.addEventListener("click", this.handleClick);
      this.query("form").addEventListener("submit", (event) => {
        event.preventDefault();
        void this.saveEditor();
      });
      document.addEventListener("pointerdown", this.outside, true);
      document.addEventListener("keydown", this.keydown, true);
      this.modal.addEventListener("wheel", this.stopPageScroll, { passive: false });
      this.modal.addEventListener("touchmove", this.stopPageScroll, { passive: false });
    }
    host = document.createElement("div");
    root;
    modal;
    library = { version: 1, prompts: [] };
    copyTimers = /* @__PURE__ */ new Map();
    generation = 0;
    busy = false;
    disposed = false;
    editing = null;
    disposeTheme;
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
      this.disposeTheme();
      this.host.remove();
      this.button.removeEventListener("click", this.toggle);
      document.removeEventListener("pointerdown", this.outside, true);
      document.removeEventListener("keydown", this.keydown, true);
    }
    toggle = async () => {
      if (!this.host.hidden) {
        this.close();
        return;
      }
      const generation = ++this.generation;
      if (!this.host.isConnected) document.body.append(this.host);
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
      if (kind === "delete" && prompt) void this.persist({ version: 1, prompts: this.library.prompts.filter((item) => item.id !== prompt.id) });
      if (kind === "copy" && prompt) void this.copy(prompt, action);
    };
    renderList() {
      const items = [...this.library.prompts].sort((a, b) => b.updatedAt - a.updatedAt);
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
        header.append(title, actions);
        article.append(header, content);
        fragment.append(article);
      }
      list.append(fragment);
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
      await this.persist({ version: 1, prompts: previous ? this.library.prompts.map((p) => p.id === previous.id ? item : p) : [...this.library.prompts, item] });
    }
    async persist(next) {
      if (this.busy) return;
      this.busy = true;
      const generation = this.generation;
      try {
        await saveLibrary(next);
        this.library = next;
        if (!this.disposed && generation === this.generation) {
          this.renderList();
          this.query("form").hidden = true;
        }
      } catch {
        if (generation === this.generation) this.error("保存失败，内容仍保留，请重试。");
      } finally {
        this.busy = false;
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
  function renderQuotaIcon(size, rings, palette = DARK_ICON_PALETTE) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas is unavailable");
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;
    const geometry = ringGeometry(size);
    const values = [rings.outer, rings.middle, rings.inner];
    const colors = [COLORS.outer, COLORS.middle, COLORS.inner];
    geometry.forEach((ring, index) => {
      drawTrack(ctx, cx, cy, ring.radius, ring.width, palette.track);
      drawArc(ctx, cx, cy, ring.radius, ring.width, colors[index], values[index]);
    });
    if (size >= 32 && rings.center) {
      ctx.fillStyle = palette.center;
      ctx.font = `600 ${Math.round(size * (rings.center === "?" ? 0.42 : 0.34))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(rings.center, cx, cy + size * 0.02);
    }
    return ctx.getImageData(0, 0, size, size);
  }
  function paintQuotaCanvas(canvas, rings, palette = DARK_ICON_PALETTE) {
    const image = renderQuotaIcon(32, rings, palette);
    canvas.width = 32;
    canvas.height = 32;
    let ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;
    try {
      ctx.putImageData(image, 0, 0);
    } catch {
    }
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

  // src/quota/iconState.ts
  function snapshotToRings(snapshot) {
    const incomplete = snapshot.coverageLabel !== "完整" || snapshot.tightestRemainingPercent == null;
    return {
      outer: remainingToRatio(snapshot.gpt6ProWeekly?.estimatedRemaining ?? 0, snapshot.gpt6ProWeekly?.limit ?? 1),
      middle: remainingToRatio(snapshot.solProDaily?.estimatedRemaining ?? 0, snapshot.solProDaily?.limit ?? 1),
      inner: remainingToRatio(snapshot.combinedDaily?.estimatedRemaining ?? 0, snapshot.combinedDaily?.limit ?? 1),
      center: incomplete ? "?" : String(snapshot.tightestRemainingPercent ?? 0)
    };
  }
  function snapshotTitle(snapshot) {
    const workspace = snapshot.personalProEligible ? "" : "\n当前工作区不计入个人 Pro Chat 额度";
    return [
      "ChatGPT Yada Pro 额度",
      "",
      metricLine("GPT-6 Pro", snapshot.gpt6ProWeekly),
      metricLine("GPT-5.6 Sol Pro", snapshot.solProDaily),
      metricLine("两个 Pro", snapshot.combinedDaily),
      "",
      `历史同步：${snapshot.historyComplete ? "完整" : "不完整"}`,
      `未分类轮次：${snapshot.unclassifiedTurns}`,
      snapshot.updatedLabel,
      workspace
    ].join("\n").trim();
  }
  function metricLine(label, metric) {
    if (!metric) return `${label}：当前套餐无此桶`;
    if (metric.estimatedRemaining == null) return `${label}：已记录 ${metric.used}，历史同步不完整`;
    return `${label}：预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
  }

  // src/quota/presentation.ts
  function metricRemainingLabel(metric) {
    if (!metric) return "当前套餐无此桶";
    if (metric.estimatedRemaining == null) return `已记录 ${metric.used} / ${metric.limit}`;
    return `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
  }
  function metricPercentLabel(metric) {
    if (!metric || metric.remainingRatio == null) return "?";
    return `${Math.round(metric.remainingRatio * 100)}%`;
  }
  function historySyncLabel(snapshot) {
    return snapshot.historyComplete ? "历史同步完整" : "历史同步不完整";
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
      return [{ title: "两个 Pro", metric: snapshot.combinedDaily }];
    }
    return [
      { title: "GPT-6 Pro", metric: snapshot.gpt6ProWeekly },
      { title: "GPT-5.6 Sol Pro", metric: snapshot.solProDaily },
      { title: "两个 Pro", metric: snapshot.combinedDaily }
    ];
  }

  // src/quota/types.ts
  var LEDGER_KEY = "chatgpt-yada:quota-ledger:v2";
  var STATE_KEY = "chatgpt-yada:quota-state:v2";
  var EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1e3;

  // src/ui/quotaIndicator.ts
  var QUOTA_INDICATOR_DEBOUNCE_MS = 80;
  var UNKNOWN_QUOTA_RINGS = { outer: 0, middle: 0, inner: 0, center: "?" };
  var POPOVER_CSS = `
  [data-quota-popover] {
    position: absolute;
    z-index: 30;
    box-sizing: border-box;
    width: 260px;
    max-width: calc(100vw - 16px);
    padding: 12px;
    border: 1px solid var(--yada-button-border);
    border-radius: 12px;
    background: #fff;
    color: var(--yada-text);
    box-shadow: 0 10px 28px rgba(15, 15, 15, 0.12);
    font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: left;
    white-space: normal;
  }
  :host([data-yada-theme="dark"]) [data-quota-popover] {
    background: #2a2a2a;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  }
  [data-quota-popover] h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
  }
  [data-quota-popover] h3 {
    margin: 10px 0 2px;
    font-size: 12px;
    font-weight: 700;
  }
  [data-quota-popover] p {
    margin: 0;
  }
  [data-quota-popover] [data-quota-note],
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] {
    margin-top: 8px;
    font-size: 11px;
    color: var(--yada-muted);
  }
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] {
    color: var(--yada-text);
  }
`;
  var QuotaIndicator = class {
    constructor(button, options = {}) {
      this.button = button;
      this.send = options.send ?? ((message, timeoutMs) => sendRuntimeMessage(message, timeoutMs));
      this.debounceMs = options.debounceMs ?? QUOTA_INDICATOR_DEBOUNCE_MS;
      this.canvas = button.querySelector("canvas") ?? button.appendChild(document.createElement("canvas"));
      this.canvas.setAttribute("aria-hidden", "true");
      const root = this.root();
      this.styleEl = document.createElement("style");
      this.styleEl.textContent = POPOVER_CSS;
      this.popover = document.createElement("div");
      this.popover.hidden = true;
      this.popover.dataset.quotaPopover = "true";
      this.popover.setAttribute("role", "dialog");
      this.popover.setAttribute("aria-label", "Pro 模型额度");
      root.append(this.styleEl, this.popover);
      this.themeObserver = new MutationObserver(() => this.paint(this.rings));
      const host = this.host();
      if (host) this.themeObserver.observe(host, { attributes: true, attributeFilter: ["data-yada-theme"] });
      this.button.setAttribute("aria-haspopup", "dialog");
      this.button.addEventListener("click", this.onClick);
      document.addEventListener("pointerdown", this.onPointerDown, true);
      document.addEventListener("keydown", this.onKeyDown, true);
      chrome.storage?.onChanged?.addListener(this.onStorageChanged);
      this.apply(null, "loading");
      void this.loadState();
    }
    send;
    debounceMs;
    canvas;
    popover;
    styleEl;
    themeObserver;
    disposed = false;
    generation = 0;
    refreshTimer = 0;
    status = "loading";
    snapshot = null;
    rings = UNKNOWN_QUOTA_RINGS;
    close = () => {
      this.popover.hidden = true;
      this.button.setAttribute("aria-expanded", "false");
    };
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.close();
      this.generation += 1;
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = 0;
      this.themeObserver.disconnect();
      this.button.removeEventListener("click", this.onClick);
      document.removeEventListener("pointerdown", this.onPointerDown, true);
      document.removeEventListener("keydown", this.onKeyDown, true);
      chrome.storage?.onChanged?.removeListener(this.onStorageChanged);
      this.popover.remove();
      this.styleEl.remove();
    }
    onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.popover.hidden) this.open();
      else this.close();
    };
    onPointerDown = (event) => {
      if (this.popover.hidden) return;
      const path = event.composedPath();
      if (path.includes(this.button) || path.includes(this.popover)) return;
      this.close();
    };
    onKeyDown = (event) => {
      if (this.popover.hidden || event.key !== "Escape") return;
      event.stopPropagation();
      this.close();
      this.button.focus();
    };
    onStorageChanged = (changes, area) => {
      if (this.disposed || area !== "local") return;
      if (!changes[LEDGER_KEY] && !changes[STATE_KEY]) return;
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = 0;
        void this.loadState();
      }, this.debounceMs);
    };
    async loadState() {
      const generation = ++this.generation;
      try {
        const response = await this.send({ type: "quota/get-state" });
        if (this.disposed || generation !== this.generation) return;
        if (response?.error) throw new Error(response.error);
        if (!response?.snapshot) throw new Error("无法读取额度账本");
        this.apply(response.snapshot, "ready");
      } catch {
        if (this.disposed || generation !== this.generation) return;
        this.apply(null, "error");
      }
    }
    apply(snapshot, status) {
      this.snapshot = snapshot;
      this.status = status;
      const rings = snapshot ? snapshotToRings(snapshot) : UNKNOWN_QUOTA_RINGS;
      this.paint(rings);
      this.setTitle(
        status === "error" ? "Pro 额度暂不可用" : snapshot ? snapshotTitle(snapshot) : "Pro 额度：读取中"
      );
      if (!this.popover.hidden) {
        this.renderPopover();
        this.positionPopover();
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
        this.theme() === "light" ? LIGHT_ICON_PALETTE : DARK_ICON_PALETTE
      );
    }
    setTitle(title) {
      this.button.title = title;
      this.button.setAttribute("aria-label", title);
    }
    open() {
      this.renderPopover();
      this.popover.hidden = false;
      this.button.setAttribute("aria-expanded", "true");
      this.positionPopover();
    }
    renderPopover() {
      this.popover.replaceChildren();
      const heading = document.createElement("h2");
      heading.textContent = "Pro 模型额度";
      this.popover.append(heading);
      if (this.status === "error" || this.status === "ready" && !this.snapshot) {
        this.popover.append(note("无法读取额度账本", "quota-error"));
        return;
      }
      if (!this.snapshot) return;
      const planNote = planStatusNote(this.snapshot);
      if (planNote) this.popover.append(note(planNote, "quota-warn"));
      else {
        for (const bucket of snapshotBucketViews(this.snapshot)) {
          const section = document.createElement("section");
          const title = document.createElement("h3");
          title.textContent = bucket.title;
          const remaining = document.createElement("p");
          remaining.textContent = metricRemainingLabel(bucket.metric);
          const percent = document.createElement("p");
          percent.textContent = metricPercentLabel(bucket.metric);
          section.append(title, remaining, percent);
          this.popover.append(section);
        }
      }
      this.popover.append(note("预计剩余", "quota-note"));
      this.popover.append(note(historySyncLabel(this.snapshot), "quota-note"));
      this.popover.append(note("只统计个人 Chat，不统计 Work 和 Codex", "quota-note"));
      this.popover.append(note(this.snapshot.updatedLabel, "quota-note"));
      const workspace = workspaceStatusNote(this.snapshot);
      if (workspace) this.popover.append(note(workspace, "quota-warn"));
    }
    positionPopover() {
      const host = this.host();
      const width = 260;
      if (!host) {
        this.popover.style.width = `${width}px`;
        return;
      }
      const hostRect = host.getBoundingClientRect();
      const buttonRect = this.button.getBoundingClientRect();
      const minLeft = 8 - hostRect.left;
      const maxLeft = window.innerWidth - 8 - width - hostRect.left;
      const preferred = buttonRect.right - hostRect.left - width;
      const left = Math.min(Math.max(preferred, minLeft), Math.max(minLeft, maxLeft));
      this.popover.style.width = `${width}px`;
      this.popover.style.left = `${left}px`;
      this.popover.style.right = "auto";
      this.popover.style.top = `${buttonRect.bottom - hostRect.top + 6}px`;
    }
    theme() {
      return this.host()?.getAttribute("data-yada-theme") === "dark" ? "dark" : "light";
    }
    host() {
      const root = this.button.getRootNode();
      return root instanceof ShadowRoot ? root.host : this.button.parentElement;
    }
    root() {
      const root = this.button.getRootNode();
      return root instanceof ShadowRoot ? root : document;
    }
  };
  function note(text, kind) {
    const node = document.createElement("p");
    node.dataset[kind === "quota-note" ? "quotaNote" : kind === "quota-warn" ? "quotaWarn" : "quotaError"] = "true";
    node.textContent = text;
    return node;
  }

  // src/ui/toolbar.ts
  var YadaToolbar = class {
    constructor(onPreviewMode = () => {
    }, sync = null) {
      this.onPreviewMode = onPreviewMode;
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
    previewAssistant = false;
    closePanels() {
      this.prompts?.close();
      this.quota?.close();
    }
    mount() {
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
      this.quota = new QuotaIndicator(this.query("[data-quota]"));
      this.prompts = new PromptPanel(this.query("[data-prompts]"));
      const mode = this.query("[data-preview-mode]");
      const applyMode = () => {
        mode.setAttribute("aria-pressed", String(this.previewAssistant));
        mode.title = this.previewAssistant ? "预览：User + ChatGPT" : "预览：User";
        mode.setAttribute("aria-label", mode.title);
        this.onPreviewMode(this.previewAssistant);
      };
      let modeTouched = false;
      void chrome.storage.local.get(PREVIEW_KEY).then((data) => {
        if (!this.host || modeTouched) return;
        this.previewAssistant = data[PREVIEW_KEY] === true;
        applyMode();
      }).catch(() => applyMode());
      mode.addEventListener("click", () => {
        modeTouched = true;
        this.previewAssistant = !this.previewAssistant;
        applyMode();
        void chrome.storage.local.set({ [PREVIEW_KEY]: this.previewAssistant }).catch(() => {
          mode.title = "预览模式保存失败，下次打开将恢复旧设置";
        });
      });
      this.disposeTheme = observeYadaTheme((theme) => {
        this.host?.setAttribute("data-yada-theme", theme);
      });
      this.placementObserver = new MutationObserver(() => this.schedulePlacement());
      this.placementObserver.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("resize", this.handleViewportChange, { passive: true });
      this.ensurePlacement();
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
        return;
      }
      if (this.host.parentElement !== document.documentElement) {
        document.documentElement.append(this.host);
      }
      this.host.dataset.placement = "fixed";
    }
    dispose() {
      this.quota?.dispose();
      this.quota = null;
      this.prompts?.dispose();
      window.clearTimeout(this.copyResetTimer);
      window.clearTimeout(this.placementTimer);
      this.placementObserver?.disconnect();
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
        button[data-preview-mode],
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
        button[data-preview-mode] {
          font-size: 16px;
          color: var(--yada-muted);
        }
        button[data-preview-mode][aria-pressed="true"] { color: var(--yada-primary); }
        button[data-quota] canvas {
          display: block;
          width: 20px;
          height: 20px;
        }
      </style>
      <button type="button" data-preview-mode aria-pressed="false" aria-label="预览：User" title="预览：User">●</button>
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
        if (!snapshot && this.sync) {
          await this.sync.requestSync("copy");
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

  // src/utils/route.ts
  function observeRouteChange(onChange) {
    let previousUrl = location.href, raf = 0;
    const check = () => {
      const currentUrl = location.href;
      if (currentUrl !== previousUrl) {
        const old = previousUrl;
        previousUrl = currentUrl;
        onChange(currentUrl, old);
      }
    };
    const frame = () => {
      check();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("popstate", check);
      window.removeEventListener("hashchange", check);
    };
  }

  // src/content.ts
  var ChatGptYadaApp = class {
    sync = null;
    navigator = null;
    rail = null;
    toolbar = null;
    quota = null;
    prep = null;
    officialNav = null;
    prepDispose = null;
    routeDispose = null;
    messageDispose = null;
    hostGuard = null;
    remounts = 0;
    mount() {
      this.sync = new ConversationSync();
      this.sync.mountPageObserver();
      this.navigator = new NavigatorController(this.sync);
      this.navigator.mount();
      this.rail = new YadaRailController(this.sync, this.navigator);
      this.rail.mount();
      this.quota = new QuotaTracker(this.sync);
      this.quota.mount();
      this.toolbar = new YadaToolbar((assistant) => this.rail?.setPreviewMode(assistant), this.sync);
      this.toolbar.mount();
      this.prep = new NativePreparationController();
      this.officialNav = new OfficialNavigationVisibilityController();
      this.prepDispose = this.sync.subscribe((snapshot) => {
        this.prep?.evaluate(snapshot?.conversationId ?? null, snapshot?.activeTurns ?? []);
        this.updateOfficialVisibility(snapshot);
      });
      this.syncPageState();
      this.routeDispose = observeRouteChange(() => {
        this.toolbar?.closePanels();
        this.rail?.clear();
        this.navigator?.cancel();
        this.prep?.cancelWait();
        this.updateOfficialVisibility(null);
        this.syncPageState();
      });
      const onMessage = (message, _sender, sendResponse) => {
        if (message?.type !== "quota/refresh-current") return false;
        void this.quota?.refreshCurrent().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: String(error) }));
        return true;
      };
      chrome.runtime.onMessage.addListener(onMessage);
      this.messageDispose = () => chrome.runtime.onMessage.removeListener(onMessage);
      this.hostGuard = new MutationObserver(() => {
        if (document.getElementById("chatgpt-yada-rail-host") && document.getElementById("chatgpt-yada-toolbar-host")) return;
        if (this.remounts >= 5) return;
        this.remounts += 1;
        this.dispose();
        this.mount();
      });
      this.hostGuard.observe(document, { childList: true });
      this.hostGuard.observe(document.documentElement, { childList: true });
    }
    dispose = () => {
      this.hostGuard?.disconnect();
      this.hostGuard = null;
      this.routeDispose?.();
      this.routeDispose = null;
      this.messageDispose?.();
      this.messageDispose = null;
      this.prepDispose?.();
      this.prepDispose = null;
      this.officialNav?.dispose();
      this.officialNav = null;
      this.prep?.dispose();
      this.prep = null;
      this.quota?.dispose();
      this.quota = null;
      this.rail?.dispose();
      this.rail = null;
      this.navigator?.dispose();
      this.navigator = null;
      this.toolbar?.dispose();
      this.toolbar = null;
      this.sync?.dispose();
      this.sync = null;
    };
    syncPageState() {
      this.toolbar?.ensurePlacement();
      this.toolbar?.setVisible(isChatGptPage());
      const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector("[data-copy-all]");
      if (copy) copy.hidden = !isChatGptConversationPage();
      this.sync?.setActiveConversation(getConversationIdFromUrl());
      if (!isChatGptConversationPage()) this.updateOfficialVisibility(null);
    }
    updateOfficialVisibility(snapshot) {
      this.officialNav?.update(officialNavigationHideGate({
        conversationPage: isChatGptConversationPage(),
        snapshot
      }));
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
      if (event.persisted) {
        app.dispose();
        app.mount();
      }
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
