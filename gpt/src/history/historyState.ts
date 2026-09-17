export type RailHistoryStatus = "API_LOADING" | "HISTORY_HYDRATING" | "COMPLETE" | "PARTIAL_STOPPED";

export const HISTORY_LIMITS = {
  maxPages: 20,
  maxMs: 60_000,
  maxResumes: 3,
  idleMs: 2500,
  pageTimeoutMs: 10_000,
  stallRounds: 2
} as const;

export type HistoryLimits = {
  maxPages: number;
  maxMs: number;
  maxResumes: number;
  idleMs: number;
  pageTimeoutMs: number;
  stallRounds: number;
};

export type HistoryPageResult = {
  ok: boolean;
  status: number;
  triggered: boolean;
  generation: number;
  hasSentinel: boolean;
  nonce?: number;
  sentinelGeneration?: number;
  hasPreviousPage?: boolean;
  cursor?: string | null;
  conversationId?: string | null;
};

export type HistoryFetchResult = {
  status: number;
  ok: boolean;
  nonce?: number;
  sentinelGeneration?: number;
  hasPreviousPage?: boolean;
  cursor?: string | null;
  conversationId: string | null;
  generation: number;
  hasSentinel: boolean;
};

export function isChatGenerating(): boolean {
  return !!document.querySelector(
    'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="Stop"]'
  );
}

export function historyProgressTitle(materialized: number, total: number, status: RailHistoryStatus): string {
  if (!total) return "";
  if (status === "HISTORY_HYDRATING") return `正在加载更早记录 ${materialized}/${total}`;
  if (status === "API_LOADING") return "正在读取完整会话";
  if (status === "PARTIAL_STOPPED") return `部分记录 ${materialized}/${total}`;
  return "";
}
