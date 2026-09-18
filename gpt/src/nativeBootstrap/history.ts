/* Request URL matching, GET rewrite, and page_info/cursor chain.
 * Adapted from:
 * - canxin121/chatgpt-web-performance-fix @ c4b12ddd87220ab8d2a14001da46aba5e773f5c7
 *   matchConversationApiUrl, rewriteGetRequest, num_turns handling (MIT)
 * - Leo7805/luna-toc @ 1339969ec25d7c9b63068abd3776ce41780023ed
 *   /backend-api/conversations/{id}, /messages?before=, include_has_versions,
 *   num_turns=100, page_info.has_previous_page / start_cursor, getFetchUrl (MIT)
 */
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import {
  emptyHistoryState,
  MAX_MESSAGE_IDS,
  TARGET_NUM_TURNS,
  type CaptureContext,
  type CaptureKind,
  type ConversationApiMatch,
  type HistoryIssue,
  type HistoryPayload,
  type HistoryState
} from "./shared";

const INITIAL_PATH =
  /^\/backend-api\/conversations\/([^/]+)\/?$/;
const MESSAGES_PATH =
  /^\/backend-api\/conversations\/([^/]+)\/messages\/?$/;

export function getFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return input instanceof URL ? input.toString() : "";
}

export function getFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (isRequestLike(input) ? input.method : "GET")).toUpperCase();
}

export function isRequestLike(input: unknown): input is Request {
  if (!input || typeof input !== "object") return false;
  const request = input as Request;
  return typeof request.method === "string" && request.headers != null && typeof request.url === "string";
}

export function matchConversationApiUrl(
  rawUrl: string,
  baseUrl: string
): ConversationApiMatch | null {
  try {
    const pathname = new URL(rawUrl, baseUrl).pathname;
    const messages = pathname.match(MESSAGES_PATH);
    if (messages) {
      const conversationId = decodeURIComponent(messages[1]);
      return conversationId && conversationId !== "init"
        ? { kind: "paginated-messages", conversationId }
        : null;
    }
    const initial = pathname.match(INITIAL_PATH);
    if (!initial) return null;
    const conversationId = decodeURIComponent(initial[1]);
    return conversationId && conversationId !== "init"
      ? { kind: "paginated-initial", conversationId }
      : null;
  } catch {
    return null;
  }
}

export function isMessageDeepLink(url = typeof location === "undefined" ? "" : location.href): boolean {
  try {
    const parsed = new URL(url, "https://chatgpt.com");
    return parsed.searchParams.has("message") || parsed.searchParams.has("messageId");
  } catch {
    return false;
  }
}

export function currentConversationId(url = typeof location === "undefined" ? "" : location.href): string | null {
  return getConversationIdFromUrl(url);
}

export function isSameOriginGet(
  rawUrl: string,
  baseUrl: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined
): boolean {
  if (getFetchMethod(input, init) !== "GET") return false;
  try {
    const url = new URL(rawUrl, baseUrl);
    const base = new URL(baseUrl);
    return url.origin === base.origin;
  } catch {
    return false;
  }
}

export function requestHasEventStream(input: RequestInfo | URL, init?: RequestInit): boolean {
  const value = headerValue(input, init, "accept") + " " + headerValue(input, init, "content-type");
  return value.includes("text/event-stream");
}

function headerValue(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string {
  const fromInit = readHeader(init?.headers, name);
  if (fromInit) return fromInit;
  return isRequestLike(input) ? readHeader(input.headers, name) : "";
}

function readHeader(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name) ?? "";
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1] ?? "";
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find(entry => entry.toLowerCase() === name.toLowerCase());
  return key ? record[key] : "";
}

