import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import { snapshotTitle, snapshotToRings } from "../src/quota/iconState";
import { LEDGER_KEY, STATE_KEY, type QuotaSnapshot } from "../src/quota/types";
import { GPT6_PRO, SOL_PRO } from "../src/quota/vibebar/allowances";
import { YadaToolbar } from "../src/ui/toolbar";
import {
  HEROICON_ARROW_PATH_D,
  QUOTA_INDICATOR_DEBOUNCE_MS,
  QUOTA_POPOVER_HOST_ID,
  QUOTA_REFRESH_ERROR,
  QUOTA_REFRESH_LABEL,
  QUOTA_REFRESHED_LIVE,
  QUOTA_REFRESHING_LABEL,
  QuotaIndicator,
  type QuotaRefreshHandler,
  type QuotaStateSender
} from "../src/ui/quotaIndicator";

const NOW = 1_800_000_000_000;
const originalSend = chrome.runtime.sendMessage;

function event(id: string, model: string) {
  return {
    id,
    accountKey: "account",
    createdAt: NOW,
    model,
    classification: "personal" as const
  };
}

function proSnapshot(count = 40, extras: { historyComplete?: boolean; syncStatus?: QuotaSnapshot["syncStatus"]; plan?: QuotaSnapshot["plan"]; workspaceKind?: QuotaSnapshot["workspaceKind"] } = {}): QuotaSnapshot {
  const gpt6 = Array.from({ length: count }, (_, index) => event(`g${index}`, GPT6_PRO));
  const sol = [event("s0", SOL_PRO)];
  return calculateQuotaSnapshot({
    accountKey: "account",
    plan: extras.plan === undefined ? "pro" : extras.plan,
    workspaceKind: extras.workspaceKind ?? "personal",
    events: [...gpt6, ...sol],
    historyComplete: extras.historyComplete ?? true,
    syncStatus: extras.syncStatus,
    unclassifiedTurns: extras.historyComplete === false ? 2 : 0,
    now: NOW,
    lastHistorySuccessAt: extras.historyComplete === false ? undefined : NOW
  });
}

function toolbarShadow(): ShadowRoot {
  const host = document.getElementById("chatgpt-yada-toolbar-host");
  if (!host?.shadowRoot) throw new Error("toolbar missing");
  return host.shadowRoot;
}

function mountToolbar(): YadaToolbar {
  const toolbar = new YadaToolbar();
  toolbar.mount();
  toolbar.setVisible(true);
  return toolbar;
}

function mountIndicator(
  send: QuotaStateSender,
  theme: "light" | "dark" = "light",
  onRefresh?: QuotaRefreshHandler
): {
  host: HTMLDivElement;
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  indicator: QuotaIndicator;
} {
  const host = document.createElement("div");
  host.setAttribute("data-yada-theme", theme);
  const shadow = host.attachShadow({ mode: "open" });
  const button = document.createElement("button");
  button.dataset.quota = "";
  const canvas = document.createElement("canvas");
  button.append(canvas);
  shadow.append(button);
  document.body.append(host);
  const indicator = new QuotaIndicator(button, { send, onRefresh });
  return { host, button, canvas, indicator };
}

function refreshButtonOf(): HTMLButtonElement {
  const button = popoverOf()?.querySelector<HTMLButtonElement>("[data-quota-refresh]");
  if (!button) throw new Error("refresh button missing");
  return button;
}

