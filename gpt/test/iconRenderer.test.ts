import { describe, expect, it, vi } from "vitest";
import { remainingToRatio, renderQuotaIcons, ringGeometry } from "../src/quota/iconRenderer";
import { snapshotTitle, snapshotToRings } from "../src/quota/iconState";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import { QUOTA_RULES } from "../src/quota/rules";
import type { QuotaUsageEvent } from "../src/quota/types";

describe("icon renderer", () => {
  it("generates 16/32/48/128 image data with remaining mapped to ring fill", () => {
    const icons = renderQuotaIcons({ outer: 1, middle: 0.5, inner: 0, center: "48" });
    expect(icons[16].width).toBe(16);
    expect(icons[32].width).toBe(32);
    expect(icons[48].width).toBe(48);
    expect(icons[128].width).toBe(128);
    expect(ringGeometry(32)).toHaveLength(3);
    expect(remainingToRatio(62, 200)).toBeCloseTo(0.31);
  });

  it("uses ? when coverage is incomplete and never says official remaining", () => {
    const snapshot = calculateQuotaSnapshot({
      accountKey: "a",
      workspaceKind: "personal",
      events: [],
      backfillStatus: "running"
    });
    const rings = snapshotToRings(snapshot);
    expect(rings.center).toBe("?");
    const title = snapshotTitle(snapshot);
    expect(title).toContain("预计剩余");
    expect(title).not.toMatch(/官方/);
    expect(QUOTA_RULES.id).toContain("2026-09-18");
  });
});
