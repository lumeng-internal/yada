import { allowances } from "./vibebar/allowances";
import { proBuckets } from "./vibebar/conversationParser";
import type { ChatGPTChatModelLimit, ChatGPTChatTurn, ChatPlan } from "./vibebar/types";
import type { QuotaCoverage, QuotaMetric, QuotaSnapshot, QuotaSyncStatus, QuotaUsageEvent } from "./types";

export function calculateQuotaSnapshot(input: {
  accountKey: string;
  plan: ChatPlan;
  workspaceKind: QuotaSnapshot["workspaceKind"];
  events: readonly QuotaUsageEvent[];
  limits?: readonly ChatGPTChatModelLimit[];
  historyComplete: boolean;
  syncStatus?: QuotaSyncStatus;
  historyError?: string | null;
  unclassifiedTurns: number;
  now?: number;
  writeError?: string;
}): QuotaSnapshot {
  const now = input.now ?? Date.now();
  const requestedStatus: QuotaSyncStatus = input.writeError
    ? "error"
    : input.syncStatus ?? (input.historyComplete ? "ready" : "partial");
  const syncStatus: QuotaSyncStatus = requestedStatus === "ready" && !input.historyComplete
    ? "partial"
    : requestedStatus;
  const countable = input.events.filter((event) =>
    event.accountKey === input.accountKey
    && (event.classification === "personal" || event.classification === "temporary")
  );
  const turns: ChatGPTChatTurn[] = countable.map((event) => ({
    id: event.id,
    createdAt: event.createdAt,
    model: event.model
  }));
  const allowanceList = allowances(input.plan);
  const buckets = proBuckets(allowanceList, turns, input.limits ?? [], input.historyComplete && !input.writeError, now)
    .map((bucket) => toMetric(bucket, input.limits ?? []));
  const gpt6ProWeekly = buckets.find((bucket) => bucket.id === "gpt6_pro_weekly") ?? null;
  const solProDaily = buckets.find((bucket) => bucket.id === "sol_pro_daily") ?? null;
  const combinedDaily = buckets.find((bucket) => bucket.id === "pro_daily") ?? buckets.find((bucket) => bucket.id === "pro_weekly") ?? null;
  const coverages = buckets.map((bucket) => bucket.coverage);
  const coverageLabel: QuotaSnapshot["coverageLabel"] = input.plan == null || coverages.includes("degraded")
    ? "数据不完整"
    : coverages.includes("partial") || !input.historyComplete
      ? "历史估算"
      : "完整";
  const ratios = buckets
    .map((bucket) => bucket.remainingRatio)
    .filter((value): value is number => value != null);
  const fallbackModel = (input.limits ?? []).map((limit) => limit.fallbackModel).find((value): value is string => !!value) ?? null;
  return {
    accountKey: input.accountKey,
    plan: input.plan,
    workspaceKind: input.workspaceKind,
    updatedAt: now,
    gpt6ProWeekly: gpt6ProWeekly ?? (input.plan === "prolite" ? combinedDaily : null),
    solProDaily: solProDaily ?? (input.plan === "prolite" ? combinedDaily : null),
    combinedDaily,
    buckets,
    unclassifiedTurns: input.unclassifiedTurns,
    recordedCount: countable.length,
    historyComplete: input.historyComplete,
    syncStatus,
    historyError: input.writeError ?? input.historyError ?? null,
    coverageLabel,
    tightestRemainingPercent: ratios.length ? Math.round(Math.min(...ratios) * 100) : null,
    personalProEligible: input.workspaceKind !== "work" && input.plan != null,
    serverLimits: [...(input.limits ?? [])],
    fallbackModel,
    updatedLabel: "刚刚更新"
  };
}

function toMetric(
  bucket: ReturnType<typeof proBuckets>[number],
  limits: readonly ChatGPTChatModelLimit[]
): QuotaMetric {
  const remaining = bucket.quantity.remaining;
  const limit = bucket.quantity.limit ?? 0;
  const used = bucket.quantity.used ?? 0;
  const exhausted = remaining === 0 && bucket.quantity.used === limit && !bucket.hasRollingReset;
  const coverage: QuotaCoverage = exhausted
    ? "complete-local"
    : bucket.quantity.coverageComplete
      ? "complete-local"
      : "partial";
  const serverResetAt = exhausted ? bucket.resetAt : null;
  const fallbackModel = exhausted
    ? limits.find((limitItem) => bucket.id.includes("gpt6") ? limitItem.model === "gpt-6-pro" : limitItem.model === "gpt-5-6-pro")?.fallbackModel ?? limits[0]?.fallbackModel ?? null
    : null;
  return {
    id: bucket.id,
    title: bucket.title,
    group: bucket.groupTitle,
    limit,
    used,
    estimatedRemaining: remaining,
    remainingRatio: remaining == null || limit <= 0 ? null : remaining / limit,
    nextReleaseAt: bucket.hasRollingReset ? bucket.resetAt : null,
    serverResetAt,
    coverage,
    exhausted,
    fallbackModel
  };
}
