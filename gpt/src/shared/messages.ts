import type { BackfillStatus, QuotaSnapshot, QuotaUsageEvent, WorkspaceKind } from "../quota/types";

export type QuotaIngest = {
  type: "quota/ingest";
  events: QuotaUsageEvent[];
};

export type QuotaGetState = {
  type: "quota/get-state";
  accountKey?: string;
  workspaceKind?: WorkspaceKind;
};

export type QuotaRefreshCurrent = {
  type: "quota/refresh-current";
  conversationId: string;
};

export type QuotaBackfillStatus = {
  type: "quota/backfill-status";
};

export type QuotaStorageChanged = {
  type: "quota/storage-changed";
  snapshot: QuotaSnapshot;
};

export type QuotaBackfillIngest = {
  type: "quota/backfill-progress";
  status: BackfillStatus;
  scannedCount?: number;
};

export type QuotaGetStateResponse = {
  snapshot: QuotaSnapshot;
};

export type YadaRequest =
  | QuotaIngest
  | QuotaGetState
  | QuotaRefreshCurrent
  | QuotaBackfillStatus
  | QuotaBackfillIngest;

export type YadaEvent = QuotaStorageChanged;
