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
  snapshotBucketViews,
  workspaceStatusNote
} from "../quota/presentation";
import { LEDGER_KEY, STATE_KEY, type QuotaSnapshot } from "../quota/types";
import { sendRuntimeMessage } from "../shared/messages";

export const QUOTA_INDICATOR_DEBOUNCE_MS = 80;
export const UNKNOWN_QUOTA_RINGS: RingValues = { outer: 0, middle: 0, inner: 0, center: "?" };

export type QuotaStateResponse = {
  snapshot?: QuotaSnapshot;
  error?: string;
};

export type QuotaStateSender = (
  message: unknown,
  timeoutMs?: number
) => Promise<QuotaStateResponse>;

type IndicatorStatus = "loading" | "ready" | "error";

const POPOVER_CSS = `
  [data-quota-popover] {
    position: absolute;
    z-index: 30;
    box-sizing: border-box;
    width: 260px;
    max-width: calc(100vw - 16px);
    padding: 12px;
    border: 1px solid var(--yada-button-border);
    border-radius: 12px;
    background: #fff;
    color: var(--yada-text);
    box-shadow: 0 10px 28px rgba(15, 15, 15, 0.12);
    font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: left;
    white-space: normal;
  }
  :host([data-yada-theme="dark"]) [data-quota-popover] {
    background: #2a2a2a;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  }
  [data-quota-popover] h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
  }
  [data-quota-popover] h3 {
    margin: 10px 0 2px;
    font-size: 12px;
    font-weight: 700;
  }
  [data-quota-popover] p {
    margin: 0;
  }
  [data-quota-popover] [data-quota-note],
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] {
    margin-top: 8px;
    font-size: 11px;
    color: var(--yada-muted);
  }
  [data-quota-popover] [data-quota-warn],
  [data-quota-popover] [data-quota-error] {
    color: var(--yada-text);
  }
`;

export class QuotaIndicator {
  private readonly send: QuotaStateSender;
  private readonly debounceMs: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly popover: HTMLDivElement;
  private readonly styleEl: HTMLStyleElement;
  private readonly themeObserver: MutationObserver;
  private disposed = false;
  private generation = 0;
  private refreshTimer = 0;
  private status: IndicatorStatus = "loading";
  private snapshot: QuotaSnapshot | null = null;
  private rings: RingValues = UNKNOWN_QUOTA_RINGS;

