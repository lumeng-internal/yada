import { afterEach, describe, expect, it } from "vitest";
import {
  isPopupReady,
  isPopupTerminal,
  loadQuotaPopup,
  renderPopupError,
  renderPopupLoading
} from "../src/popup/app";
import type { QuotaSnapshot } from "../src/quota/types";

function snapshot(): QuotaSnapshot {
  return {
    accountKey: "account",
    plan: null,
    workspaceKind: "personal",
    updatedAt: 1,
    gpt6ProWeekly: null,
    solProDaily: null,
    combinedDaily: null,
    buckets: [],
    unclassifiedTurns: 0,
    recordedCount: 0,
    historyComplete: false,
    syncStatus: "partial",
    historyError: null,
    coverageLabel: "数据不完整",
    tightestRemainingPercent: null,
    personalProEligible: true,
    serverLimits: [],
    fallbackModel: null,
    updatedLabel: "now"
  };
}

describe("popup ready/error contract", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not treat 读取中 as ready", () => {
    const root = document.createElement("div");
    renderPopupLoading(root);
    expect(root.dataset.state).toBe("loading");
    expect(root.textContent).toContain("读取中");
    expect(isPopupReady(root)).toBe(false);
    expect(isPopupTerminal(root)).toBe(false);
  });

  it("treats error as a terminal state with visible Chinese text", async () => {
    const root = document.createElement("div");
    renderPopupError(root, "无法读取额度账本");
    expect(root.dataset.state).toBe("error");
    expect(isPopupReady(root)).toBe(false);
    expect(isPopupTerminal(root)).toBe(true);
    expect(root.textContent).toContain("无法读取额度账本");
  });

  it("times out a hanging backend into error instead of staying on 读取中", async () => {
    const root = document.createElement("div");
    await loadQuotaPopup(root, () => new Promise(() => {}), { timeoutMs: 30 });
    expect(root.dataset.state).toBe("error");
    expect(isPopupTerminal(root)).toBe(true);
    expect(isPopupReady(root)).toBe(false);
    expect(root.textContent).toMatch(/超时|无法读取/);
  });

  it("renders ready after a snapshot arrives", async () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => null;
    const root = document.createElement("div");
    await loadQuotaPopup(root, async () => ({ snapshot: snapshot() }), { timeoutMs: 100 });
    HTMLCanvasElement.prototype.getContext = original;
    expect(root.dataset.state).toBe("ready");
    expect(isPopupReady(root)).toBe(true);
    expect(root.textContent).toContain("历史补齐前不估算剩余");
    expect(root.textContent).not.toMatch(/预计剩余 \d+/);
  });
});
