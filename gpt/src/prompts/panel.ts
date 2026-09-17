/* Modal structure, filtering and card rendering adapted from GPT Conversation Toolkit
 * features/prompt-library.js. Copyright (c) 2026 bujue3709. MIT; see THIRD_PARTY_NOTICES.md.
 * Yada adapters: storage, editing, composer insertion, cancellation and focus lifecycle.
 */
import styles from "./panel.css?inline";
import { captureComposerSelection, insertPromptWhenReady, type ComposerSelection } from "./composer";
import { readLibrary, saveLibrary } from "./storage";
import type { Prompt, PromptLibrary } from "./types";
import { detectYadaTheme, observeYadaTheme } from "../ui/theme";

export const PROMPT_HOST_ID = "chatgpt-yada-prompt-host";
export class PromptPanel {
  readonly host = document.createElement("div");
  private readonly root: ShadowRoot;
  private readonly modal: HTMLElement;
  private library: PromptLibrary = { version: 1, prompts: [] };
  private selection: ComposerSelection | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private busy = false;
  private disposed = false;
  private editing: Prompt | null = null;
  private readonly disposeTheme: () => void;

  constructor(private readonly button: HTMLButtonElement) {
    document.getElementById(PROMPT_HOST_ID)?.remove();
    this.host.id = PROMPT_HOST_ID;
    this.host.dataset.yadaRoot = "true";
    this.host.hidden = true;
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = styles;
    this.modal = document.createElement("section");
    this.modal.className = "yada-prompt-modal is-visible";
    // Upstream complete modal shell; intentionally omit category, sort and import/export.
    this.modal.innerHTML = `
      <div class="yada-prompt-backdrop" data-prompt-action="close"></div>
      <div class="yada-prompt-panel" role="dialog" aria-modal="true" aria-label="提示词收藏库">
        <div class="yada-prompt-header"><strong>提示词收藏库</strong>
          <button type="button" class="yada-prompt-close" data-prompt-action="close">关闭</button></div>
        <div class="yada-prompt-filters"><input type="search" placeholder="搜索提示词" aria-label="搜索提示词"></div>
        <div class="yada-prompt-list"></div>
        <p class="yada-prompt-empty">暂无提示词</p>
        <form class="yada-prompt-editor" hidden>
          <input name="title" placeholder="标题" aria-label="标题" required>
          <textarea name="content" rows="4" placeholder="正文" aria-label="正文" required></textarea>
          <button type="submit" class="yada-prompt-add">保存</button>
          <button type="button" class="yada-prompt-close" data-prompt-action="cancel">取消</button>
        </form>
        <div class="yada-prompt-footer"><span class="yada-prompt-count"></span>
          <div class="yada-prompt-footer-actions"><button type="button" data-prompt-action="add">新增提示词</button></div></div>
        <p role="alert" hidden></p>
      </div>`;
    this.root.append(style, this.modal);
    document.body.append(this.host);
    this.modal.dataset.toolkitTheme = detectYadaTheme();
    this.disposeTheme = observeYadaTheme(theme => { this.modal.dataset.toolkitTheme = theme; });
    button.addEventListener("pointerdown", this.capture);
    button.addEventListener("click", this.toggle);
    this.modal.addEventListener("click", this.handleClick);
    this.query<HTMLInputElement>('input[type="search"]').addEventListener("input", () => this.renderList());
    this.query<HTMLFormElement>("form").addEventListener("submit", event => { event.preventDefault(); void this.saveEditor(); });
    document.addEventListener("pointerdown", this.outside, true);
    document.addEventListener("keydown", this.keydown, true);
  }
  private query<T extends HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  close = (): void => {
    this.generation++;
    this.request?.abort(); this.request = null;
    this.selection = null; this.host.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  };
  dispose(): void {
    this.disposed = true; this.close(); this.disposeTheme(); this.host.remove();
    this.button.removeEventListener("pointerdown", this.capture);
    this.button.removeEventListener("click", this.toggle);
    document.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("keydown", this.keydown, true);
  }
  private capture = (): void => { if (this.host.hidden) this.selection = captureComposerSelection(); };
  private toggle = async (): Promise<void> => {
    if (!this.host.hidden) { this.close(); return; }
    this.selection ??= captureComposerSelection();
    const generation = ++this.generation;
    if (!this.host.isConnected) document.body.append(this.host);
    this.host.hidden = false; this.button.setAttribute("aria-expanded", "true");
    this.query('[role="alert"]').hidden = true;
    this.query('form').hidden = true;
    this.query<HTMLInputElement>('input[type="search"]').value = "";
    try {
      const library = await readLibrary();
      if (this.disposed || generation !== this.generation) return;
      this.library = library; this.renderList();
      this.query('input[type="search"]').focus();
    } catch { if (generation === this.generation) this.error("无法读取提示词，请重新打开重试。"); }
  };
  private outside = (event: PointerEvent): void => {
    if (!this.host.hidden && !event.composedPath().includes(this.host) && !event.composedPath().includes(this.button)) this.close();
  };
  private keydown = (event: KeyboardEvent): void => {
    if (this.host.hidden) return;
    if (event.key === "Escape") { event.stopPropagation(); this.close(); this.button.focus(); }
    if (event.key === "Tab") {
      const items = [...this.modal.querySelectorAll<HTMLElement>('button, input, textarea')].filter(e => e.getClientRects().length && !(e as HTMLButtonElement).disabled);
      const first = items[0], last = items.at(-1), active = this.root.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
    }
  };
  private handleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest<HTMLElement>('[data-prompt-action]');
    if (!action || this.host.hidden) return;
    const kind = action.dataset.promptAction;
    if (kind === 'close') { this.close(); this.button.focus(); return; }
    if (this.busy) return;
    const prompt = this.library.prompts.find(item => item.id === action.dataset.promptId);
    if (kind === 'add') this.edit();
    if (kind === 'cancel') this.query('form').hidden = true;
    if (kind === 'edit' && prompt) this.edit(prompt);
    if (kind === 'delete' && prompt) void this.persist({ version: 1, prompts: this.library.prompts.filter(item => item.id !== prompt.id) });
    if (kind === 'insert' && prompt) void this.insert(prompt);
  };
  private renderList(): void {
    const keyword = this.query<HTMLInputElement>('input[type="search"]').value.trim().toLocaleLowerCase();
    const items = this.library.prompts.filter(item => `${item.title} ${item.content}`.toLocaleLowerCase().includes(keyword)).sort((a, b) => b.updatedAt - a.updatedAt);
    const list = this.query('.yada-prompt-list'); list.replaceChildren();
    this.query('.yada-prompt-empty').hidden = items.length > 0;
    this.query('.yada-prompt-count').textContent = `${items.length} / ${this.library.prompts.length} 条提示词`;
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const article = document.createElement('article'); article.className = 'yada-prompt-item';
      article.dataset.promptId = item.id;
      const header = document.createElement('div'); header.className = 'yada-prompt-item-header';
      const insert = this.action(item.title, 'insert', item.id); insert.className = 'yada-prompt-insert';
      const title = document.createElement('h4'); title.className = 'yada-prompt-item-title'; title.textContent = item.title;
      const content = document.createElement('p'); content.className = 'yada-prompt-item-content'; content.textContent = item.content;
      insert.replaceChildren(title, content);
      const actions = document.createElement('div'); actions.className = 'yada-prompt-item-actions';
      const edit = this.action('编辑', 'edit', item.id); edit.className = 'yada-prompt-close';
      const remove = this.action('删除', 'delete', item.id); remove.className = 'yada-prompt-delete';
      actions.append(edit, remove); header.append(insert, actions); article.append(header); fragment.append(article);
    }
    list.append(fragment);
  }
  private action(text: string, action: string, id: string): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.dataset.promptAction = action; button.dataset.promptId = id; return button;
  }
  private edit(prompt?: Prompt): void {
    this.editing = prompt ?? null; this.query('form').hidden = false;
    this.query<HTMLInputElement>('[name="title"]').value = prompt?.title ?? '';
    this.query<HTMLTextAreaElement>('[name="content"]').value = prompt?.content ?? '';
    this.query('[name="title"]').focus();
  }
  private async saveEditor(): Promise<void> {
    const title = this.query<HTMLInputElement>('[name="title"]').value.trim();
    const content = this.query<HTMLTextAreaElement>('[name="content"]').value;
    if (!title || !content.trim() || this.busy) return;
    const previous = this.editing, now = Date.now();
    const item: Prompt = { id: previous?.id ?? crypto.randomUUID(), title, content, createdAt: previous?.createdAt ?? now, updatedAt: now };
    await this.persist({ version: 1, prompts: previous ? this.library.prompts.map(p => p.id === previous.id ? item : p) : [...this.library.prompts, item] });
  }
  private async persist(next: PromptLibrary): Promise<void> {
    if (this.busy) return;
    this.busy = true; const generation = this.generation;
    try {
      await saveLibrary(next); this.library = next;
      if (!this.disposed && generation === this.generation) { this.renderList(); this.query('form').hidden = true; }
    } catch { if (generation === this.generation) this.error('保存失败，内容仍保留，请重试。'); }
    finally { this.busy = false; }
  }
  private async insert(prompt: Prompt): Promise<void> {
    if (this.busy) return;
    this.busy = true; const generation = this.generation;
    const request = new AbortController(); this.request = request;
    try {
      const inserted = await insertPromptWhenReady(prompt.content, this.selection, request.signal);
      if (generation !== this.generation || this.disposed) return;
      if (inserted) this.close();
      else this.error('未找到可写输入框或编辑器拒绝写入，请重试。');
    } finally { this.busy = false; if (this.request === request) this.request = null; }
  }
  private error(message: string): void { const alert = this.query('[role="alert"]'); alert.textContent = message; alert.hidden = false; }
}
