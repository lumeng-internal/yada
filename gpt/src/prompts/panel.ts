import { captureComposerSelection, insertPrompt, type ComposerSelection } from "./composer";
import { readLibrary, saveLibrary } from "./storage";
import type { Prompt, PromptLibrary } from "./types";

export class PromptPanel {
  private readonly panel = document.createElement("section");
  private library: PromptLibrary = { version: 1, prompts: [] };
  private selection: ComposerSelection | null = null;
  private generation = 0;
  private busy = false;
  private disposed = false;
  constructor(root: ShadowRoot, private readonly button: HTMLButtonElement) {
    this.panel.className = "prompt-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "提示词收藏库");
    root.append(this.panel);
    button.addEventListener("pointerdown", this.capture);
    button.addEventListener("click", this.toggle);
    document.addEventListener("pointerdown", this.outside, true);
    document.addEventListener("keydown", this.keydown, true);
    window.addEventListener("resize", this.position);
  }
  close = (): void => {
    this.generation++;
    this.selection = null;
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  };
  dispose(): void {
    this.disposed = true;
    this.close(); this.panel.remove();
    this.button.removeEventListener("pointerdown", this.capture);
    this.button.removeEventListener("click", this.toggle);
    document.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("keydown", this.keydown, true);
    window.removeEventListener("resize", this.position);
  }
  private capture = (): void => { this.selection = captureComposerSelection(); };
  private toggle = async (): Promise<void> => {
    if (!this.panel.hidden) { this.close(); return; }
    this.selection ??= captureComposerSelection();
    const generation = ++this.generation;
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.panel.textContent = "加载中…";
    this.position();
    try {
      const library = await readLibrary();
      if (generation !== this.generation) return;
      this.library = library; this.list();
    } catch { if (generation === this.generation) this.panel.textContent = "无法读取提示词，请重新打开重试。"; }
  };
  private outside = (event: PointerEvent): void => {
    const path = event.composedPath();
    if (!path.includes(this.panel) && !path.includes(this.button)) this.close();
  };
  private keydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !this.panel.hidden) { event.stopPropagation(); this.close(); this.button.focus(); }
  };
  private position = (): void => {
    const rect = this.button.getBoundingClientRect();
    this.panel.style.left = `${Math.max(8, Math.min(rect.right - 330, innerWidth - Math.min(330, innerWidth - 16) - 8))}px`;
    this.panel.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - 100))}px`;
    this.panel.style.maxHeight = `${Math.max(80, innerHeight - rect.bottom - 24)}px`;
  };
  private action(label: string, fn: () => void): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button";
    button.textContent = label; button.addEventListener("click", fn); return button;
  }
  private list(): void {
    this.panel.replaceChildren();
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "搜索提示词"; search.setAttribute("aria-label", "搜索提示词");
    const rows = document.createElement("div"); rows.className = "prompt-list";
    const renderRows = (): void => {
      rows.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      for (const prompt of this.library.prompts.filter(p => `${p.title}\n${p.content}`.toLocaleLowerCase().includes(query))) {
        const row = document.createElement("div"); row.className = "prompt-row";
        const insert = this.action(prompt.title, () => {
          if (insertPrompt(prompt.content, this.selection)) { this.close(); this.selection = null; }
          else this.error("未找到可写输入框或编辑器拒绝写入，请重试。");
        });
        insert.className = "prompt-insert";
        const summary = document.createElement("small"); summary.textContent = prompt.content; insert.append(summary);
        row.append(insert, this.action("编辑", () => this.edit(prompt)), this.action("删除", () => {
          void this.persist({ version: 1, prompts: this.library.prompts.filter(p => p.id !== prompt.id) });
        })); rows.append(row);
      }
      if (!rows.childElementCount) rows.textContent = "暂无提示词";
    };
    search.addEventListener("input", renderRows); renderRows();
    this.panel.append(search, rows, this.action("新增提示词", () => this.edit())); search.focus();
  }
  private edit(prompt?: Prompt): void {
    const form = document.createElement("form");
    const title = document.createElement("input"); title.placeholder = "标题"; title.setAttribute("aria-label", "标题"); title.required = true; title.value = prompt?.title ?? "";
    const content = document.createElement("textarea"); content.placeholder = "正文"; content.setAttribute("aria-label", "正文"); content.required = true; content.rows = 7; content.value = prompt?.content ?? "";
    const save = this.action("保存", () => {}); save.type = "submit";
    form.append(title, content, save, this.action("取消", () => this.list()));
    form.addEventListener("submit", event => {
      event.preventDefault(); if (!title.value.trim() || !content.value.trim()) return;
      const now = Date.now();
      const updated: Prompt = { id: prompt?.id ?? crypto.randomUUID(), title: title.value.trim(), content: content.value, createdAt: prompt?.createdAt ?? now, updatedAt: now };
      const prompts = prompt ? this.library.prompts.map(p => p.id === prompt.id ? updated : p) : [...this.library.prompts, updated];
      void this.persist({ version: 1, prompts });
    });
    this.panel.replaceChildren(form); title.focus();
  }
  private async persist(next: PromptLibrary): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const generation = this.generation;
    const buttons = this.panel.querySelectorAll<HTMLButtonElement>("button"); buttons.forEach(b => { b.disabled = true; });
    try { await saveLibrary(next); this.library = next; if (!this.disposed && generation === this.generation) this.list(); }
    catch { if (!this.disposed && generation === this.generation) this.error("保存失败，内容仍保留，请重试。"); }
    finally { this.busy = false; buttons.forEach(b => { b.disabled = false; }); }
  }
  private error(message: string): void {
    this.panel.querySelector('[role="alert"]')?.remove();
    const error = document.createElement("p"); error.setAttribute("role", "alert"); error.textContent = message; this.panel.append(error);
  }
}
