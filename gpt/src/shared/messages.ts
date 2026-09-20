import type { QuotaSnapshot, QuotaSyncStatus, QuotaUsageEvent } from "../quota/types";
import type { ChatGPTChatHistoryCache, ChatGPTChatModelLimit, ChatPlan } from "../quota/vibebar/types";
import { withTimeout } from "./timeout";

export const MESSAGE_TIMEOUT_MS = 15_000;
export const REFRESH_TIMEOUT_MS = 45_000;

export function sendRuntimeMessage<T>(message: unknown, timeoutMs = MESSAGE_TIMEOUT_MS): Promise<T> {
  return withTimeout(Promise.resolve(chrome.runtime.sendMessage(message)), timeoutMs, "扩展消息超时");
}

export type QuotaIngest = {
  type: "quota/ingest";
  events: QuotaUsageEvent[];
  plan?: ChatPlan;
  historyComplete?: boolean;
  syncStatus?: QuotaSyncStatus;
  lastHistorySuccessAt?: number;
  lastHistoryAttemptAt?: number;
  lastHistoryError?: string | null;
  historyCache?: ChatGPTChatHistoryCache;
  unclassifiedTurns?: number;
  workspaceKind?: QuotaSnapshot["workspaceKind"];
  limits?: ChatGPTChatModelLimit[];
  accountKey?: string;
};

export type QuotaGetState = {
  type: "quota/get-state";
  accountKey?: string;
  plan?: ChatPlan;
};

export type QuotaRefreshCurrent = {
  type: "quota/refresh-current";
  conversationId: string;
};

export type QuotaStorageChanged = {
  type: "quota/storage-changed";
  snapshot: QuotaSnapshot;
};

export type YadaRequest = QuotaIngest | QuotaGetState | QuotaRefreshCurrent;
export type YadaEvent = QuotaStorageChanged;
