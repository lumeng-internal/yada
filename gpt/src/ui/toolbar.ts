import { autoUpdate } from "@floating-ui/dom";
import type { ConversationSync } from "../core/conversationSync";
import { PromptPanel } from "../prompts/panel";
import { writeTextToClipboard } from "../export/clipboard";
import { formatTurnsAsMarkdown } from "../export/markdownFormatter";
import { getConversationIdFromUrl } from "../platform/chatgptAdapter";
import { conversationSurface, findNativeActionGroup, nativeActionObstacles } from "../platform/pageFacts";
import { YADA_ACCENT, YADA_ACCENT_SOFT, YADA_TOOLBAR_HOST_ID } from "../styles";
import { paintQuotaCanvas } from "../quota/iconRenderer";
import { QuotaIndicator, type QuotaRefreshHandler, type QuotaStateSender } from "./quotaIndicator";
import { detectYadaTheme, observeYadaTheme } from "./theme";
import {
  boxAt,
  boxFromRect,
  computeFallbackToolbarPosition,
  computeToolbarPosition,
  placementAllowed
} from "./toolbarPlacement";

type CopyState = "idle" | "pending" | "success" | "error" | "empty";

export class YadaToolbar {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private disposeTheme: (() => void) | null = null;
  private copyResetTimer = 0;
  private copyBusy = false;
  private placementObserver: MutationObserver | null = null;
  private placementTimer = 0;
  private stopAutoUpdate: (() => void) | null = null;
  private anchorSizeObserver: ResizeObserver | null = null;
  private layoutToken = 0;
  private lastLeft: number | null = null;
  private lastTop: number | null = null;
  private visibilityListening = false;

  private prompts: PromptPanel | null = null;
  private quota: QuotaIndicator | null = null;
  private observedTarget: Element | null = null;
  private observedParent: Element | null = null;
  constructor(private sync: ConversationSync | null = null) {}

  setConversationSync(sync: ConversationSync | null): void {
    this.sync = sync;
  }

  closePanels(): void {
    this.prompts?.close();
    this.quota?.close();
  }

  mount(): void {
    this.mountShell();
    try {
      this.attachQuotaIndicator();
    } catch (error) {
      console.error("ChatGPT Yada: quota indicator failed", error);
      this.showQuotaFault();
    }
  }

  mountShell(): void {
    if (this.host?.isConnected) return;
    document.getElementById(YADA_TOOLBAR_HOST_ID)?.remove();

    this.host = document.createElement("div");
    this.host.id = YADA_TOOLBAR_HOST_ID;
    this.host.dataset.yadaRoot = "true";
    this.host.dataset.layout = "pending";
    this.host.dataset.visible = "false";
    this.host.setAttribute("data-yada-theme", detectYadaTheme());
    this.shadow = this.host.attachShadow({ mode: "open" });
    document.documentElement.append(this.host);

    this.render();
    this.query<HTMLButtonElement>("[data-copy-all]")?.addEventListener("click", () => {
      void this.copyAll();
    });

    this.query<HTMLButtonElement>("[data-prompts]")?.addEventListener("click", this.onPromptsClick);

    this.disposeTheme = observeYadaTheme((theme) => {
      this.host?.setAttribute("data-yada-theme", theme);
    });
    if (!this.visibilityListening) {
      document.addEventListener("visibilitychange", this.onVisibility);
      this.visibilityListening = true;
    }
    this.ensurePlacement();
  }

  attachQuotaIndicator(options: { send?: QuotaStateSender; onRefresh?: QuotaRefreshHandler } = {}): void {
    if (this.quota) return;
    const button = this.query<HTMLButtonElement>("[data-quota]");
    if (!button) throw new Error("Quota button is missing");
    this.quota = new QuotaIndicator(button, options);
  }

  showQuotaFault(): void {
    const button = this.query<HTMLButtonElement>("[data-quota]");
    if (!button) return;
    button.setAttribute("aria-label", "Pro 额度：异常");
    button.title = "Pro 额度：异常";
    const canvas = button.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return;
    try {
      paintQuotaCanvas(canvas, { outer: 0, middle: 0, inner: 0, center: "!" });
    } catch {
      button.textContent = "!";
    }
  }

  isMounted(): boolean {
    return Boolean(this.host?.isConnected);
  }

  hasQuotaIndicator(): boolean {
    return this.quota !== null;
  }

  setVisible(visible: boolean): void {
    this.host?.setAttribute("data-visible", visible ? "true" : "false");
    if (visible) this.ensurePlacement();
    else {
      this.stopPositioning();
      this.host?.setAttribute("data-layout", "pending");
    }
  }

  ensurePlacement(): void {
    if (!this.host) return;
    if (this.host.parentElement !== document.documentElement) {
      document.documentElement.append(this.host);
    }
    if (this.host.getAttribute("data-visible") === "false" || document.visibilityState !== "visible") {
      this.stopPositioning();
      return;
    }
    const group = findNativeActionGroup();
    if (!group) {
      this.host.dataset.layout = "pending";
      this.stopPositioning();
      this.observeLayout(null);
      return;
    }
    this.observeLayout(group.container);
    this.startPositioning(group.container);
  }

