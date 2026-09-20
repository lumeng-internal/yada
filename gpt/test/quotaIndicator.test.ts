import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import { snapshotTitle, snapshotToRings } from "../src/quota/iconState";
import { LEDGER_KEY, STATE_KEY, type QuotaSnapshot } from "../src/quota/types";
import { GPT6_PRO, SOL_PRO } from "../src/quota/vibebar/allowances";
import { YadaToolbar } from "../src/ui/toolbar";
import {
  QUOTA_INDICATOR_DEBOUNCE_MS,
  QUOTA_POPOVER_HOST_ID,
  QuotaIndicator,
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
    now: NOW
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

function mountIndicator(send: QuotaStateSender, theme: "light" | "dark" = "light"): {
  host: HTMLDivElement;
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  indicator: QuotaIndicator;
  popover: HTMLElement;
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
  const indicator = new QuotaIndicator(button, { send });
  const popover = document.getElementById(QUOTA_POPOVER_HOST_ID)?.shadowRoot?.querySelector<HTMLElement>("[data-quota-popover]")!;
  return { host, button, canvas, indicator, popover };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
    mounted.button.click();
    expect(mounted.popover.hidden).toBe(false);
    expect(mounted.popover.textContent).toContain("Pro 模型额度");
    expect(mounted.popover.textContent).toContain("GPT-6 Pro");
    expect(mounted.popover.textContent).toContain("GPT-5.6 Sol Pro");
    expect(mounted.popover.textContent).toContain("两个 Pro");
    expect(mounted.popover.textContent).toContain(`预计剩余 ${snapshot.gpt6ProWeekly?.estimatedRemaining} / ${snapshot.gpt6ProWeekly?.limit}`);
    expect(mounted.popover.textContent).toContain(`预计剩余 ${snapshot.solProDaily?.estimatedRemaining} / ${snapshot.solProDaily?.limit}`);
    expect(mounted.popover.textContent).toContain(`预计剩余 ${snapshot.combinedDaily?.estimatedRemaining} / ${snapshot.combinedDaily?.limit}`);
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
    expect(mounted.popover.textContent).toContain("历史暂未补齐");
    expect(mounted.popover.textContent).not.toMatch(/预计剩余 \d+/);
  });

  it("uses an ellipsis while progressive history backfill is active", async () => {
    const snapshot = proSnapshot(8, { historyComplete: false, syncStatus: "backfill" });
    const mounted = mountIndicator(async () => ({ snapshot }));
    indicator = mounted.indicator;
    await flush();
    expect(mounted.canvas.dataset.quotaCenter).toBe("…");
    mounted.button.click();
    expect(mounted.popover.textContent).toContain("正在首次同步最近 7 天 ChatGPT 历史");
    expect(mounted.popover.textContent).toContain(`已记录 ${snapshot.recordedCount}`);
  });

  it("does not invent Pro remaining for unknown plans", async () => {
    const snapshot = proSnapshot(8, { plan: null });
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    expect(mounted.popover.textContent).toContain("未确认 ChatGPT 套餐，不猜测额度桶。");
    expect(mounted.popover.textContent).not.toMatch(/预计剩余 \d+/);
    expect(mounted.popover.textContent).not.toContain("GPT-6 Pro");
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
    expect(mounted.popover.hidden).toBe(false);
    expect(mounted.button.getAttribute("aria-expanded")).toBe("true");
    mounted.button.click();
    expect(mounted.popover.hidden).toBe(true);
    mounted.button.click();
    expect(mounted.popover.hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    expect(mounted.popover.hidden).toBe(true);
    mounted.button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(mounted.popover.hidden).toBe(true);
  });

  it("mounts the quota detail in a detached fixed portal", async () => {
    const mounted = mountIndicator(async () => ({ snapshot: proSnapshot() }));
    indicator = mounted.indicator;
    await flush();
    const portal = document.getElementById(QUOTA_POPOVER_HOST_ID);
    const css = portal?.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(portal?.parentElement).toBe(document.body);
    expect(mounted.popover.getRootNode()).toBe(portal?.shadowRoot);
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
    expect(mounted.popover.textContent).toContain("无法读取额度账本");
  });

  it("removes listeners, timers, and the popover on dispose", async () => {
    vi.useFakeTimers();
    const send = vi.fn<QuotaStateSender>(async () => ({ snapshot: proSnapshot() }));
    const mounted = mountIndicator(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    expect(mounted.popover.isConnected).toBe(true);
    await chrome.storage.local.set({ [LEDGER_KEY]: { version: 2, events: [] } });
    mounted.indicator.dispose();
    indicator = null;
    expect(mounted.popover.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(QUOTA_INDICATOR_DEBOUNCE_MS + 20);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    await chrome.storage.local.set({ [STATE_KEY]: { version: 2, plan: "pro", historyComplete: true, unclassifiedTurns: 0 } });
    await vi.advanceTimersByTimeAsync(QUOTA_INDICATOR_DEBOUNCE_MS + 20);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
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
    const popover = document.getElementById(QUOTA_POPOVER_HOST_ID)?.shadowRoot?.querySelector<HTMLElement>("[data-quota-popover]");
    expect(popover?.hasAttribute("hidden")).toBe(true);
  });
});