function popoverOf(): HTMLElement | null {
  return document.getElementById(QUOTA_POPOVER_HOST_ID)?.shadowRoot?.querySelector<HTMLElement>("[data-quota-popover]") ?? null;
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("inline toolbar quota rings", () => {
  let toolbar: YadaToolbar | null = null;
  let indicator: QuotaIndicator | null = null;

  afterEach(() => {
    indicator?.dispose();
    indicator = null;
    toolbar?.dispose();
    toolbar = null;
    chrome.runtime.sendMessage = originalSend;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("keeps only quota, copy, prompts in that order", () => {
    toolbar = mountToolbar();
    const buttons = [...toolbarShadow().querySelectorAll("button")];
    expect(buttons.map((button) => {
      if (button.hasAttribute("data-quota")) return "quota";
      if (button.hasAttribute("data-copy-all")) return "copy";
      if (button.hasAttribute("data-prompts")) return "prompts";
      return button.textContent;
    })).toEqual(["quota", "copy", "prompts"]);
    expect(toolbarShadow().querySelector("[data-preview-mode]")).toBeNull();
  });

  it("sizes the quota icon as a 20px control, not a 29px capsule", () => {
    toolbar = mountToolbar();
    const root = toolbarShadow();
    const quota = root.querySelector<HTMLButtonElement>("[data-quota]")!;
    const copy = root.querySelector<HTMLButtonElement>("[data-copy-all]")!;
    const css = root.querySelector("style")!.textContent ?? "";
    const iconRule = css.slice(css.indexOf("button[data-quota]"), css.indexOf("button[data-quota] canvas"));
    expect(css).toMatch(/button\s*\{[^}]*height:\s*29px/);
    expect(iconRule).toContain("button[data-quota]");
    expect(iconRule).toMatch(/width:\s*20px/);
    expect(iconRule).toMatch(/height:\s*20px/);
    expect(iconRule).toMatch(/padding:\s*0/);
    expect(iconRule).toMatch(/border:\s*0/);
    expect(iconRule).toMatch(/border-radius:\s*50%/);
    expect(iconRule).not.toMatch(/height:\s*29px/);
    expect(css).toMatch(/button\[data-quota\] canvas\s*\{[^}]*width:\s*20px/);
    expect(copy.textContent).toBe("复制全部");
    expect(quota.textContent).not.toMatch(/额度|Pro|%/);
  });

  it("renders unknown rings immediately before a snapshot arrives", () => {
    toolbar = mountToolbar();
    const quota = toolbarShadow().querySelector<HTMLButtonElement>("[data-quota]")!;
    const canvas = quota.querySelector("canvas");
    expect(quota).toBeTruthy();
    expect(canvas).toBeTruthy();
    expect(quota.title).toBe("Pro 额度：读取中");
    expect(quota.getAttribute("aria-label")).toBe("Pro 额度：读取中");
    expect(canvas?.dataset.quotaCenter).toBe("…");
    expect(canvas?.dataset.quotaOuter).toBe("0");
    expect(canvas?.dataset.quotaMiddle).toBe("0");
    expect(canvas?.dataset.quotaInner).toBe("0");
  });

  it("paints Pro rings and popover buckets from the same snapshot", async () => {
    const snapshot = proSnapshot();
    const rings = snapshotToRings(snapshot);
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    expect(send).toHaveBeenCalledWith({ type: "quota/get-state" });
    expect(mounted.canvas.dataset.quotaOuter).toBe(String(rings.outer));
    expect(mounted.canvas.dataset.quotaMiddle).toBe(String(rings.middle));
    expect(mounted.canvas.dataset.quotaInner).toBe(String(rings.inner));
    expect(mounted.canvas.dataset.quotaCenter).toBe(rings.center ?? "");
    expect(mounted.button.title).toBe(snapshotTitle(snapshot));
    expect(mounted.button.title).toContain(`GPT-6 Pro：已用 ${snapshot.gpt6ProWeekly?.used} / ${snapshot.gpt6ProWeekly?.limit}`);
    expect(document.getElementById(QUOTA_POPOVER_HOST_ID)).toBeNull();
    mounted.button.click();
    const popover = popoverOf()!;
    expect(popover.hidden).toBe(false);
    expect(popover.textContent).toContain("Pro 模型额度");
    expect(popover.textContent).toContain("GPT-6 Pro");
    expect(popover.textContent).toContain("GPT-5.6 Sol Pro");
    expect(popover.textContent).toContain("GPT-6 Pro+5.6 Sol Pro");
    expect(popover.textContent).not.toContain("两个 Pro");
    expect(popover.textContent).toContain(`已用 ${snapshot.gpt6ProWeekly?.used} / ${snapshot.gpt6ProWeekly?.limit}`);
    expect(popover.textContent).toContain(`已用 ${snapshot.solProDaily?.used} / ${snapshot.solProDaily?.limit}`);
    expect(popover.textContent).toContain(`已用 ${snapshot.combinedDaily?.used} / ${snapshot.combinedDaily?.limit}`);
    expect(popover.textContent).not.toContain("本地估算，不是 ChatGPT 官方余额");
    expect(popover.textContent).not.toContain("只统计个人 Chat，不统计 Work 和 Codex");
    expect(popover.textContent).not.toContain("历史同步完整");
    expect(popover.textContent).toContain("上次完整同步：");
  });

  it("does not estimate remaining and marks partial history with a dash", async () => {
    const snapshot = proSnapshot(8, { historyComplete: false });
    const rings = snapshotToRings(snapshot);
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    expect(rings.center).toBe("—");
    expect(mounted.canvas.dataset.quotaCenter).toBe("—");
    mounted.button.click();
    expect(popoverOf()!.textContent).toContain("历史暂未补齐");
    expect(popoverOf()!.textContent).not.toMatch(/预计剩余 \d+/);
  });

  it("keeps first-sync, error, and partial notes in the details popover", async () => {
    const errorSnapshot = proSnapshot(8, { historyComplete: true });
    errorSnapshot.syncStatus = "error";
    errorSnapshot.historyError = "历史读取超时";
    errorSnapshot.lastHistoryError = "历史读取超时";
    const mounted = mountIndicator(async () => ({ snapshot: errorSnapshot }));
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    expect(popoverOf()!.textContent).toContain("最近历史刷新失败");
    expect(popoverOf()!.textContent).toContain("上次完整同步：");
  });

  it("uses an ellipsis while progressive history backfill is active", async () => {
    const snapshot = proSnapshot(8, { historyComplete: false, syncStatus: "backfill" });
    const mounted = mountIndicator(async () => ({ snapshot }));
    indicator = mounted.indicator;
    await flush();
    expect(mounted.canvas.dataset.quotaCenter).toBe("…");
    mounted.button.click();
    expect(popoverOf()!.textContent).toContain("正在首次同步最近 7 天 ChatGPT 历史");
    expect(popoverOf()!.textContent).toContain(`已记录 ${snapshot.recordedCount}`);
  });

  it("does not invent Pro remaining for unknown plans", async () => {
    const snapshot = proSnapshot(8, { plan: null });
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    expect(popoverOf()!.textContent).toContain("未确认 ChatGPT 套餐，不猜测额度桶。");
    expect(popoverOf()!.textContent).not.toMatch(/预计剩余 \d+/);
    expect(popoverOf()!.textContent).not.toContain("GPT-6 Pro");
  });

  it("refetches quota/get-state after storage changes, without polling", async () => {
    vi.useFakeTimers();
    const first = proSnapshot(10);
    const second = proSnapshot(80);
    const send = vi.fn<QuotaStateSender>()
      .mockResolvedValueOnce({ snapshot: first })
      .mockResolvedValue({ snapshot: second });
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(mounted.canvas.dataset.quotaOuter).toBe(String(snapshotToRings(first).outer));
    await chrome.storage.local.set({ [STATE_KEY]: { version: 2, plan: "pro", historyComplete: true, unclassifiedTurns: 0 } });
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(QUOTA_INDICATOR_DEBOUNCE_MS);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({ type: "quota/get-state" });
    expect(mounted.canvas.dataset.quotaOuter).toBe(String(snapshotToRings(second).outer));
    expect(send.mock.calls.every((call) => call[0] && typeof call[0] === "object" && (call[0] as { type?: string }).type === "quota/get-state")).toBe(true);
  });

  it("toggles the popover with click, outside click, and Escape", async () => {
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot: proSnapshot() }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    expect(popoverOf()!.hidden).toBe(false);
    expect(mounted.button.getAttribute("aria-expanded")).toBe("true");
    mounted.button.click();
    expect(popoverOf()!.hidden).toBe(true);
    mounted.button.click();
    expect(popoverOf()!.hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    expect(popoverOf()!.hidden).toBe(true);
    mounted.button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popoverOf()!.hidden).toBe(true);
  });

  it("mounts the quota detail in a detached fixed portal on first click", async () => {
    const mounted = mountIndicator(async () => ({ snapshot: proSnapshot() }));
    indicator = mounted.indicator;
    await flush();
    expect(document.getElementById(QUOTA_POPOVER_HOST_ID)).toBeNull();
    mounted.button.click();
    const portal = document.getElementById(QUOTA_POPOVER_HOST_ID);
    const popover = popoverOf()!;
    const css = portal?.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(portal?.parentElement).toBe(document.body);
    expect(popover.getRootNode()).toBe(portal?.shadowRoot);
    expect(css).toMatch(/position:\s*fixed/);
    expect(css).toMatch(/max-height:\s*calc\(100vh - 16px\)/);
    expect(css).toMatch(/overflow:\s*auto/);
  });

  it("keeps the 20px button and fail-soft copy when background is unavailable", async () => {
    const send = vi.fn<QuotaStateSender>(async () => ({ error: "down" }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    expect(mounted.button.title).toBe("Pro 额度暂不可用");
    expect(mounted.canvas.dataset.quotaCenter).toBe("!");
    mounted.button.click();
    expect(popoverOf()!.textContent).toContain("无法读取额度账本");
  });

  it("removes listeners, timers, and the popover on dispose", async () => {
    vi.useFakeTimers();
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot: proSnapshot() }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    expect(popoverOf()!.isConnected).toBe(true);
    await chrome.storage.local.set({ [LEDGER_KEY]: { version: 2, events: [] } });
    mounted.indicator.dispose();
    indicator = null;
    expect(popoverOf()).toBeNull();
    await vi.advanceTimersByTimeAsync(QUOTA_INDICATOR_DEBOUNCE_MS + 20);
    await flush();
    expect(send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-state")).toHaveLength(1);
    await chrome.storage.local.set({ [STATE_KEY]: { version: 2, plan: "pro", historyComplete: true, unclassifiedTurns: 0 } });
    await vi.advanceTimersByTimeAsync(QUOTA_INDICATOR_DEBOUNCE_MS + 20);
    await flush();
    expect(send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-state")).toHaveLength(1);
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  it("places an inline SVG refresh control on the popover title row", async () => {
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot: proSnapshot() }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    expect(document.getElementById(QUOTA_POPOVER_HOST_ID)).toBeNull();
    expect(send.mock.calls.every((call) => (call[0] as { type?: string }).type !== "quota/refresh-current")).toBe(true);
    mounted.button.click();
    const popover = popoverOf()!;
    const header = popover.querySelector("[data-quota-header]")!;
    const refresh = refreshButtonOf();
    const svg = refresh.querySelector("svg");
    const path = refresh.querySelector("path");
    const css = document.getElementById(QUOTA_POPOVER_HOST_ID)?.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(header.contains(refresh)).toBe(true);
    expect(header.querySelector("h2")?.textContent).toBe("Pro 模型额度");
    expect(refresh.tagName).toBe("BUTTON");
    expect(refresh.getAttribute("aria-label")).toBe(QUOTA_REFRESH_LABEL);
    expect(refresh.title).toBe(QUOTA_REFRESH_LABEL);
    expect(refresh.disabled).toBe(false);
    expect(refresh.getAttribute("aria-busy")).toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(path?.getAttribute("d")).toBe(HEROICON_ARROW_PATH_D);
    expect(css).toMatch(/\[data-quota-refresh\][^{]*\{[^}]*width:\s*28px/);
    expect(css).toMatch(/\[data-quota-refresh\][^{]*\{[^}]*height:\s*28px/);
    expect(css).toMatch(/\[data-quota-refresh\][^{]*\{[^}]*border:\s*0/);
    expect(css).toMatch(/\[data-quota-refresh\] svg\s*\{[^}]*width:\s*16px/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/@keyframes yada-quota-refresh-spin/);
    expect(css).toMatch(/:host\(\[data-yada-theme="dark"\]\) \[data-quota-refresh\]:hover/);
    expect(popover.textContent).not.toContain("刷新当前额度");
    expect(send.mock.calls.every((call) => (call[0] as { type?: string }).type !== "quota/refresh-current")).toBe(true);
  });

  it("does not start a light refresh until the title-row button is clicked", async () => {
    const onRefresh = vi.fn<QuotaRefreshHandler>(async () => undefined);
    const send = vi.fn<QuotaStateSender>(async (message) => {
      if ((message as { type?: string }).type === "quota/get-heatmap") return {};
      return { snapshot: proSnapshot() };
    });
    const mounted = mountIndicator(send, "light", onRefresh);
    indicator = mounted.indicator;
    await flush();
    expect(onRefresh).not.toHaveBeenCalled();
    mounted.button.click();
    await flush();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(send.mock.calls.some((call) => (call[0] as { type?: string }).type === "quota/refresh-current")).toBe(false);
  });

  it("enters a single-flight refreshing state and reloads state plus heatmap on success", async () => {
    let release!: () => void;
    const onRefresh = vi.fn<QuotaRefreshHandler>(() => new Promise((resolve) => { release = resolve; }));
    const send = vi.fn<QuotaStateSender>(async (message) => {
      if ((message as { type?: string }).type === "quota/get-heatmap") {
        return { heatmap: { generatedAt: NOW, historyComplete: true, accountKey: "account", buckets: [] } };
      }
      return { snapshot: proSnapshot() };
    });
    const mounted = mountIndicator(send, "light", onRefresh);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const heatmapCount = () => send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-heatmap").length;
    const stateCount = () => send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-state").length;
    expect(heatmapCount()).toBe(1);
    expect(stateCount()).toBe(1);
    const refresh = refreshButtonOf();
    refresh.click();
    refresh.click();
    refresh.click();
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(refresh.getAttribute("aria-label")).toBe(QUOTA_REFRESHING_LABEL);
    expect(send.mock.calls.some((call) => (call[0] as { type?: string }).type === "quota/refresh-current")).toBe(false);
    release();
    await flush();
    await flush();
    expect(refresh.disabled).toBe(false);
    expect(refresh.getAttribute("aria-busy")).toBeNull();
    expect(refresh.getAttribute("aria-label")).toBe(QUOTA_REFRESH_LABEL);
    expect(stateCount()).toBe(2);
    expect(heatmapCount()).toBe(2);
    expect(popoverOf()?.querySelector("[data-quota-live]")?.textContent).toBe(QUOTA_REFRESHED_LIVE);
    expect(popoverOf()?.querySelector("[data-quota-refresh-error]")).toBeNull();
  });

  it("keeps last-good numbers and heatmap after a failed refresh, then clears the error on success", async () => {
    const first = proSnapshot(10);
    const onRefresh = vi.fn<QuotaRefreshHandler>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const send = vi.fn<QuotaStateSender>(async (message) => {
      if ((message as { type?: string }).type === "quota/get-heatmap") {
        return {
          heatmap: {
            generatedAt: NOW,
            historyComplete: true,
            accountKey: "account",
            buckets: [{
              id: "gpt6_pro_weekly",
              windowHours: 168,
              rows: 7,
              columns: 24,
              firstReleaseHour: NOW,
              cells: [],
              maxCount: 0
            }]
          }
        };
      }
      return { snapshot: first };
    });
    const mounted = mountIndicator(send, "light", onRefresh);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const outer = mounted.canvas.dataset.quotaOuter;
    const heatmapBefore = popoverOf()!.querySelector("[data-quota-heatmap]")?.outerHTML ?? "none";
    refreshButtonOf().click();
    await flush(8);
    expect(mounted.canvas.dataset.quotaCenter).not.toBe("!");
    expect(mounted.canvas.dataset.quotaOuter).toBe(outer);
    expect(popoverOf()!.querySelector("[data-quota-refresh-error]")?.textContent).toBe(QUOTA_REFRESH_ERROR);
    expect(popoverOf()!.querySelector("[data-quota-heatmap]")?.outerHTML ?? "none").toBe(heatmapBefore);
    refreshButtonOf().click();
    await flush(8);
    expect(popoverOf()!.querySelector("[data-quota-refresh-error]")).toBeNull();
    expect(mounted.canvas.dataset.quotaOuter).toBe(outer);
  });

  it("clears refresh animation and error state on close", async () => {
    let release!: () => void;
    const onRefresh = vi.fn<QuotaRefreshHandler>(() => new Promise((_, reject) => { release = () => reject(new Error("nope")); }));
    const mounted = mountIndicator(async () => ({ snapshot: proSnapshot() }), "light", onRefresh);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    refreshButtonOf().click();
    await flush(8);
    expect(refreshButtonOf().getAttribute("aria-busy")).toBe("true");
    mounted.indicator.close();
    expect(popoverOf()?.hidden).toBe(true);
    release();
    await flush(8);
    mounted.button.click();
    expect(refreshButtonOf().getAttribute("aria-busy")).toBeNull();
    expect(refreshButtonOf().disabled).toBe(false);
    expect(popoverOf()!.querySelector("[data-quota-refresh-error]")).toBeNull();
  });

  it("keeps copy-all and prompts working beside the quota icon", () => {
    toolbar = mountToolbar();
    const root = toolbarShadow();
    const copy = root.querySelector<HTMLButtonElement>("[data-copy-all]")!;
    const prompts = root.querySelector<HTMLButtonElement>("[data-prompts]")!;
    expect(root.querySelector("[data-preview-mode]")).toBeNull();
    expect(copy.textContent).toBe("复制全部");
    expect(prompts.textContent).toBe("提示词");
    toolbar.closePanels();
    expect(document.getElementById(QUOTA_POPOVER_HOST_ID)).toBeNull();
    expect(document.getElementById("chatgpt-yada-prompt-host")).toBeNull();
  });
});