export function shouldHandleConversationRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  baseUrl: string,
  conversationId: string | null
): ConversationApiMatch | null {
  if (!conversationId) return null;
  if (isMessageDeepLink(baseUrl)) return null;
  const rawUrl = getFetchUrl(input);
  if (!rawUrl) return null;
  if (!isSameOriginGet(rawUrl, baseUrl, input, init)) return null;
  if (requestHasEventStream(input, init)) return null;
  let url: URL;
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

export function boostConversationUrl(
  rawUrl: string,
  baseUrl: string,
  match: ConversationApiMatch,
  boostOlder: boolean
): { href: string; boosted: boolean } {
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

export function rewriteGetRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  rewrittenUrl: string
): [RequestInfo | URL, RequestInit | undefined] {
  const requestLike = input as unknown as {
    method?: unknown;
    headers?: HeadersInit;
    credentials?: RequestCredentials;
    cache?: RequestCache;
    redirect?: RequestRedirect;
    referrer?: string;
    referrerPolicy?: ReferrerPolicy;
    integrity?: string;
    keepalive?: boolean;
    mode?: RequestMode;
    signal?: AbortSignal;
  };

  if (typeof requestLike.method !== "string" || requestLike.headers == null) {
    return [rewrittenUrl, init];
  }

  if (typeof Request !== "undefined" && isRequestLike(input)) {
    try {
      return [new Request(rewrittenUrl, input), init];
    } catch {
      // Cross-realm Request objects fall through to explicit field copy.
    }
  }

  const rewrittenInit: RequestInit = {
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

export function pageHasPrevious(payload: HistoryPayload): boolean | undefined {
  const value = payload.page_info?.has_previous_page;
  return typeof value === "boolean" ? value : undefined;
}

export function pageCursor(payload: HistoryPayload): string | null {
  const cursor = payload.page_info?.start_cursor;
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

function messageRole(message: { author?: { role?: string } }): string {
  return message.author?.role ?? "";
}

export class HistoryTracker {
  private readonly ids = new Set<string>();
  private readonly seenCursors = new Set<string>();
  private readonly active = new Map<number, CaptureContext>();
  private currentNode: string | null = null;
  private promptCount = 0;
  private nextRequestId = 0;
  private latestInitialId = 0;
  private routeGeneration = 0;
  private snapshot: HistoryState = emptyHistoryState();

  snapshotState(): HistoryState {
    return { ...this.snapshot };
  }

  reset(conversationId = ""): void {
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

  notifyRoute(conversationId: string): HistoryState {
    this.routeGeneration += 1;
    this.reset(conversationId);
    this.snapshot.revision += 1;
    return this.snapshotState();
  }

  matchesContext(ctx: CaptureContext): boolean {
    return ctx.conversationId === this.snapshot.conversationId
      && ctx.routeGeneration === this.snapshot.generation;
  }

  isStale(ctx: CaptureContext): boolean {
    if (!this.matchesContext(ctx)) return true;
    if (ctx.kind === "initial") return ctx.requestId !== this.latestInitialId;
    return ctx.initialVersion !== this.snapshot.initialVersion;
  }

  isValidRequest(ctx: CaptureContext): boolean {
    return !this.isStale(ctx);
  }

  beginRequest(input: {
    conversationId: string;
    kind: CaptureKind;
    before: string | null;
    boosted?: boolean;
  }): CaptureContext {
    if (!this.snapshot.conversationId) {
      if (this.routeGeneration === 0) this.routeGeneration = 1;
      this.snapshot.conversationId = input.conversationId;
      this.snapshot.generation = this.routeGeneration;
    }
    const ctx: CaptureContext = {
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

  endRequest(requestId: number): HistoryState {
    this.active.delete(requestId);
    this.snapshot.revision += 1;
    this.syncPending();
    return this.snapshotState();
  }

  markIssue(issue: HistoryIssue, ctx?: CaptureContext): HistoryState {
    if (ctx && this.isStale(ctx)) return this.snapshotState();
    this.snapshot.issue = issue;
    this.snapshot.revision += 1;
    return this.snapshotState();
  }

  applyInitial(conversationId: string, payload: HistoryPayload): HistoryState {
    if (this.snapshot.conversationId !== conversationId) this.notifyRoute(conversationId);
    const ctx = this.beginRequest({ conversationId, kind: "initial", before: null });
    const state = this.applyInitialFrom(ctx, payload);
    this.endRequest(ctx.requestId);
    return state;
  }

  applyOlder(payload: HistoryPayload, requestedBefore: string | null): HistoryState {
    return this.applyOlderFrom({
      requestId: ++this.nextRequestId,
      conversationId: this.snapshot.conversationId,
      routeGeneration: this.snapshot.generation,
      initialVersion: this.snapshot.initialVersion,
      kind: "older",
      before: requestedBefore
    }, payload, false);
  }

  applyInitialFrom(ctx: CaptureContext, payload: HistoryPayload): HistoryState {
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

  applyOlderFrom(ctx: CaptureContext, payload: HistoryPayload, silentStale = true): HistoryState {
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

  private commitPage(payload: HistoryPayload, kind: "initial" | "older"): HistoryState {
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

  private fail(issue: HistoryIssue): HistoryState {
    this.snapshot.issue = issue;
    if (this.snapshot.boundary === "complete") this.snapshot.boundary = "unknown";
    this.snapshot.revision += 1;
    return this.snapshotState();
  }

  private collectNewIds(payload: HistoryPayload): number {
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

  private syncCounts(): void {
    this.snapshot.messages = this.ids.size;
    this.snapshot.prompts = this.promptCount;
  }

  private syncPending(): void {
    let pending = 0;
    for (const ctx of this.active.values()) {
      if (this.isValidRequest(ctx)) pending += 1;
    }
    this.snapshot.pending = pending;
  }
}
