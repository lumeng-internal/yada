import type {
  QuotaHeatmapBucket,
  QuotaHeatmapResponse,
  QuotaUsageEvent
} from "./types";
import { allowances } from "./vibebar/allowances";
import type { ChatPlan } from "./vibebar/types";

export const HOUR_MS = 60 * 60 * 1000;

export function nextFullLocalHour(now: number | Date): number {
  const next = new Date(now instanceof Date ? now.getTime() : now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime();
}

export function buildQuotaHeatmap(input: {
  accountKey: string;
  plan: ChatPlan;
  events: readonly QuotaUsageEvent[];
  historyComplete: boolean;
  now?: number;
}): QuotaHeatmapResponse {
  const generatedAt = input.now ?? Date.now();
  const anchor = nextFullLocalHour(generatedAt);
  const countable = input.events.filter((event) =>
    event.accountKey === input.accountKey
    && (event.classification === "personal" || event.classification === "temporary")
  );
  const buckets = allowances(input.plan).flatMap((allowance): QuotaHeatmapBucket[] => {
    const windowHours = allowance.windowSeconds * 1000 / HOUR_MS;
    if (windowHours !== 24 && windowHours !== 168) return [];
    const rows = windowHours === 168 ? 7 : 1;
    const windowMs = windowHours * HOUR_MS;
    const cells = Array.from({ length: windowHours }, (_, slot) => {
      const releaseHourStart = anchor + slot * HOUR_MS;
      return {
        releaseHourStart,
        usageHourStart: releaseHourStart - windowMs,
        count: 0
      };
    });

    for (const event of countable) {
      if (!allowance.models.has(event.model)) continue;
      const releaseAt = event.createdAt + windowMs;
      const slot = Math.floor((releaseAt - anchor) / HOUR_MS);
      if (slot < 0 || slot >= windowHours) continue;
      cells[slot].count += 1;
    }

    return [{
      id: allowance.id,
      windowHours,
      rows,
      columns: 24,
      firstReleaseHour: anchor,
      cells,
      maxCount: cells.reduce((maximum, cell) => Math.max(maximum, cell.count), 0)
    }];
  });

  return {
    generatedAt,
    historyComplete: input.historyComplete,
    accountKey: input.accountKey,
    buckets
  };
}
