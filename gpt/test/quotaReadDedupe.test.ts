import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleQuotaRequest, resetQuotaPresentationForTests, restoreQuotaPresentation } from "../src/background/serviceWorker";
import { QuotaLedger } from "../src/quota/ledger";
import { LEDGER_KEY } from "../src/quota/types";

describe("pure quota reads and duplicate writes", () => {
  beforeEach(() => {
    resetQuotaPresentationForTests();
    vi.restoreAllMocks();
  });

  it("does not paint, alarm, or broadcast for quota/get-state", async () => {
    const setIcon = vi.spyOn(chrome.action, "setIcon");
    const setTitle = vi.spyOn(chrome.action, "setTitle");
    const alarm = vi.spyOn(chrome.alarms, "create");
    const broadcast = vi.spyOn(chrome.runtime, "sendMessage");
    await handleQuotaRequest({ type: "quota/get-state", accountKey: "account", plan: "pro" });
    expect(setIcon).not.toHaveBeenCalled();
    expect(setTitle).not.toHaveBeenCalled();
    expect(alarm).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("skips storage when the same events are ingested again", async () => {
    const ledger = new QuotaLedger();
    const event = { id: "t1", accountKey: "account", createdAt: 10, model: "gpt-6-pro", classification: "personal" as const };
    await ledger.ingest([event], { accountKey: "account", plan: "pro", historyComplete: true, now: 20 });
    expect(ledger.takeChanged()).toBe(true);
    const set = vi.spyOn(chrome.storage.local, "set");
    await ledger.ingest([event], { accountKey: "account", plan: "pro", historyComplete: true, now: 30 });
    expect(ledger.takeChanged()).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("does not write limits again when they are unchanged", async () => {
    const ledger = new QuotaLedger();
    const limits = [{ model: "gpt-6-pro", resetsAt: null, fallbackModel: null }];
    await ledger.ingest([], { accountKey: "account", plan: "pro", limits, now: 20 });
    const set = vi.spyOn(chrome.storage.local, "set");
    await ledger.ingest([], { accountKey: "account", plan: "pro", limits, now: 21 });
    expect(set).not.toHaveBeenCalled();
  });

  it("does not redraw an identical icon and does redraw when the rolling window moves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const setIcon = vi.spyOn(chrome.action, "setIcon");
    const event = { id: "t1", accountKey: "account", createdAt: 1_800_000_000_000, model: "gpt-5-6-pro", classification: "personal" as const };
    await handleQuotaRequest({ type: "quota/ingest", events: [event], accountKey: "account", plan: "pro", historyComplete: true });
    const first = setIcon.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    await handleQuotaRequest({ type: "quota/ingest", events: [event], accountKey: "account", plan: "pro", historyComplete: true });
    expect(setIcon).toHaveBeenCalledTimes(first);
    vi.setSystemTime(1_800_000_000_000 + 24 * 60 * 60 * 1000 + 1);
    await restoreQuotaPresentation();
    expect(setIcon.mock.calls.length).toBeGreaterThan(first);
    vi.useRealTimers();
  });

  it("stores a changed ledger once", async () => {
    const set = vi.spyOn(chrome.storage.local, "set");
    await handleQuotaRequest({
      type: "quota/ingest",
      events: [{ id: "n1", accountKey: "account", createdAt: 5, model: "gpt-6-pro", classification: "personal" }],
      accountKey: "account",
      plan: "pro",
      historyComplete: true
    });
    const ledgerWrites = set.mock.calls.filter((call) => call[0] && LEDGER_KEY in (call[0] as object));
    expect(ledgerWrites.length).toBe(1);
  });
});
