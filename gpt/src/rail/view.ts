import type { YadaTurn } from "../conversation/types";
import { detectYadaTheme, observeYadaTheme } from "../ui/theme";
export const RAIL_HOST_ID = "chatgpt-yada-rail-host";
export class RailView {
  readonly host = document.createElement("div");
  private readonly marks = document.createElement("div");
  private readonly preview = document.createElement("div");
  private turns: readonly YadaTurn[] = [];
  private buttons: HTMLButtonElement[] = [];
  private active = -1;
  private hovered = -1;
  private assistant = false;
  private timer = 0;
  private themeDispose: () => void;
  constructor(onJump: (id: string) => void) {
    document.querySelectorAll(`[id="${RAIL_HOST_ID}"]`).forEach(node => node.remove());
    this.host.id = RAIL_HOST_ID; this.host.dataset.yadaRoot = "true";
    this.host.setAttribute("data-yada-theme", detectYadaTheme());
    const shadow = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { position: fixed; width: 58px; z-index: 2147483400; font: 12px/1.5 system-ui; --text:#303030; --bg:#fff; --bar:#aaa8; color:var(--text); }
      :host([hidden]) { display:none; }
      :host([data-yada-theme="dark"]) { --text:#eee; --bg:#272727; --bar:#aaa7; color-scheme:dark; }
      .marks { height:100%; display:flex; flex-direction:column; }
      .mark { position:relative; flex:1 1 0; min-height:0; padding:0; border:0; width:58px; background:transparent; display:flex; align-items:center; justify-content:flex-end; cursor:pointer; outline-offset:2px; }
      .mark-bar { display:block; height:1px; width:16px; border-radius:2px; background:var(--bar); transition:width .12s, background .12s; }
      .number { position:absolute; right:37px; color:var(--text); opacity:0; font:10px/1 system-ui; }
      .mark[data-active="true"] .mark-bar { width:24px; background:#10a37f; height:2px; }
      .mark[data-active="true"] .number, .mark[data-distance="0"] .number, .mark:focus-visible .number { opacity:1; }
      .mark[data-distance="3"] .mark-bar { width:19px; background:#10a37f66; }
      .mark[data-distance="2"] .mark-bar { width:23px; background:#10a37f99; }
      .mark[data-distance="1"] .mark-bar { width:28px; background:#10a37fcc; }
      .mark[data-distance="0"] .mark-bar { width:33px; background:#10a37f; height:2px; }
      .preview { position:fixed; box-sizing:border-box; width:min(340px, calc(100vw - 24px)); background:var(--bg); color:var(--text); border:1px solid #8884; box-shadow:0 5px 20px #0002; padding:10px 12px; border-radius:10px; pointer-events:none; overflow:hidden; }
      .preview[hidden] { display:none; }
      .preview strong { display:block; margin-bottom:4px; font-size:11px; opacity:.65; }
      .preview p { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
      .preview[data-expanded="true"] p { -webkit-line-clamp:5; }
      @media (prefers-reduced-motion:reduce) { .mark-bar { transition:none; } }
    `;
    this.marks.className = "marks"; this.marks.dataset.marks = "true";
    this.marks.setAttribute("role", "navigation"); this.marks.setAttribute("aria-label", "对话轮次");
    this.preview.className = "preview"; this.preview.hidden = true;
    shadow.append(style, this.marks, this.preview); document.documentElement.append(this.host);
    this.host.hidden = true;
    this.marks.addEventListener("pointermove", event => {
      const rect = this.marks.getBoundingClientRect();
      this.hover(Math.max(0, Math.min(this.turns.length - 1, Math.floor((event.clientY - rect.top) / rect.height * this.turns.length))));
    });
    this.marks.addEventListener("pointerleave", () => this.clearHover());
    this.marks.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button");
      const turn = button && this.turns[Number(button.dataset.index)];
      if (turn) onJump(turn.id);
    });
    this.marks.addEventListener("focusin", event => { const button = (event.target as HTMLElement).closest("button"); if (button) this.hover(Number(button.dataset.index)); });
    this.marks.addEventListener("focusout", () => this.clearHover());
    this.themeDispose = observeYadaTheme(theme => this.host.setAttribute("data-yada-theme", theme));
  }
  setTurns(turns: readonly YadaTurn[]): void {
    const changed = turns.length !== this.turns.length || turns.some((turn, index) => turn.id !== this.turns[index]?.id);
    this.turns = turns;
    if (!changed) return;
    this.clearHover(); this.active = -1;
    this.buttons = turns.map(turn => {
      const button = document.createElement("button"); button.type = "button"; button.className = "mark"; button.dataset.index = String(turn.index);
      button.setAttribute("aria-label", `跳到第 ${turn.index + 1} 轮`);
      const number = document.createElement("span"); number.className = "number"; number.textContent = String(turn.index + 1);
      const bar = document.createElement("span"); bar.className = "mark-bar"; button.append(number, bar); return button;
    });
    this.marks.replaceChildren(...this.buttons);
    this.host.hidden = !turns.length;
  }
  setActive(index: number): void {
    if (this.active === index) return;
    const old = this.buttons[this.active]; if (old) { delete old.dataset.active; old.removeAttribute("aria-current"); }
    this.active = index;
    const next = this.buttons[index]; if (next) { next.dataset.active = "true"; next.setAttribute("aria-current", "step"); }
  }
  setPreviewMode(assistant: boolean): void { this.assistant = assistant; if (this.hovered >= 0) this.showPreview(); }
  clearHover(): void {
    clearTimeout(this.timer); this.timer = 0;
    for (const button of this.buttons.slice(Math.max(0, this.hovered - 3), this.hovered + 4)) delete button.dataset.distance;
    this.hovered = -1; this.preview.hidden = true;
  }
  dispose(): void { this.clearHover(); this.themeDispose(); this.host.remove(); }
  private hover(index: number): void {
    if (index === this.hovered || !this.turns[index]) return;
    this.clearHover(); this.hovered = index;
    for (let n = Math.max(0, index - 3); n <= Math.min(this.buttons.length - 1, index + 3); n++) this.buttons[n].dataset.distance = String(Math.abs(n - index));
    this.preview.dataset.expanded = "false"; this.showPreview();
    this.timer = window.setTimeout(() => { this.preview.dataset.expanded = "true"; this.showPreview(); }, 1000);
  }
  private showPreview(): void {
    const turn = this.turns[this.hovered], button = this.buttons[this.hovered]; if (!turn || !button) return;
    const title = document.createElement("strong"); title.textContent = `第 ${turn.index + 1} 轮`;
    const body = document.createElement("p"); body.textContent = this.assistant ? `User: ${turn.userPreview}\nChatGPT: ${turn.assistantPreview || "[暂无回复]"}` : turn.userPreview;
    this.preview.replaceChildren(title, body); this.preview.hidden = false;
    const rect = button.getBoundingClientRect();
    const width = this.preview.getBoundingClientRect().width;
    this.preview.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left - width - 12))}px`;
    this.preview.style.maxHeight = `${innerHeight - 16}px`;
    const height = this.preview.getBoundingClientRect().height;
    this.preview.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, rect.top - height / 2))}px`;
  }
}
