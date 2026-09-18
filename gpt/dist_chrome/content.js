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
  async function fetchCompleteConversation(id, headers, signal) {
    const request = async (url) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, 1e4);
      try {
        if (signal?.aborted || controller.signal.aborted) throw abortError();
        const response = await fetch(url, { credentials: "include", cache: "no-store", headers, signal: controller.signal });
        if (signal?.aborted || controller.signal.aborted) throw abortError();
        if (!response.ok) throw new Error(`ChatGPT conversation API failed: ${response.status}`);
        const data = await response.json();
        if (!data || typeof data !== "object") throw new Error("Conversation API returned an empty response");
        return data;
      } catch (error) {
        if (signal?.aborted || controller.signal.aborted || isAbortError(error)) throw abortError();
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    };
    const complete = (raw) => {
      const data = unwrap(raw);
      if (!isCompleteConversationMapping(raw)) throw new Error("Incomplete active conversation path");
      return { ...data, id: data.id ?? data.conversation_id ?? id, current_node: data.current_node ?? data.current_node_id };
    };
    const base = `/backend-api/conversation/${encodeURIComponent(id)}`;
    let activeTip = "";
    let lastError;
    try {
      const full = await request(`${base}?include_full_conversation=true`);
      activeTip = unwrap(full).current_node ?? unwrap(full).current_node_id ?? "";
      return complete(full);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    }
    try {
      const first = unwrap(await request(getPaginatedConversationApiUrl(id)));
      if (!Array.isArray(first.messages)) throw new Error("Paginated conversation API returned no messages");
      let messages = mergePaginatedConversationMessages([], first.messages);
      let cursor = getPaginatedConversationCursor(first);
      const seen = /* @__PURE__ */ new Set();
      let count = 1;
      while (cursor) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (seen.has(cursor) || count >= MAX_PAGES) throw new Error("Conversation pagination stalled");
        seen.add(cursor);
        const page = unwrap(await request(getPaginatedConversationApiUrl(id, cursor)));
        if (!Array.isArray(page.messages)) throw new Error("Conversation message page returned no messages");
        messages = mergePaginatedConversationMessages(page.messages, messages);
        cursor = getPaginatedConversationCursor(page);
        count++;
      }
      if (!messages.length) throw new Error("Paginated conversation is empty");
      const current = first.current_node ?? first.current_node_id ?? activeTip;
      const rebuilt = buildConversationMappingFromMessages(messages, id, current);
      return { ...first, ...rebuilt, messages };
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    }
    for (const url of [base, `${base}?offset=0&limit=100000`]) {
      try {
        return complete(await request(url));
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
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
    return fetch(path, { credentials: "include", cache: "no-store", ...init, headers });
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
    sessionTokenPromise ??= fetchSessionToken();
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
  function parseInteger(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
    return value;
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
          if (aborted()) throw abortError2();
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
                  const detail = await input.transport.request(`/backend-api/conversation/${id}`, input.signal);
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
          if (!items.length) reachedEnd = true;
          const total = parseInteger(root.total);
          if (total != null && offset >= total) reachedEnd = true;
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
  function abortError2() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError2(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }

  // src/conversation/readConversation.ts
  function abortError3() {
    return new DOMException("Aborted", "AbortError");
  }
  function isAbortError3(error) {
    return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
  }
  async function readConversation(conversationId, signal) {
    if (signal?.aborted) throw abortError3();
    if (!conversationId) throw new Error("No active ChatGPT conversation");
    const conversation = await fetchCurrentConversation(conversationId, signal);
    if (signal?.aborted) throw abortError3();
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
      if (this.disposed) return Promise.reject(abortError3());
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
            if (this.disposed || signal.aborted) throw abortError3();
            if (this.activeConversationId === conversationId && this.generation === generation) {
              snapshot.revision = ++this.published;
              await this.publish(snapshot);
            }
          } catch (error) {
            if (this.disposed) return;
            if (isAbortError3(error) || this.generation !== generation) continue;
            if (this.activeConversationId === conversationId) await this.publish(null);
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
  var NAVIGATION_CONFIG = {
    promptTopOffsetPx: 16,
    fingerprint: {
      countPerAssistant: 3,
      probeLength: 40,
      verificationLength: 256,
      segmentViewportRatio: 0.75,
      segmentOverlapRatio: 0.15,
      estimatedCharsPerVisualLine: 60,
      estimatedRowsPerViewport: 30,
      maximumSegmentsPerAssistant: 20,
      buildBatchSize: 10,
      buildTimeBudgetMs: 8,
      observationDebounceMs: 750
    },
    anchorCache: {
      maxConversations: 50,
      maxAnchorsPerConversation: 100,
      maxAgeMs: 30 * 24 * 60 * 60 * 1e3,
      viewportWidthTolerance: 48
    },
    search: {
      maxAttempts: 32,
      maxUnproductiveAttempts: 6,
      renderWaitMs: 80,
      maxDurationMs: 3e4,
      edgeBackfillWaitMs: 1200,
      maximumWindowSlideCycles: 16,
      interpolationFailuresBeforeBinary: 2,
      relativeViewportRatio: 0.75,
      minimumRelativeViewportRatio: 0.25,
      maximumRelativeViewportCount: 16,
      maximumLearnedRelativeViewportCount: 64,
      nearTargetPromptDistance: 4,
      maximumNearTargetViewportCount: 8,
      stalledStepGrowthRatio: 1.5,
      crossingStepRatio: 0.5,
      promptMountScanViewportRatio: 0.2,
      minimumPromptMountViewportRatio: 0.05,
      maximumPromptMountViewportCount: 2,
      promptMountStepGrowthRatio: 1.5,
      promptMountCrossingStepRatio: 0.5,
      maximumPromptMountAttempts: 12
    }
  };
  var APP_CONFIG = {
    platforms: {
      chatgpt: {
        promptTopOffsetPx: NAVIGATION_CONFIG.promptTopOffsetPx,
        settleAttempts: 3
      }
    },
    navigation: {
      fingerprint: NAVIGATION_CONFIG.fingerprint,
      anchorCache: NAVIGATION_CONFIG.anchorCache,
      search: NAVIGATION_CONFIG.search
    }
  };

  // vendor/luna-navigation/src/navigation/jump/navigationAnchorStore.ts
  var CACHE_VERSION = 2;
  var DEFAULT_STORAGE_KEY = "chatToc:navigationAnchors";
  function createNavigationAnchorStore(options = {}) {
    const config = APP_CONFIG.navigation.anchorCache;
    const storage = options.storage || createChromeNavigationAnchorStorage();
    const now = options.now || Date.now;
    const maxConversations = options.maxConversations ?? config.maxConversations;
    const maxAnchorsPerConversation = options.maxAnchorsPerConversation ?? config.maxAnchorsPerConversation;
    const maxAgeMs = options.maxAgeMs ?? config.maxAgeMs;
    const viewportWidthTolerance = options.viewportWidthTolerance ?? config.viewportWidthTolerance;
    const observedByConversation = /* @__PURE__ */ new Map();
    let persistentCachePromise = null;
    function recordObservation(input) {
      const anchor = createNavigationAnchor(input, now());
      const conversationAnchors = observedByConversation.get(anchor.conversationKey) || /* @__PURE__ */ new Map();
      conversationAnchors.set(anchor.promptId, anchor);
      observedByConversation.set(anchor.conversationKey, conversationAnchors);
      return cloneAnchor(anchor);
    }
    function getObservedAnchors(conversationKey) {
      return sortAnchors(
        [...observedByConversation.get(conversationKey)?.values() || []].map(
          cloneAnchor
        )
      );
    }
    async function recordConfirmed(input) {
      const anchor = createNavigationAnchor(input, now());
      const cache = await getPersistentCache();
      const conversation = cache.conversations[anchor.conversationKey] || {
        lastUsedAt: anchor.updatedAt,
        anchors: []
      };
      const nextAnchors = conversation.anchors.filter(
        ({ promptId }) => promptId !== anchor.promptId
      );
      nextAnchors.push(anchor);
      conversation.lastUsedAt = anchor.updatedAt;
      conversation.anchors = keepMostRecent(
        nextAnchors,
        maxAnchorsPerConversation
      );
      cache.conversations[anchor.conversationKey] = conversation;
      prunePersistentCache(cache, now(), {
        maxAgeMs,
        maxConversations
      });
      await storage.write(clonePersistentCache(cache));
      return cloneAnchor(anchor);
    }
    async function findConfirmed(query) {
      const cache = await getPersistentCache();
      const currentTime = now();
      const conversation = cache.conversations[query.conversationKey];
      if (!conversation) return null;
      const anchor = conversation.anchors.find(
        (candidate) => candidate.promptId === query.promptId && candidate.promptIndex === query.promptIndex && currentTime - candidate.updatedAt <= maxAgeMs && Math.abs(candidate.viewportWidth - query.viewportWidth) <= viewportWidthTolerance
      );
      return anchor ? cloneAnchor(anchor) : null;
    }
    async function removeConfirmed(conversationKey, promptId) {
      const cache = await getPersistentCache();
      const conversation = cache.conversations[conversationKey];
      if (!conversation) return false;
      const nextAnchors = conversation.anchors.filter(
        (anchor) => anchor.promptId !== promptId
      );
      if (nextAnchors.length === conversation.anchors.length) return false;
      if (nextAnchors.length === 0) {
        delete cache.conversations[conversationKey];
      } else {
        conversation.anchors = nextAnchors;
        conversation.lastUsedAt = now();
      }
      await storage.write(clonePersistentCache(cache));
      return true;
    }
    async function getConfirmedAnchors(conversationKey) {
      const cache = await getPersistentCache();
      const currentTime = now();
      const anchors = cache.conversations[conversationKey]?.anchors || [];
      return sortAnchors(
        anchors.filter((anchor) => currentTime - anchor.updatedAt <= maxAgeMs).map(cloneAnchor)
      );
    }
    async function getPersistentCache() {
      persistentCachePromise ||= storage.read().then((value) => {
        const cache = parsePersistentCache(value);
        prunePersistentCache(cache, now(), {
          maxAgeMs,
          maxConversations
        });
        return cache;
      });
      return persistentCachePromise;
    }
    return {
      recordObservation,
      getObservedAnchors,
      recordConfirmed,
      removeConfirmed,
      findConfirmed,
      getConfirmedAnchors
    };
  }
  function createChromeNavigationAnchorStorage(storageKey = DEFAULT_STORAGE_KEY) {
    return {
      async read() {
        const localStorage = getChromeLocalStorage();
        if (!localStorage) return void 0;
        try {
          const values = await localStorage.get(storageKey);
          return values[storageKey];
        } catch {
          return void 0;
        }
      },
      async write(value) {
        const localStorage = getChromeLocalStorage();
        if (!localStorage) return;
        try {
          await localStorage.set({ [storageKey]: value });
        } catch {
        }
      }
    };
  }
  function getChromeLocalStorage() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
    return chrome.storage.local;
  }
  function createNavigationAnchor(input, updatedAt = Date.now()) {
    const maximumScrollTop = Math.max(
      0,
      input.scrollHeight - input.viewportHeight
    );
    const scrollTop = clamp(input.scrollTop, 0, maximumScrollTop);
    return {
      conversationKey: input.conversationKey,
      promptId: input.promptId,
      promptIndex: Math.max(0, Math.trunc(input.promptIndex)),
      scrollTop,
      scrollHeight: Math.max(0, input.scrollHeight),
      viewportWidth: Math.max(0, input.viewportWidth),
      viewportHeight: Math.max(0, input.viewportHeight),
      scrollProgress: maximumScrollTop > 0 ? scrollTop / maximumScrollTop : 0,
      updatedAt
    };
  }
  function parsePersistentCache(value) {
    if (!isRecord(value) || value.version !== CACHE_VERSION) {
      return createEmptyPersistentCache();
    }
    const conversationsValue = value.conversations;
    if (!isRecord(conversationsValue)) return createEmptyPersistentCache();
    const conversations = {};
    Object.entries(conversationsValue).forEach(
      ([conversationKey, conversationValue]) => {
        if (!isRecord(conversationValue)) return;
        const lastUsedAt = conversationValue.lastUsedAt;
        const anchorsValue = conversationValue.anchors;
        if (typeof lastUsedAt !== "number" || !Array.isArray(anchorsValue)) {
          return;
        }
        const anchors = anchorsValue.filter(isNavigationAnchor).map(cloneAnchor);
        if (anchors.length === 0) return;
        conversations[conversationKey] = {
          lastUsedAt,
          anchors
        };
      }
    );
    return {
      version: CACHE_VERSION,
      conversations
    };
  }
  function prunePersistentCache(cache, currentTime, limits) {
    Object.entries(cache.conversations).forEach(
      ([conversationKey, conversation]) => {
        conversation.anchors = conversation.anchors.filter(
          ({ updatedAt }) => currentTime - updatedAt <= limits.maxAgeMs
        );
        if (conversation.anchors.length === 0) {
          delete cache.conversations[conversationKey];
        }
      }
    );
    const retainedConversations = Object.entries(cache.conversations).sort(
      ([, first], [, second]) => second.lastUsedAt - first.lastUsedAt
    ).slice(0, Math.max(0, limits.maxConversations));
    cache.conversations = Object.fromEntries(retainedConversations);
  }
  function keepMostRecent(anchors, limit) {
    return [...anchors].sort((first, second) => second.updatedAt - first.updatedAt).slice(0, Math.max(0, limit));
  }
  function sortAnchors(anchors) {
    return anchors.sort(
      (first, second) => first.promptIndex - second.promptIndex || first.updatedAt - second.updatedAt
    );
  }
  function isNavigationAnchor(value) {
    if (!isRecord(value)) return false;
    return typeof value.conversationKey === "string" && typeof value.promptId === "string" && [
      value.promptIndex,
      value.scrollTop,
      value.scrollHeight,
      value.viewportWidth,
      value.viewportHeight,
      value.scrollProgress,
      value.updatedAt
    ].every((field) => typeof field === "number" && Number.isFinite(field));
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function createEmptyPersistentCache() {
    return {
      version: CACHE_VERSION,
      conversations: {}
    };
  }
  function cloneAnchor(anchor) {
    return { ...anchor };
  }
  function clonePersistentCache(cache) {
    return {
      version: cache.version,
      conversations: Object.fromEntries(
        Object.entries(cache.conversations).map(
          ([conversationKey, conversation]) => [
            conversationKey,
            {
              lastUsedAt: conversation.lastUsedAt,
              anchors: conversation.anchors.map(cloneAnchor)
            }
          ]
        )
      )
    };
  }
  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  // vendor/luna-navigation/src/navigation/jump/relativeSearchPlanner.ts
  function planRelativeSearch({
    targetPromptIndex,
    currentSample,
    previousSample,
    lastScrollDelta,
    maximumScrollTop,
    viewportHeight
  }) {
    const viewport2 = Math.max(1, viewportHeight);
    const logicalDelta = targetPromptIndex - currentSample.logicalPosition;
    const direction = logicalDelta >= 0 ? 1 : -1;
    const distance = Math.abs(logicalDelta);
    const config = APP_CONFIG.navigation.search;
    const defaultMovementLimit = config.maximumRelativeViewportCount * viewport2;
    let movementLimit = defaultMovementLimit;
    let planningBasis = "distance-default";
    let estimatedPixelsPerPrompt = null;
    let movement = clamp2(
      distance * config.relativeViewportRatio * viewport2,
      config.minimumRelativeViewportRatio * viewport2,
      movementLimit
    );
    if (previousSample) {
      const previousLogicalDelta = targetPromptIndex - previousSample.logicalPosition;
      const crossedTarget = previousLogicalDelta !== 0 && Math.sign(previousLogicalDelta) !== Math.sign(logicalDelta);
      const observedPromptDelta = Math.abs(
        currentSample.logicalPosition - previousSample.logicalPosition
      );
      const observedScrollDelta = Math.abs(
        currentSample.scrollTop - previousSample.scrollTop
      );
      if (crossedTarget && lastScrollDelta !== null) {
        planningBasis = "target-crossing";
        movement = Math.max(
          config.minimumRelativeViewportRatio * viewport2,
          Math.abs(lastScrollDelta) * config.crossingStepRatio
        );
      } else if (observedPromptDelta > 0 && observedScrollDelta > 0) {
        planningBasis = "learned-rate";
        estimatedPixelsPerPrompt = observedScrollDelta / observedPromptDelta;
        movementLimit = distance <= config.nearTargetPromptDistance ? config.maximumNearTargetViewportCount * viewport2 : config.maximumLearnedRelativeViewportCount * viewport2;
        movement = clamp2(
          distance * estimatedPixelsPerPrompt,
          config.minimumRelativeViewportRatio * viewport2,
          movementLimit
        );
      } else if (lastScrollDelta !== null) {
        planningBasis = "stalled-growth";
        movement = clamp2(
          Math.abs(lastScrollDelta) * config.stalledStepGrowthRatio,
          config.minimumRelativeViewportRatio * viewport2,
          movementLimit
        );
      }
    }
    return {
      ...createRelativePlan(
        targetPromptIndex,
        currentSample.scrollTop + direction * movement,
        maximumScrollTop
      ),
      planningBasis,
      estimatedPixelsPerPrompt,
      movementLimit
    };
  }
  function planPromptMountScan({
    targetPromptIndex,
    currentScrollTop,
    maximumScrollTop,
    viewportHeight,
    direction,
    viewportRatio = APP_CONFIG.navigation.search.promptMountScanViewportRatio
  }) {
    const movement = Math.max(1, viewportHeight) * Math.max(0, viewportRatio);
    return createRelativePlan(
      targetPromptIndex,
      currentScrollTop + direction * movement,
      maximumScrollTop
    );
  }
  function createRelativePlan(targetPromptIndex, scrollTop, maximumScrollTop) {
    return {
      method: "linear-probe",
      targetPromptIndex,
      scrollTop: clamp2(scrollTop, 0, Math.max(0, maximumScrollTop)),
      lowerAnchor: null,
      upperAnchor: null
    };
  }
  function clamp2(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  // vendor/luna-navigation/src/navigation/jump/virtualSearchMachine.ts
  function createVirtualSearchMachine() {
    return {
      phase: "initial-estimate",
      mountAttempts: 0,
      mountDirection: null,
      mountStepViewportRatio: 0
    };
  }
  function advanceVirtualSearchMachine(state, targetResponseLocated) {
    if (state.phase === "mount-prompt") return state;
    return targetResponseLocated ? {
      phase: "mount-prompt",
      mountAttempts: 0,
      mountDirection: null,
      mountStepViewportRatio: 0
    } : { ...state, phase: "seek-response" };
  }
  function updatePromptMountFeedback(state, {
    targetPromptIndex,
    logicalPosition,
    initialDirection,
    initialStepViewportRatio,
    minimumStepViewportRatio,
    maximumStepViewportRatio,
    growthRatio,
    crossingRatio
  }) {
    if (state.phase !== "mount-prompt") return state;
    const desiredDirection = logicalPosition === null || logicalPosition >= targetPromptIndex ? initialDirection : initialDirection === 1 ? -1 : 1;
    const crossedBoundary = state.mountDirection !== null && state.mountDirection !== desiredDirection;
    const nextStep = state.mountDirection === null ? initialStepViewportRatio : crossedBoundary ? state.mountStepViewportRatio * crossingRatio : state.mountStepViewportRatio * growthRatio;
    return {
      ...state,
      mountAttempts: state.mountAttempts + 1,
      mountDirection: desiredDirection,
      mountStepViewportRatio: Math.min(
        Math.max(nextStep, minimumStepViewportRatio),
        maximumStepViewportRatio
      )
    };
  }

  // vendor/luna-navigation/src/navigation/jump/virtualSearchPlanner.ts
  function planVirtualSearch({
    targetPromptIndex,
    promptCount,
    maximumScrollTop,
    viewportWidth,
    observedAnchors,
    confirmedAnchors,
    failedInterpolationAttempts = 0
  }) {
    const safePromptCount = Math.max(1, Math.trunc(promptCount));
    const safeMaximumScrollTop = Math.max(0, maximumScrollTop);
    const safeTargetPromptIndex = clamp3(
      Math.trunc(targetPromptIndex),
      0,
      safePromptCount - 1
    );
    const anchors = mergeCompatibleAnchors({
      observedAnchors,
      confirmedAnchors,
      viewportWidth,
      maximumScrollTop: safeMaximumScrollTop
    });
    const exactAnchor = anchors.find(
      ({ promptIndex }) => promptIndex === safeTargetPromptIndex
    );
    if (exactAnchor) {
      return createPlan(
        "exact-anchor",
        safeTargetPromptIndex,
        exactAnchor.scrollTop,
        exactAnchor,
        exactAnchor,
        safeMaximumScrollTop
      );
    }
    if (anchors.length === 0) {
      const denominator = Math.max(1, safePromptCount - 1);
      const proportionalScrollTop = safeTargetPromptIndex / denominator * safeMaximumScrollTop;
      return createPlan(
        "proportional",
        safeTargetPromptIndex,
        proportionalScrollTop,
        null,
        null,
        safeMaximumScrollTop
      );
    }
    const lowerAnchor = findNearestLowerAnchor(anchors, safeTargetPromptIndex) || createBoundaryAnchor(0, 0);
    const upperAnchor = findNearestUpperAnchor(anchors, safeTargetPromptIndex) || createBoundaryAnchor(safePromptCount - 1, safeMaximumScrollTop);
    if (lowerAnchor.scrollTop >= upperAnchor.scrollTop) {
      const denominator = Math.max(1, safePromptCount - 1);
      const proportionalScrollTop = safeTargetPromptIndex / denominator * safeMaximumScrollTop;
      return createPlan(
        "proportional",
        safeTargetPromptIndex,
        proportionalScrollTop,
        null,
        null,
        safeMaximumScrollTop
      );
    }
    const shouldUseBinary = failedInterpolationAttempts >= APP_CONFIG.navigation.search.interpolationFailuresBeforeBinary;
    const scrollTop = shouldUseBinary ? (lowerAnchor.scrollTop + upperAnchor.scrollTop) / 2 : interpolateScrollTop(
      safeTargetPromptIndex,
      lowerAnchor,
      upperAnchor
    );
    return createPlan(
      shouldUseBinary ? "binary" : "interpolation",
      safeTargetPromptIndex,
      scrollTop,
      lowerAnchor,
      upperAnchor,
      safeMaximumScrollTop
    );
  }
  function mergeCompatibleAnchors({
    observedAnchors,
    confirmedAnchors,
    viewportWidth,
    maximumScrollTop
  }) {
    const tolerance = APP_CONFIG.navigation.anchorCache.viewportWidthTolerance;
    const anchorsByPromptIndex = /* @__PURE__ */ new Map();
    confirmedAnchors.filter(
      (anchor) => Math.abs(anchor.viewportWidth - viewportWidth) <= tolerance
    ).forEach((anchor) => {
      anchorsByPromptIndex.set(anchor.promptIndex, {
        promptIndex: anchor.promptIndex,
        scrollTop: anchor.scrollProgress * maximumScrollTop,
        source: "confirmed"
      });
    });
    observedAnchors.forEach((anchor) => {
      anchorsByPromptIndex.set(anchor.promptIndex, {
        promptIndex: anchor.promptIndex,
        scrollTop: anchor.scrollTop,
        source: "observed"
      });
    });
    return [...anchorsByPromptIndex.values()].sort(
      (first, second) => first.promptIndex - second.promptIndex
    );
  }
  function findNearestLowerAnchor(anchors, targetPromptIndex) {
    for (let index = anchors.length - 1; index >= 0; index -= 1) {
      const anchor = anchors[index];
      if (anchor.promptIndex < targetPromptIndex) return anchor;
    }
    return null;
  }
  function findNearestUpperAnchor(anchors, targetPromptIndex) {
    return anchors.find(({ promptIndex }) => promptIndex > targetPromptIndex) || null;
  }
  function interpolateScrollTop(targetPromptIndex, lowerAnchor, upperAnchor) {
    const indexDistance = upperAnchor.promptIndex - lowerAnchor.promptIndex;
    if (indexDistance <= 0) {
      return (lowerAnchor.scrollTop + upperAnchor.scrollTop) / 2;
    }
    const targetRatio = (targetPromptIndex - lowerAnchor.promptIndex) / indexDistance;
    return lowerAnchor.scrollTop + targetRatio * (upperAnchor.scrollTop - lowerAnchor.scrollTop);
  }
  function createBoundaryAnchor(promptIndex, scrollTop) {
    return {
      promptIndex,
      scrollTop,
      source: "boundary"
    };
  }
  function createPlan(method, targetPromptIndex, scrollTop, lowerAnchor, upperAnchor, maximumScrollTop) {
    return {
      method,
      targetPromptIndex,
      scrollTop: clamp3(scrollTop, 0, maximumScrollTop),
      lowerAnchor,
      upperAnchor
    };
  }
  function clamp3(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  // vendor/luna-navigation/src/navigation/jump/virtualSearchController.ts
  var SCROLL_POSITION_TOLERANCE_PX = 1;
  async function searchVirtualPrompt({
    targetPromptId,
    targetPromptIndex,
    promptCount,
    getConfirmedAnchors,
    invalidateConfirmedAnchor,
    getObservedAnchors,
    recordObservation,
    getScrollMetrics,
    observePosition,
    isTargetRendered,
    scrollTo,
    waitForRender = waitForVirtualRender,
    now = () => performance.now(),
    signal,
    maxAttempts = APP_CONFIG.navigation.search.maxAttempts,
    maxUnproductiveAttempts = APP_CONFIG.navigation.search.maxUnproductiveAttempts,
    maxDurationMs = APP_CONFIG.navigation.search.maxDurationMs,
    targetDomRecoveryDirection = null,
    onDiagnosticEvent,
    onProgress
  }) {
    const startedAt = now();
    const confirmedAnchors = await getConfirmedAnchors();
    let machine = createVirtualSearchMachine();
    let attempts = 0;
    let unproductiveAttempts = 0;
    let previousDistance = null;
    let previousSample = null;
    let lastScrollDelta = null;
    let lastDirection = null;
    let lastPlan = null;
    let lastPosition = { status: "none" };
    let networkBackfillDone = false;
    const finish = (status) => {
      onDiagnosticEvent?.({
        eventName: "SEARCH_FINISHED",
        details: {
          status,
          phase: machine.phase,
          attempts,
          unproductiveAttempts,
          lastPlanMethod: lastPlan?.method || null,
          lastPositionStatus: lastPosition.status
        }
      });
      return { status, attempts, lastPlan, lastPosition };
    };
    onDiagnosticEvent?.({
      eventName: "SEARCH_STARTED",
      details: {
        targetPromptId,
        targetPromptIndex,
        promptCount,
        confirmedAnchorCount: confirmedAnchors.length,
        maxAttempts,
        maxUnproductiveAttempts,
        maxDurationMs
      }
    });
    while (attempts < Math.max(0, maxAttempts)) {
      onProgress?.({ remaining: Math.max(0, maxAttempts - attempts) });
      const terminalStatus = getTerminalStatus({
        signal,
        startedAt,
        currentTime: now(),
        maxDurationMs,
        isTargetRendered
      });
      if (terminalStatus) return finish(terminalStatus);
      const observation = await observePosition();
      lastPosition = observation.position;
      observation.anchors.forEach(recordObservation);
      if (isTargetRendered()) return finish("found");
      const metrics = getScrollMetrics();
      const logicalPosition = getClosestLogicalPosition(
        targetPromptIndex,
        observation.position
      );
      const currentDistance = logicalPosition === null ? null : Math.abs(targetPromptIndex - logicalPosition);
      const targetResponseLocated = logicalPosition !== null && getMatchedLogicalPositions(observation.position).some(
        (position) => Math.trunc(position) === targetPromptIndex
      );
      onDiagnosticEvent?.({
        eventName: "POSITION_OBSERVED",
        details: {
          ...getPositionDiagnosticDetails(
            observation.position,
            observation.anchors.length
          ),
          logicalPosition,
          currentDistance,
          phase: machine.phase
        }
      });
      if (attempts === 1 && lastPlan?.method === "exact-anchor" && lastPlan.lowerAnchor?.source === "confirmed" && logicalPosition !== null && Math.trunc(logicalPosition) !== targetPromptIndex) {
        await invalidateConfirmedAnchor?.(
          targetPromptId,
          targetPromptIndex
        );
        onDiagnosticEvent?.({
          eventName: "EXACT_ANCHOR_INVALIDATED",
          details: {
            targetPromptId,
            targetPromptIndex,
            observedLogicalPosition: logicalPosition
          }
        });
      }
      machine = advanceVirtualSearchMachine(
        machine,
        targetResponseLocated
      );
      const madeProgress = currentDistance !== null && (previousDistance === null || currentDistance < previousDistance);
      if (attempts > 0 && machine.phase !== "mount-prompt") {
        unproductiveAttempts = madeProgress ? 0 : unproductiveAttempts + 1;
        if (unproductiveAttempts >= Math.max(1, maxUnproductiveAttempts)) {
          return finish(
            logicalPosition === null ? "unresolved" : "exhausted"
          );
        }
      }
      let plan;
      let phase = machine.phase;
      let relativePlanningDetails = {};
      const currentSample = logicalPosition === null ? null : {
        logicalPosition,
        scrollTop: metrics.scrollTop
      };
      if (machine.phase === "mount-prompt") {
        if (machine.mountAttempts >= APP_CONFIG.navigation.search.maximumPromptMountAttempts) {
          onDiagnosticEvent?.({
            eventName: "PROMPT_MOUNT_EXHAUSTED",
            details: {
              targetPromptId,
              targetPromptIndex,
              mountAttempts: machine.mountAttempts,
              mountDirection: machine.mountDirection,
              mountStepViewportRatio: machine.mountStepViewportRatio,
              lastPosition: getPositionDiagnosticDetails(
                lastPosition,
                observation.anchors.length
              )
            }
          });
          return finish("exhausted");
        }
        const searchConfig = APP_CONFIG.navigation.search;
        machine = updatePromptMountFeedback(machine, {
          targetPromptIndex,
          logicalPosition,
          initialDirection: targetDomRecoveryDirection ?? -1,
          initialStepViewportRatio: searchConfig.promptMountScanViewportRatio,
          minimumStepViewportRatio: searchConfig.minimumPromptMountViewportRatio,
          maximumStepViewportRatio: searchConfig.maximumPromptMountViewportCount,
          growthRatio: searchConfig.promptMountStepGrowthRatio,
          crossingRatio: searchConfig.promptMountCrossingStepRatio
        });
        phase = "mount-prompt";
        plan = planPromptMountScan({
          targetPromptIndex,
          currentScrollTop: metrics.scrollTop,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportHeight: metrics.viewportHeight,
          direction: machine.mountDirection,
          viewportRatio: machine.mountStepViewportRatio
        });
      } else if (attempts === 0) {
        plan = planVirtualSearch({
          targetPromptIndex,
          promptCount,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportWidth: metrics.viewportWidth,
          observedAnchors: getObservedAnchors(),
          confirmedAnchors
        });
        phase = "initial-estimate";
        if (logicalPosition === null && isSameScrollTop(plan.scrollTop, metrics.scrollTop)) {
          plan = createRelativePlan2(
            targetPromptIndex,
            metrics.scrollTop,
            metrics.maximumScrollTop,
            metrics.viewportHeight,
            getInteriorRecoveryDirection(
              targetPromptIndex,
              promptCount
            )
          );
          phase = "initial-mount-recovery";
        }
      } else if (currentSample) {
        const relativePlan = planRelativeSearch({
          targetPromptIndex,
          currentSample,
          previousSample,
          lastScrollDelta,
          maximumScrollTop: metrics.maximumScrollTop,
          viewportHeight: metrics.viewportHeight
        });
        plan = relativePlan;
        relativePlanningDetails = {
          planningBasis: relativePlan.planningBasis,
          estimatedPixelsPerPrompt: relativePlan.estimatedPixelsPerPrompt,
          movementLimit: relativePlan.movementLimit
        };
        phase = "seek-response";
        lastDirection = targetPromptIndex >= currentSample.logicalPosition ? 1 : -1;
      } else {
        const recoveryDirection = getUnresolvedRecoveryDirection({
          scrollTop: metrics.scrollTop,
          maximumScrollTop: metrics.maximumScrollTop,
          lastDirection,
          targetPromptIndex,
          promptCount
        });
        plan = createRelativePlan2(
          targetPromptIndex,
          metrics.scrollTop,
          metrics.maximumScrollTop,
          metrics.viewportHeight,
          recoveryDirection
        );
        lastDirection = recoveryDirection;
        phase = "unresolved-recovery";
      }
      if (isSameScrollTop(plan.scrollTop, metrics.scrollTop)) {
        const atScrollEdge = plan.scrollTop <= SCROLL_POSITION_TOLERANCE_PX || plan.scrollTop >= metrics.maximumScrollTop - SCROLL_POSITION_TOLERANCE_PX;
        if (atScrollEdge && !isTargetRendered()) {
          const slideDirection = plan.scrollTop <= SCROLL_POSITION_TOLERANCE_PX ? -1 : 1;
          onDiagnosticEvent?.({
            eventName: "EDGE_BACKFILL_WAIT",
            details: {
              phase,
              scrollTop: metrics.scrollTop,
              maximumScrollTop: metrics.maximumScrollTop,
              targetPromptIndex
            }
          });
          if (!networkBackfillDone) {
            networkBackfillDone = true;
            const backfillLanded = await waitForTargetBackfill({
              signal,
              isTargetRendered,
              getScrollMetrics
            });
            onDiagnosticEvent?.({
              eventName: "BACKFILL_RESULT",
              details: {
                backfillLanded,
                maximumScrollTop: getScrollMetrics().maximumScrollTop,
                targetPromptIndex
              }
            });
          }
          const slideCycles = APP_CONFIG.navigation.search.maximumWindowSlideCycles;
          for (let cycle = 0; cycle < slideCycles; cycle++) {
            if (signal?.aborted || isTargetRendered()) break;
            const slideMetrics = getScrollMetrics();
            const edge = slideDirection === -1 ? 0 : slideMetrics.maximumScrollTop;
            const inward = slideDirection === -1 ? Math.min(
              slideMetrics.maximumScrollTop,
              slideMetrics.scrollTop + slideMetrics.viewportHeight
            ) : Math.max(
              0,
              slideMetrics.scrollTop - slideMetrics.viewportHeight
            );
            scrollTo(inward);
            await waitForRender();
            scrollTo(edge);
            await waitForRender();
            onDiagnosticEvent?.({
              eventName: "WINDOW_SLIDE_STEP",
              details: {
                cycle: cycle + 1,
                direction: slideDirection,
                inward: Math.round(inward),
                edge: Math.round(edge),
                targetPromptIndex
              }
            });
          }
          attempts += 1;
          continue;
        }
        lastPlan = plan;
        return finish("exhausted");
      }
      onDiagnosticEvent?.({
        eventName: "SEARCH_PLAN",
        details: {
          phase,
          method: plan.method,
          scrollTop: plan.scrollTop,
          logicalPosition,
          currentDistance,
          madeProgress,
          unproductiveAttempts,
          mountAttempt: machine.phase === "mount-prompt" ? machine.mountAttempts : null,
          mountDirection: machine.phase === "mount-prompt" ? machine.mountDirection : null,
          mountStepViewportRatio: machine.phase === "mount-prompt" ? machine.mountStepViewportRatio : null,
          ...relativePlanningDetails,
          relativeDelta: plan.scrollTop - metrics.scrollTop
        }
      });
      lastPlan = plan;
      lastScrollDelta = plan.scrollTop - metrics.scrollTop;
      previousSample = currentSample;
      previousDistance = currentDistance;
      scrollTo(plan.scrollTop);
      onDiagnosticEvent?.({
        eventName: "SCROLL_APPLIED",
        details: {
          phase,
          plannedScrollTop: plan.scrollTop,
          scrollTopBefore: metrics.scrollTop,
          scrollTopAfter: getScrollMetrics().scrollTop,
          maximumScrollTop: metrics.maximumScrollTop
        }
      });
      attempts += 1;
      await waitForRender();
      if (isTargetRendered()) return finish("found");
    }
    return finish("exhausted");
  }
  function waitForVirtualRender() {
    return new Promise((resolve) => {
      setTimeout(resolve, APP_CONFIG.navigation.search.renderWaitMs);
    });
  }
  async function waitForTargetBackfill({
    signal,
    isTargetRendered,
    getScrollMetrics
  }) {
    const deadline = Date.now() + APP_CONFIG.navigation.search.edgeBackfillWaitMs;
    let previousMaximumScrollTop = getScrollMetrics().maximumScrollTop;
    let sawChange = false;
    let stableRounds = 0;
    while (Date.now() < deadline) {
      if (signal?.aborted || isTargetRendered()) return sawChange;
      await new Promise((resolve) => setTimeout(resolve, 120));
      const currentMaximumScrollTop = getScrollMetrics().maximumScrollTop;
      if (Math.abs(currentMaximumScrollTop - previousMaximumScrollTop) > SCROLL_POSITION_TOLERANCE_PX) {
        previousMaximumScrollTop = currentMaximumScrollTop;
        sawChange = true;
        stableRounds = 0;
      } else {
        stableRounds += 1;
        if (sawChange && stableRounds >= 2) return true;
      }
    }
    return sawChange;
  }
  function getClosestLogicalPosition(targetPromptIndex, position) {
    const positions = getMatchedLogicalPositions(position);
    if (positions.length === 0) return null;
    return positions.reduce(
      (closest, candidate) => Math.abs(targetPromptIndex - candidate) < Math.abs(targetPromptIndex - closest) ? candidate : closest
    );
  }
  function getMatchedLogicalPositions(position) {
    if (position.status !== "located") return [];
    return position.matchedBlocks.length > 0 ? position.matchedBlocks.map(
      ({ promptIndex, source, positionRatio = 0 }) => promptIndex + (source === "segment" ? positionRatio : 0)
    ) : position.matchedPromptIndexes;
  }
  function getInteriorRecoveryDirection(targetPromptIndex, promptCount) {
    return targetPromptIndex >= Math.max(0, promptCount - 1) / 2 ? -1 : 1;
  }
  function getUnresolvedRecoveryDirection({
    scrollTop,
    maximumScrollTop,
    lastDirection,
    targetPromptIndex,
    promptCount
  }) {
    if (scrollTop <= SCROLL_POSITION_TOLERANCE_PX) return 1;
    if (maximumScrollTop - scrollTop <= SCROLL_POSITION_TOLERANCE_PX) {
      return -1;
    }
    return lastDirection ?? getInteriorRecoveryDirection(targetPromptIndex, promptCount);
  }
  function createRelativePlan2(targetPromptIndex, currentScrollTop, maximumScrollTop, viewportHeight, direction) {
    return {
      method: "linear-probe",
      targetPromptIndex,
      scrollTop: clamp4(
        currentScrollTop + direction * Math.max(1, viewportHeight),
        0,
        maximumScrollTop
      ),
      lowerAnchor: null,
      upperAnchor: null
    };
  }
  function getPositionDiagnosticDetails(position, anchorCount) {
    if (position.status !== "located") {
      return { status: position.status, anchorCount };
    }
    return {
      status: position.status,
      firstPromptIndex: position.firstPromptIndex,
      lastPromptIndex: position.lastPromptIndex,
      matchedBlocks: position.matchedBlocks,
      matchSource: position.matchedBlocks[0]?.source || null,
      anchorCount
    };
  }
  function getTerminalStatus({
    signal,
    startedAt,
    currentTime,
    maxDurationMs,
    isTargetRendered
  }) {
    if (signal?.aborted) return "cancelled";
    if (isTargetRendered()) return "found";
    if (currentTime - startedAt >= Math.max(0, maxDurationMs)) {
      return "timed-out";
    }
    return null;
  }
  function isSameScrollTop(first, second) {
    return Math.abs(first - second) <= SCROLL_POSITION_TOLERANCE_PX;
  }
  function clamp4(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  // vendor/luna-navigation/src/navigation/fingerprint/comparableText.ts
  function stripMarkdownPayloads(text) {
    return text.replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/!\[[^\]]*]\[[^\]]*]/g, " ").replace(/\[([^\]]+)]\([^)]*\)/g, "$1").replace(/\[([^\]]+)]\[[^\]]*]/g, "$1").replace(/^[ \t]*\[[^\]]+]:\s+\S+.*$/gm, " ").replace(/^[ \t]*(?:```|~~~)[^\r\n]*$/gm, " ").replace(/(?:https?|ftp):\/\/[^\s<>)\]]+/giu, " ").replace(/<[^>]*>/g, " ");
  }
  function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function normalizeComparableText(text) {
    const textWithoutPayloads = stripMarkdownPayloads(text.normalize("NFKC"));
    const lettersAndNumbers = textWithoutPayloads.replace(
      /[^\p{L}\p{N}]+/gu,
      " "
    );
    return normalizeWhitespace(lettersAndNumbers);
  }

  // vendor/luna-navigation/src/navigation/fingerprint/generator.ts
  function calculateFingerprintOffsets(textLength, options) {
    if (textLength <= 0 || options.countPerAssistant <= 0) return [];
    const sampleWindowLength = options.probeLength + options.verificationLength;
    const sampleCount = Math.min(
      options.countPerAssistant,
      Math.max(1, Math.ceil(textLength / sampleWindowLength))
    );
    const maximumOffset = Math.max(0, textLength - sampleWindowLength);
    if (sampleCount === 1) return [0];
    return Array.from(
      { length: sampleCount },
      (_, index) => Math.round(maximumOffset * index / (sampleCount - 1))
    );
  }
  async function createSha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
  }
  async function createResponseFingerprints(response, options = APP_CONFIG.navigation.fingerprint) {
    const text = normalizeComparableText(response.text);
    const offsets = calculateFingerprintOffsets(text.length, options);
    return Promise.all(
      offsets.map(async (textOffset, sampleIndex) => {
        const probeText = text.slice(
          textOffset,
          textOffset + options.probeLength
        );
        const verificationText = text.slice(
          textOffset + probeText.length,
          textOffset + probeText.length + options.verificationLength
        );
        const hashSource = verificationText || probeText;
        return {
          responseId: response.id,
          sampleIndex,
          textOffset,
          probeText,
          verificationHash: await createSha256(hashSource),
          verificationLength: verificationText.length
        };
      })
    );
  }

  // vendor/luna-navigation/src/navigation/fingerprint/index.ts
  function flattenResponseTasks(turns) {
    return turns.flatMap(
      (turn) => turn.responses.map((response) => ({
        promptIndex: turn.promptIndex,
        response
      }))
    );
  }
  function yieldToMainThread() {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  async function buildFingerprintIndex(turns, quality = "derived", options = APP_CONFIG.navigation.fingerprint, yieldControl = yieldToMainThread) {
    const index = [];
    const tasks = flattenResponseTasks(turns);
    const batchSize = Math.max(1, options.buildBatchSize);
    const timeBudgetMs = Math.max(0, options.buildTimeBudgetMs);
    let batchStartedAt = performance.now();
    let batchTaskCount = 0;
    for (const [taskIndex, task] of tasks.entries()) {
      const fingerprints = await createResponseFingerprints(
        task.response,
        options
      );
      if (fingerprints.length > 0) {
        index.push({
          responseId: task.response.id,
          promptIndex: task.promptIndex,
          quality,
          fingerprints
        });
      }
      batchTaskCount += 1;
      const hasMoreTasks = taskIndex < tasks.length - 1;
      const reachedBatchSize = batchTaskCount >= batchSize;
      const reachedTimeBudget = performance.now() - batchStartedAt >= timeBudgetMs;
      if (hasMoreTasks && (reachedBatchSize || reachedTimeBudget)) {
        await yieldControl();
        batchStartedAt = performance.now();
        batchTaskCount = 0;
      }
    }
    return index;
  }

  // vendor/luna-navigation/src/navigation/fingerprint/segments.ts
  function calculateDerivedSegmentRanges(text, options = APP_CONFIG.navigation.fingerprint) {
    if (!normalizeComparableText(text)) return [];
    const units = createEstimatedVisualUnits(
      text,
      options.estimatedCharsPerVisualLine
    );
    if (units.length === 0) return [];
    const rowsPerSegment = Math.max(
      1,
      options.estimatedRowsPerViewport * options.segmentViewportRatio
    );
    const segmentCount = Math.min(
      Math.max(1, Math.trunc(options.maximumSegmentsPerAssistant)),
      Math.max(1, Math.ceil(units.length / rowsPerSegment))
    );
    const unitsPerSegment = Math.ceil(units.length / segmentCount);
    const overlapUnits = Math.max(
      0,
      Math.round(unitsPerSegment * options.segmentOverlapRatio)
    );
    return Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const coreStartIndex = Math.min(
        units.length - 1,
        segmentIndex * unitsPerSegment
      );
      const coreEndIndex = Math.min(
        units.length,
        (segmentIndex + 1) * unitsPerSegment
      );
      const startIndex = Math.max(0, coreStartIndex - overlapUnits);
      const endIndex = Math.min(
        units.length,
        coreEndIndex + overlapUnits
      );
      return {
        startOffset: units[startIndex].startOffset,
        endOffset: units[endIndex - 1].endOffset,
        positionRatio: units.length === 1 ? 0 : coreStartIndex / (units.length - 1)
      };
    });
  }
  async function createDerivedResponseSegments(response, promptIndex, options = APP_CONFIG.navigation.fingerprint) {
    const ranges = calculateDerivedSegmentRanges(response.text, options);
    const candidates = ranges.map((range) => ({
      range,
      comparableText: normalizeComparableText(
        response.text.slice(range.startOffset, range.endOffset)
      )
    })).filter(({ comparableText }) => comparableText.length > 0);
    return Promise.all(
      candidates.map(async ({ range, comparableText }, segmentIndex) => {
        const probeText = comparableText.slice(0, options.probeLength);
        const verificationText = comparableText.slice(
          probeText.length,
          probeText.length + options.verificationLength
        );
        return {
          responseId: response.id,
          promptIndex,
          segmentIndex,
          segmentCount: candidates.length,
          positionRatio: range.positionRatio,
          probeText,
          verificationHash: await createSha256(
            verificationText || probeText
          ),
          verificationLength: verificationText.length,
          quality: "derived"
        };
      })
    );
  }
  async function buildDerivedSegmentIndex(turns, options = APP_CONFIG.navigation.fingerprint, yieldControl = yieldSegmentBuild) {
    const tasks = turns.flatMap(
      (turn) => turn.responses.map((response) => ({
        promptIndex: turn.promptIndex,
        response
      }))
    );
    const index = [];
    const batchSize = Math.max(1, options.buildBatchSize);
    const timeBudgetMs = Math.max(0, options.buildTimeBudgetMs);
    let batchStartedAt = performance.now();
    let batchTaskCount = 0;
    for (const [taskIndex, task] of tasks.entries()) {
      index.push(
        ...await createDerivedResponseSegments(
          task.response,
          task.promptIndex,
          options
        )
      );
      batchTaskCount += 1;
      const hasMoreTasks = taskIndex < tasks.length - 1;
      const reachedBatchSize = batchTaskCount >= batchSize;
      const reachedTimeBudget = performance.now() - batchStartedAt >= timeBudgetMs;
      if (hasMoreTasks && (reachedBatchSize || reachedTimeBudget)) {
        await yieldControl();
        batchStartedAt = performance.now();
        batchTaskCount = 0;
      }
    }
    return index;
  }
  function extractRenderedTextWithinVerticalBounds(contentElements, top, bottom) {
    if (bottom <= top) return "";
    const textNodes = collectTextNodes(
      contentElements.filter((element) => element.isConnected)
    );
    if (textNodes.length === 0) return "";
    const start = findObservedTextPosition(textNodes, top);
    const end = findObservedTextPosition(textNodes, bottom);
    if (!start || !end) return "";
    return getTextBetweenObservedPositions(textNodes, start, end);
  }
  function createEstimatedVisualUnits(text, estimatedCharsPerVisualLine) {
    const safeLineLength = Math.max(
      1,
      Math.trunc(estimatedCharsPerVisualLine)
    );
    const units = [];
    let lineStartOffset = 0;
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (line.length === 0) {
        units.push({
          startOffset: lineStartOffset,
          endOffset: lineStartOffset
        });
      } else {
        for (let lineOffset = 0; lineOffset < line.length; lineOffset += safeLineLength) {
          units.push({
            startOffset: lineStartOffset + lineOffset,
            endOffset: lineStartOffset + Math.min(line.length, lineOffset + safeLineLength)
          });
        }
      }
      lineStartOffset += line.length + 1;
    }
    return units;
  }
  function collectTextNodes(elements) {
    return elements.flatMap((element) => {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      );
      const nodes = [];
      let currentNode = walker.nextNode();
      while (currentNode) {
        if (currentNode.textContent?.trim()) {
          nodes.push(currentNode);
        }
        currentNode = walker.nextNode();
      }
      return nodes;
    });
  }
  function findObservedTextPosition(textNodes, targetY) {
    for (const [nodeIndex, textNode] of textNodes.entries()) {
      const textLength = textNode.data.length;
      if (textLength === 0) continue;
      const nodeRect = measureTextRange(textNode, 0, textLength);
      if (nodeRect.bottom < targetY) continue;
      let lowerOffset = 0;
      let upperOffset = textLength - 1;
      while (lowerOffset < upperOffset) {
        const middleOffset = Math.floor((lowerOffset + upperOffset) / 2);
        const characterRect = measureTextRange(
          textNode,
          middleOffset,
          middleOffset + 1
        );
        if (characterRect.bottom < targetY) {
          lowerOffset = middleOffset + 1;
        } else {
          upperOffset = middleOffset;
        }
      }
      return {
        nodeIndex,
        characterOffset: lowerOffset
      };
    }
    const lastNode = textNodes.at(-1);
    if (!lastNode) return null;
    return {
      nodeIndex: textNodes.length - 1,
      characterOffset: Math.max(0, lastNode.data.length - 1)
    };
  }
  function getTextBetweenObservedPositions(textNodes, start, end) {
    return textNodes.slice(start.nodeIndex, end.nodeIndex + 1).map((node, relativeIndex, selectedNodes) => {
      const isFirst = relativeIndex === 0;
      const isLast = relativeIndex === selectedNodes.length - 1;
      const startOffset = isFirst ? start.characterOffset : 0;
      const endOffset = isLast ? end.characterOffset + 1 : node.data.length;
      return node.data.slice(startOffset, endOffset);
    }).join(" ");
  }
  function measureTextRange(textNode, startOffset, endOffset) {
    const range = document.createRange();
    range.setStart(textNode, startOffset);
    range.setEnd(textNode, endOffset);
    return range.getBoundingClientRect();
  }
  function yieldSegmentBuild() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // vendor/luna-navigation/src/navigation/fingerprint/matcher.ts
  async function verifyFingerprintMatch(renderedText, fingerprint) {
    const normalizedText = normalizeComparableText(renderedText);
    const probeText = fingerprint.probeText;
    const offsets = findProbeOffsetsInNormalizedText(
      normalizedText,
      probeText
    );
    for (const offset of offsets) {
      const verificationStart = offset + probeText.length;
      const verificationText = normalizedText.slice(
        verificationStart,
        verificationStart + fingerprint.verificationLength
      );
      if (fingerprint.verificationLength > 0 && verificationText.length !== fingerprint.verificationLength) {
        continue;
      }
      const hashSource = verificationText || probeText;
      if (await createSha256(hashSource) === fingerprint.verificationHash) {
        return true;
      }
    }
    return false;
  }
  async function matchFingerprintIndex(blocks, fingerprintIndex) {
    const normalizedBlocks = blocks.map((block2) => ({
      id: block2.id,
      text: normalizeComparableText(block2.text)
    }));
    const matchesByPrompt = /* @__PURE__ */ new Map();
    for (const record of fingerprintIndex) {
      const promptMatch = matchesByPrompt.get(record.promptIndex) || {
        matchedFingerprintCount: 0,
        responseIds: /* @__PURE__ */ new Set(),
        blockIds: /* @__PURE__ */ new Set()
      };
      let matchedFingerprintCount = 0;
      const matchingResponseBlockIds = /* @__PURE__ */ new Set();
      for (const fingerprint of record.fingerprints) {
        const matchingBlockIds = [];
        for (const block2 of normalizedBlocks) {
          if (await verifyFingerprintMatch(block2.text, fingerprint)) {
            matchingBlockIds.push(block2.id);
          }
        }
        if (matchingBlockIds.length === 0) continue;
        matchedFingerprintCount += 1;
        matchingBlockIds.forEach(
          (blockId) => matchingResponseBlockIds.add(blockId)
        );
      }
      if (matchedFingerprintCount === 0) continue;
      promptMatch.matchedFingerprintCount += matchedFingerprintCount;
      promptMatch.responseIds.add(record.responseId);
      matchingResponseBlockIds.forEach(
        (blockId) => promptMatch.blockIds.add(blockId)
      );
      matchesByPrompt.set(record.promptIndex, promptMatch);
    }
    const matches = Array.from(
      matchesByPrompt,
      ([
        promptIndex,
        { matchedFingerprintCount, responseIds, blockIds }
      ]) => ({
        promptIndex,
        matchedFingerprintCount,
        responseIds: [...responseIds],
        blockIds: [...blockIds]
      })
    );
    return matches.sort(
      (first, second) => second.matchedFingerprintCount - first.matchedFingerprintCount || first.promptIndex - second.promptIndex
    );
  }
  function selectBestPromptMatch(matches) {
    if (matches.length === 0) return { status: "none" };
    const highestScore = Math.max(
      ...matches.map(({ matchedFingerprintCount }) => matchedFingerprintCount)
    );
    const strongestMatches = matches.filter(
      ({ matchedFingerprintCount }) => matchedFingerprintCount === highestScore
    );
    if (strongestMatches.length > 1) {
      return {
        status: "ambiguous",
        matches: strongestMatches
      };
    }
    return {
      status: "matched",
      match: strongestMatches[0]
    };
  }
  function findProbeOffsetsInNormalizedText(normalizedText, normalizedProbe) {
    if (!normalizedText || !normalizedProbe) return [];
    const offsets = [];
    let searchStart = 0;
    while (searchStart <= normalizedText.length - normalizedProbe.length) {
      const offset = normalizedText.indexOf(normalizedProbe, searchStart);
      if (offset === -1) break;
      offsets.push(offset);
      searchStart = offset + 1;
    }
    return offsets;
  }

  // vendor/luna-navigation/src/navigation/fingerprint/segmentMatcher.ts
  async function matchSegmentIndex(blocks, segmentIndex) {
    const matches = [];
    for (const segment of segmentIndex) {
      const blockIds = [];
      for (const block2 of blocks) {
        if (await verifyFingerprintMatch(block2.text, segment)) {
          blockIds.push(block2.id);
        }
      }
      if (blockIds.length === 0) continue;
      matches.push({
        responseId: segment.responseId,
        promptIndex: segment.promptIndex,
        segmentIndex: segment.segmentIndex,
        segmentCount: segment.segmentCount,
        positionRatio: segment.positionRatio,
        quality: segment.quality,
        blockIds
      });
    }
    return matches.sort(
      (first, second) => getQualityScore(second.quality) - getQualityScore(first.quality) || first.promptIndex - second.promptIndex || first.segmentIndex - second.segmentIndex
    );
  }
  function selectBestSegmentMatch(matches) {
    if (matches.length === 0) return { status: "none" };
    const highestQuality = Math.max(
      ...matches.map(({ quality }) => getQualityScore(quality))
    );
    const strongestMatches = matches.filter(
      ({ quality }) => getQualityScore(quality) === highestQuality
    );
    const uniqueMatches = strongestMatches.filter(
      (match, index, candidates) => candidates.findIndex(
        (candidate) => candidate.responseId === match.responseId && candidate.promptIndex === match.promptIndex && candidate.segmentIndex === match.segmentIndex
      ) === index
    );
    if (uniqueMatches.length !== 1) {
      return {
        status: "ambiguous",
        matches: uniqueMatches
      };
    }
    return {
      status: "matched",
      match: uniqueMatches[0]
    };
  }
  function getQualityScore(quality) {
    return quality === "observed" ? 2 : 1;
  }

  // vendor/luna-navigation/src/navigation/jump/visiblePositionResolver.ts
  async function resolveVisiblePromptPosition(blocks, fingerprintIndex, segmentIndex = [], segmentBlocks = blocks) {
    if (blocks.length === 0 || fingerprintIndex.length === 0 && segmentIndex.length === 0) {
      return { status: "none" };
    }
    const promptIndexesByResponseId = indexPromptIndexesByResponseId(
      fingerprintIndex,
      segmentIndex
    );
    const matchedPromptIndexes = /* @__PURE__ */ new Set();
    const matchedBlockIds = /* @__PURE__ */ new Set();
    const matchedBlocks = [];
    const candidatePromptIndexes = /* @__PURE__ */ new Set();
    const ambiguousBlockIds = /* @__PURE__ */ new Set();
    const segmentBlocksById = new Map(
      segmentBlocks.map((block2) => [block2.id, block2])
    );
    for (const block2 of blocks) {
      const segmentBlock = segmentBlocksById.get(block2.id);
      const segmentSelection = selectBestSegmentMatch(
        segmentBlock ? await matchSegmentIndex([segmentBlock], segmentIndex) : []
      );
      if (segmentSelection.status === "matched") {
        const segment = segmentSelection.match;
        matchedPromptIndexes.add(segment.promptIndex);
        matchedBlockIds.add(block2.id);
        matchedBlocks.push({
          blockId: block2.id,
          promptIndex: segment.promptIndex,
          source: "segment",
          segmentIndex: segment.segmentIndex,
          segmentCount: segment.segmentCount,
          positionRatio: segment.positionRatio,
          segmentQuality: segment.quality
        });
        continue;
      }
      const selection = selectBestPromptMatch(
        await matchFingerprintIndex([block2], fingerprintIndex)
      );
      if (selection.status === "matched") {
        matchedPromptIndexes.add(selection.match.promptIndex);
        matchedBlockIds.add(block2.id);
        matchedBlocks.push({
          blockId: block2.id,
          promptIndex: selection.match.promptIndex,
          source: "fingerprint"
        });
        continue;
      }
      const directPromptIndexes = promptIndexesByResponseId.get(block2.id);
      if (directPromptIndexes?.size === 1) {
        const promptIndex = [...directPromptIndexes][0];
        matchedPromptIndexes.add(promptIndex);
        matchedBlockIds.add(block2.id);
        matchedBlocks.push({
          blockId: block2.id,
          promptIndex,
          source: "response-id"
        });
        continue;
      }
      if (directPromptIndexes && directPromptIndexes.size > 1) {
        directPromptIndexes.forEach((index) => candidatePromptIndexes.add(index));
        ambiguousBlockIds.add(block2.id);
        continue;
      }
      if (selection.status === "ambiguous") {
        selection.matches.forEach(
          ({ promptIndex }) => candidatePromptIndexes.add(promptIndex)
        );
        ambiguousBlockIds.add(block2.id);
      }
      if (segmentSelection.status === "ambiguous") {
        segmentSelection.matches.forEach(
          ({ promptIndex }) => candidatePromptIndexes.add(promptIndex)
        );
        ambiguousBlockIds.add(block2.id);
      }
    }
    if (ambiguousBlockIds.size > 0) {
      matchedPromptIndexes.forEach((index) => candidatePromptIndexes.add(index));
      return {
        status: "ambiguous",
        candidatePromptIndexes: [...candidatePromptIndexes].sort(
          (first, second) => first - second
        ),
        ambiguousBlockIds: [...ambiguousBlockIds]
      };
    }
    const sortedPromptIndexes = [...matchedPromptIndexes].sort(
      (first, second) => first - second
    );
    if (sortedPromptIndexes.length === 0) return { status: "none" };
    return {
      status: "located",
      firstPromptIndex: sortedPromptIndexes[0],
      lastPromptIndex: sortedPromptIndexes.at(-1),
      matchedPromptIndexes: sortedPromptIndexes,
      matchedBlockIds: [...matchedBlockIds],
      matchedBlocks
    };
  }
  function indexPromptIndexesByResponseId(fingerprintIndex, segmentIndex) {
    const promptIndexesByResponseId = /* @__PURE__ */ new Map();
    fingerprintIndex.forEach(({ responseId, promptIndex }) => {
      const promptIndexes = promptIndexesByResponseId.get(responseId) || /* @__PURE__ */ new Set();
      promptIndexes.add(promptIndex);
      promptIndexesByResponseId.set(responseId, promptIndexes);
    });
    segmentIndex.forEach(({ responseId, promptIndex }) => {
      const promptIndexes = promptIndexesByResponseId.get(responseId) || /* @__PURE__ */ new Set();
      promptIndexes.add(promptIndex);
      promptIndexesByResponseId.set(responseId, promptIndexes);
    });
    return promptIndexesByResponseId;
  }
  function resolvePromptIndexesFromIds(ids, prompts) {
    const promptIndexById = /* @__PURE__ */ new Map();
    prompts.forEach((prompt, index) => {
      if (!promptIndexById.has(prompt.id)) {
        promptIndexById.set(prompt.id, index);
      }
    });
    const matchedPromptIndexes = /* @__PURE__ */ new Set();
    const matchedBlockIds = /* @__PURE__ */ new Set();
    const matchedBlocks = [];
    for (const id of ids) {
      if (!id) continue;
      const promptIndex = promptIndexById.get(id);
      if (promptIndex === void 0) continue;
      if (matchedBlockIds.has(id)) continue;
      matchedBlockIds.add(id);
      matchedPromptIndexes.add(promptIndex);
      matchedBlocks.push({
        blockId: id,
        promptIndex,
        source: "user-message-id"
      });
    }
    if (matchedPromptIndexes.size === 0) return null;
    const sortedPromptIndexes = [...matchedPromptIndexes].sort(
      (first, second) => first - second
    );
    return {
      status: "located",
      firstPromptIndex: sortedPromptIndexes[0],
      lastPromptIndex: sortedPromptIndexes.at(-1),
      matchedPromptIndexes: sortedPromptIndexes,
      matchedBlockIds: [...matchedBlockIds],
      matchedBlocks
    };
  }

  // vendor/luna-navigation/src/platforms/chatgpt/renderedTextAdapter.ts
  var ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
  var MARKDOWN_SELECTOR = ".markdown";
  function getRenderedAssistantEntries(root = document) {
    return Array.from(
      root.querySelectorAll(ASSISTANT_SELECTOR)
    ).flatMap((assistantElement, index) => {
      const text = getAssistantMarkdownText(assistantElement);
      if (!text) return [];
      return [
        {
          element: assistantElement,
          block: {
            id: getAssistantBlockId(assistantElement, index),
            text
          }
        }
      ];
    });
  }
  function getVisibleAssistantViewportSamples(scrollContainer, root = document) {
    const viewport2 = scrollContainer.getBoundingClientRect();
    return getRenderedAssistantEntries(root).flatMap(
      ({ block: block2, element }) => {
        const contentElements = getAssistantMarkdownContainers(element);
        const intersectsViewport = contentElements.some((contentElement) => {
          const rect = contentElement.getBoundingClientRect();
          return rect.bottom > viewport2.top && rect.top < viewport2.bottom;
        });
        if (!intersectsViewport) return [];
        const text = extractRenderedTextWithinVerticalBounds(
          contentElements,
          viewport2.top,
          viewport2.bottom
        );
        return text ? [{ id: block2.id, text }] : [];
      }
    );
  }
  function getAssistantBlockId(assistantElement, index) {
    return assistantElement.dataset.messageId || assistantElement.closest("[data-message-id]")?.dataset.messageId || `chatgpt-assistant-${index}`;
  }
  function getAssistantMarkdownText(assistantElement) {
    return getAssistantMarkdownContainers(assistantElement).map((container) => container.innerText || container.textContent || "").map((text) => text.trim()).filter(Boolean).join("\n");
  }
  function getAssistantMarkdownContainers(assistantElement) {
    return Array.from(
      assistantElement.querySelectorAll(MARKDOWN_SELECTOR)
    ).filter((container) => {
      const owningMessage = container.closest(
        "[data-message-author-role]"
      );
      const nestedMarkdown = container.parentElement?.closest(MARKDOWN_SELECTOR);
      return owningMessage === assistantElement && !nestedMarkdown;
    });
  }

  // vendor/luna-navigation/src/platforms/chatgpt/virtualSearchAdapter.ts
  var USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]';
  var ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"]';
  function getChatGptScrollContainer(root = document) {
    const sampleMessage = root.querySelector(USER_MESSAGE_SELECTOR) || root.querySelector(ASSISTANT_MESSAGE_SELECTOR);
    let parent = sampleMessage?.parentElement || null;
    while (parent && parent !== document.body) {
      if (isVerticallyScrollable(parent)) return parent;
      parent = parent.parentElement;
    }
    const selectorFallback = root.querySelector("main div.overflow-y-auto") || root.querySelector('[class*="react-scroll-to-bottom"]') || root.querySelector('main [class*="react-scroll-to-bottom"]');
    if (selectorFallback) return selectorFallback;
    const main = root.querySelector("main");
    if (!main) return null;
    return Array.from(main.querySelectorAll("div")).find(
      isVerticallyScrollable
    ) || null;
  }
  function findRenderedChatGptPrompt(promptId, root = document) {
    return Array.from(root.querySelectorAll(USER_MESSAGE_SELECTOR)).find(
      (element) => getChatGptMessageId(element) === promptId
    ) || null;
  }
  function getChatGptScrollMetrics(container) {
    return {
      scrollTop: container.scrollTop,
      maximumScrollTop: Math.max(
        0,
        container.scrollHeight - container.clientHeight
      ),
      viewportWidth: container.clientWidth || window.innerWidth,
      viewportHeight: container.clientHeight || window.innerHeight
    };
  }
  function getVisibleUserMessages(root, scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    return Array.from(root.querySelectorAll(USER_MESSAGE_SELECTOR)).filter((element) => isElementWithinScrollViewport(element, containerRect));
  }
  function resolveVisiblePromptPositionByUserMessageId(prompts, scrollContainer, root) {
    const visibleUserMessages = getVisibleUserMessages(root, scrollContainer);
    return resolvePromptIndexesFromIds(
      visibleUserMessages.map((element) => getChatGptMessageId(element)),
      prompts
    );
  }
  async function observeChatGptVirtualPosition({
    conversationKey,
    prompts,
    fingerprintIndex,
    segmentIndex,
    root = document,
    scrollContainer = getChatGptScrollContainer(root)
  }) {
    if (!scrollContainer) {
      return {
        position: { status: "none" },
        anchors: []
      };
    }
    const directPosition = resolveVisiblePromptPositionByUserMessageId(
      prompts,
      scrollContainer,
      root
    );
    if (directPosition) {
      const visibleUserMessages = getVisibleUserMessages(root, scrollContainer);
      const elementsByBlockId2 = /* @__PURE__ */ new Map();
      for (const element of visibleUserMessages) {
        const id = getChatGptMessageId(element);
        if (id) elementsByBlockId2.set(id, element);
      }
      const anchors2 = directPosition.matchedBlocks.flatMap(
        ({ blockId, promptIndex }) => {
          const element = elementsByBlockId2.get(blockId);
          const prompt = prompts[promptIndex];
          if (!element || !prompt) return [];
          return [
            createChatGptElementNavigationAnchor({
              conversationKey,
              promptId: prompt.id,
              promptIndex,
              element,
              scrollContainer
            })
          ];
        }
      );
      return { position: directPosition, anchors: anchors2 };
    }
    const entries = getRenderedAssistantEntries(root);
    const containerRect = scrollContainer.getBoundingClientRect();
    const visibleEntries = entries.filter(
      ({ element }) => isElementWithinScrollViewport(element, containerRect)
    );
    const validFingerprintIndex = fingerprintIndex.filter(
      ({ promptIndex }) => promptIndex >= 0 && promptIndex < prompts.length
    );
    const validDerivedSegmentIndex = segmentIndex.filter(
      ({ promptIndex, quality }) => quality === "derived" && promptIndex >= 0 && promptIndex < prompts.length
    );
    const viewportSamples = getVisibleAssistantViewportSamples(
      scrollContainer,
      root
    );
    const position = await resolveVisiblePromptPosition(
      visibleEntries.map(({ block: block2 }) => block2),
      validFingerprintIndex,
      validDerivedSegmentIndex,
      viewportSamples
    );
    if (position.status !== "located") {
      return {
        position,
        anchors: []
      };
    }
    const elementsByBlockId = new Map(
      visibleEntries.map(({ block: block2, element }) => [block2.id, element])
    );
    const anchors = position.matchedBlocks.flatMap(
      ({ blockId, promptIndex }) => {
        const element = elementsByBlockId.get(blockId);
        const prompt = prompts[promptIndex];
        if (!element || !prompt) return [];
        return [
          createChatGptElementNavigationAnchor({
            conversationKey,
            promptId: prompt.id,
            promptIndex,
            element,
            scrollContainer
          })
        ];
      }
    );
    return {
      position,
      anchors
    };
  }
  function createChatGptElementNavigationAnchor({
    conversationKey,
    promptId,
    promptIndex,
    element,
    scrollContainer
  }) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const anchorScrollTop = scrollContainer.scrollTop + elementRect.top - containerRect.top;
    return createNavigationAnchor({
      conversationKey,
      promptId,
      promptIndex,
      scrollTop: anchorScrollTop,
      scrollHeight: scrollContainer.scrollHeight,
      viewportWidth: scrollContainer.clientWidth || window.innerWidth,
      viewportHeight: scrollContainer.clientHeight || window.innerHeight
    });
  }
  function getChatGptMessageId(element) {
    return element.dataset.messageId || element.closest("[data-message-id]")?.dataset.messageId || null;
  }
  function isVerticallyScrollable(element) {
    const overflowY = window.getComputedStyle(element).overflowY;
    return overflowY === "auto" || overflowY === "scroll";
  }
  function isElementWithinScrollViewport(element, containerRect) {
    const elementRect = element.getBoundingClientRect();
    return elementRect.bottom > containerRect.top && elementRect.top < containerRect.bottom;
  }

  // vendor/luna-navigation/src/navigation/navigationData.ts
  function createNavigationTurns(messages) {
    const turns = [];
    let currentTurn = null;
    messages.forEach((message) => {
      const normalizedMessage = createNavigationTextMessage(message);
      if (!normalizedMessage) return;
      if (message.kind === "prompt") {
        currentTurn = {
          promptIndex: turns.length,
          prompt: normalizedMessage,
          responses: []
        };
        turns.push(currentTurn);
        return;
      }
      currentTurn?.responses.push(normalizedMessage);
    });
    return turns;
  }
  function createNavigationTextMessage(message) {
    const text = message.text.trim();
    if (!text) return null;
    return {
      id: message.id,
      text
    };
  }

  // src/navigation/conversationAdapter.ts
  function toLunaPrompts(turns) {
    return turns.map((turn) => ({ id: turn.userMessageId ?? turn.id }));
  }
  function toLunaNavigationTurns(turns) {
    return createNavigationTurns(
      turns.flatMap((turn) => {
        const promptId = turn.userMessageId ?? turn.id;
        const promptText = turn.userMarkdown || turn.userPreview || promptId;
        const responseId = turn.assistantMessageId;
        const responseText = turn.assistantMarkdown || turn.assistantPreview;
        const prompt = { id: promptId, kind: "prompt", text: promptText };
        if (!responseId || !responseText.trim()) return [prompt];
        return [prompt, { id: responseId, kind: "response", text: responseText }];
      })
    );
  }
  function findTurn(turns, turnId) {
    return turns.find(
      (turn) => turn.id === turnId || turn.userMessageId === turnId || turn.assistantMessageId === turnId
    );
  }

  // src/navigation/navigationPort.ts
  var PROMPT_TOP_OFFSET_PX = NAVIGATION_CONFIG.promptTopOffsetPx;
  var ANCHOR_KEY = "chatgpt-yada:nav-anchors:v1";
  var CANCEL_KEYS = /* @__PURE__ */ new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Space", " "]);
  var NavigationPort = class {
    transaction = null;
    fingerprintCache = null;
    anchors = createNavigationAnchorStore({
      storage: {
        async read() {
          if (typeof chrome === "undefined" || !chrome.storage?.local) return void 0;
          const data = await chrome.storage.local.get(ANCHOR_KEY);
          return data[ANCHOR_KEY];
        },
        async write(value) {
          if (typeof chrome === "undefined" || !chrome.storage?.local) return;
          await chrome.storage.local.set({ [ANCHOR_KEY]: value });
        }
      }
    });
    interrupt = null;
    async navigateTo(turnId, turns, conversationId, options = {}) {
      this.cancel();
      const turn = findTurn(turns, turnId);
      if (!turn) return { ok: false, status: "failed" };
      const controller = new AbortController();
      this.transaction = controller;
      const abort = () => controller.abort();
      if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener("abort", abort, { once: true });
      }
      this.attachInterrupt(abort);
      try {
        if (controller.signal.aborted) return { ok: false, status: "cancelled" };
        if (await this.jumpDirect(turn, controller.signal)) {
          return { ok: true, status: "found", path: "direct" };
        }
        if (controller.signal.aborted) return { ok: false, status: "cancelled" };
        return await this.jumpVirtual(turn, turns, conversationId, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || isAbortError4(error)) return { ok: false, status: "cancelled" };
        return { ok: false, status: "failed" };
      } finally {
        options.signal?.removeEventListener("abort", abort);
        this.detachInterrupt();
        if (this.transaction === controller) this.transaction = null;
      }
    }
    cancel() {
      this.transaction?.abort();
      this.transaction = null;
      this.detachInterrupt();
    }
    dispose() {
      this.cancel();
      this.fingerprintCache = null;
    }
    async jumpDirect(turn, signal) {
      const ids = [turn.userMessageId, turn.assistantMessageId, turn.id].filter((id) => !!id);
      for (const id of ids) {
        if (signal.aborted) return false;
        const element = findRenderedById(id);
        const container = getChatGptScrollContainer();
        if (!element || !container) continue;
        if (readMessageId(element) !== id) continue;
        scrollElementIntoContainer(element, container);
        await wait(32);
        if (signal.aborted) return false;
        const still = findRenderedById(id);
        if (still && readMessageId(still) === id) return true;
      }
      return false;
    }
    async jumpVirtual(turn, turns, conversationId, signal) {
      const prompts = toLunaPrompts(turns);
      const lunaTurns = toLunaNavigationTurns(turns);
      const signature = `${conversationId}:${turns.map((item) => `${item.userMessageId}:${item.assistantMessageId}`).join("|")}`;
      if (!this.fingerprintCache || this.fingerprintCache.signature !== signature) {
        this.fingerprintCache = {
          signature,
          fingerprintIndex: await buildFingerprintIndex(lunaTurns),
          segmentIndex: await buildDerivedSegmentIndex(lunaTurns)
        };
      }
      const { fingerprintIndex, segmentIndex } = this.fingerprintCache;
      const targetPromptId = turn.userMessageId ?? turn.id;
      const container = () => getChatGptScrollContainer();
      const result = await searchVirtualPrompt({
        targetPromptId,
        targetPromptIndex: turn.index,
        promptCount: turns.length,
        getConfirmedAnchors: () => this.anchors.getConfirmedAnchors(conversationId),
        invalidateConfirmedAnchor: (promptId) => this.anchors.removeConfirmed(conversationId, promptId).then(() => void 0),
        getObservedAnchors: () => this.anchors.getObservedAnchors(conversationId),
        recordObservation: (anchor) => {
          this.anchors.recordObservation(anchor);
        },
        getScrollMetrics: () => {
          const node = container();
          return node ? getChatGptScrollMetrics(node) : { scrollTop: 0, maximumScrollTop: 0, viewportWidth: innerWidth, viewportHeight: innerHeight };
        },
        observePosition: () => observeChatGptVirtualPosition({
          conversationKey: conversationId,
          prompts,
          fingerprintIndex,
          segmentIndex
        }),
        isTargetRendered: () => {
          const element = findRenderedById(targetPromptId);
          const node = container();
          return Boolean(element && node && readMessageId(element) === targetPromptId);
        },
        scrollTo: (scrollTop) => {
          const node = container();
          if (node) node.scrollTop = scrollTop;
        },
        now: () => Date.now(),
        signal
      });
      if (result.status === "found") {
        const element = findRenderedById(targetPromptId);
        const node = container();
        if (element && node) {
          scrollElementIntoContainer(element, node);
          const metrics = getChatGptScrollMetrics(node);
          await this.anchors.recordConfirmed({
            conversationKey: conversationId,
            promptId: targetPromptId,
            promptIndex: turn.index,
            scrollTop: metrics.scrollTop,
            scrollHeight: node.scrollHeight,
            viewportWidth: metrics.viewportWidth,
            viewportHeight: metrics.viewportHeight
          });
        }
        return { ok: true, status: "found", path: "virtual", attempts: result.attempts };
      }
      if (result.status === "cancelled") return { ok: false, status: "cancelled", path: "virtual", attempts: result.attempts };
      if (result.status === "timed-out") return { ok: false, status: "timed-out", path: "virtual", attempts: result.attempts };
      if (result.status === "exhausted") return { ok: false, status: "exhausted", path: "virtual", attempts: result.attempts };
      return { ok: false, status: "unresolved", path: "virtual", attempts: result.attempts };
    }
    attachInterrupt(abort) {
      this.detachInterrupt();
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
      window.addEventListener("touchmove", onTouch, { passive: true, capture: true });
      window.addEventListener("pointerdown", onPointer, { capture: true });
      window.addEventListener("keydown", onKey, { capture: true });
      this.interrupt = () => {
        window.removeEventListener("wheel", onWheel, true);
        window.removeEventListener("touchmove", onTouch, true);
        window.removeEventListener("pointerdown", onPointer, true);
        window.removeEventListener("keydown", onKey, true);
      };
    }
    detachInterrupt() {
      this.interrupt?.();
      this.interrupt = null;
    }
  };
  function findRenderedById(id) {
    return findRenderedChatGptPrompt(id) ?? document.querySelector(`[data-message-id="${cssEscape(id)}"]`);
  }
  function readMessageId(element) {
    return element.dataset.messageId ?? element.closest("[data-message-id]")?.dataset.messageId ?? null;
  }
  function scrollElementIntoContainer(element, container) {
    const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - PROMPT_TOP_OFFSET_PX;
    container.scrollTop = Math.max(0, top);
  }
  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  function isAbortError4(error) {
    return error instanceof DOMException && error.name === "AbortError";
  }
  function cssEscape(value) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
  }

  // src/navigation/navigatorController.ts
  var NavigatorController = class {
    constructor(sync) {
      this.sync = sync;
    }
    port = new NavigationPort();
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
    dispose() {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.port.dispose();
    }
  };

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
    mount() {
      this.unsubscribe = this.sync.subscribe((snapshot) => this.onSnapshot(snapshot));
      document.addEventListener("visibilitychange", this.onVisibility);
      void this.scanHistory();
    }
    async refreshCurrent() {
      await this.sync.requestSync("popup");
      await this.ingestQueue;
    }
    dispose() {
      this.disposed = true;
      this.unsubscribe?.();
      this.unsubscribe = null;
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    onSnapshot(snapshot) {
      const work = this.writeLedger(snapshot);
      this.ingestQueue = this.ingestQueue.then(() => work, () => work);
      return work;
    }
    async writeLedger(snapshot) {
      if (this.disposed || !snapshot) return;
      const account = await readChatAccount();
      const limits = await readModelLimits();
      const classification = classifySnapshot(snapshot);
      const events = snapshot.quotaIsWork ? [] : toEvents(snapshot.quotaTurns, account.identity, classification);
      await chrome.runtime.sendMessage({
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
        store: this.history,
        identity: account.identity,
        now: Date.now()
      });
      if (this.disposed) return;
      const events = toEvents(result.turns, account.identity, "personal");
      await chrome.runtime.sendMessage({
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
      if (document.visibilityState === "visible") void this.scanHistory();
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
    statusTimer = 0;
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
    setStatus(message) {
      window.clearTimeout(this.statusTimer);
      this.host.title = message;
      let status = this.host.shadowRoot.querySelector('[role="status"]');
      if (!status) {
        status = document.createElement("div");
        status.setAttribute("role", "status");
        status.style.cssText = "position:absolute;right:64px;top:0;white-space:nowrap;background:var(--bg);padding:4px 8px;border-radius:6px;pointer-events:none";
        this.host.shadowRoot.append(status);
      }
      status.textContent = message;
      status.hidden = !message;
      if (message && message !== "定位中") this.statusTimer = window.setTimeout(() => this.setStatus(""), 1800);
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
      window.clearTimeout(this.statusTimer);
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
      this.view.setTurns([]);
      this.view.clearHover();
    }
    dispose() {
      this.disposed = true;
      this.unsubscribe?.();
      this.unsubscribe = null;
      window.cancelAnimationFrame(this.raf);
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
        this.syncActive();
      }
    }
    async jump(turnId) {
      const generation = ++this.jumpGeneration;
      this.navigator.cancel();
      this.jumping = true;
      this.view.setStatus("定位中");
      try {
        const result = await this.navigator.navigateTo(turnId);
        if (generation !== this.jumpGeneration) return;
        if (result.status === "cancelled") {
          this.view.setStatus("");
          return;
        }
        if (!result.ok) {
          this.view.setStatus("定位失败");
          return;
        }
        this.view.setStatus("");
        this.syncActive();
      } finally {
        if (generation === this.jumpGeneration) this.jumping = false;
      }
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
    previewAssistant = false;
    closePanels() {
      this.prompts?.close();
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
        [data-preview-mode] { padding: 0; width: 20px; height: 20px; font-size: 16px; color: var(--yada-muted); border: 0; background: transparent; }
        [data-preview-mode][aria-pressed="true"] { color: var(--yada-primary); }
      </style>
      <button type="button" data-preview-mode aria-pressed="false" aria-label="预览：User" title="预览：User">●</button>
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
    sync = new ConversationSync();
    navigator = null;
    rail = null;
    toolbar = null;
    quota = null;
    routeDispose = null;
    messageDispose = null;
    mount() {
      this.sync.mountPageObserver();
      this.navigator = new NavigatorController(this.sync);
      this.navigator.mount();
      this.rail = new YadaRailController(this.sync, this.navigator);
      this.rail.mount();
      this.quota = new QuotaTracker(this.sync);
      this.quota.mount();
      this.toolbar = new YadaToolbar((assistant) => this.rail?.setPreviewMode(assistant), this.sync);
      this.toolbar.mount();
      this.syncPageState();
      this.routeDispose = observeRouteChange(() => {
        this.toolbar?.closePanels();
        this.rail?.clear();
        this.navigator?.cancel();
        this.syncPageState();
      });
      const onMessage = (message, _sender, sendResponse) => {
        if (message?.type !== "quota/refresh-current") return false;
        void this.quota?.refreshCurrent().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: String(error) }));
        return true;
      };
      chrome.runtime.onMessage.addListener(onMessage);
      this.messageDispose = () => chrome.runtime.onMessage.removeListener(onMessage);
    }
    dispose = () => {
      this.routeDispose?.();
      this.routeDispose = null;
      this.messageDispose?.();
      this.messageDispose = null;
      this.quota?.dispose();
      this.quota = null;
      this.rail?.dispose();
      this.rail = null;
      this.navigator?.dispose();
      this.navigator = null;
      this.toolbar?.dispose();
      this.toolbar = null;
      this.sync.dispose();
    };
    syncPageState() {
      this.toolbar?.ensurePlacement();
      this.toolbar?.setVisible(isChatGptPage());
      const copy = document.getElementById("chatgpt-yada-toolbar-host")?.shadowRoot?.querySelector("[data-copy-all]");
      if (copy) copy.hidden = !isChatGptConversationPage();
      this.sync.setActiveConversation(getConversationIdFromUrl());
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
