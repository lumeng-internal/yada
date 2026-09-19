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
  var ChatGPTApiTimeoutError = class extends Error {
    constructor() {
      super("ChatGPT API timed out");
      this.name = "ChatGPTApiTimeoutError";
    }
  };
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
    let read = 0;
    let cancelled = false;
    let hitDeadline = false;
    let hitDetailBudget = false;
    const turns = [];
    const aborted = () => Boolean(input.signal?.aborted);
    const recordFailure = (error) => {
      failures += 1;
      if (error instanceof RetryableHistoryTransportError) retryableFailures += 1;
      else permanentFailures += 1;
    };
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
              permanentFailures += 1;
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
                  recordFailure(error);
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
            permanentFailures += 1;
            break;
          }
        }
        if (reachedEnd) streamsFinished += 1;
      }
    } catch (error) {
      if (isAbortError2(error)) cancelled = true;
      else recordFailure(error);
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
        retryableFailures,
        permanentFailures,
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
    if (candidates.length !== 1) return { found: 0, visible: 0 };
    const container = [...candidates[0].children].find(
      (child) => child instanceof HTMLElement && OFFICIAL_CONTAINER_TOKENS.every((token) => child.classList.contains(token)) && !child.closest("[data-yada-root]")
    );
    if (!container) return { found: 0, visible: 0 };
    const buttons = [...container.querySelectorAll("button")];
    const indexes = buttons.map(readPromptIndex);
    if (!indexes.length || indexes.some((index) => index === null)) return { found: 0, visible: 0 };
    const numeric = indexes;
    if (new Set(numeric).size !== numeric.length) return { found: 0, visible: 0 };
    const first = Math.min(...numeric);
    const ordered = [...numeric].map((index) => index - (first === 1 ? 1 : 0)).sort((left, right) => left - right);
    if (!ordered.every((index, position) => index === position)) return { found: 0, visible: 0 };
    return { found: buttons.length, visible: buttons.filter(elementVisible).length };
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
    const matches = [...scroller.querySelectorAll(SENTINEL_SELECTOR)];
    if (matches.length !== 1) return null;
    const element = matches[0];
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
  function elementVisible(element) {
    if (!element.isConnected || element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
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
    const matches = [...document.querySelectorAll(`[${identity2.attribute}="${CSS.escape(identity2.value)}"]`)];
    if (matches.length !== 1) return null;
    return matches[0].matches(MESSAGE_SELECTOR) ? matches[0] : matches[0].querySelector(MESSAGE_SELECTOR);
  }

  // src/nativeNavigator/protocol.ts
  var NATIVE_NAV_CHANNEL = "chatgpt-yada:native-nav:v1";
  var HISTORY_ISSUES = /* @__PURE__ */ new Set([
    null,
    "http-error",
    "capture-unavailable",
    "unlinked",
    "stalled",
    "limit"
  ]);
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
      issue: null
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
  function isNativeHistoryState(value) {
    const candidate = record(value);
    if (!candidate) return false;
    if (candidate.conversationId !== null && !identifier(candidate.conversationId)) return false;
    if (candidate.boundary !== "unknown" && candidate.boundary !== "more" && candidate.boundary !== "complete") return false;
    if (!HISTORY_ISSUES.has(candidate.issue) || typeof candidate.cursorPresent !== "boolean") return false;
    for (const key of ["generation", "initialVersion", "revision", "pending", "pages", "messages", "prompts"]) {
      const number = candidate[key];
      if (!Number.isSafeInteger(number) || number < 0 || number > 1e6) return false;
    }
    return true;
  }

  // src/nativeNavigator/hydrator.ts
  var ACTIVE_LIMIT_MS = 6e4;
  var ADDITIONAL_PAGE_LIMIT = 20;
  var PAGE_PROGRESS_LIMIT_MS = 12e3;
  var NATIVE_APPEARANCE_WAIT_MS = 2500;
  var RECOVERY_IDLE_MS = 2500;
  var MAX_RECOVERIES = 3;
  var DEBUG_KEY = "chatgpt-yada:native-nav-debug";
  var OfficialNavigatorHydrator = class {
    constructor(sync) {
      this.sync = sync;
    }
    state = emptyHistory(conversationIdFromUrl(location.href));
    expectedPrompts = 0;
    context = "";
    firstPage = 0;
    activeMs = 0;
    recoveries = 0;
    peakDrift = 0;
    completeSince = 0;
    connected = false;
    terminal = false;
    phase = "waiting";
    issue = null;
    lastUserInput = performance.now() - RECOVERY_IDLE_MS;
    operation = null;
    timer = 0;
    mutations = null;
    unsubscribe = null;
    disposed = false;
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => {
        this.expectedPrompts = snapshot?.conversationId === this.state.conversationId ? snapshot.activeTurns.length : 0;
        this.schedule();
      });
      addEventListener("message", this.onMessage);
      addEventListener("wheel", this.onUserInput, { capture: true, passive: true });
      addEventListener("touchstart", this.onUserInput, { capture: true, passive: true });
      addEventListener("pointerdown", this.onUserInput, { capture: true, passive: true });
      addEventListener("keydown", this.onUserInput, { capture: true, passive: true });
      addEventListener("resize", this.onEnvironment, { passive: true });
      document.addEventListener("visibilitychange", this.onEnvironment);
      this.mutations = new MutationObserver(() => this.schedule());
      this.mutations.observe(document.documentElement, { subtree: true, childList: true });
      this.requestState();
      this.schedule(600);
    }
    resetRoute() {
      this.cancel("route");
      this.state = emptyHistory(conversationIdFromUrl(location.href), this.state.generation + 1);
      this.connected = false;
      this.expectedPrompts = 0;
      this.resetContext("", 0);
      this.setPhase("waiting");
      this.requestState();
      this.schedule(300);
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.cancel("dispose");
      clearTimeout(this.timer);
      this.timer = 0;
      this.mutations?.disconnect();
      this.mutations = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
      removeEventListener("message", this.onMessage);
      removeEventListener("wheel", this.onUserInput, true);
      removeEventListener("touchstart", this.onUserInput, true);
      removeEventListener("pointerdown", this.onUserInput, true);
      removeEventListener("keydown", this.onUserInput, true);
      removeEventListener("resize", this.onEnvironment);
      document.removeEventListener("visibilitychange", this.onEnvironment);
      delete globalThis.__YADA_NATIVE_NAV_DIAGNOSTICS__;
    }
    onMessage = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const message = record(event.data);
      if (message?.channel !== NATIVE_NAV_CHANNEL || message.kind !== "state" || !isNativeHistoryState(message.state)) return;
      const incoming = message.state;
      if (incoming.conversationId !== conversationIdFromUrl(location.href)) return;
      if (incoming.generation < this.state.generation) return;
      if (incoming.generation === this.state.generation && incoming.revision < this.state.revision) return;
      const incomingContext = `${incoming.conversationId ?? ""}:${incoming.generation}:${incoming.initialVersion}`;
      if (incomingContext !== this.context) {
        this.cancel("context");
        this.resetContext(incomingContext, incoming.pages);
      }
      this.state = incoming;
      this.connected = true;
      this.schedule();
    };
    onUserInput = () => {
      this.lastUserInput = performance.now();
      if (this.operation) {
        this.cancel("user");
        this.setPhase("interrupted");
      } else {
        this.schedule(RECOVERY_IDLE_MS);
      }
    };
    onEnvironment = () => {
      if (document.visibilityState !== "visible") this.cancel("hidden");
      this.schedule(document.visibilityState === "visible" ? RECOVERY_IDLE_MS : 800);
    };
    schedule(delayMs = 180) {
      if (this.disposed) return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        void this.evaluate();
      }, Math.max(0, delayMs));
    }
    async evaluate() {
      if (this.disposed || this.operation) return;
      const native = readNativePrompts();
      if (!this.connected || !this.state.conversationId || this.state.initialVersion === 0 || this.state.pending > 0) {
        this.setPhase("waiting");
        return;
      }
      if (isMessageDeepLink()) {
        this.terminal = true;
        this.setPhase("deep-link");
        return;
      }
      if (this.state.boundary === "complete") {
        this.finishWithNativeState(native);
        return;
      }
      if (this.terminal) {
        this.publishDiagnostics();
        return;
      }
      if (this.state.issue || this.state.boundary === "unknown") {
        this.terminal = true;
        this.setPhase("unverified", this.state.issue ?? "unverified-history");
        return;
      }
      if (!safeDesktopLayout()) {
        this.setPhase("deferred");
        this.schedule(800);
        return;
      }
      const idleFor = performance.now() - this.lastUserInput;
      if (idleFor < RECOVERY_IDLE_MS) {
        this.setPhase("deferred");
        this.schedule(RECOVERY_IDLE_MS - idleFor);
        return;
      }
      if (this.activeMs >= ACTIVE_LIMIT_MS || this.state.pages - this.firstPage >= ADDITIONAL_PAGE_LIMIT) {
        this.terminal = true;
        this.setPhase("limit", "limit");
        return;
      }
      await this.launchAttempt();
    }
    finishWithNativeState(native) {
      const snapshotMatch = this.expectedPrompts > 0 && native.found === this.expectedPrompts;
      const captureMatch = this.state.prompts > 0 && native.found === this.state.prompts;
      if (native.found > 0 && native.visible > 0 && (snapshotMatch || captureMatch)) {
        this.terminal = true;
        this.setPhase("ready-complete");
        return;
      }
      if (native.found > 0 && this.expectedPrompts > 0 && !snapshotMatch && !captureMatch) {
        this.terminal = true;
        this.setPhase("prompt-count-mismatch", "prompt-count-mismatch");
        return;
      }
      if (this.completeSince === 0) this.completeSince = performance.now();
      const remaining = NATIVE_APPEARANCE_WAIT_MS - (performance.now() - this.completeSince);
      if (remaining > 0) {
        this.setPhase("waiting-native");
        this.schedule(remaining);
        return;
      }
      this.terminal = true;
      this.setPhase("loaded-no-native");
    }
    async launchAttempt() {
      const controller = new AbortController();
      const attemptContext = this.context;
      const started = performance.now();
      this.operation = controller;
      this.setPhase("automatic-loading");
      let outcome;
      try {
        outcome = await this.hydrate(controller.signal, attemptContext);
      } catch {
        outcome = controller.signal.reason === "user" || controller.signal.reason === "hidden" ? "interrupted" : "changed";
      } finally {
        this.activeMs += Math.max(0, performance.now() - started);
        if (this.operation === controller) this.operation = null;
      }
      if (this.disposed || attemptContext !== this.context) return;
      if (outcome === "complete") {
        this.completeSince = 0;
        this.schedule(0);
        return;
      }
      if (outcome === "interrupted") {
        if (this.recoveries < MAX_RECOVERIES && this.activeMs < ACTIVE_LIMIT_MS) {
          this.recoveries += 1;
          this.setPhase("recovering");
          this.schedule(RECOVERY_IDLE_MS);
        } else {
          this.terminal = true;
          this.setPhase("recovery-limit", "recovery-limit");
        }
        return;
      }
      this.terminal = true;
      this.setPhase(outcome, outcome);
    }
    async hydrate(signal, context) {
      const position = saveReadingPosition();
      if (!position || !stableLayoutAvailable()) return "incompatible-layout";
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
        if (context !== this.context || this.state.conversationId !== conversationIdFromUrl(location.href)) return "changed";
        if (watch.problem()) return watch.problem();
        if (document.visibilityState !== "visible") return "interrupted";
        if (this.state.issue) return this.state.issue;
        if (this.state.boundary === "unknown") return "unverified";
        if (performance.now() >= activeDeadline || this.state.pages - this.firstPage >= ADDITIONAL_PAGE_LIMIT) return "limit";
        return null;
      };
      try {
        for (; ; ) {
          const currentProblem = problem();
          if (currentProblem) return currentProblem;
          if (this.state.pending > 0) {
            await abortableDelay(40, signal);
            continue;
          }
          if (this.state.boundary === "complete") return "complete";
          const pageAtStart = this.state.pages;
          const pendingAtStart = this.state.pending;
          exposure = exposePaginationSentinel(position.scroller);
          if (!exposure) return "incompatible-layout";
          const pageDeadline = Math.min(activeDeadline, performance.now() + PAGE_PROGRESS_LIMIT_MS);
          let hostStarted = false;
          while (performance.now() < pageDeadline) {
            await abortableDelay(20, signal);
            const waitProblem = problem();
            if (waitProblem) return waitProblem;
            if (this.state.pending > pendingAtStart || this.state.pages !== pageAtStart || this.state.boundary === "complete") {
              hostStarted = true;
              release();
              break;
            }
            const rectangle = exposure.element.getBoundingClientRect();
            const top = position.scroller === document.scrollingElement ? 0 : position.scroller.getBoundingClientRect().top + position.scroller.clientTop;
            if (!exposure.element.isConnected || rectangle.bottom < top || rectangle.top > top + position.scroller.clientHeight) {
              return "incompatible-layout";
            }
          }
          release();
          if (!hostStarted) return "stalled";
          while (this.state.pending > 0 || this.state.pages === pageAtStart) {
            const completionProblem = problem();
            if (completionProblem) return completionProblem;
            if (performance.now() >= pageDeadline) return "stalled";
            await abortableDelay(40, signal);
          }
          await abortableDelay(240, signal);
        }
      } finally {
        release();
        watch.dispose();
        signal.removeEventListener("abort", release);
      }
    }
    cancel(reason) {
      this.operation?.abort(reason);
    }
    resetContext(context, firstPage) {
      this.context = context;
      this.firstPage = firstPage;
      this.activeMs = 0;
      this.recoveries = 0;
      this.peakDrift = 0;
      this.completeSince = 0;
      this.terminal = false;
      this.issue = null;
    }
    setPhase(phase, issue = null) {
      this.phase = phase;
      this.issue = issue;
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
        pages: this.state.pages,
        messages: this.state.messages,
        capturedPrompts: this.state.prompts,
        expectedPrompts: this.expectedPrompts,
        nativeFound: native.found,
        nativeVisible: native.visible,
        boundary: this.state.boundary,
        cursorPresent: this.state.cursorPresent,
        issue: this.issue ?? this.state.issue,
        recoveryCount: this.recoveries,
        elapsedActiveMs: Math.round(this.activeMs),
        maxObservedDriftPx: Math.round(this.peakDrift * 10) / 10
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
  var FIRST_HISTORY_DELAY_MS = 4e3;
  var NEXT_HISTORY_SLICE_DELAY_MS = 1500;
  var MAX_HISTORY_PASSES = 20;
  var HISTORY_LIST_TIMEOUT_MS = 45e3;
  async function requestHistoryList(path, signal) {
    try {
      const response = await chatgptApi(path, { signal }, { timeoutMs: HISTORY_LIST_TIMEOUT_MS });
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("login"), { name: "AbortError" });
      }
      if ([408, 500, 502, 503, 504].includes(response.status)) {
        throw new RetryableHistoryTransportError(`history ${response.status}`);
      }
      if (!response.ok) throw new Error(`history ${response.status}`);
      return await response.json();
    } catch (error) {
      if (!signal?.aborted && (error instanceof ChatGPTApiTimeoutError || error instanceof TypeError)) {
        throw new RetryableHistoryTransportError("History list transport interrupted");
      }
      throw error;
    }
  }
  var QuotaTracker = class {
    constructor(sync) {
      this.sync = sync;
    }
    unsubscribe = null;
    ingestQueue = Promise.resolve();
    history = createChromeHistoryStore();
    disposed = false;
    historyFlight = null;
    historyTimer = 0;
    historyAbort = null;
    historyIdentity = null;
    historyPass = 0;
    historyStopped = false;
    historyResumePending = false;
    lastAccount = null;
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
      document.addEventListener("visibilitychange", this.onVisibility);
      this.scheduleHistory(FIRST_HISTORY_DELAY_MS);
    }
    async refreshCurrent() {
      await withTimeout(this.sync.requestSync("popup"), REFRESH_TIMEOUT_MS, "同步超时");
      await withTimeout(this.ingestQueue, MESSAGE_TIMEOUT_MS, "账本写入超时");
      this.historyStopped = false;
      this.historyResumePending = false;
      this.scheduleHistory(0);
    }
    dispose() {
      this.disposed = true;
      this.historyAbort?.abort();
      this.historyAbort = null;
      this.historyResumePending = false;
      window.clearTimeout(this.historyTimer);
      this.historyTimer = 0;
      this.unsubscribe?.();
      this.unsubscribe = null;
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    onSnapshot(snapshot) {
      const work = this.writeLedger(snapshot);
      this.ingestQueue = this.ingestQueue.then(() => work, () => work);
      if (snapshot && !this.historyStopped) this.scheduleHistory(600);
      return work;
    }
    scheduleHistory(delayMs) {
      if (this.disposed || this.historyStopped || this.historyFlight || document.visibilityState === "hidden") return;
      window.clearTimeout(this.historyTimer);
      this.historyTimer = window.setTimeout(() => {
        this.historyTimer = 0;
        this.startHistoryScan();
      }, Math.max(0, delayMs));
    }
    startHistoryScan() {
      if (this.disposed || this.historyStopped || this.historyFlight || document.visibilityState === "hidden") return;
      const controller = new AbortController();
      this.historyAbort = controller;
      this.historyFlight = this.scanHistory(controller.signal).catch((error) => this.handleHistoryError(error, controller.signal)).finally(() => {
        if (this.historyAbort === controller) this.historyAbort = null;
        this.historyFlight = null;
        if (this.historyResumePending) {
          this.historyResumePending = false;
          this.scheduleHistory(NEXT_HISTORY_SLICE_DELAY_MS);
        }
      });
    }
    async scanHistory(signal) {
      const account = await readChatAccount(signal);
      if (signal.aborted || this.disposed) return;
      this.lastAccount = account;
      if (this.historyIdentity !== account.identity) {
        this.historyIdentity = account.identity;
        this.historyPass = 0;
        this.historyStopped = false;
        this.historyResumePending = false;
      }
      this.historyPass += 1;
      await this.publishHistoryState(account, [], "backfill", false, void 0, null);
      const result = await readChatHistory({
        transport: { request: requestHistoryList },
        fetchDetail: (id, requestSignal) => fetchConversation(id, requestSignal),
        store: this.history,
        identity: account.identity,
        now: Date.now(),
        signal
      });
      if (signal.aborted || this.disposed) return;
      if (result.summary.cancelled) throw new Error("login");
      const resumable = historyNeedsAnotherPass(result.summary) && this.historyPass < MAX_HISTORY_PASSES;
      const status = result.summary.complete ? "ready" : resumable ? "backfill" : "partial";
      await this.publishHistoryState(
        account,
        result.turns,
        status,
        result.summary.complete,
        result.summary.unclassifiedTurns,
        null
      );
      if (resumable) this.historyResumePending = true;
      else this.historyStopped = true;
    }
    async handleHistoryError(error, signal) {
      if (signal.aborted || this.disposed) return;
      this.historyStopped = true;
      this.historyResumePending = false;
      const account = this.lastAccount;
      if (!account) return;
      const message = conciseError(error);
      await this.publishHistoryState(account, [], "error", false, void 0, message).catch(() => void 0);
    }
    async publishHistoryState(account, turns, syncStatus, historyComplete, unclassifiedTurns, historyError) {
      const events = toEvents(turns, account.identity, "personal");
      await sendRuntimeMessage({
        type: "quota/ingest",
        events,
        plan: account.plan,
        unclassifiedTurns,
        historyComplete,
        syncStatus,
        historyError,
        workspaceKind: "personal",
        accountKey: account.identity
      });
    }
    async writeLedger(snapshot) {
      if (this.disposed || !snapshot) return;
      const account = await readChatAccount();
      this.lastAccount = account;
      const limits = await readModelLimits();
      const classification = classifySnapshot(snapshot);
      const events = snapshot.quotaIsWork ? [] : toEvents(snapshot.quotaTurns, account.identity, classification);
      await sendRuntimeMessage({
        type: "quota/ingest",
        events,
        plan: account.plan,
        workspaceKind: snapshot.quotaIsWork ? "work" : classification === "unknown" ? "unknown" : "personal",
        limits,
        historyComplete: void 0,
        accountKey: account.identity
      });
    }
    onVisibility = () => {
      if (document.visibilityState === "hidden") {
        this.historyAbort?.abort();
        window.clearTimeout(this.historyTimer);
        this.historyTimer = 0;
        return;
      }
      if (!this.historyStopped) {
        if (this.historyFlight) this.historyResumePending = true;
        else this.scheduleHistory(RECOVERY_DELAY_MS);
      }
    };
  };
  var RECOVERY_DELAY_MS = 600;
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
    return !summary.complete && !summary.cancelled && summary.permanentFailures === 0 && (summary.hitDetailBudget || summary.hitDeadline || summary.retryableFailures > 0);
  }

  // inline-css:/Volumes/AutomationData/10_Workspace/Codex/yada-gpt-official-only-20260919/gpt/src/prompts/panel.css
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
      const symbolic = rings.center === "…" || rings.center === "—" || rings.center === "!";
      ctx.font = `600 ${Math.round(size * (symbolic ? 0.42 : 0.34))}px system-ui, sans-serif`;
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

  // src/quota/presentation.ts
  function metricRemainingLabel(metric) {
    if (!metric) return "当前套餐无此桶";
    if (metric.estimatedRemaining == null) return `已记录 ${metric.used} / ${metric.limit}`;
    return `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
  }
  function metricPercentLabel(metric) {
    if (!metric || metric.remainingRatio == null) return "—";
    return `${Math.round(metric.remainingRatio * 100)}%`;
  }
  function historySyncLabel(snapshot) {
    switch (snapshot.syncStatus) {
      case "loading":
        return "正在读取额度";
      case "backfill":
        return `正在补齐最近 7 天 ChatGPT 历史 · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次`;
      case "ready":
        return "历史同步完整";
      case "error":
        return `额度读取失败${snapshot.historyError ? ` · ${snapshot.historyError}` : ""}`;
      default:
        return `历史暂未补齐 · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次，暂不猜剩余次数`;
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
      return [{ title: "两个 Pro", metric: snapshot.combinedDaily }];
    }
    return [
      { title: "GPT-6 Pro", metric: snapshot.gpt6ProWeekly },
      { title: "GPT-5.6 Sol Pro", metric: snapshot.solProDaily },
      { title: "两个 Pro", metric: snapshot.combinedDaily }
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
      metricLine("两个 Pro", snapshot.combinedDaily),
      "",
      `历史同步：${historySyncLabel(snapshot)}`,
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

  // src/quota/types.ts
  var LEDGER_KEY = "chatgpt-yada:quota-ledger:v2";
  var STATE_KEY = "chatgpt-yada:quota-state:v2";
  var EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1e3;

  // src/ui/quotaIndicator.ts
  var QUOTA_INDICATOR_DEBOUNCE_MS = 80;
  var QUOTA_POPOVER_HOST_ID = "chatgpt-yada-quota-popover-host";
  var UNKNOWN_QUOTA_RINGS = { outer: 0, middle: 0, inner: 0, center: "…" };
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
  [data-quota-popover] h2 { margin: 0 0 8px; font-size: 13px; font-weight: 700; }
  [data-quota-popover] h3 { margin: 10px 0 2px; font-size: 12px; font-weight: 700; }
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
`;
  var QuotaIndicator = class {
    constructor(button, options = {}) {
      this.button = button;
      this.send = options.send ?? ((message, timeoutMs) => sendRuntimeMessage(message, timeoutMs));
      this.debounceMs = options.debounceMs ?? QUOTA_INDICATOR_DEBOUNCE_MS;
      this.canvas = button.querySelector("canvas") ?? button.appendChild(document.createElement("canvas"));
      this.canvas.setAttribute("aria-hidden", "true");
      document.getElementById(QUOTA_POPOVER_HOST_ID)?.remove();
      this.portalHost = document.createElement("div");
      this.portalHost.id = QUOTA_POPOVER_HOST_ID;
      this.portalHost.dataset.yadaRoot = "true";
      this.themeValue = detectYadaTheme();
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
      this.disposeTheme = observeYadaTheme((theme) => {
        this.themeValue = theme;
        this.portalHost.dataset.yadaTheme = theme;
        this.paint(this.rings);
      });
      this.button.setAttribute("aria-haspopup", "dialog");
      this.button.addEventListener("click", this.onClick);
      document.addEventListener("pointerdown", this.onPointerDown, true);
      document.addEventListener("keydown", this.onKeyDown, true);
      window.addEventListener("resize", this.onViewportChange, { passive: true });
      window.addEventListener("scroll", this.onViewportChange, { passive: true, capture: true });
      chrome.storage?.onChanged?.addListener(this.onStorageChanged);
      this.apply(null, "loading");
      void this.loadState();
    }
    send;
    debounceMs;
    canvas;
    portalHost;
    popover;
    disposeTheme;
    disposed = false;
    generation = 0;
    refreshTimer = 0;
    status = "loading";
    snapshot = null;
    rings = UNKNOWN_QUOTA_RINGS;
    themeValue;
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
      this.disposeTheme();
      this.button.removeEventListener("click", this.onClick);
      document.removeEventListener("pointerdown", this.onPointerDown, true);
      document.removeEventListener("keydown", this.onKeyDown, true);
      window.removeEventListener("resize", this.onViewportChange);
      window.removeEventListener("scroll", this.onViewportChange, true);
      chrome.storage?.onChanged?.removeListener(this.onStorageChanged);
      this.portalHost.remove();
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
      if (path.includes(this.button) || path.includes(this.popover) || path.includes(this.portalHost)) return;
      this.close();
    };
    onKeyDown = (event) => {
      if (this.popover.hidden || event.key !== "Escape") return;
      event.stopPropagation();
      this.close();
      this.button.focus();
    };
    onViewportChange = () => {
      if (!this.popover.hidden) this.positionPopover();
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
      const rings = status === "error" ? ERROR_QUOTA_RINGS : snapshot ? snapshotToRings(snapshot) : UNKNOWN_QUOTA_RINGS;
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
        this.themeValue === "light" ? LIGHT_ICON_PALETTE : DARK_ICON_PALETTE
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
      if (!this.snapshot) {
        this.popover.append(note("正在读取额度", "quota-note"));
        return;
      }
      this.popover.append(note(historySyncLabel(this.snapshot), this.snapshot.syncStatus === "error" ? "quota-error" : "quota-note"));
      if (this.snapshot.syncStatus === "error") return;
      const planNote = planStatusNote(this.snapshot);
      if (planNote) this.popover.append(note(planNote, "quota-warn"));
      else if (this.snapshot.syncStatus === "ready") {
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
      this.popover.append(note("本地估算，不是 ChatGPT 官方余额", "quota-note"));
      this.popover.append(note("只统计个人 Chat，不统计 Work 和 Codex", "quota-note"));
      this.popover.append(note(this.snapshot.updatedLabel, "quota-note"));
      const workspace = workspaceStatusNote(this.snapshot);
      if (workspace) this.popover.append(note(workspace, "quota-warn"));
    }
    positionPopover() {
      const buttonRect = this.button.getBoundingClientRect();
      const width = Math.min(POPOVER_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2));
      const left = clamp(
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
  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }
  function note(text, kind) {
    const node = document.createElement("p");
    node.dataset[kind === "quota-note" ? "quotaNote" : kind === "quota-warn" ? "quotaWarn" : "quotaError"] = "true";
    node.textContent = text;
    return node;
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
    hydrator = null;
    toolbar = null;
    quota = null;
    routeDispose = null;
    messageDispose = null;
    hostGuard = null;
    remounts = 0;
    mount() {
      this.sync = new ConversationSync();
      this.sync.mountPageObserver();
      this.hydrator = new OfficialNavigatorHydrator(this.sync);
      this.hydrator.mount();
      this.quota = new QuotaTracker(this.sync);
      this.quota.mount();
      this.toolbar = new YadaToolbar(this.sync);
      this.toolbar.mount();
      this.syncPageState();
      this.routeDispose = observeRouteChange(() => {
        this.toolbar?.closePanels();
        this.hydrator?.resetRoute();
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
        if (document.getElementById("chatgpt-yada-toolbar-host")) return;
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
      this.hydrator?.dispose();
      this.hydrator = null;
      this.quota?.dispose();
      this.quota = null;
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
