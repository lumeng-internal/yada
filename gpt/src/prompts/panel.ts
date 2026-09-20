/* Modal structure and card rendering adapted from GPT Conversation Toolkit
 * features/prompt-library.js. Copyright (c) 2026 bujue3709. MIT; see THIRD_PARTY_NOTICES.md.
 * Yada adapters: storage, editing, clipboard feedback and focus lifecycle.
 */
import Sortable from "sortablejs";
import styles from "./panel.css?inline";
import { writeTextToClipboard } from "../export/clipboard";
import { readLibrary, saveLibrary } from "./storage";
import type { Prompt, PromptLibrary } from "./types";
import { detectYadaTheme, observeYadaTheme } from "../ui/theme";

const svg = (body: string): string => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS: Record<string, string> = {
  grip: svg('<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  edit: svg('<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>'),
  delete: svg('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>'),
};

export const PROMPT_HOST_ID = "chatgpt-yada-prompt-host";
export class PromptPanel {
  readonly host = document.createElement("div");
  private readonly root: ShadowRoot;
  private readonly modal: HTMLElement;
  private library: PromptLibrary = { version: 2, prompts: [] };
  private copyTimers = new Map<HTMLButtonElement, number>();
  private generation = 0;
  private busy = false;
  private sortable: Sortable | null = null;
  private disposed = false;
  private editing: Prompt | null = null;
  private globalsAttached = false;
  private disposeTheme: (() => void) | null = null;

  documentListenersAttached(): boolean {
    return this.globalsAttached;
  }

  constructor(private readonly button: HTMLButtonElement) {
    document.getElementById(PROMPT_HOST_ID)?.remove();
    this.host.id = PROMPT_HOST_ID;
    this.host.dataset.yadaRoot = "true";
    this.host.hidden = true;
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = styles;
    this.modal = document.createElement("section");
    this.modal.className = "yada-prompt-modal is-visible";
    // Upstream complete modal shell; intentionally omit category and import/export.
    this.modal.innerHTML = `
      <div class="yada-prompt-backdrop" data-prompt-action="close"></div>
      <div class="yada-prompt-panel" role="dialog" aria-modal="true" aria-label="提示词收藏库">
        <div class="yada-prompt-header"><strong>提示词收藏库</strong>
          <div class="yada-prompt-header-actions"><button type="button" data-prompt-action="add">新增提示词</button>
          <button type="button" data-prompt-action="close">关闭</button></div></div>
        <div class="yada-prompt-list"></div>
        <p class="yada-prompt-empty">暂无提示词</p>
        <form class="yada-prompt-editor" hidden>
          <input name="title" placeholder="标题" aria-label="标题" required>
          <textarea name="content" rows="4" placeholder="正文" aria-label="正文" required></textarea>
          <button type="submit" class="yada-prompt-add">保存</button>
          <button type="button" class="yada-prompt-close" data-prompt-action="cancel">取消</button>
        </form>
        <p class="sr-only" role="status" aria-live="polite"></p>
        <p role="alert" hidden></p>
      </div>`;
    this.root.append(style, this.modal);
    document.body.append(this.host);
    this.modal.dataset.toolkitTheme = detectYadaTheme();
    button.addEventListener("click", this.toggle);
    this.modal.addEventListener("click", this.handleClick);
    this.query<HTMLFormElement>("form").addEventListener("submit", event => { event.preventDefault(); void this.saveEditor(); });
    // Prevent wheel/touch from chaining through the fixed modal into the page.
    this.modal.addEventListener('wheel', this.stopPageScroll, { passive: false });
    this.modal.addEventListener('touchmove', this.stopPageScroll, { passive: false });
  }
  private stopPageScroll = (event: Event): void => {
    const node = event.target instanceof Element ? event.target : null;
    const scrollable = node?.closest<HTMLElement>('.yada-prompt-list, textarea');
    if (!scrollable || scrollable.scrollHeight <= scrollable.clientHeight) { event.preventDefault(); return; }
    if (event instanceof WheelEvent && (event.deltaY < 0 && scrollable.scrollTop <= 0
      || event.deltaY > 0 && scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight)) event.preventDefault();
  };
  private query<T extends HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }
  close = (): void => {
    this.destroySortable();
    this.detachGlobals();
    this.generation++;
    for (const [button, timer] of this.copyTimers) { clearTimeout(timer); button.innerHTML = ICONS.copy; }
    this.copyTimers.clear(); this.host.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  };
  dispose(): void {
    this.disposed = true; this.close(); this.host.remove();
    this.button.removeEventListener("click", this.toggle);
  }
  toggle = async (): Promise<void> => {
    if (!this.host.hidden) { this.close(); return; }
    if (this.busy) return;
    const generation = ++this.generation;
    if (!this.host.isConnected) document.body.append(this.host);
    this.attachGlobals();
    this.host.hidden = false; this.button.setAttribute("aria-expanded", "true");
    this.query('[role="alert"]').hidden = true;
    this.query('form').hidden = true;
    try {
      const library = await readLibrary();
      if (this.disposed || generation !== this.generation) return;
      this.library = library; this.renderList();
      this.query('[data-prompt-action="add"]').focus();
    } catch { if (generation === this.generation) this.error("无法读取提示词，请重新打开重试。"); }
  };
  private attachGlobals(): void {
    if (this.globalsAttached) return;
    this.globalsAttached = true;
    this.modal.dataset.toolkitTheme = detectYadaTheme();
    this.disposeTheme = observeYadaTheme(theme => { this.modal.dataset.toolkitTheme = theme; });
    document.addEventListener("pointerdown", this.outside, true);
    document.addEventListener("keydown", this.keydown, true);
  }
  private detachGlobals(): void {
    if (!this.globalsAttached) return;
    this.globalsAttached = false;
    this.disposeTheme?.();
    this.disposeTheme = null;
    document.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("keydown", this.keydown, true);
  }
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
    if (kind === 'cancel') { this.query('form').hidden = true; this.renderList(); }
    if (kind === 'edit' && prompt) this.edit(prompt);
    if (kind === 'delete' && prompt) void this.persist({ version: 2, prompts: this.library.prompts.filter(item => item.id !== prompt.id) });
    if (kind === 'copy' && prompt) void this.copy(prompt, action as HTMLButtonElement);
  };
  private renderList(): void {
    this.destroySortable();
    const items = this.library.prompts;
    const list = this.query('.yada-prompt-list'); list.replaceChildren(); list.hidden = false;
    this.query('.yada-prompt-empty').hidden = items.length > 0;
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const article = document.createElement('article'); article.className = 'yada-prompt-item';
      article.dataset.promptId = item.id;
      const header = document.createElement('div'); header.className = 'yada-prompt-item-header';
      const title = document.createElement('h4'); title.className = 'yada-prompt-item-title'; title.textContent = item.title;
      const content = document.createElement('p'); content.className = 'yada-prompt-item-content'; content.textContent = item.content;
      const actions = document.createElement('div'); actions.className = 'yada-prompt-item-actions';
      actions.append(this.action('复制提示词', 'copy', item.id), this.action('编辑提示词', 'edit', item.id), this.action('删除提示词', 'delete', item.id));
      const grip = document.createElement('span'); grip.className = 'yada-prompt-grip';
      grip.title = '拖拽排序'; grip.setAttribute('aria-label', '拖拽排序'); grip.innerHTML = ICONS.grip;
      header.append(grip, title, actions); article.append(header, content); fragment.append(article);
    }
    list.append(fragment);
    if (this.disposed || this.host.hidden) return;
    // Official default ESM entry includes AutoScroll; no custom pointer/scroll state machine.
    this.sortable = new Sortable(list, {
      handle: '.yada-prompt-grip', draggable: '.yada-prompt-item', dataIdAttr: 'data-prompt-id',
      animation: 150, ghostClass: 'yada-prompt-ghost', chosenClass: 'yada-prompt-chosen',
      scroll: list, bubbleScroll: false,
      onEnd: () => { void this.saveOrder(); }
    });
  }
  private destroySortable(): void { this.sortable?.destroy(); this.sortable = null; }
  private async saveOrder(): Promise<void> {
    if (!this.sortable || this.busy) return;
    const ids = this.sortable.toArray();
    if (ids.every((id, index) => id === this.library.prompts[index]?.id)) return;
    const byId = new Map(this.library.prompts.map(item => [item.id, item]));
    if (ids.length !== byId.size || new Set(ids).size !== byId.size || ids.some(id => !byId.has(id))) {
      this.renderList(); return;
    }
    await this.persist({ version: 2, prompts: ids.map(id => byId.get(id)!) }, true);
  }
  private action(text: string, action: string, id: string): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'yada-prompt-icon';
    button.setAttribute('aria-label', text); button.title = text; button.innerHTML = ICONS[action];
    button.dataset.promptAction = action; button.dataset.promptId = id; return button;
  }
  private edit(prompt?: Prompt): void {
    this.destroySortable();
    this.editing = prompt ?? null; this.query('form').hidden = false;
    this.query('.yada-prompt-list').hidden = true; this.query('.yada-prompt-empty').hidden = true;
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
    await this.persist({ version: 2, prompts: previous ? this.library.prompts.map(p => p.id === previous.id ? item : p) : [item, ...this.library.prompts] });
  }
  private async persist(next: PromptLibrary, sorting = false): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.sortable?.option("disabled", true); const generation = this.generation;
    try {
      await saveLibrary(next); this.library = next;
      if (!this.disposed && generation === this.generation) { this.renderList(); this.query('form').hidden = true; }
    } catch {
      if (generation === this.generation) {
        if (sorting) this.renderList();
        this.error(sorting ? '排序保存失败，请重试' : '保存失败，内容仍保留，请重试。');
      }
    } finally { this.busy = false; this.sortable?.option("disabled", false); }
  }
  private async copy(prompt: Prompt, button: HTMLButtonElement): Promise<void> {
    const generation = this.generation;
    try {
      await writeTextToClipboard(prompt.content);
      if (this.disposed || generation !== this.generation || !button.isConnected) return;
      clearTimeout(this.copyTimers.get(button)); button.innerHTML = ICONS.check;
      this.query('[role="status"]').textContent = '提示词已复制';
      this.copyTimers.set(button, window.setTimeout(() => { button.innerHTML = ICONS.copy; this.copyTimers.delete(button); this.query('[role="status"]').textContent = ''; }, 1300));
    } catch { if (generation === this.generation) this.error('复制失败，请重试。'); }
  }
  private error(message: string): void { const alert = this.query('[role="alert"]'); alert.textContent = message; alert.hidden = false; }
}