  dispose(): void {
    this.quota?.dispose();
    this.quota = null;
    this.prompts?.dispose();
    window.clearTimeout(this.copyResetTimer);
    window.clearTimeout(this.placementTimer);
    this.stopPositioning();
    this.placementObserver?.disconnect();
    this.placementObserver = null;
    this.observedTarget = null;
    this.observedParent = null;
    this.disposeTheme?.();
    if (this.visibilityListening) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.visibilityListening = false;
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
  }

  private render(): void {
    if (!this.shadow) return;
    this.shadow.innerHTML = `
      <style>
        :host {
          --yada-primary: ${YADA_ACCENT};
          --yada-primary-soft: ${YADA_ACCENT_SOFT};
          --yada-text: #202123;
          --yada-muted: rgba(32, 33, 35, 0.64);
          --yada-button-bg: rgba(255, 255, 255, 0.68);
          --yada-button-border: rgba(32, 33, 35, 0.16);
          display: inline-flex;
          align-items: center;
          gap: 5px;
          position: fixed;
          left: 0;
          top: 0;
          width: max-content;
          z-index: 2147483500;
          color-scheme: light;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
        }

        :host([data-visible="false"]) {
          display: none;
        }

        :host([data-layout="pending"]) {
          visibility: hidden;
          pointer-events: none;
        }

        :host([data-yada-theme="dark"]) {
          --yada-text: #ececec;
          --yada-muted: rgba(236, 236, 236, 0.66);
          --yada-button-bg: rgba(32, 33, 35, 0.68);
          --yada-button-border: rgba(236, 236, 236, 0.16);
          color-scheme: dark;
        }

        button {
          appearance: none;
          height: 29px;
          padding: 0 10px;
          border: 1px solid var(--yada-button-border);
          border-radius: 999px;
          background: var(--yada-button-bg);
          color: var(--yada-text);
          cursor: pointer;
          font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
          white-space: nowrap;
        }

        button:hover,
        button:focus-visible {
          border-color: rgba(16, 163, 127, 0.45);
          color: var(--yada-primary);
          outline: none;
        }

        button[data-state="pending"] {
          background: rgba(32, 33, 35, 0.05);
          color: var(--yada-muted);
        }

        button[data-state="success"] {
          border-color: rgba(16, 163, 127, 0.32);
          background: var(--yada-primary-soft);
          color: var(--yada-primary);
        }

        button[data-state="error"],
        button[data-state="empty"] {
          border-color: rgba(209, 67, 67, 0.28);
          background: rgba(209, 67, 67, 0.1);
          color: #d14343;
        }

        button:disabled {
          cursor: default;
          opacity: 0.66;
        }
        button[data-quota] {
          padding: 0;
          width: 20px;
          height: 20px;
          border: 0;
          background: transparent;
          border-radius: 50%;
          flex-shrink: 0;
          line-height: 0;
        }
        button[data-quota] canvas {
          display: block;
          width: 20px;
          height: 20px;
        }
      </style>
      <button type="button" data-quota aria-haspopup="dialog" aria-expanded="false" aria-label="Pro 额度：读取中" title="Pro 额度：读取中"><canvas width="32" height="32" aria-hidden="true"></canvas></button>
      <button type="button" data-copy-all data-state="idle">复制全部</button>
      <button type="button" data-prompts aria-expanded="false">提示词</button>
    `;
  }

  private async copyAll(): Promise<void> {
    if (this.copyBusy) return;
    this.copyBusy = true;
    this.setCopyState("pending", "复制中...", 0);

    try {
      const id = getConversationIdFromUrl();
      if (id && this.sync && this.sync.getActiveConversationId() !== id) this.sync.setActiveConversation(id);
      let snapshot = this.sync?.getSnapshot() ?? null;
      if (this.sync) {
        await this.sync.requestFull("copy");
        snapshot = this.sync.getSnapshot();
      }
      if (!snapshot) throw new Error("No conversation snapshot");
      const turns = snapshot.activeTurns;
      const markdown = formatTurnsAsMarkdown(turns);
      if (!markdown) {
        this.setCopyState("empty", "没有可复制内容");
        return;
      }

      await writeTextToClipboard(markdown);
      this.setCopyState("success", `已复制 ${turns.length} 轮`);
    } catch (error) {
      console.error("ChatGPT Yada: copy all failed", error);
      this.setCopyState("error", "复制失败");
    } finally {
      this.copyBusy = false;
      const button = this.query<HTMLButtonElement>("[data-copy-all]");
      if (button?.dataset.state !== "pending") button?.removeAttribute("disabled");
    }
  }

