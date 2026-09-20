import type { QuotaMetric, QuotaSnapshot } from "./types";

export type QuotaBucketView = {
  title: string;
  period: "7days" | "24h";
  metric: QuotaMetric | null;
};

export function metricRemainingLabel(metric: QuotaMetric | null): string {
  if (!metric) return "当前套餐无此桶";
  if (metric.estimatedRemaining == null) return `已记录 ${metric.used} / ${metric.limit}`;
  return `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
}

export function metricPercentLabel(metric: QuotaMetric | null): string {
  if (!metric || metric.remainingRatio == null) return "—";
  return `${Math.round(metric.remainingRatio * 100)}%`;
}

export function quotaDetailsQuiet(snapshot: QuotaSnapshot): boolean {
  return snapshot.historyComplete
    && snapshot.syncStatus === "ready"
    && !snapshot.historyError
    && !snapshot.lastHistoryError;
}

export function historySyncLabel(snapshot: QuotaSnapshot): string {
  if (quotaDetailsQuiet(snapshot)) return "";
  switch (snapshot.syncStatus) {
    case "loading":
      return "正在读取额度";
    case "backfill":
      return `正在首次同步最近 7 天 ChatGPT 历史… · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次`;
    case "error":
      return snapshot.historyError
        ? `最近历史刷新失败 · ${snapshot.historyError}`
        : "最近历史刷新失败";
    case "ready":
      return snapshot.lastHistoryError ? "最近历史刷新失败" : "";
    default:
      return snapshot.historyError
        ? snapshot.historyError
        : `历史暂未补齐 · 已记录 ${snapshot.recordedCount} 个 Pro 使用轮次，暂不猜剩余次数`;
  }
}

export function planStatusNote(snapshot: QuotaSnapshot): string | null {
  if (!snapshot.plan) return "未确认 ChatGPT 套餐，不猜测额度桶。";
  return null;
}

export function workspaceStatusNote(snapshot: QuotaSnapshot): string | null {
  return snapshot.personalProEligible ? null : "当前工作区不计入个人 Pro Chat 额度";
}

export function snapshotBucketViews(snapshot: QuotaSnapshot): QuotaBucketView[] {
  if (!snapshot.plan) return [];
  if (snapshot.plan === "prolite") {
    return [{ title: "GPT-6 Pro+5.6 Sol Pro", period: "7days", metric: snapshot.combinedDaily }];
  }
  return [
    { title: "GPT-6 Pro", period: "7days", metric: snapshot.gpt6ProWeekly },
    { title: "GPT-5.6 Sol Pro", period: "24h", metric: snapshot.solProDaily },
    { title: "GPT-6 Pro+5.6 Sol Pro", period: "24h", metric: snapshot.combinedDaily }
  ];
}
