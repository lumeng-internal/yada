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
};

type SessionResponse = {
  accessToken?: string;
};

let sessionTokenPromise: Promise<string | null> | null = null;

export async function fetchCurrentConversation(conversationId = getConversationIdFromUrl(), signal?: AbortSignal): Promise<ApiConversation | null> {
  if (!conversationId) return null;
  return fetchConversation(conversationId, signal);
}

export async function fetchConversation(conversationId: string, signal?: AbortSignal): Promise<ApiConversation> {
  const headers: HeadersInit = {
    Accept: "application/json"
  };
  const accessToken = await getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    headers["X-Authorization"] = `Bearer ${accessToken}`;
  }
  const accountId = getChatGptAccountId();
  if (accountId) {
    headers["Chatgpt-Account-Id"] = accountId;
  }

  const response = await fetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
    credentials: "include",
    signal,
    headers
  });

  if (!response.ok) {
    throw new Error(`ChatGPT conversation API failed: ${response.status}`);
  }

  const conversation = await response.json() as ApiConversation;
  return {
    ...conversation,
    id: conversation.id ?? conversation.conversation_id ?? conversationId
  };
}

async function getAccessToken(): Promise<string | null> {
  sessionTokenPromise ??= fetchSessionToken();
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

function getChatGptAccountId(): string | null {
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
