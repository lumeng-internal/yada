import type { QuotaSnapshot } from "./types";
import { remainingToRatio, renderQuotaIcons, type RingValues } from "./iconRenderer";
import { historySyncLabel, quotaDetailsQuiet } from "./presentation";

export function snapshotToRings(snapshot: QuotaSnapshot): RingValues {
  const center = snapshot.syncStatus === "loading" || snapshot.syncStatus === "backfill"
    ? "…"
    : snapshot.syncStatus === "error"
      ? "!"
      : snapshot.syncStatus === "partial" || snapshot.tightestRemainingPercent == null
        ? "—"
        : String(snapshot.tightestRemainingPercent);
  return {
    outer: remainingToRatio(snapshot.gpt6ProWeekly?.estimatedRemaining ?? 0, snapshot.gpt6ProWeekly?.limit ?? 1),
    middle: remainingToRatio(snapshot.solProDaily?.estimatedRemaining ?? 0, snapshot.solProDaily?.limit ?? 1),
    inner: remainingToRatio(snapshot.combinedDaily?.estimatedRemaining ?? 0, snapshot.combinedDaily?.limit ?? 1),
    center
  };
}

export function snapshotTitle(snapshot: QuotaSnapshot): string {
  const workspace = snapshot.personalProEligible ? "" : "\n当前工作区不计入个人 Pro Chat 额度";
  return [
    "ChatGPT Yada Pro 额度",
    "",
    metricLine("GPT-6 Pro", snapshot.gpt6ProWeekly),
    metricLine("GPT-5.6 Sol Pro", snapshot.solProDaily),
    metricLine("GPT-6 Pro+5.6 Sol Pro", snapshot.combinedDaily),
    "",
    quotaDetailsQuiet(snapshot) ? snapshot.updatedLabel : `历史同步：${historySyncLabel(snapshot)}`,
    `未分类轮次：${snapshot.unclassifiedTurns}`,
    snapshot.updatedLabel,
    workspace
  ].join("\n").trim();
}

export function nextAlarmAt(snapshot: QuotaSnapshot, now = Date.now()): number | null {
  const times = [
    snapshot.gpt6ProWeekly?.nextReleaseAt,
    snapshot.solProDaily?.nextReleaseAt,
    snapshot.combinedDaily?.nextReleaseAt,
    snapshot.gpt6ProWeekly?.serverResetAt,
    snapshot.solProDaily?.serverResetAt,
    snapshot.combinedDaily?.serverResetAt
  ].filter((value): value is number => typeof value === "number" && value > now);
  return times.length ? Math.min(...times) : now + 60 * 60 * 1000;
}

export async function applyQuotaIcon(snapshot: QuotaSnapshot): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.action?.setIcon) return;
  const imageData = renderQuotaIcons(snapshotToRings(snapshot));
  await chrome.action.setIcon({ imageData });
  await chrome.action.setTitle({ title: snapshotTitle(snapshot) });
}

function metricLine(label: string, metric: QuotaSnapshot["gpt6ProWeekly"]): string {
  if (!metric) return `${label}：当前套餐无此桶`;
  if (metric.estimatedRemaining == null) return `${label}：已记录 ${metric.used}，历史同步不完整`;
  return `${label}：预计剩余 ${metric.estimatedRemaining} / ${metric.limit}`;
}
