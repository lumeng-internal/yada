import { PromptPanel } from "../prompts/panel";
import { PREVIEW_KEY } from "../prompts/storage";
import { loadCurrentConversationSnapshot } from "../conversation/normalizeConversation";
import { writeTextToClipboard } from "../export/clipboard";
import { formatTurnsAsMarkdown } from "../export/markdownFormatter";
import { YADA_ACCENT, YADA_ACCENT_SOFT, YADA_TOOLBAR_HOST_ID } from "../styles";
import { detectYadaTheme, observeYadaTheme } from "./theme";

type CopyState = "idle" | "pending" | "success" | "error" | "empty";

export class YadaToolbar {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private disposeTheme: (() => void) | null = null;
  private copyResetTimer = 0;
  private copyBusy = false;
  private placementObserver: MutationObserver | null = null;
  private placementTimer = 0;

  private prompts: PromptPanel | null = null;
  private previewAssistant = false;
  private statusHideTimer = 0;
  constructor(private readonly onPreviewMode: (assistant: boolean) => void = () => {}) {}

  closePanels(): void { this.prompts?.close(); }

  mount(): void {
    if (this.host?.isConnected) return;
    document.getElementById(YADA_TOOLBAR_HOST_ID)?.remove();

    this.host = document.createElement("div");
    this.host.id = YADA_TOOLBAR_HOST_ID;
    this.host.dataset.yadaRoot = "true";
    this.host.dataset.placement = "fixed";
    this.host.dataset.visible = "false";
    this.host.setAttribute("data-yada-theme", detectYadaTheme());
    this.shadow = this.host.attachShadow({ mode: "open" });
    document.documentElement.append(this.host);

    this.render();
    this.query<HTMLButtonElement>("[data-copy-all]")?.addEventListener("click", () => {
      void this.copyAll();
    });

    this.prompts = new PromptPanel( this.query<HTMLButtonElement>("[data-prompts]")!);
    const mode = this.query<HTMLButtonElement>("[data-preview-mode]")!;
    const applyMode = (): void => {
      mode.setAttribute("aria-pressed", String(this.previewAssistant));
      mode.title = this.previewAssistant ? "预览：User + ChatGPT" : "预览：User";
      mode.setAttribute("aria-label", mode.title);
      this.onPreviewMode(this.previewAssistant);
    };
    let modeTouched = false;
    void chrome.storage.local.get(PREVIEW_KEY).then(data => {
      if (!this.host || modeTouched) return;
      this.previewAssistant = data[PREVIEW_KEY] === true; applyMode();
    }).catch(() => applyMode());
    mode.addEventListener("click", () => {
      modeTouched = true;
      this.previewAssistant = !this.previewAssistant; applyMode();
      void chrome.storage.local.set({ [PREVIEW_KEY]: this.previewAssistant }).catch(() => { mode.title = "预览模式保存失败，下次打开将恢复旧设置"; });
    });

    this.disposeTheme = observeYadaTheme((theme) => {
      this.host?.setAttribute("data-yada-theme", theme);
    });

    this.placementObserver = new MutationObserver(() => this.schedulePlacement());
    this.placementObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", this.handleViewportChange, { passive: true });
    this.ensurePlacement();
  }

  setVisible(visible: boolean): void {
    this.host?.setAttribute("data-visible", visible ? "true" : "false");
  }

  ensurePlacement(): void {
    if (!this.host) return;
    const target = findHeaderActions();
    if (target) {
      if (this.host.parentElement !== target) {
        target.insertBefore(this.host, target.firstElementChild);
      }
      this.host.dataset.placement = "inline";
      return;
    }

    if (this.host.parentElement !== document.documentElement) {
      document.documentElement.append(this.host);
    }
    this.host.dataset.placement = "fixed";
  }

  dispose(): void {
    this.prompts?.dispose();
    window.clearTimeout(this.copyResetTimer);
    window.clearTimeout(this.placementTimer);
    window.clearTimeout(this.statusHideTimer);
    this.placementObserver?.disconnect();
    this.disposeTheme?.();
    window.removeEventListener("resize", this.handleViewportChange);
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
          position: relative;
          z-index: 2147483500;
          color-scheme: light;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
        }

