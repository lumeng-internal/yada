import {
  DARK_ICON_PALETTE,
  LIGHT_ICON_PALETTE,
  paintQuotaCanvas,
  type RingValues
} from "../quota/iconRenderer";
import { snapshotTitle, snapshotToRings } from "../quota/iconState";
import {
  historySyncLabel,
  metricPercentLabel,
  metricRemainingLabel,
  planStatusNote,
  quotaDetailsQuiet,
  snapshotBucketViews,
  workspaceStatusNote
} from "../quota/presentation";
import { LEDGER_KEY, STATE_KEY, type QuotaHeatmapResponse, type QuotaSnapshot } from "../quota/types";
import { sendRuntimeMessage } from "../shared/messages";
import { QUOTA_HEATMAP_CSS, QuotaHeatmapRenderer } from "./quotaHeatmap";
import { detectYadaTheme, observeYadaTheme, type YadaTheme } from "./theme";

export const QUOTA_INDICATOR_DEBOUNCE_MS = 80;
export const QUOTA_POPOVER_HOST_ID = "chatgpt-yada-quota-popover-host";
export const UNKNOWN_QUOTA_RINGS: RingValues = { outer: 0, middle: 0, inner: 0, center: "…" };
const ERROR_QUOTA_RINGS: RingValues = { outer: 0, middle: 0, inner: 0, center: "!" };
const POPOVER_WIDTH = 312;
const VIEWPORT_GUTTER = 8;

export type QuotaStateResponse = {
  snapshot?: QuotaSnapshot;
  heatmap?: QuotaHeatmapResponse;
  error?: string;
};

export type QuotaStateSender = (
  message: unknown,
  timeoutMs?: number
) => Promise<QuotaStateResponse>;

type IndicatorStatus = "loading" | "ready" | "error";

const POPOVER_CSS = `
  :host {
    --yada-text: #202123;
    --yada-muted: rgba(32, 33, 35, 0.64);
    --yada-border: rgba(32, 33, 35, 0.16);
    color-scheme: light;
    pointer-events: none;
  }
  :host([data-yada-theme="dark"]) {
    --yada-text: #ececec;
    --yada-muted: rgba(236, 236, 236, 0.66);
    --yada-border: rgba(236, 236, 236, 0.16);
    color-scheme: dark;
  }
  [data-quota-popover] {
    position: fixed;
    z-index: 2147483646;
    box-sizing: border-box;
    width: min(${POPOVER_WIDTH}px, calc(100vw - ${VIEWPORT_GUTTER * 2}px));
    max-height: calc(100vh - ${VIEWPORT_GUTTER * 2}px);
    overflow: auto;
    overscroll-behavior: contain;
    padding: 14px;
    border: 1px solid var(--yada-border);
    border-radius: 12px;
    background: #fff;
    color: var(--yada-text);
    box-shadow: 0 12px 32px rgba(15, 15, 15, 0.18);
    font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: left;
    white-space: normal;
    pointer-events: auto;
  }
  [data-quota-popover][hidden] { display: none !important; }
  :host([data-yada-theme="dark"]) [data-quota-popover] {
    background: #2a2a2a;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.46);
  }
  [data-quota-popover] h2 { margin: 0 0 8px; font-size: 13px; font-weight: 700; }
  [data-quota-popover] [data-quota-bucket] { margin-top: 10px; }
  [data-quota-popover] [data-quota-row] {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  [data-quota-popover] [data-quota-name] { margin: 0; font-size: 12px; font-weight: 700; }
  [data-quota-popover] [data-quota-meta] {
    margin: 0;
    color: var(--yada-muted);
    white-space: nowrap;
  }
  [data-quota-popover] [data-quota-remaining] { margin: 2px 0 0; }
  [data-quota-popover] p { margin: 0; }
  [data-quota-popover] [data-quota-note],
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] {
    margin-top: 8px;
    font-size: 11px;
    color: var(--yada-muted);
  }
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] { color: var(--yada-text); }
  ${QUOTA_HEATMAP_CSS}
`;

