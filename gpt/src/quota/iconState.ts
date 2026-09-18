import { DAY_MS, WEEK_MS } from "./rules";
import type { QuotaSnapshot } from "./types";
import { remainingToRatio, renderQuotaIcons, type RingValues } from "./iconRenderer";

export function snapshotToRings(snapshot: QuotaSnapshot): RingValues {
  const incomplete = snapshot.gpt6ProWeekly.coverage !== "complete-local"
    || snapshot.solProDaily.coverage !== "complete-local"
    || snapshot.combinedDaily.coverage !== "complete-local";
  return {
    outer: remainingToRatio(snapshot.gpt6ProWeekly.estimatedRemaining, snapshot.gpt6ProWeekly.limit),
    middle: remainingToRatio(snapshot.solProDaily.estimatedRemaining, snapshot.solProDaily.limit),
    inner: remainingToRatio(snapshot.combinedDaily.estimatedRemaining, snapshot.combinedDaily.limit),
    center: incomplete ? "?" : String(snapshot.tightestRemainingPercent ?? 0)
  };
}

export function snapshotTitle(snapshot: QuotaSnapshot): string {
  const coverage = snapshot.coverageLabel === "完整" ? "完整" : snapshot.coverageLabel;
  const workspace = snapshot.personalProEligible ? "" : "\n当前工作区不计入个人 Pro Chat 额度";
  return [
    "ChatGPT Yada Pro 额度",
    "",
    `GPT-6 Pro 本周：预计剩余 ${snapshot.gpt6ProWeekly.estimatedRemaining} / ${snapshot.gpt6ProWeekly.limit}`,
    `GPT-5.6 Sol Pro 今日：预计剩余 ${snapshot.solProDaily.estimatedRemaining} / ${snapshot.solProDaily.limit}`,
    `Pro 今日合计：预计剩余 ${snapshot.combinedDaily.estimatedRemaining} / ${snapshot.combinedDaily.limit}`,
    "",
    `统计覆盖：${coverage}`,
    "更新时间：刚刚",
    workspace
  ].join("\n").trim();
}

export function nextAlarmAt(snapshot: QuotaSnapshot, now = Date.now()): number | null {
  const times = [
    snapshot.gpt6ProWeekly.nextReleaseAt,
    snapshot.solProDaily.nextReleaseAt,
    snapshot.combinedDaily.nextReleaseAt
  ].filter((value): value is number => typeof value === "number" && value > now);
  return times.length ? Math.min(...times) : now + Math.min(DAY_MS, WEEK_MS);
}

export async function applyQuotaIcon(snapshot: QuotaSnapshot): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.action?.setIcon) return;
  const imageData = renderQuotaIcons(snapshotToRings(snapshot));
  await chrome.action.setIcon({ imageData });
  await chrome.action.setTitle({ title: snapshotTitle(snapshot) });
}
