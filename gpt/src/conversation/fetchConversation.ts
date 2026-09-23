import { fetchCompleteConversation, fetchRecentConversation } from "./completeConversation";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";

export type ApiAuthorRole = "system" | "assistant" | "user" | "tool";

export type ApiConversationMessage = {
  id: string;
  author?: {
    role?: ApiAuthorRole | string;
    name?: string;
  };
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  recipient?: string;
  channel?: string | null;
  status?: string;
  create_time?: number;
};

export type ApiConversationNode = {
  id: string;
  parent?: string;
  children?: string[];
  message?: ApiConversationMessage | null;
};

export type ApiConversation = {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  current_node?: string;
  mapping?: Record<string, ApiConversationNode>;
  messages?: ApiConversationMessage[];
  workspace_id?: string;
  workspaceId?: string;
  workspace_type?: string;
  workspaceType?: string;
  is_workspace?: boolean;
  isWorkspace?: boolean;
};

type SessionResponse = {
  accessToken?: string;
};

let sessionTokenPromise: Promise<string | null> | null = null;

export async function fetchCurrentConversation(conversationId = getConversationIdFromUrl(), signal?: AbortSignal): Promise<ApiConversation | null> {
  if (!conversationId) return null;
  return fetchConversation(conversationId, signal);
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export class ChatGPTApiTimeoutError extends Error {
  constructor() {
    super("ChatGPT API timed out");
    this.name = "ChatGPTApiTimeoutError";
  }
}

export async function chatgptApiJson(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {}
): Promise<unknown> {
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
  const abort = (): void => controller.abort();
  init.signal?.addEventListener("abort", abort);
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 15_000);
  try {
    if (init.signal?.aborted) throw abortError();
    const response = await fetch(path, { credentials: "include", cache: "no-store", ...init, headers, signal: controller.signal });
    if (init.signal?.aborted) throw abortError();
    if (timedOut || controller.signal.aborted) throw new ChatGPTApiTimeoutError();
    if (!response.ok) throw new Error(`API failed: ${response.status}`);
    return await new Promise((resolve, reject) => {
      const fail = (): void => {
        if (init.signal?.aborted) reject(abortError());
        else reject(new ChatGPTApiTimeoutError());
      };
      if (controller.signal.aborted) {
        fail();
        return;
      }
      const onAbort = (): void => fail();
      controller.signal.addEventListener("abort", onAbort, { once: true });
      response.json().then((data) => {
        controller.signal.removeEventListener("abort", onAbort);
        if (controller.signal.aborted) fail();
        else resolve(data);
      }, (error: unknown) => {
        controller.signal.removeEventListener("abort", onAbort);
        if (init.signal?.aborted) reject(abortError());
        else if (timedOut || controller.signal.aborted || isAbortError(error)) reject(new ChatGPTApiTimeoutError());
        else reject(error);
      });
    });
  } catch (error) {
    if (init.signal?.aborted) throw abortError();
    if (timedOut || error instanceof ChatGPTApiTimeoutError || controller.signal.aborted) throw new ChatGPTApiTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name: string }).name === "AbortError");
}

export async function chatgptApi(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {}
): Promise<Response> {
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
  const abort = (): void => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 15_000);
  try {
    if (controller.signal.aborted && init.signal?.aborted) throw abortError();
    return await fetch(path, { credentials: "include", cache: "no-store", ...init, headers, signal: controller.signal });
  } catch (error) {
    if (init.signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new ChatGPTApiTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

async function authorizedHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { Accept: "application/json" };
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

export async function fetchConversation(conversationId: string, signal?: AbortSignal): Promise<ApiConversation> {
  return fetchCompleteConversation(conversationId, await authorizedHeaders(), signal);
}

export async function fetchRecentConversationPage(conversationId: string, signal?: AbortSignal): Promise<ApiConversation> {
  return fetchRecentConversation(conversationId, await authorizedHeaders(), signal);
}

async function getAccessToken(): Promise<string | null> {
  sessionTokenPromise ??= fetchSessionToken().then((token) => {
    if (!token) sessionTokenPromise = null;
    return token;
  }, (error) => {
    sessionTokenPromise = null;
    throw error;
  });
  return sessionTokenPromise;
}

async function fetchSessionToken(): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const session = await response.json() as SessionResponse;
    return typeof session.accessToken === "string" ? session.accessToken : null;
  } catch {
    return null;
  }
}

export function getChatGptAccountId(): string | null {
  try {
    const raw = window.localStorage.getItem("_account");
    if (!raw) return null;
    if (/^account-[a-z0-9_-]+$/i.test(raw)) return raw;

    const parsed = JSON.parse(raw) as unknown;
    return findAccountId(parsed);
  } catch {
    return null;
  }
}

function findAccountId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
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
