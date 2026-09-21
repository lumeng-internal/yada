import { describe, expect, it } from "vitest";
import { buildQuotaHeatmap, HOUR_MS, nextFullLocalHour } from "../src/quota/heatmap";
import type { QuotaUsageEvent } from "../src/quota/types";
import { GPT6_PRO, SOL_PRO } from "../src/quota/vibebar/allowances";
import { formatQuotaHeatmapTooltip } from "../src/ui/quotaHeatmap";

const NOW = new Date(2026, 8, 21, 20, 5, 0, 0).getTime();
const ANCHOR = new Date(2026, 8, 21, 21, 0, 0, 0).getTime();

function usageEvent(
  id: string,
  createdAt: number,
  model = GPT6_PRO,
  classification: QuotaUsageEvent["classification"] = "personal",
  accountKey = "account"
): QuotaUsageEvent {
  return { id, accountKey, createdAt, model, classification };
}

function bucket(id: string, events: readonly QuotaUsageEvent[] = []) {
  return buildQuotaHeatmap({
    accountKey: "account",
    plan: "pro",
    events,
    historyComplete: true,
    now: NOW
  }).buckets.find((item) => item.id === id)!;
}

describe("rolling quota heatmap aggregation", () => {
  it("anchors at the exact next local hour in Asia/Shanghai", () => {
    expect(nextFullLocalHour(NOW)).toBe(ANCHOR);
    expect(nextFullLocalHour(new Date(2026, 8, 21, 20, 0, 0, 0))).toBe(ANCHOR);
    const next = new Date(nextFullLocalHour(NOW));
    expect([next.getFullYear(), next.getMonth() + 1, next.getDate(), next.getHours(), next.getMinutes()])
      .toEqual([2026, 9, 21, 21, 0]);
  });

  it("creates the exact 24-hour and 168-hour rolling contracts", () => {
    const daily = bucket("sol_pro_daily");
    expect(daily).toMatchObject({ windowHours: 24, rows: 1, columns: 24, firstReleaseHour: ANCHOR });
    expect(daily.cells).toHaveLength(24);
    expect(daily.cells[0]).toMatchObject({
      releaseHourStart: new Date(2026, 8, 21, 21).getTime(),
      usageHourStart: new Date(2026, 8, 20, 21).getTime()
    });
    expect(daily.cells[23]).toMatchObject({
      releaseHourStart: new Date(2026, 8, 22, 20).getTime(),
      usageHourStart: new Date(2026, 8, 21, 20).getTime()
    });

    const weekly = bucket("gpt6_pro_weekly");
    expect(weekly).toMatchObject({ windowHours: 168, rows: 7, columns: 24, firstReleaseHour: ANCHOR });
    expect(weekly.cells).toHaveLength(168);
    expect(weekly.cells[0].usageHourStart).toBe(new Date(2026, 8, 14, 21).getTime());
    expect(weekly.cells[167].usageHourStart).toBe(new Date(2026, 8, 21, 20).getTime());
  });

  it("uses [start,end) boundaries without duplicate cells", () => {
    const firstUsage = ANCHOR - 24 * HOUR_MS;
    const events = [
      usageEvent("before", firstUsage - 1, SOL_PRO),
      usageEvent("first", firstUsage, SOL_PRO),
      usageEvent("first-end", firstUsage + HOUR_MS - 1, SOL_PRO),
      usageEvent("last", ANCHOR - 1, SOL_PRO),
      usageEvent("after", ANCHOR, SOL_PRO)
    ];
    const daily = bucket("sol_pro_daily", events);
    expect(daily.cells[0].count).toBe(2);
    expect(daily.cells[23].count).toBe(1);
    expect(daily.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(3);
  });

  it("reuses allowance models for GPT-6, Sol, and the combined bucket", () => {
    const firstDailyUsage = ANCHOR - 24 * HOUR_MS;
    const olderWeeklyUsage = ANCHOR - 7 * 24 * HOUR_MS;
    const events = [
      usageEvent("g-daily", firstDailyUsage, GPT6_PRO),
      usageEvent("g-weekly", olderWeeklyUsage, GPT6_PRO),
      usageEvent("s-daily", firstDailyUsage, SOL_PRO)
    ];
    const result = buildQuotaHeatmap({ accountKey: "account", plan: "pro", events, historyComplete: true, now: NOW });
    const weekly = result.buckets.find((item) => item.id === "gpt6_pro_weekly")!;
    const sol = result.buckets.find((item) => item.id === "sol_pro_daily")!;
    const combined = result.buckets.find((item) => item.id === "pro_daily")!;
    expect(weekly.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(2);
    expect(sol.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(1);
    expect(combined.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(2);
  });

  it("counts personal and temporary only for the requested account", () => {
    const createdAt = ANCHOR - 24 * HOUR_MS;
    const events = [
      usageEvent("personal", createdAt, SOL_PRO, "personal"),
      usageEvent("temporary", createdAt, SOL_PRO, "temporary"),
      usageEvent("work", createdAt, SOL_PRO, "work"),
      usageEvent("unknown", createdAt, SOL_PRO, "unknown"),
      usageEvent("other-account", createdAt, SOL_PRO, "personal", "other")
    ];
    const daily = bucket("sol_pro_daily", events);
    expect(daily.cells[0].count).toBe(2);
    expect(daily.maxCount).toBe(2);
  });

  it("accumulates multiple events in one release slot and excludes the rolling-window exterior", () => {
    const usageStart = ANCHOR - 24 * HOUR_MS;
    const events = [
      usageEvent("one", usageStart + 10, SOL_PRO),
      usageEvent("two", usageStart + 20, SOL_PRO),
      usageEvent("three", usageStart + HOUR_MS + 10, SOL_PRO),
      usageEvent("outside-old", usageStart - HOUR_MS, SOL_PRO),
      usageEvent("outside-new", ANCHOR + HOUR_MS, SOL_PRO)
    ];
    const daily = bucket("sol_pro_daily", events);
    expect(daily.cells[0].count).toBe(2);
    expect(daily.cells[1].count).toBe(1);
    expect(daily.maxCount).toBe(2);
  });

  it("maps releaseAt to releaseHourStart and preserves the input ledger", () => {
    const events = [usageEvent("secret-raw-event-id", ANCHOR - 24 * HOUR_MS + 37 * 60_000, SOL_PRO)];
    const before = JSON.stringify(events);
    const response = buildQuotaHeatmap({ accountKey: "account", plan: "pro", events, historyComplete: true, now: NOW });
    const daily = response.buckets.find((item) => item.id === "sol_pro_daily")!;
    expect(daily.cells[0]).toMatchObject({
      releaseHourStart: ANCHOR,
      usageHourStart: ANCHOR - 24 * HOUR_MS,
      count: 1
    });
    expect(JSON.stringify(events)).toBe(before);
    expect(JSON.stringify(response)).not.toMatch(/secret-raw-event-id|classification|conversationId|messageId|gpt-5-6-pro/);
  });

  it("mirrors the existing ProLite allowance instead of manufacturing Pro buckets", () => {
    const result = buildQuotaHeatmap({ accountKey: "account", plan: "prolite", events: [], historyComplete: true, now: NOW });
    expect(result.buckets.map((item) => [item.id, item.windowHours, item.rows])).toEqual([
      ["pro_weekly", 168, 7]
    ]);
  });
});

describe("quota heatmap tooltip", () => {
  it("formats the strict one-line local-time contract", () => {
    const usageHour = new Date(2026, 8, 18, 20, 0, 0, 0).getTime();
    expect(formatQuotaHeatmapTooltip(usageHour, 12)).toBe("9月18日 周五 20:00 使用12次");
    expect(formatQuotaHeatmapTooltip(usageHour, 0)).toBe("9月18日 周五 20:00 使用0次");
  });
});
