export type ProModelKind = "gpt-6-pro" | "gpt-5.6-sol-pro" | "other" | "unknown";
export type WorkspaceKind = "personal" | "work" | "unknown";
export type QuotaTimeSource = "message" | "observed";
export type QuotaEventSource = "live" | "history";
export type QuotaCoverage = "partial" | "complete-local" | "degraded";

export type QuotaUsageEvent = {
  id: string;
  accountKey: string;
  conversationId: string;
  occurredAt: number;
  observedAt: number;
  timeSource: QuotaTimeSource;
  model: ProModelKind;
  source: QuotaEventSource;
  workspaceKind: WorkspaceKind;
  modelSlug?: string;
};

export type QuotaMetric = {
  limit: number;
  used: number;
  estimatedRemaining: number;
  remainingRatio: number;
  nextReleaseAt: number | null;
  coverage: QuotaCoverage;
};

export type QuotaSnapshot = {
  accountKey: string;
  workspaceKind: WorkspaceKind;
  updatedAt: number;
  gpt6ProWeekly: QuotaMetric;
  solProDaily: QuotaMetric;
  combinedDaily: QuotaMetric;
  unknownModelCount: number;
  recordedCount: number;
  ruleId: string;
  ruleDate: string;
  backfillStatus: BackfillStatus;
  coverageLabel: "完整" | "历史估算" | "数据不完整";
  tightestRemainingPercent: number | null;
  personalProEligible: boolean;
};

export type BackfillStatus =
  | "idle"
  | "running"
  | "paused"
  | "complete"
  | "unavailable"
  | "error";

export type QuotaLedgerState = {
  version: 1;
  events: QuotaUsageEvent[];
};

export type QuotaPersistedState = {
  version: 1;
  liveStartedAt: Record<string, number>;
  lastLiveAt: Record<string, number>;
  writeError?: string;
  lastSnapshot?: QuotaSnapshot;
};

export type QuotaBackfillState = {
  version: 1;
  status: BackfillStatus;
  cutoffAt: number;
  scanned: Record<string, number>;
  cursorOffset: number;
  updatedAt: number;
  error?: string;
};

export const LEDGER_KEY = "chatgpt-yada:quota-ledger:v1";
export const STATE_KEY = "chatgpt-yada:quota-state:v1";
export const BACKFILL_KEY = "chatgpt-yada:quota-backfill:v1";
export const MAX_EVENTS = 5000;
export const EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
