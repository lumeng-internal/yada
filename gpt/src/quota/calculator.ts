import { DAY_MS, QUOTA_RULES, WEEK_MS } from "./rules";
import type { QuotaCoverage, QuotaMetric, QuotaPersistedState, QuotaSnapshot, QuotaUsageEvent } from "./types";

export function calculateQuotaSnapshot(input: {
  accountKey: string;
  workspaceKind: QuotaSnapshot["workspaceKind"];
  events: readonly QuotaUsageEvent[];
  now?: number;
  liveStartedAt?: number;
  lastLiveAt?: number;
  writeError?: string;
  backfillStatus: QuotaSnapshot["backfillStatus"];
}): QuotaSnapshot {
  const now = input.now ?? Date.now();
  const personal = input.events.filter((event) =>
    event.accountKey === input.accountKey && event.workspaceKind === "personal"
  );
  const unknownModelCount = personal.filter((event) => event.model === "unknown").length;
  const gpt6 = personal.filter((event) => event.model === "gpt-6-pro");
  const sol = personal.filter((event) => event.model === "gpt-5.6-sol-pro");
  const usedObservedTime = personal.some((event) => event.timeSource === "observed");
  const degraded = Boolean(input.writeError)
    || unknownModelCount > 0
    || usedObservedTime
    || input.backfillStatus === "error"
    || input.workspaceKind === "unknown";

  const gpt6ProWeekly = metric(QUOTA_RULES.gpt6ProWeekly, gpt6, now, WEEK_MS, coverageFor(input, now, WEEK_MS, degraded));
  const solProDaily = metric(QUOTA_RULES.solProDaily, sol, now, DAY_MS, coverageFor(input, now, DAY_MS, degraded));
  const combinedEvents = personal.filter((event) => event.model === "gpt-6-pro" || event.model === "gpt-5.6-sol-pro");
  const combinedDaily = metric(QUOTA_RULES.combinedDaily, combinedEvents, now, DAY_MS, coverageFor(input, now, DAY_MS, degraded));

  const coverages = [gpt6ProWeekly.coverage, solProDaily.coverage, combinedDaily.coverage];
  const coverageLabel = coverages.includes("degraded") || coverages.includes("partial")
    ? coverages.includes("degraded") ? "数据不完整" : "历史估算"
    : "完整";
  const ratios = [gpt6ProWeekly, solProDaily, combinedDaily]
    .filter((item) => item.coverage === "complete-local")
    .map((item) => item.remainingRatio);
  const tightestRemainingPercent = ratios.length ? Math.round(Math.min(...ratios) * 100) : null;

  return {
    accountKey: input.accountKey,
    workspaceKind: input.workspaceKind,
    updatedAt: now,
    gpt6ProWeekly,
    solProDaily,
    combinedDaily,
    unknownModelCount,
    recordedCount: personal.length,
    ruleId: QUOTA_RULES.id,
    ruleDate: QUOTA_RULES.effectiveFrom,
    backfillStatus: input.backfillStatus,
    coverageLabel,
    tightestRemainingPercent,
    personalProEligible: input.workspaceKind === "personal"
  };
}

export function coverageFromState(
  state: QuotaPersistedState | undefined
): Pick<QuotaPersistedState, "liveStartedAt" | "lastLiveAt" | "writeError"> {
  return {
    liveStartedAt: state?.liveStartedAt ?? {},
    lastLiveAt: state?.lastLiveAt ?? {},
    writeError: state?.writeError
  };
}

function coverageFor(
  input: {
    liveStartedAt?: number;
    lastLiveAt?: number;
    writeError?: string;
    backfillStatus: QuotaSnapshot["backfillStatus"];
    workspaceKind: QuotaSnapshot["workspaceKind"];
  },
  now: number,
  windowMs: number,
  degraded: boolean
): QuotaCoverage {
  if (degraded) return "degraded";
  if (!input.liveStartedAt || now - input.liveStartedAt < windowMs) return "partial";
  if (input.backfillStatus === "running" || input.backfillStatus === "paused") return "partial";
  if (input.lastLiveAt && now - input.lastLiveAt > windowMs) return "partial";
  return "complete-local";
}

function metric(
  limit: number,
  events: readonly QuotaUsageEvent[],
  now: number,
  windowMs: number,
  coverage: QuotaCoverage
): QuotaMetric {
  const inWindow = events
    .filter((event) => event.occurredAt > now - windowMs)
    .sort((a, b) => a.occurredAt - b.occurredAt);
  const used = inWindow.length;
  const estimatedRemaining = Math.max(0, limit - used);
  const oldest = inWindow[0];
  return {
    limit,
    used,
    estimatedRemaining,
    remainingRatio: limit <= 0 ? 0 : estimatedRemaining / limit,
    nextReleaseAt: oldest ? oldest.occurredAt + windowMs : null,
    coverage
  };
}
