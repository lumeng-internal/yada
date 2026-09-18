import { describe, expect, it } from "vitest";
import { GPT6_PRO, SOL_PRO, allowances, parsePlanType } from "../src/quota/vibebar/allowances";
import { identity, isTemporary, isWork, parseConversation } from "../src/quota/vibebar/conversationParser";
import { modelLimits } from "../src/quota/vibebar/modelLimits";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import { QuotaLedger } from "../src/quota/ledger";
import { snapshotToRings, snapshotTitle } from "../src/quota/iconState";
import { branchedConversation, linearConversation } from "./helpers";
import type { QuotaUsageEvent } from "../src/quota/types";

const NOW = 1_800_000_000_000;

function event(partial: Partial<QuotaUsageEvent>): QuotaUsageEvent {
  return {
    id: "chat-a",
    accountKey: "account",
    createdAt: NOW,
    model: GPT6_PRO,
    classification: "personal",
    ...partial
  };
}

describe("vibe bar allowances", () => {
  it("uses published Pro and ProLite buckets and does not guess other plans", () => {
    const pro = allowances("pro");
    expect(pro.map((item) => [item.id, item.limit, [...item.models]])).toEqual([
      ["gpt6_pro_weekly", 200, [GPT6_PRO]],
      ["sol_pro_daily", 170, [SOL_PRO]],
      ["pro_daily", 200, [GPT6_PRO, SOL_PRO]]
    ]);
    expect(allowances("prolite")).toEqual([
      expect.objectContaining({ id: "pro_weekly", limit: 50 })
    ]);
    expect(allowances("plus")).toEqual([]);
    expect(allowances(null)).toEqual([]);
    expect(parsePlanType({ plan_type: "pro" })).toBe("pro");
    expect(parsePlanType({ plan_type: "team" })).toBeNull();
  });
});

describe("vibe bar conversation parser", () => {
  it("charges one user turn to the newest finished assistant model", async () => {
    const parsed = await parseConversation(branchedConversation(), "branched", NOW, 0);
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0].model).toBe(GPT6_PRO);
    expect(parsed.turns[0].id.startsWith("chat-")).toBe(true);
    expect(parsed.turns[0].id).toBe(await identity("branched:u0"));
  });

  it("does not count a regenerated answer as a second turn", async () => {
    const parsed = await parseConversation(branchedConversation(), "branched", NOW, 0);
    expect(parsed.turns).toHaveLength(1);
  });

  it("classifies Work, temporary, and unknown origin", async () => {
    expect(isWork("tpp", null)).toBe(true);
    expect(isWork("flora", null)).toBe(true);
    expect(isWork("codex", null)).toBe(true);
    expect(isWork("chat", "gpt-5-codex")).toBe(true);
    expect(isWork("chat", "gpt-5-wm")).toBe(true);
    expect(isWork("chat", GPT6_PRO)).toBe(false);
    expect(isTemporary({ is_temporary_chat: true })).toBe(true);
    const unknown = await parseConversation(
      { ...linearConversation(1, "c1"), conversation_id: "c1", conversation_origin: "something-new" },
      "c1",
      NOW,
      0
    );
    expect(unknown.turns).toHaveLength(0);
    expect(unknown.unclassifiedTurns).toBe(1);
    expect(unknown.isWork).toBe(false);
  });

  it("excludes Work conversations before counting", async () => {
    const parsed = await parseConversation(
      { ...linearConversation(2, "work-1"), conversation_id: "work-1", conversation_origin: "tpp" },
      "work-1",
      NOW,
      0
    );
    expect(parsed.isWork).toBe(true);
    expect(parsed.turns).toHaveLength(0);
  });
});

describe("model_limits", () => {
  it("keeps future exhausted models and ignores past resets", () => {
    const limits = modelLimits({
      model_limits: [
        { model_slug: GPT6_PRO, resets_after: (NOW + 3_600_000) / 1000, using_default_model_slug: "gpt-5.4" },
        { model_slug: SOL_PRO, resets_after: (NOW - 1_000) / 1000 }
      ]
    }, NOW);
    expect(limits).toEqual([
      { model: GPT6_PRO, resetsAt: NOW + 3_600_000, fallbackModel: "gpt-5.4" }
    ]);
  });
});

describe("calculation", () => {
  it("applies Pro 200/7d, 170/24h, combined 200/24h and forces 0 when exhausted", async () => {
    const ledger = new QuotaLedger();
    const events = [
      ...Array.from({ length: 10 }, (_, i) => event({ id: `g${i}`, model: GPT6_PRO, createdAt: NOW - i * 1000 })),
      ...Array.from({ length: 5 }, (_, i) => event({ id: `s${i}`, model: SOL_PRO, createdAt: NOW - i * 1000 }))
    ];
    await ledger.ingest(events, { plan: "pro", historyComplete: true, now: NOW, accountKey: "account" });
    const snapshot = await ledger.getSnapshot("account", "pro", { historyComplete: true, now: NOW });
    expect(snapshot.gpt6ProWeekly?.limit).toBe(200);
    expect(snapshot.gpt6ProWeekly?.used).toBe(10);
    expect(snapshot.gpt6ProWeekly?.estimatedRemaining).toBe(190);
    expect(snapshot.solProDaily?.used).toBe(5);
    expect(snapshot.combinedDaily?.used).toBe(15);
    const exhausted = calculateQuotaSnapshot({
      accountKey: "account",
      plan: "pro",
      workspaceKind: "personal",
      events,
      historyComplete: true,
      unclassifiedTurns: 0,
      now: NOW,
      limits: [{ model: GPT6_PRO, resetsAt: NOW + 1000, fallbackModel: "gpt-5.4" }]
    });
    expect(exhausted.gpt6ProWeekly?.estimatedRemaining).toBe(0);
    expect(exhausted.gpt6ProWeekly?.serverResetAt).toBe(NOW + 1000);
    expect(exhausted.fallbackModel).toBe("gpt-5.4");
  });

  it("does not count Work events and keeps hashed ids only", async () => {
    const ledger = new QuotaLedger();
    await ledger.ingest([
      event({ id: await identity("c:u"), classification: "work" }),
      event({ id: await identity("c:u2"), classification: "personal" })
    ], { plan: "pro", historyComplete: true, now: NOW, accountKey: "account" });
    const snapshot = await ledger.getSnapshot("account", "pro", { historyComplete: true, now: NOW });
    expect(snapshot.gpt6ProWeekly?.used).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/userMarkdown|please summarize|accessToken/);
  });

  it("hides remaining when history is incomplete", () => {
    const snapshot = calculateQuotaSnapshot({
      accountKey: "account",
      plan: "pro",
      workspaceKind: "personal",
      events: [event({ id: "x" })],
      historyComplete: false,
      unclassifiedTurns: 2,
      now: NOW
    });
    expect(snapshot.gpt6ProWeekly?.estimatedRemaining).toBeNull();
    expect(snapshot.coverageLabel).toBe("历史估算");
    expect(snapshotToRings(snapshot).center).toBe("?");
    expect(snapshotTitle(snapshot)).not.toMatch(/官方/);
  });
});
