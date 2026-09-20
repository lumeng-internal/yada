export const NATIVE_NAV_CHANNEL = "chatgpt-yada:native-nav:v1";
export const MIN_HISTORY_TURNS = 100;
export const PREPARE_LEASE_MS = 10_000;
export const PREPARE_HEARTBEAT_MS = 4_000;
export const PREPARE_ACK_WAIT_MS = 1_000;

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
  boosted: boolean;
  issue: HistoryIssue;
};

export type PrepareHandshake = {
  enabled: boolean;
  conversationId: string;
  generation: number;
};

export type PrepareLease = {
  enabled: boolean;
  conversationId: string | null;
  generation: number;
  until: number;
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
    boosted: false,
    issue: null
  };
}

export function emptyPrepareLease(): PrepareLease {
  return { enabled: false, conversationId: null, generation: 0, until: 0 };
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

export function canExpandInitial(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pageUrl: string,
  visible: boolean
): boolean {
  if (!visible || isMessageDeepLink(pageUrl)) return false;
  const match = historyRequest(input, init, pageUrl);
  return match != null && match.kind === "initial" && match.plural;
}

export function shouldExpandHistoryRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pageUrl: string,
  options: { visible: boolean; prepareActive: boolean }
): boolean {
  if (!historyRequest(input, init, pageUrl)) return false;
  return options.prepareActive || canExpandInitial(input, init, pageUrl, options.visible);
}

export function expandHistoryRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pageUrl: string
): readonly [RequestInfo | URL, RequestInit?] {
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

export function parsePrepareHandshake(value: unknown): PrepareHandshake | null {
  const message = record(value);
  if (!message || message.kind !== "prepare" || typeof message.enabled !== "boolean") return null;
  const conversationId = identifier(message.conversationId);
  if (!conversationId || !Number.isSafeInteger(message.generation) || (message.generation as number) < 0) return null;
  return {
    enabled: message.enabled,
    conversationId,
    generation: message.generation as number
  };
}

export function acceptPrepareHandshake(
  handshake: PrepareHandshake,
  context: { conversationId: string | null; generation: number }
): boolean {
  return handshake.conversationId === context.conversationId && handshake.generation === context.generation;
}

export function applyPrepareHandshake(handshake: PrepareHandshake, now: number): PrepareLease {
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

export function isPrepareActive(
  lease: PrepareLease,
  now: number,
  conversationId: string | null,
  generation: number
): boolean {
  return lease.enabled
    && lease.until > now
    && conversationId != null
    && lease.conversationId === conversationId
    && lease.generation === generation;
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
  if (typeof candidate.boosted !== "boolean") return false;
  for (const key of ["generation", "initialVersion", "revision", "pending", "pages", "messages", "prompts"] as const) {
    const number = candidate[key];
    if (!Number.isSafeInteger(number) || (number as number) < 0 || (number as number) > 1_000_000) return false;
  }
  return true;
}