export class QuotaIndicator {
  private readonly send: QuotaStateSender;
  private readonly debounceMs: number;
  private readonly canvas: HTMLCanvasElement;
  private portalHost: HTMLDivElement | null = null;
  private popover: HTMLDivElement | null = null;
  private readonly disposeTheme: () => void;
  private disposed = false;
  private generation = 0;
  private refreshTimer = 0;
  private status: IndicatorStatus = "loading";
  private snapshot: QuotaSnapshot | null = null;
  private rings: RingValues = UNKNOWN_QUOTA_RINGS;
  private themeValue: YadaTheme;
  private quotaDirty = false;
  private heatmapVisibilityDirty = false;
  private popoverListeners = false;
  private heatmapRenderer: QuotaHeatmapRenderer | null = null;
  private heatmapGeneration = 0;
  private heatmapHourTimer = 0;

  constructor(
    private readonly button: HTMLButtonElement,
    options: { send?: QuotaStateSender; debounceMs?: number } = {}
  ) {
    this.send = options.send ?? ((message, timeoutMs) => sendRuntimeMessage<QuotaStateResponse>(message, timeoutMs));
    this.debounceMs = options.debounceMs ?? QUOTA_INDICATOR_DEBOUNCE_MS;
    this.canvas = button.querySelector("canvas") ?? button.appendChild(document.createElement("canvas"));
    this.canvas.setAttribute("aria-hidden", "true");
    this.themeValue = detectYadaTheme();

    this.disposeTheme = observeYadaTheme((theme) => {
      this.themeValue = theme;
      if (this.portalHost) this.portalHost.dataset.yadaTheme = theme;
      this.paint(this.rings);
    });
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.addEventListener("click", this.onClick);
    chrome.storage?.onChanged?.addListener(this.onStorageChanged);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.apply(null, "loading");
    void this.loadState();
  }

  close = (): void => {
    this.stopHeatmapLifecycle();
    if (this.popover) this.popover.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.detachPopoverListeners();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.generation += 1;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = 0;
    this.disposeTheme();
    this.button.removeEventListener("click", this.onClick);
    chrome.storage?.onChanged?.removeListener(this.onStorageChanged);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.portalHost?.remove();
    this.portalHost = null;
    this.popover = null;
  }

