import type { QuotaMetric, QuotaSnapshot } from "./types";

export type QuotaBucketView = {
  title: string;
  metric: QuotaMetric | null;
};

export function metricRemainingLabel(metric: QuotaMetric | null): string {
  if (!metric) return "当前套餐无此桶";
  if (metric.estimatedRemaining == null) return `已记录 ${metric.used} / ${metric.limit}`;
  return `预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
}

export function metricPercentLabel(metric: QuotaMetric | null): string {
  if (!metric || metric.remainingRatio == null) return "?";
  return `${Math.round(metric.remainingRatio * 100)}%`;
}

export function historySyncLabel(snapshot: QuotaSnapshot): string {
  return snapshot.historyComplete ? "历史同步完整" : "历史同步不完整";
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
    return [{ title: "两个 Pro", metric: snapshot.combinedDaily }];
  }
  return [
    { title: "GPT-6 Pro", metric: snapshot.gpt6ProWeekly },
    { title: "GPT-5.6 Sol Pro", metric: snapshot.solProDaily },
    { title: "两个 Pro", metric: snapshot.combinedDaily }
  ];
}