  constructor(
    private readonly button: HTMLButtonElement,
    options: { send?: QuotaStateSender; debounceMs?: number } = {}
  ) {
    this.send = options.send ?? ((message, timeoutMs) => sendRuntimeMessage<QuotaStateResponse>(message, timeoutMs));
    this.debounceMs = options.debounceMs ?? QUOTA_INDICATOR_DEBOUNCE_MS;
    this.canvas = button.querySelector("canvas") ?? button.appendChild(document.createElement("canvas"));
    this.canvas.setAttribute("aria-hidden", "true");
    const root = this.root();
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = POPOVER_CSS;
    this.popover = document.createElement("div");
    this.popover.hidden = true;
    this.popover.dataset.quotaPopover = "true";
    this.popover.setAttribute("role", "dialog");
    this.popover.setAttribute("aria-label", "Pro 模型额度");
    root.append(this.styleEl, this.popover);
    this.themeObserver = new MutationObserver(() => this.paint(this.rings));
    const host = this.host();
    if (host) this.themeObserver.observe(host, { attributes: true, attributeFilter: ["data-yada-theme"] });
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.addEventListener("click", this.onClick);
    document.addEventListener("pointerdown", this.onPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    chrome.storage?.onChanged?.addListener(this.onStorageChanged);
    this.apply(null, "loading");
    void this.loadState();
  }

  close = (): void => {
    this.popover.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.generation += 1;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = 0;
    this.themeObserver.disconnect();
    this.button.removeEventListener("click", this.onClick);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    chrome.storage?.onChanged?.removeListener(this.onStorageChanged);
    this.popover.remove();
    this.styleEl.remove();
  }

  private readonly onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.popover.hidden) this.open();
    else this.close();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.popover.hidden) return;
    const path = event.composedPath();
    if (path.includes(this.button) || path.includes(this.popover)) return;
    this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.popover.hidden || event.key !== "Escape") return;
    event.stopPropagation();
    this.close();
    this.button.focus();
  };

  private readonly onStorageChanged = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string
  ): void => {
    if (this.disposed || area !== "local") return;
    if (!changes[LEDGER_KEY] && !changes[STATE_KEY]) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      void this.loadState();
    }, this.debounceMs);
  };

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
    const rings = snapshot ? snapshotToRings(snapshot) : UNKNOWN_QUOTA_RINGS;
    this.paint(rings);
    this.setTitle(
      status === "error"
        ? "Pro 额度暂不可用"
        : snapshot
          ? snapshotTitle(snapshot)
          : "Pro 额度：读取中"
    );
    if (!this.popover.hidden) {
      this.renderPopover();
      this.positionPopover();
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
      this.theme() === "light" ? LIGHT_ICON_PALETTE : DARK_ICON_PALETTE
    );
  }

  private setTitle(title: string): void {
    this.button.title = title;
    this.button.setAttribute("aria-label", title);
  }

  private open(): void {
    this.renderPopover();
    this.popover.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.positionPopover();
  }

  private renderPopover(): void {
    this.popover.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Pro 模型额度";
    this.popover.append(heading);
    if (this.status === "error" || (this.status === "ready" && !this.snapshot)) {
      this.popover.append(note("无法读取额度账本", "quota-error"));
      return;
    }
    if (!this.snapshot) return;

    const planNote = planStatusNote(this.snapshot);
    if (planNote) this.popover.append(note(planNote, "quota-warn"));
    else {
      for (const bucket of snapshotBucketViews(this.snapshot)) {
        const section = document.createElement("section");
        const title = document.createElement("h3");
        title.textContent = bucket.title;
        const remaining = document.createElement("p");
        remaining.textContent = metricRemainingLabel(bucket.metric);
        const percent = document.createElement("p");
        percent.textContent = metricPercentLabel(bucket.metric);
        section.append(title, remaining, percent);
        this.popover.append(section);
      }
    }

    this.popover.append(note("预计剩余", "quota-note"));
    this.popover.append(note(historySyncLabel(this.snapshot), "quota-note"));
    this.popover.append(note("只统计个人 Chat，不统计 Work 和 Codex", "quota-note"));
    this.popover.append(note(this.snapshot.updatedLabel, "quota-note"));
    const workspace = workspaceStatusNote(this.snapshot);
    if (workspace) this.popover.append(note(workspace, "quota-warn"));
  }

  private positionPopover(): void {
    const host = this.host();
    const width = 260;
    if (!host) {
      this.popover.style.width = `${width}px`;
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const buttonRect = this.button.getBoundingClientRect();
    const minLeft = 8 - hostRect.left;
    const maxLeft = window.innerWidth - 8 - width - hostRect.left;
    const preferred = buttonRect.right - hostRect.left - width;
    const left = Math.min(Math.max(preferred, minLeft), Math.max(minLeft, maxLeft));
    this.popover.style.width = `${width}px`;
    this.popover.style.left = `${left}px`;
    this.popover.style.right = "auto";
    this.popover.style.top = `${buttonRect.bottom - hostRect.top + 6}px`;
  }

  private theme(): "light" | "dark" {
    return this.host()?.getAttribute("data-yada-theme") === "dark" ? "dark" : "light";
  }

  private host(): HTMLElement | null {
    const root = this.button.getRootNode();
    return root instanceof ShadowRoot ? (root.host as HTMLElement) : this.button.parentElement;
  }

  private root(): ShadowRoot | Document {
    const root = this.button.getRootNode();
    return root instanceof ShadowRoot ? root : document;
  }
}

function note(text: string, kind: "quota-note" | "quota-warn" | "quota-error"): HTMLParagraphElement {
  const node = document.createElement("p");
  node.dataset[kind === "quota-note" ? "quotaNote" : kind === "quota-warn" ? "quotaWarn" : "quotaError"] = "true";
  node.textContent = text;
  return node;
}
