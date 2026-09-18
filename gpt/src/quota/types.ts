import type { ChatGPTChatModelLimit, ChatPlan } from "./vibebar/types";

export type QuotaCoverage = "partial" | "complete-local" | "degraded";

export type QuotaClassification = "personal" | "work" | "unknown" | "temporary";

export type QuotaUsageEvent = {
  id: string;
  accountKey: string;
  createdAt: number;
  model: string;
  classification: QuotaClassification;
};

export type QuotaMetric = {
  id: string;
  title: string;
  group: string;
  limit: number;
  used: number;
  estimatedRemaining: number | null;
  remainingRatio: number | null;
  nextReleaseAt: number | null;
  serverResetAt: number | null;
  coverage: QuotaCoverage;
  exhausted: boolean;
  fallbackModel: string | null;
};

export type QuotaSnapshot = {
  accountKey: string;
  plan: ChatPlan;
  workspaceKind: "personal" | "work" | "unknown";
  updatedAt: number;
  gpt6ProWeekly: QuotaMetric | null;
  solProDaily: QuotaMetric | null;
  combinedDaily: QuotaMetric | null;
  buckets: QuotaMetric[];
  unclassifiedTurns: number;
  recordedCount: number;
  historyComplete: boolean;
  coverageLabel: "完整" | "历史估算" | "数据不完整";
  tightestRemainingPercent: number | null;
  personalProEligible: boolean;
  serverLimits: ChatGPTChatModelLimit[];
  fallbackModel: string | null;
  updatedLabel: string;
};

export type BackfillStatus =
  | "idle"
  | "running"
  | "paused"
  | "complete"
  | "unavailable"
  | "error"
  | "incomplete";

export type QuotaLedgerState = {
  version: 2;
  events: QuotaUsageEvent[];
};

export type QuotaPersistedState = {
  version: 2;
  accountKey?: string;
  plan: ChatPlan;
  historyComplete: boolean;
  unclassifiedTurns: number;
  lastSnapshot?: QuotaSnapshot;
  writeError?: string;
};

export const LEDGER_KEY = "chatgpt-yada:quota-ledger:v2";
export const STATE_KEY = "chatgpt-yada:quota-state:v2";
export const MAX_EVENTS = 5000;
export const EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
