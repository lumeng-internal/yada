/* Adapted from GPT Conversation Toolkit features/conversation-api.js.
 * Copyright (c) 2026 bujue3709. MIT; see THIRD_PARTY_NOTICES.md.
 * Same full-conversation and paginated API contracts; Yada keeps its active-branch normalizer.
 */
import type { ApiConversation, ApiConversationMessage, ApiConversationNode } from './fetchConversation';

type PageInfo = { has_previous_page?: boolean; hasPreviousPage?: boolean; start_cursor?: string; startCursor?: string };
type ConversationResponse = ApiConversation & {
  current_node_id?: string;
  conversation?: ConversationResponse;
  messages?: ApiConversationMessage[];
  page_info?: PageInfo;
  pageInfo?: PageInfo;
};
const PAGE_NUM_TURNS = 100;
export const RECENT_TURN_BATCH = 16;
const MAX_PAGES = 500;

function unwrap(data: ConversationResponse): ConversationResponse { return data.conversation ?? data; }
function abortError(): DOMException { return new DOMException("Aborted", "AbortError"); }
function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name: string }).name === "AbortError");
}
export function isCompleteConversationMapping(raw: ConversationResponse): boolean {
  const data = unwrap(raw), mapping = data.mapping;
  let next = data.current_node ?? data.current_node_id ?? '';
  if (!mapping || !next || !mapping[next]) return false;
  const seen = new Set<string>();
  while (next) {
    if (seen.has(next) || !mapping[next]) return false;
    seen.add(next); next = mapping[next].parent ?? '';
  }
  return true;
}
export function getPaginatedConversationApiUrl(conversationId: string, before = '', numTurns = PAGE_NUM_TURNS): string {
  const id = encodeURIComponent(conversationId);
  const path = before ? `/backend-api/conversations/${id}/messages` : `/backend-api/conversations/${id}`;
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  params.set('include_has_versions', 'true'); params.set('num_turns', String(numTurns));
  return `${path}?${params}`;
}
function getPaginatedConversationCursor(data: ConversationResponse): string {
  const page = data.page_info ?? data.pageInfo;
  // Without terminal page evidence, a partial response must never become an api-full snapshot.
  if (!page || typeof (page.has_previous_page ?? page.hasPreviousPage) !== 'boolean') throw new Error('Missing pagination completeness metadata');
  const previous = page.has_previous_page === true || page.hasPreviousPage === true;
  const cursor = page.start_cursor ?? page.startCursor ?? '';
  if (previous && !cursor) throw new Error('Pagination requested an older page without a cursor');
  return previous ? cursor : '';
}
function mergePaginatedConversationMessages(older: ApiConversationMessage[], newer: ApiConversationMessage[]): ApiConversationMessage[] {
  const seen = new Set<string>();
  return [...older, ...newer].filter(message => {
    if (!message?.id) throw new Error('Conversation message has no stable ID');
    if (seen.has(message.id)) return false;
    seen.add(message.id); return true;
  });
}
function buildConversationMappingFromMessages(messages: ApiConversationMessage[], id: string, current: string): ApiConversation {
  const rootId = `paginated-root:${id}`;
  const mapping: Record<string, ApiConversationNode> = { [rootId]: { id: rootId, parent: '', children: [] } };
  let parent = rootId;
  for (const message of messages) {
    mapping[parent].children = [message.id];
    mapping[message.id] = { id: message.id, parent, children: [], message };
    parent = message.id;
  }
  // Preserve first-page current branch tip, never silently switch to a nearby branch.
  if (current && !mapping[current]) throw new Error('Active branch tip missing after pagination');
  return { id, mapping, current_node: current || parent };
}

export type CompleteConversationOptions = {
  requestTimeoutMs?: number;
  rateLimitWaitMs?: number;
};

export function isTransientTransportError(error: unknown): boolean {
  if (isAbortError(error)) return true;
  if (!(error instanceof Error)) return false;
  return /timed out/i.test(error.message)
    || /API failed: 429\b/.test(error.message)
    || /API failed: 5\d{2}\b/.test(error.message)
    || /Failed to fetch|NetworkError|network/i.test(error.message);
}

