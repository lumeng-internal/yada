import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateQuotaSnapshot } from "../src/quota/calculator";
import { buildQuotaHeatmap, HOUR_MS } from "../src/quota/heatmap";
import { STATE_KEY, type QuotaSnapshot, type QuotaUsageEvent } from "../src/quota/types";
import { GPT6_PRO, SOL_PRO } from "../src/quota/vibebar/allowances";
import { QUOTA_INDICATOR_DEBOUNCE_MS, QUOTA_POPOVER_HOST_ID, QuotaIndicator, type QuotaStateSender } from "../src/ui/quotaIndicator";
import { HEATMAP_CELL_SIZE, HEATMAP_GAP, HEATMAP_RADIUS } from "../src/ui/quotaHeatmap";

const NOW = new Date(2026, 8, 22, 20, 5, 0, 0).getTime();
const ANCHOR = new Date(2026, 8, 22, 21, 0, 0, 0).getTime();

function event(id: string, createdAt: number, model: string, classification: QuotaUsageEvent["classification"] = "personal"): QuotaUsageEvent {
  return { id, accountKey: "account", createdAt, model, classification };
}

function fixture(plan: QuotaSnapshot["plan"] = "pro", complete = true, workspaceKind: QuotaSnapshot["workspaceKind"] = "personal") {
  const events = [
    ...Array.from({ length: 12 }, (_, index) => event(`g${index}`, ANCHOR - 168 * HOUR_MS + index * 60_000, GPT6_PRO)),
    ...Array.from({ length: 4 }, (_, index) => event(`s${index}`, ANCHOR - 24 * HOUR_MS + index * 60_000, SOL_PRO))
  ];
  const snapshot = calculateQuotaSnapshot({
    accountKey: "account",
    plan,
    workspaceKind,
    events,
    historyComplete: complete,
    syncStatus: complete ? "ready" : "partial",
    unclassifiedTurns: complete ? 0 : 1,
    now: NOW,
    lastHistorySuccessAt: complete ? NOW : undefined
  });
  const heatmap = buildQuotaHeatmap({ accountKey: "account", plan, events, historyComplete: complete, now: NOW });
  return { snapshot, heatmap };
}

function mount(send: QuotaStateSender): { indicator: QuotaIndicator; button: HTMLButtonElement } {
  const button = document.createElement("button");
  button.append(document.createElement("canvas"));
  document.body.append(button);
  return { indicator: new QuotaIndicator(button, { send }), button };
}

function popover(): HTMLElement {
  return document.getElementById(QUOTA_POPOVER_HOST_ID)!.shadowRoot!.querySelector<HTMLElement>("[data-quota-popover]")!;
}

