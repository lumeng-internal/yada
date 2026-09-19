export const NATIVE_NAV_CHANNEL = "chatgpt-yada:native-nav:v1";

export type HistoryBoundary = "unknown" | "more" | "complete";
export type HistoryIssue = "http-error" | "capture-unavailable" | "unlinked" | "stalled" | "limit" | null;

export type NativeHistoryState = {
  conversationId: string | null;
  generation: number;
  initialVersion: number;
  revision: number;
  pending: number;
  pages: number;
  messages: number;
  prompts: number;
  boundary: HistoryBoundary;
  cursorPresent: boolean;
  issue: HistoryIssue;
};

export type HistoryRequest = {
  conversationId: string;
  kind: "initial" | "older";
  before: string | null;
  plural: boolean;
};

const HISTORY_ISSUES = new Set<HistoryIssue>([
  null,
  "http-error",
  "capture-unavailable",
  "unlinked",
  "stalled",
  "limit"
]);

export function emptyHistory(conversationId: string | null, generation = 0): NativeHistoryState {
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

export function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function identifier(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
}

export function conversationIdFromUrl(input: string): string | null {
  try {
    const parts = new URL(input).pathname.split("/").filter(Boolean);
    const marker = parts.indexOf("c");
    return marker >= 0 && marker + 1 < parts.length && /^[A-Za-z0-9_-]{1,128}$/.test(parts[marker + 1]!)
      ? parts[marker + 1]!
      : null;
  } catch {
    return null;
  }
}

export function isMessageDeepLink(input = location.href): boolean {
  try {
    const params = new URL(input).searchParams;
    return params.has("message") || params.has("messageId");
  } catch {
    return false;
  }
}

export function historyRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pageUrl: string
): HistoryRequest | null {
  try {
    const page = new URL(pageUrl);
    const current = conversationIdFromUrl(page.href);
    if (page.origin !== "https://chatgpt.com" || !current) return null;

    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    if ((init?.method ?? request?.method ?? "GET").toUpperCase() !== "GET") return null;
    const target = new URL(request?.url ?? String(input), page);
    if (target.origin !== page.origin) return null;

    const path = target.pathname.split("/").filter(Boolean);
    if (path[0] !== "backend-api" || (path[1] !== "conversation" && path[1] !== "conversations")) return null;
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

export function expandInitialHistoryRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pageUrl: string
): readonly [RequestInfo | URL, RequestInit?] {
  const match = historyRequest(input, init, pageUrl);
  if (!match || match.kind !== "initial" || !match.plural || isMessageDeepLink(pageUrl)) return [input, init];

  try {
    const original = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const target = new URL(original?.url ?? String(input), pageUrl);
    const currentBatch = Number(target.searchParams.get("num_turns"));
    if (Number.isFinite(currentBatch) && currentBatch >= 100) return [input, init];
    target.searchParams.set("num_turns", "100");
    return [original ? new Request(target.href, requestCloneInit(original)) : target.href, init];
  } catch {
    return [input, init];
  }
}

export function requestCloneInit(request: Request): RequestInit {
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

export function isNativeHistoryState(value: unknown): value is NativeHistoryState {
  const candidate = record(value);
  if (!candidate) return false;
  if (candidate.conversationId !== null && !identifier(candidate.conversationId)) return false;
  if (candidate.boundary !== "unknown" && candidate.boundary !== "more" && candidate.boundary !== "complete") return false;
  if (!HISTORY_ISSUES.has(candidate.issue as HistoryIssue) || typeof candidate.cursorPresent !== "boolean") return false;
  for (const key of ["generation", "initialVersion", "revision", "pending", "pages", "messages", "prompts"] as const) {
    const number = candidate[key];
    if (!Number.isSafeInteger(number) || (number as number) < 0 || (number as number) > 1_000_000) return false;
  }
  return true;
}
