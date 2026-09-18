import { describe, expect, it } from "vitest";
import { QuotaLedger } from "../src/quota/ledger";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import { detectProModel } from "../src/quota/modelDetector";
import { DAY_MS, QUOTA_RULES, WEEK_MS } from "../src/quota/rules";
import type { QuotaUsageEvent } from "../src/quota/types";

function event(partial: Partial<QuotaUsageEvent>): QuotaUsageEvent {
  return {
    id: "a1",
    accountKey: "account-1:personal",
    conversationId: "c1",
    occurredAt: Date.now(),
    observedAt: Date.now(),
    timeSource: "message",
    model: "gpt-6-pro",
    source: "live",
    workspaceKind: "personal",
    ...partial
  };
}

describe("model detector", () => {
  it("classifies known Pro slugs and leaves unknown unforced", () => {
    expect(detectProModel("gpt-6-pro").kind).toBe("gpt-6-pro");
    expect(detectProModel("gpt-5.6-sol-pro").kind).toBe("gpt-5.6-sol-pro");
    expect(detectProModel("gpt-5.4").kind).toBe("other");
    expect(detectProModel("mystery-pro-model").kind).toBe("unknown");
    expect(detectProModel(null).kind).toBe("unknown");
  });
});

describe("ledger", () => {
  it("dedupes assistantMessageId across repeated scans", async () => {
    const ledger = new QuotaLedger();
    await ledger.ingest([event({ id: "a1" }), event({ id: "a1" })]);
    await ledger.ingest([event({ id: "a1" })]);
    const snapshot = await ledger.getSnapshot("account-1:personal", "personal");
    expect(snapshot.gpt6ProWeekly.used).toBe(1);
  });

  it("counts a regenerated assistant id as a new event", async () => {
    const ledger = new QuotaLedger();
    await ledger.ingest([event({ id: "a1" }), event({ id: "a2" })]);
    const snapshot = await ledger.getSnapshot("account-1:personal", "personal");
    expect(snapshot.gpt6ProWeekly.used).toBe(2);
  });

  it("does not count Work workspace events toward personal Pro", async () => {
    const ledger = new QuotaLedger();
    await ledger.ingest([event({ id: "work-1", workspaceKind: "work", accountKey: "account-1:work" })]);
    const snapshot = await ledger.getSnapshot("account-1:personal", "personal");
    expect(snapshot.gpt6ProWeekly.used).toBe(0);
  });

  it("keeps events after a conversation is gone", async () => {
    const ledger = new QuotaLedger();
    await ledger.ingest([event({ id: "kept", conversationId: "deleted-later" })]);
    const snapshot = await ledger.getSnapshot("account-1:personal", "personal");
    expect(snapshot.gpt6ProWeekly.used).toBe(1);
  });

  it("serializes concurrent writes", async () => {
    const ledger = new QuotaLedger();
    await Promise.all([
      ledger.ingest([event({ id: "c1" })]),
      ledger.ingest([event({ id: "c2" })]),
      ledger.ingest([event({ id: "c3" })])
    ]);
    const snapshot = await ledger.getSnapshot("account-1:personal", "personal");
    expect(snapshot.gpt6ProWeekly.used).toBe(3);
  });

  it("restores events after a new ledger instance", async () => {
    const ledger = new QuotaLedger();
    await ledger.ingest([event({ id: "persist-1" })]);
    const restored = new QuotaLedger();
    const snapshot = await restored.getSnapshot("account-1:personal", "personal");
    expect(snapshot.gpt6ProWeekly.used).toBe(1);
  });

  it("prunes events older than 14 days", async () => {
    const ledger = new QuotaLedger();
    const now = Date.now();
    await ledger.ingest([
      event({ id: "old", occurredAt: now - 15 * DAY_MS }),
      event({ id: "fresh", occurredAt: now })
    ], now);
    const snapshot = await ledger.getSnapshot("account-1:personal", "personal", "idle", now);
    expect(snapshot.gpt6ProWeekly.used).toBe(1);
  });
});

describe("calculator", () => {
  it("applies GPT-6 Pro 7-day 200, Sol Pro 24h 170, combined 24h 200", () => {
    const now = Date.now();
    const events = [
      ...Array.from({ length: 10 }, (_, i) => event({ id: `g${i}`, model: "gpt-6-pro", occurredAt: now - i * 1000 })),
      ...Array.from({ length: 5 }, (_, i) => event({ id: `s${i}`, model: "gpt-5.6-sol-pro", occurredAt: now - i * 1000 }))
    ];
    const snapshot = calculateQuotaSnapshot({
      accountKey: "account-1:personal",
      workspaceKind: "personal",
      events,
      now,
      liveStartedAt: now - WEEK_MS,
      lastLiveAt: now,
      backfillStatus: "complete"
    });
    expect(snapshot.gpt6ProWeekly.limit).toBe(QUOTA_RULES.gpt6ProWeekly);
    expect(snapshot.gpt6ProWeekly.used).toBe(10);
    expect(snapshot.gpt6ProWeekly.estimatedRemaining).toBe(190);
    expect(snapshot.solProDaily.limit).toBe(170);
    expect(snapshot.solProDaily.used).toBe(5);
    expect(snapshot.combinedDaily.used).toBe(15);
    expect(snapshot.combinedDaily.estimatedRemaining).toBe(185);
    expect(snapshot.tightestRemainingPercent).toBe(Math.round(185 / 200 * 100));
  });

  it("releases events that leave the window and never goes below zero", () => {
    const now = Date.now();
    const snapshot = calculateQuotaSnapshot({
      accountKey: "account-1:personal",
      workspaceKind: "personal",
      events: [
        event({ id: "expired", occurredAt: now - WEEK_MS - 1000 }),
        ...Array.from({ length: 250 }, (_, i) => event({ id: `over${i}`, occurredAt: now }))
      ],
      now,
      liveStartedAt: now - WEEK_MS,
      lastLiveAt: now,
      backfillStatus: "complete"
    });
    expect(snapshot.gpt6ProWeekly.used).toBe(250);
    expect(snapshot.gpt6ProWeekly.estimatedRemaining).toBe(0);
  });

  it("marks partial coverage with a missing live window", () => {
    const snapshot = calculateQuotaSnapshot({
      accountKey: "account-1:personal",
      workspaceKind: "personal",
      events: [],
      now: Date.now(),
      backfillStatus: "running"
    });
    expect(snapshot.gpt6ProWeekly.coverage).toBe("partial");
  });

  it("marks unknown model usage as degraded", () => {
    const snapshot = calculateQuotaSnapshot({
      accountKey: "account-1:personal",
      workspaceKind: "personal",
      events: [event({ id: "u", model: "unknown" })],
      liveStartedAt: Date.now() - WEEK_MS,
      lastLiveAt: Date.now(),
      backfillStatus: "complete"
    });
    expect(snapshot.gpt6ProWeekly.coverage).toBe("degraded");
  });
});