export function shouldFallbackToLegacyConversation(error: unknown): boolean {
  if (isAbortError(error) || isTransientTransportError(error)) return false;
  if (error instanceof Error && (/API failed: \d+/.test(error.message) || /invalid JSON/i.test(error.message))) return false;
  return true;
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type ConversationPayload = { status: number; data: ConversationResponse | null };

async function readJsonBody(
  response: Response,
  controller: AbortController,
  external?: AbortSignal
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const fail = (): void => {
      if (external?.aborted) reject(abortError());
      else reject(new Error("ChatGPT conversation API timed out"));
    };
    if (controller.signal.aborted) {
      fail();
      return;
    }
    const onAbort = (): void => fail();
    controller.signal.addEventListener("abort", onAbort, { once: true });
    response.json().then((data) => {
      controller.signal.removeEventListener("abort", onAbort);
      if (controller.signal.aborted) {
        fail();
        return;
      }
      resolve(data);
    }, (error: unknown) => {
      controller.signal.removeEventListener("abort", onAbort);
      if (external?.aborted) reject(abortError());
      else if (controller.signal.aborted || isAbortError(error)) reject(new Error("ChatGPT conversation API timed out"));
      else reject(new Error("Conversation API returned invalid JSON"));
    });
  });
}

function createConversationRequest(
  headers: HeadersInit,
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  rateLimitWaitMs: number
): (url: string) => Promise<ConversationResponse> {
  const once = async (): Promise<ConversationPayload> => {
    const controller = new AbortController();
    let timedOut = false;
    const abort = (): void => controller.abort();
    const onTimeout = (): void => {
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
      return { status: response.status, data: data as ConversationResponse };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (timedOut || controller.signal.aborted || (isAbortError(error) && !signal?.aborted)) {
        throw new Error("ChatGPT conversation API timed out");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
  const urlHolder: { current: string } = { current: "" };
  function urlFrom(_controller: AbortController): string {
    return urlHolder.current;
  }
  return async (url: string): Promise<ConversationResponse> => {
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

export async function fetchRecentConversation(
  id: string,
  headers: HeadersInit,
  signal?: AbortSignal,
  options: CompleteConversationOptions = {}
): Promise<ApiConversation> {
  const request = createConversationRequest(
    headers,
    signal,
    options.requestTimeoutMs ?? 30_000,
    options.rateLimitWaitMs ?? 1_000
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

export async function fetchCompleteConversation(
  id: string,
  headers: HeadersInit,
  signal?: AbortSignal,
  options: CompleteConversationOptions = {}
): Promise<ApiConversation> {
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const rateLimitWaitMs = options.rateLimitWaitMs ?? 1_000;
  const request = createConversationRequest(headers, signal, requestTimeoutMs, rateLimitWaitMs);
  const complete = (raw: ConversationResponse): ApiConversation => {
    const data = unwrap(raw);
    if (!isCompleteConversationMapping(raw)) throw new Error('Incomplete active conversation path');
    return { ...data, id: data.id ?? data.conversation_id ?? id, current_node: data.current_node ?? data.current_node_id };
  };
  const base = `/backend-api/conversation/${encodeURIComponent(id)}`;
  let lastError: unknown;
  try {
    const first = unwrap(await request(getPaginatedConversationApiUrl(id)));
    if (Array.isArray(first.messages)) {
      let messages = mergePaginatedConversationMessages([], first.messages);
      let cursor = getPaginatedConversationCursor(first);
      const seen = new Set<string>();
      let count = 1;
      while (cursor) {
        if (signal?.aborted) throw abortError();
        if (seen.has(cursor) || count >= MAX_PAGES) throw new Error('Conversation pagination stalled');
        seen.add(cursor);
        const page = unwrap(await request(getPaginatedConversationApiUrl(id, cursor)));
        if (!Array.isArray(page.messages)) throw new Error('Conversation message page returned no messages');
        messages = mergePaginatedConversationMessages(page.messages, messages);
        cursor = getPaginatedConversationCursor(page); count++;
      }
      if (!messages.length) throw new Error('Paginated conversation is empty');
      const current = first.current_node ?? first.current_node_id ?? '';
      const rebuilt = buildConversationMappingFromMessages(messages, id, current);
      return { ...first, ...rebuilt, messages };
    }
    if (isCompleteConversationMapping(first)) return complete(first);
    throw new Error('Paginated conversation API returned no messages');
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
    try { return complete(await request(url)); }
    catch (error) {
      lastError = error;
      if (!shouldFallbackToLegacyConversation(error)) throw error;
    }
  }
  throw lastError;
}
