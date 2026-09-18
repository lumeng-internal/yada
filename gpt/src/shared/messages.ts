import type { QuotaSnapshot, QuotaUsageEvent } from "../quota/types";
import type { ChatGPTChatModelLimit, ChatPlan } from "../quota/vibebar/types";

export type QuotaIngest = {
  type: "quota/ingest";
  events: QuotaUsageEvent[];
  plan?: ChatPlan;
  historyComplete?: boolean;
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