  private readonly onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.popover?.hidden !== false) this.open();
    else this.close();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.popover || this.popover.hidden) return;
    const path = event.composedPath();
    if (path.includes(this.button) || path.includes(this.popover) || (this.portalHost && path.includes(this.portalHost))) return;
    this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.popover || this.popover.hidden || event.key !== "Escape") return;
    event.stopPropagation();
    this.close();
    this.button.focus();
  };

  private readonly onViewportChange = (): void => {
    if (this.popover && !this.popover.hidden) this.positionPopover();
  };

  private readonly onStorageChanged = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string
  ): void => {
    if (this.disposed || area !== "local") return;
    if (!changes[LEDGER_KEY] && !changes[STATE_KEY]) return;
    if (document.visibilityState === "hidden") {
      this.quotaDirty = true;
      return;
    }
    this.queueLoad();
  };

  private readonly onVisibility = (): void => {
    if (this.disposed) return;
    if (document.visibilityState !== "visible") {
      if (this.popover?.hidden === false) {
        this.heatmapVisibilityDirty = true;
        this.heatmapGeneration += 1;
        window.clearTimeout(this.heatmapHourTimer);
        this.heatmapHourTimer = 0;
      }
      return;
    }
    if (!this.quotaDirty && !this.heatmapVisibilityDirty) return;
    this.quotaDirty = false;
    this.heatmapVisibilityDirty = false;
    void this.loadState();
  };

  private queueLoad(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      void this.loadState();
    }, this.debounceMs);
  }

  private async loadState(): Promise<void> {
    const generation = ++this.generation;
    try {
      const response = await this.send({ type: "quota/get-state" });
      if (this.disposed || generation !== this.generation) return;
      if (response?.error) throw new Error(response.error);
      if (!response?.snapshot) throw new Error("无法读取额度账本");
      this.apply(response.snapshot, "ready");
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.apply(null, "error");
    }
  }

  private apply(snapshot: QuotaSnapshot | null, status: IndicatorStatus): void {
    this.snapshot = snapshot;
    this.status = status;
    const rings = status === "error"
      ? ERROR_QUOTA_RINGS
      : snapshot
        ? snapshotToRings(snapshot)
        : UNKNOWN_QUOTA_RINGS;
    this.paint(rings);
    this.setTitle(
      status === "error"
        ? "Pro 额度暂不可用"
        : snapshot
          ? snapshotTitle(snapshot)
          : "Pro 额度：读取中"
    );
    if (this.popover && !this.popover.hidden) {
      this.disposeHeatmapRenderer();
      this.renderPopover();
      this.positionPopover();
      this.refreshHeatmap();
    }
  }

  private paint(rings: RingValues): void {
    this.rings = rings;
    this.canvas.dataset.quotaCenter = rings.center ?? "";
    this.canvas.dataset.quotaOuter = String(rings.outer);
    this.canvas.dataset.quotaMiddle = String(rings.middle);
    this.canvas.dataset.quotaInner = String(rings.inner);
    paintQuotaCanvas(
      this.canvas,
      rings,
      this.themeValue === "light" ? LIGHT_ICON_PALETTE : DARK_ICON_PALETTE
    );
  }

  private setTitle(title: string): void {
    this.button.title = title;
    this.button.setAttribute("aria-label", title);
  }

  private open(): void {
    this.ensurePopover();
    this.renderPopover();
    this.popover!.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.attachPopoverListeners();
    this.positionPopover();
    this.refreshHeatmap();
  }

  private ensurePopover(): void {
    if (this.popover) return;
    document.getElementById(QUOTA_POPOVER_HOST_ID)?.remove();
    this.portalHost = document.createElement("div");
    this.portalHost.id = QUOTA_POPOVER_HOST_ID;
    this.portalHost.dataset.yadaRoot = "true";
    this.portalHost.dataset.yadaTheme = this.themeValue;
    const portal = this.portalHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = POPOVER_CSS;
    this.popover = document.createElement("div");
    this.popover.hidden = true;
    this.popover.dataset.quotaPopover = "true";
    this.popover.setAttribute("role", "dialog");
    this.popover.setAttribute("aria-label", "Pro 模型额度");
    portal.append(style, this.popover);
    (document.body ?? document.documentElement).append(this.portalHost);
  }

  private attachPopoverListeners(): void {
    if (this.popoverListeners) return;
    this.popoverListeners = true;
    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onViewportChange, { passive: true });
    window.addEventListener("scroll", this.onViewportChange, { passive: true, capture: true });
  }

  private detachPopoverListeners(): void {
    if (!this.popoverListeners) return;
    this.popoverListeners = false;
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("scroll", this.onViewportChange, true);
  }

  private renderPopover(): void {
    if (!this.popover) return;
    this.popover.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Pro 模型额度";
    this.popover.append(heading);
    if (this.status === "error" || (this.status === "ready" && !this.snapshot)) {
      this.popover.append(note("无法读取额度账本", "quota-error"));
      return;
    }
    if (!this.snapshot) {
      this.popover.append(note("正在读取额度", "quota-note"));
      return;
    }

    const statusNote = historySyncLabel(this.snapshot);
    if (statusNote) {
      this.popover.append(note(statusNote, this.snapshot.syncStatus === "error" ? "quota-error" : "quota-note"));
    }
    if (this.snapshot.syncStatus === "error") {
      this.popover.append(note(this.snapshot.updatedLabel, "quota-note"));
      return;
    }
    const planNote = planStatusNote(this.snapshot);
    if (planNote) this.popover.append(note(planNote, "quota-warn"));
    else if (this.snapshot.syncStatus === "ready" || quotaDetailsQuiet(this.snapshot) || this.snapshot.plan) {
      if (this.snapshot.plan) {
        for (const bucket of snapshotBucketViews(this.snapshot)) {
          const section = document.createElement("section");
          section.dataset.quotaBucket = "true";
          const row = document.createElement("div");
          row.dataset.quotaRow = "true";
          const title = document.createElement("p");
          title.dataset.quotaName = "true";
          title.textContent = bucket.title;
          const meta = document.createElement("p");
          meta.dataset.quotaMeta = "true";
          meta.textContent = `${bucket.period}   ${metricPercentLabel(bucket.metric)}`;
          row.append(title, meta);
          const remaining = document.createElement("p");
          remaining.dataset.quotaRemaining = "true";
          remaining.textContent = metricRemainingLabel(bucket.metric);
          if (bucket.metric) section.dataset.quotaBucketId = bucket.metric.id;
          section.append(row, remaining);
          this.popover.append(section);
        }
      }
    }

    this.popover.append(note(this.snapshot.updatedLabel, "quota-note"));
    const workspace = workspaceStatusNote(this.snapshot);
    if (workspace) this.popover.append(note(workspace, "quota-warn"));
  }

  private refreshHeatmap(): void {
    window.clearTimeout(this.heatmapHourTimer);
    this.heatmapHourTimer = 0;
    if (!this.heatmapEligible()) {
      this.disposeHeatmapRenderer();
      return;
    }
    void this.requestHeatmap();
    this.scheduleHeatmapHourRefresh();
  }

  private async requestHeatmap(): Promise<void> {
    if (!this.popover || this.popover.hidden || !this.heatmapEligible()) return;
    const snapshot = this.snapshot!;
    const generation = ++this.heatmapGeneration;
    try {
      const response = await this.send({
        type: "quota/get-heatmap",
        accountKey: snapshot.accountKey,
        plan: snapshot.plan
      });
      if (this.disposed || generation !== this.heatmapGeneration || this.popover.hidden) return;
      const heatmap = response.heatmap;
      if (response.error || !heatmap || !heatmap.historyComplete || heatmap.accountKey !== snapshot.accountKey) return;
      this.disposeHeatmapRenderer();
      this.heatmapRenderer = new QuotaHeatmapRenderer(this.popover);
      for (const bucket of heatmap.buckets) {
        const container = [...this.popover.querySelectorAll<HTMLElement>("[data-quota-bucket-id]")]
          .find((node) => node.dataset.quotaBucketId === bucket.id);
        if (container) this.heatmapRenderer.render(bucket, container);
      }
      this.positionPopover();
    } catch {
      // The existing quota numbers remain useful if on-demand aggregation fails.
    }
  }

  private heatmapEligible(): boolean {
    return this.popover?.hidden === false
      && document.visibilityState !== "hidden"
      && this.snapshot?.historyComplete === true
      && this.snapshot.syncStatus === "ready"
      && this.snapshot.plan != null
      && this.snapshot.personalProEligible === true;
  }

  private scheduleHeatmapHourRefresh(): void {
    window.clearTimeout(this.heatmapHourTimer);
    if (!this.heatmapEligible()) {
      this.heatmapHourTimer = 0;
      return;
    }
    const now = new Date();
    const next = new Date(now.getTime());
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    this.heatmapHourTimer = window.setTimeout(() => {
      this.heatmapHourTimer = 0;
      if (!this.heatmapEligible()) return;
      void this.requestHeatmap();
      this.scheduleHeatmapHourRefresh();
    }, Math.max(1, next.getTime() - now.getTime() + 50));
  }

  private stopHeatmapLifecycle(): void {
    this.heatmapGeneration += 1;
    window.clearTimeout(this.heatmapHourTimer);
    this.heatmapHourTimer = 0;
    this.heatmapVisibilityDirty = false;
    this.disposeHeatmapRenderer();
  }

  private disposeHeatmapRenderer(): void {
    this.heatmapRenderer?.dispose();
    this.heatmapRenderer = null;
  }

  private positionPopover(): void {
    if (!this.popover) return;
    const buttonRect = this.button.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2));
    const left = clamp(
      buttonRect.right - width,
      VIEWPORT_GUTTER,
      Math.max(VIEWPORT_GUTTER, window.innerWidth - VIEWPORT_GUTTER - width)
    );
    this.popover.style.width = `${width}px`;
    this.popover.style.left = `${left}px`;
    this.popover.style.right = "auto";
    this.popover.style.top = `${VIEWPORT_GUTTER}px`;
    const rect = this.popover.getBoundingClientRect();
    const height = Math.min(rect.height, Math.max(0, window.innerHeight - VIEWPORT_GUTTER * 2));
    const below = buttonRect.bottom + 6;
    const above = buttonRect.top - height - 6;
    const top = below + height <= window.innerHeight - VIEWPORT_GUTTER
      ? below
      : above >= VIEWPORT_GUTTER
        ? above
        : VIEWPORT_GUTTER;
    this.popover.style.top = `${top}px`;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function note(text: string, kind: "quota-note" | "quota-warn" | "quota-error"): HTMLParagraphElement {
  const node = document.createElement("p");
  node.dataset[kind === "quota-note" ? "quotaNote" : kind === "quota-warn" ? "quotaWarn" : "quotaError"] = "true";
  node.textContent = text;
  return node;
}