  private setCopyState(state: CopyState, label = "复制全部", resetAfterMs = 1800): void {
    window.clearTimeout(this.copyResetTimer);
    const button = this.query<HTMLButtonElement>("[data-copy-all]");
    if (!button) return;

    button.dataset.state = state;
    button.textContent = label;
    button.disabled = state === "pending";

    if (resetAfterMs > 0 && state !== "idle") {
      this.copyResetTimer = window.setTimeout(() => {
        if (!button.isConnected) return;
        button.dataset.state = "idle";
        button.textContent = "复制全部";
        button.disabled = false;
      }, resetAfterMs);
    }
  }

  private readonly onPromptsClick = (): void => {
    const button = this.query<HTMLButtonElement>("[data-prompts]");
    if (!button) return;
    if (!this.prompts) {
      try {
        this.prompts = new PromptPanel(button);
      } catch (error) {
        console.error("ChatGPT Yada: prompt panel failed", error);
        return;
      }
      void this.prompts.toggle();
    }
  };

  private observeLayout(target: HTMLElement | null): void {
    const parent = target?.parentElement ?? document.body;
    if (target === this.observedTarget && parent === this.observedParent) return;
    this.placementObserver?.disconnect();
    this.placementObserver = null;
    this.observedTarget = target;
    this.observedParent = parent;
    this.placementObserver = new MutationObserver(() => this.schedulePlacement());
    if (target) {
      this.placementObserver.observe(target, { childList: true, subtree: true });
      this.placementObserver.observe(parent, { childList: true });
      return;
    }
    this.placementObserver.observe(document.body, { childList: true });
  }

  private startPositioning(reference: HTMLElement): void {
    if (!this.host) return;
    this.stopPositioning();
    const token = ++this.layoutToken;
    const host = this.host;
    const update = (): void => {
      void this.applyPosition(token, reference, host);
    };
    const attachAutoUpdate = (): void => {
      if (this.layoutToken !== token || this.host !== host) return;
      this.stopAutoUpdate?.();
      this.stopAutoUpdate = autoUpdate(reference, host, update, { animationFrame: false, layoutShift: false });
    };
    const rect = reference.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      attachAutoUpdate();
      return;
    }
    update();
    if (typeof ResizeObserver === "undefined") return;
    this.anchorSizeObserver = new ResizeObserver(() => {
      const next = reference.getBoundingClientRect();
      if (next.width <= 0 || next.height <= 0) return;
      this.anchorSizeObserver?.disconnect();
      this.anchorSizeObserver = null;
      attachAutoUpdate();
    });
    this.anchorSizeObserver.observe(reference);
  }

  private stopPositioning(): void {
    this.layoutToken += 1;
    this.stopAutoUpdate?.();
    this.stopAutoUpdate = null;
    this.anchorSizeObserver?.disconnect();
    this.anchorSizeObserver = null;
    this.lastLeft = null;
    this.lastTop = null;
  }

  private async applyPosition(token: number, reference: HTMLElement, host: HTMLDivElement): Promise<void> {
    if (token !== this.layoutToken || !reference.isConnected || host !== this.host) return;
    const group = findNativeActionGroup();
    if (!group || group.container !== reference) {
      this.schedulePlacement();
      return;
    }
    const candidates = [
      await computeToolbarPosition(reference, host),
      await computeFallbackToolbarPosition(reference, host)
    ];
    if (token !== this.layoutToken) return;
    const width = host.offsetWidth;
    const height = host.offsetHeight;
    const obstacles = [
      ...nativeActionObstacles(group).map((element) => ({ rect: boxFromRect(element.getBoundingClientRect()), kind: "native-action" as const })),
      ...contentObstacles()
    ];
    const viewport = { width: innerWidth, height: innerHeight };
    const chosen = candidates.find((candidate) => {
      if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return false;
      return placementAllowed(boxAt(candidate.x, candidate.y, width, height), obstacles, viewport);
    });
    if (!chosen) {
      host.dataset.layout = "pending";
      return;
    }
    if (this.lastLeft === chosen.x && this.lastTop === chosen.y) {
      host.dataset.layout = "ready";
      return;
    }
    this.lastLeft = chosen.x;
    this.lastTop = chosen.y;
    host.style.left = `${chosen.x}px`;
    host.style.top = `${chosen.y}px`;
    host.dataset.layout = "ready";
  }

  private schedulePlacement(): void {
    window.clearTimeout(this.placementTimer);
    this.placementTimer = window.setTimeout(() => this.ensurePlacement(), 180);
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState !== "visible") {
      this.stopPositioning();
      return;
    }
    this.ensurePlacement();
  };

  private query<T extends Element>(selector: string): T | null {
    return this.shadow?.querySelector<T>(selector) ?? null;
  }
}

function contentObstacles(): Array<{ rect: ReturnType<typeof boxFromRect>; kind: "content" }> {
  const surface = conversationSurface();
  const first = surface?.querySelector<HTMLElement>("article, [data-message-id], [data-turn]");
  if (!first) return [];
  const rect = first.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];
  return [{ rect: boxFromRect(rect), kind: "content" }];
}
