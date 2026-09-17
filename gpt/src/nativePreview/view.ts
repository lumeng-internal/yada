import type { YadaTurn } from "../conversation/types";
import { YADA_PREVIEW_HOST_ID } from "../styles";
import { detectYadaTheme, observeYadaTheme } from "../ui/theme";

export function formatPreviewTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export class PreviewView {
  private host: HTMLDivElement | null = null;
  private preview: HTMLDivElement | null = null;
  private turn: YadaTurn | null = null;
  private button: HTMLElement | null = null;
  private assistant = false;
  private timer = 0;
  private themeDispose: (() => void) | null = null;

  setPreviewMode(assistant: boolean): void {
    this.assistant = assistant;
    if (this.turn && this.button) this.render();
  }

  show(turn: YadaTurn, button: HTMLElement): void {
    this.ensureHost();
    const same = this.turn === turn && this.button === button && this.preview && !this.preview.hidden;
    this.turn = turn;
    this.button = button;
    if (!same) {
      window.clearTimeout(this.timer);
      if (this.preview) this.preview.dataset.expanded = "false";
      this.timer = window.setTimeout(() => {
        if (!this.preview || this.turn !== turn || this.button !== button) return;
        this.preview.dataset.expanded = "true";
        this.render();
      }, 1000);
    }
    this.render();
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.turn = null;
    this.button = null;
    if (this.preview) {
      this.preview.hidden = true;
      this.preview.dataset.expanded = "false";
    }
  }

  reposition(): void {
    if (!this.preview || this.preview.hidden || !this.button?.isConnected) return;
    const rect = this.button.getBoundingClientRect();
    const width = this.preview.getBoundingClientRect().width || Math.min(340, innerWidth - 24);
    this.preview.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left - width - 12))}px`;
    this.preview.style.maxHeight = `${innerHeight - 16}px`;
    const height = this.preview.getBoundingClientRect().height;
    this.preview.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, rect.top + rect.height / 2 - height / 2))}px`;
  }

  dispose(): void {
    this.hide();
    this.themeDispose?.();
    this.themeDispose = null;
    this.host?.remove();
    this.host = null;
    this.preview = null;
  }

  private ensureHost(): void {
    if (this.host?.isConnected && this.preview) return;
    document.getElementById(YADA_PREVIEW_HOST_ID)?.remove();
    this.host = document.createElement("div");
    this.host.id = YADA_PREVIEW_HOST_ID;
    this.host.dataset.yadaRoot = "true";
    this.host.style.cssText = "position:fixed;inset:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483400";
    this.host.setAttribute("data-yada-theme", detectYadaTheme());
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { pointer-events: none; font: 12px/1.5 system-ui; --text:#303030; --bg:#fff; color: var(--text); }
      :host([data-yada-theme="dark"]) { --text:#eee; --bg:#272727; color-scheme: dark; }
      .preview { position: fixed; box-sizing: border-box; width: min(340px, calc(100vw - 24px)); background: var(--bg); color: var(--text); border: 1px solid #8884; box-shadow: 0 5px 20px #0002; padding: 10px 12px; border-radius: 10px; pointer-events: none; overflow: hidden; }
      .preview[hidden] { display: none; }
      .preview strong { display: block; margin-bottom: 4px; font-size: 11px; }
      .preview section strong { color: #10a37f; font-weight: 700; }
      .preview-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 10px; }
      .preview-header strong { margin: 0; white-space: nowrap; }
      .preview time { white-space: nowrap; opacity: .7; }
      .preview section + section { margin-top: 8px; }
      .preview p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
      .preview[data-expanded="true"] p { -webkit-line-clamp: 5; }
    `;
    this.preview = document.createElement("div");
    this.preview.className = "preview";
    this.preview.hidden = true;
    this.preview.style.pointerEvents = "none";
    shadow.append(style, this.preview);
    document.documentElement.append(this.host);
    this.themeDispose?.();
    this.themeDispose = observeYadaTheme(theme => this.host?.setAttribute("data-yada-theme", theme));
  }

  private render(): void {
    if (!this.preview || !this.turn) return;
    const turn = this.turn;
    const title = document.createElement("strong");
    title.textContent = `第 ${turn.index + 1} 轮`;
    const heading = document.createElement("div");
    heading.className = "preview-header";
    heading.append(title);
    const timestamp = formatPreviewTime(turn.userCreatedAt);
    if (timestamp) {
      const time = document.createElement("time");
      time.textContent = timestamp;
      heading.append(time);
    }
    this.preview.replaceChildren(heading, this.block("Harson", turn.userPreview));
    if (this.assistant) this.preview.append(this.block("ChatGPT", turn.assistantPreview || "该轮暂无 ChatGPT 回复"));
    this.preview.hidden = false;
    this.reposition();
  }

  private block(role: string, text: string): HTMLElement {
    const section = document.createElement("section");
    section.dataset.previewRole = role;
    const label = document.createElement("strong");
    label.textContent = role;
    const summary = document.createElement("p");
    summary.textContent = text;
    section.append(label, summary);
    return section;
  }
}