        :host([data-visible="false"]) {
          display: none;
        }

        :host([data-placement="fixed"]) {
          position: fixed;
          top: 16px;
          right: 88px;
        }

        :host([data-placement="inline"]) {
          margin-right: 2px;
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
        [data-preview-mode] { padding: 0; width: 20px; height: 20px; font-size: 16px; color: var(--yada-muted); border: 0; background: transparent; }
        [data-preview-mode][aria-pressed="true"] { color: var(--yada-primary); }
        [data-nav-status] {
          max-width: 9.5em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font: 500 11px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: var(--yada-muted);
        }
      </style>
      <button type="button" data-preview-mode aria-pressed="false" aria-label="预览：User" title="预览：User">●</button>
      <span data-nav-status hidden></span>
      <button type="button" data-copy-all data-state="idle">复制全部</button>
      <button type="button" data-prompts aria-expanded="false">提示词</button>
    `;
  }

  setNavStatus(status: { kind: "hidden" | "preparing" | "ready" | "incomplete"; current?: number; total?: number; reason?: string; title?: string }): void {
    const node = this.query<HTMLElement>("[data-nav-status]");
    if (!node) return;
    window.clearTimeout(this.statusHideTimer);
    this.statusHideTimer = 0;
    if (status.kind === "hidden") {
      node.hidden = true;
      node.textContent = "";
      node.removeAttribute("title");
      return;
    }
    if (status.kind === "preparing") {
      const current = status.current ?? 0;
      const total = status.total ?? current;
      node.hidden = false;
      node.textContent = `导航准备中 ${current}/${total}`;
      node.title = node.textContent;
      return;
    }
    if (status.kind === "ready") {
      node.hidden = false;
      node.textContent = "导航已就绪";
      node.title = "导航已就绪";
      this.statusHideTimer = window.setTimeout(() => {
        if (!node.isConnected) return;
        node.hidden = true;
        node.textContent = "";
        node.removeAttribute("title");
      }, 1500);
      return;
    }
    node.hidden = false;
    node.textContent = "导航未完整";
    node.title = status.title ?? status.reason ?? "导航未完整";
  }

  private async copyAll(): Promise<void> {
    if (this.copyBusy) return;
    this.copyBusy = true;
    this.setCopyState("pending", "复制中...", 0);

    try {
      const snapshot = await loadCurrentConversationSnapshot();
      const markdown = formatTurnsAsMarkdown(snapshot.turns);
      if (!markdown) {
        this.setCopyState("empty", "没有可复制内容");
        return;
      }

      await writeTextToClipboard(markdown);
      this.setCopyState("success", `已复制 ${snapshot.turns.length} 轮`);
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

  private schedulePlacement(): void {
    window.clearTimeout(this.placementTimer);
    this.placementTimer = window.setTimeout(() => this.ensurePlacement(), 180);
  }

  private readonly handleViewportChange = (): void => {
    this.ensurePlacement();
  };

  private query<T extends Element>(selector: string): T | null {
    return this.shadow?.querySelector<T>(selector) ?? null;
  }
}

function findHeaderActions(): HTMLElement | null {
  const direct = document.querySelector<HTMLElement>("#page-header #conversation-header-actions");
  if (direct) return direct;

  const candidates = [
    "#conversation-header-actions",
    '[data-testid="conversation-header-actions"]',
    'header [aria-label*="Share" i]',
    'header [data-testid*="share" i]',
    'main ~ div header button'
  ];

  for (const selector of candidates) {
    const element = document.querySelector<HTMLElement>(selector);
    const parent = element?.parentElement;
    if (parent && isUsableHeaderTarget(parent)) return parent;
  }

  const header = document.querySelector<HTMLElement>("header");
  const button = header?.querySelector<HTMLElement>('button, [role="button"]');
  return button?.parentElement && isUsableHeaderTarget(button.parentElement) ? button.parentElement : null;
}

function isUsableHeaderTarget(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.top < 120 && rect.right > window.innerWidth * 0.45;
}