function routedSender(snapshot: QuotaSnapshot, heatmap = buildQuotaHeatmap({
  accountKey: snapshot.accountKey,
  plan: snapshot.plan,
  events: [],
  historyComplete: snapshot.historyComplete,
  now: NOW
})) {
  return vi.fn<QuotaStateSender>(async (message) =>
    (message as { type?: string }).type === "quota/get-heatmap"
      ? { heatmap }
      : { snapshot }
  );
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("on-demand quota heatmap UI", () => {
  let indicator: QuotaIndicator | null = null;

  afterEach(() => {
    indicator?.dispose();
    indicator = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark", "light");
    document.body.innerHTML = "";
  });

  it("does no heatmap work on page mount and requests it only on first open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { snapshot, heatmap } = fixture();
    const send = routedSender(snapshot, heatmap);
    const mounted = mount(send);
    indicator = mounted.indicator;
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual({ type: "quota/get-state" });
    expect(document.querySelectorAll("[data-heatmap-cell]")).toHaveLength(0);
    expect(document.querySelector("[data-heatmap-tooltip]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    mounted.button.click();
    await flush();
    const heatmapCalls = send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-heatmap");
    expect(heatmapCalls).toHaveLength(1);
    expect(heatmapCalls[0]?.[0]).toEqual({ type: "quota/get-heatmap", accountKey: "account", plan: "pro" });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("contains no polling, RAF, observer, animation, or network transport", () => {
    const source = ["src/quota/heatmap.ts", "src/ui/quotaHeatmap.ts"]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bsetInterval\b|\brequestAnimationFrame\b|new\s+MutationObserver\b|\bfetch\s*\(/);
    expect(source).not.toMatch(/\.animate\s*\(|\btransition\s*:/);
  });

  it("renders 168+24+24 rects with row-major groups, rolling hour labels, and no legend", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { snapshot, heatmap } = fixture();
    const mounted = mount(routedSender(snapshot, heatmap));
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const root = popover();
    expect(root.querySelectorAll("[data-heatmap-cell]")).toHaveLength(216);
    expect(root.querySelectorAll('[data-quota-heatmap="gpt6_pro_weekly"] g[data-heatmap-row]')).toHaveLength(7);
    expect(root.querySelectorAll('[data-quota-heatmap="sol_pro_daily"] g[data-heatmap-row]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-quota-heatmap="pro_daily"] g[data-heatmap-row]')).toHaveLength(1);
    expect(root.querySelector('[data-quota-heatmap="gpt6_pro_weekly"] [data-heatmap-axis][data-heatmap-column="0"]')?.textContent).toBe("21");
    expect(root.querySelectorAll('[data-quota-heatmap="gpt6_pro_weekly"] [data-heatmap-axis]')).toHaveLength(5);
    expect([...root.querySelectorAll('[data-quota-heatmap="gpt6_pro_weekly"] [data-heatmap-row-label]')]
      .map((label) => label.textContent)).toEqual(["09/16", "09/17", "09/18", "09/19", "09/20", "09/21", "09/22"]);
    expect([...root.querySelectorAll('[data-quota-heatmap="sol_pro_daily"] [data-heatmap-row-label]')]
      .map((label) => label.textContent)).toEqual(["09/22"]);
    expect([...root.querySelectorAll('[data-quota-heatmap="pro_daily"] [data-heatmap-row-label]')]
      .map((label) => label.textContent)).toEqual(["09/22"]);
    expect(root.textContent).not.toMatch(/1–2|3–5|6–10|11\+|少\s*→\s*多|Low|High|Legend/);
    expect(root.querySelector("[data-heatmap-legend]")).toBeNull();
    const first = root.querySelector<SVGRectElement>('[data-quota-heatmap="gpt6_pro_weekly"] [data-heatmap-cell]')!;
    expect(first.getAttribute("width")).toBe(String(HEATMAP_CELL_SIZE));
    expect(first.getAttribute("rx")).toBe(String(HEATMAP_RADIUS));
    const second = root.querySelector<SVGRectElement>('[data-quota-heatmap="gpt6_pro_weekly"] [data-heatmap-cell][data-heatmap-column="1"]')!;
    expect(Number(second.getAttribute("x")) - Number(first.getAttribute("x"))).toBe(HEATMAP_CELL_SIZE + HEATMAP_GAP);
  });

  it("uses one shared tooltip with the strict text and immediate show/hide", async () => {
    const { snapshot, heatmap } = fixture();
    const mounted = mount(routedSender(snapshot, heatmap));
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const root = popover();
    const tooltips = root.querySelectorAll<HTMLElement>("[data-heatmap-tooltip]");
    expect(tooltips).toHaveLength(1);
    const tooltip = tooltips[0];
    const cell = root.querySelector<SVGRectElement>('[data-quota-heatmap="gpt6_pro_weekly"] [data-heatmap-cell]')!;
    cell.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toBe("9月15日 周二 21:00 使用12次");
    expect(tooltip.textContent).not.toContain("\n");
    cell.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    expect(tooltip.hidden).toBe(true);
  });

  it("ships light/dark variables and only a non-animated hover stroke", async () => {
    const { snapshot, heatmap } = fixture();
    const mounted = mount(routedSender(snapshot, heatmap));
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const host = document.getElementById(QUOTA_POPOVER_HOST_ID)!;
    const css = host.shadowRoot!.querySelector("style")!.textContent!;
    expect(css).toContain("--yada-heatmap-empty: #ebedf0");
    expect(css).toContain("--yada-heatmap-empty: #2d333b");
    expect(css).toMatch(/\[data-heatmap-cell\]:hover\s*\{[^}]*stroke:/);
    expect(css).not.toMatch(/transition|animation/);
    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(host.dataset.yadaTheme).toBe("dark");
  });

  it("removes SVG, the shared tooltip, delegated listeners, and the hour timer on close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { snapshot, heatmap } = fixture();
    const mounted = mount(routedSender(snapshot, heatmap));
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const root = popover();
    const remove = vi.spyOn(root, "removeEventListener");
    expect(root.querySelectorAll("[data-heatmap-cell]")).toHaveLength(216);
    expect(vi.getTimerCount()).toBe(1);
    mounted.button.click();
    expect(root.hidden).toBe(true);
    expect(root.querySelectorAll("[data-heatmap-cell]")).toHaveLength(0);
    expect(root.querySelector("[data-heatmap-tooltip]")).toBeNull();
    expect(remove).toHaveBeenCalledWith("pointerover", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("pointerout", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes heatmap on debounced ledger changes only while open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { snapshot, heatmap } = fixture();
    const send = routedSender(snapshot, heatmap);
    const mounted = mount(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const heatmapCount = () => send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-heatmap").length;
    expect(heatmapCount()).toBe(1);
    await chrome.storage.local.set({ [STATE_KEY]: { version: 2 } });
    await vi.advanceTimersByTimeAsync(QUOTA_INDICATOR_DEBOUNCE_MS);
    await flush();
    expect(heatmapCount()).toBe(2);

    mounted.button.click();
    await chrome.storage.local.set({ [STATE_KEY]: { version: 2, changed: true } });
    await vi.advanceTimersByTimeAsync(QUOTA_INDICATOR_DEBOUNCE_MS);
    await flush();
    expect(heatmapCount()).toBe(2);
  });

  it("refreshes once across an hour boundary with setTimeout, not interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { snapshot, heatmap } = fixture();
    const send = routedSender(snapshot, heatmap);
    const mounted = mount(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const heatmapCount = () => send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-heatmap").length;
    expect(heatmapCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(55 * 60_000 + 49);
    expect(heatmapCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(heatmapCount()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not redraw while hidden and fetches once when an open popover becomes visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { snapshot, heatmap } = fixture();
    const send = routedSender(snapshot, heatmap);
    const mounted = mount(send);
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const heatmapCount = () => send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-heatmap").length;
    expect(heatmapCount()).toBe(1);
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(55 * 60_000 + 50);
    expect(heatmapCount()).toBe(1);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(heatmapCount()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not request or draw for incomplete, error, unknown-plan, or Work snapshots", async () => {
    const error = fixture("pro", true).snapshot;
    error.syncStatus = "error";
    for (const { snapshot } of [fixture("pro", false), fixture(null, true), fixture("pro", true, "work"), { snapshot: error }]) {
      document.body.innerHTML = "";
      const send = routedSender(snapshot);
      const mounted = mount(send);
      await flush();
      mounted.button.click();
      await flush();
      expect(send.mock.calls.filter((call) => (call[0] as { type?: string }).type === "quota/get-heatmap")).toHaveLength(0);
      expect(popover().querySelectorAll("[data-heatmap-cell]")).toHaveLength(0);
      mounted.indicator.dispose();
    }
  });

  it("renders only the real ProLite bucket", async () => {
    const { snapshot, heatmap } = fixture("prolite");
    const mounted = mount(routedSender(snapshot, heatmap));
    indicator = mounted.indicator;
    await flush();
    mounted.button.click();
    await flush();
    const root = popover();
    expect(root.querySelectorAll("[data-quota-heatmap]")).toHaveLength(1);
    expect(root.querySelectorAll("[data-heatmap-cell]")).toHaveLength(168);
    expect(root.querySelector('[data-quota-heatmap="pro_weekly"]')).not.toBeNull();
  });
});
