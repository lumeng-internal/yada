import { normalizeConversation } from '../src/conversation/normalizeConversation';
import type { ApiConversation, ApiConversationMessage } from '../src/conversation/fetchConversation';
import { fetchCompleteConversation } from '../src/conversation/completeConversation';
import { NativePreviewController } from '../src/nativePreview/controller';
import { closestOfficialButton, isOfficialNavItem, resolveOfficialTurnIndex } from '../src/nativePreview/map';
import { PreviewView, formatPreviewTime } from '../src/nativePreview/view';
import { nativeBootstrapChecks } from './verify-bootstrap';
import { readLibrary, saveLibrary, PROMPT_KEY, PREVIEW_KEY } from '../src/prompts/storage';
import { YadaToolbar } from '../src/ui/toolbar';
import { YADA_PREVIEW_HOST_ID } from '../src/styles';
import type { YadaTurn } from '../src/conversation/types';

const savedChecks = JSON.parse(sessionStorage.getItem('yada-reload-checks') || '[]') as string[];
const result = { done: false, checks: savedChecks, error: '' };
Object.assign(globalThis, { yadaVerification: result });
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const pass = (message: string): void => { result.checks.push(message); };
const wait = (ms = 80): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
async function until(fn: () => boolean, message: string, rounds = 90): Promise<void> {
  for (let i = 0; i < rounds; i++) { if (fn()) return; await wait(); }
  throw new Error(message);
}

function el(tag: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

const css = el('style');
css.textContent = `body{margin:0;font:14px/1.4 system-ui}header{position:fixed;top:0;left:0;right:0;height:96px;z-index:20;background:white}#conversation-header-actions{float:right}#draft{position:fixed;bottom:10px}`;
document.head.append(css);
const header = el('header'); header.id = 'page-header';
const actions = el('div'); actions.id = 'conversation-header-actions'; header.append(actions);
const draft = el('textarea') as HTMLTextAreaElement; draft.id = 'draft'; draft.value = 'Existing unsent draft';
document.body.append(header, draft);

function makeApi(count: number, id = 'fixture-1'): ApiConversation {
  const api: ApiConversation = { id, current_node: `a${count - 1}`, mapping: { root: { id: 'root', parent: '', message: null } } };
  for (let i = 0; i < count; i++) {
    api.mapping![`u${i}`] = {
      id: `u${i}`,
      parent: i ? `a${i - 1}` : 'root',
      message: { id: `u${i}`, author: { role: 'user' }, content: { content_type: 'text', parts: ['identical user question'] }, create_time: 1700000000 + i }
    };
    api.mapping![`a${i}`] = {
      id: `a${i}`,
      parent: `u${i}`,
      message: { id: `a${i}`, author: { role: 'assistant' }, channel: 'final', content: { content_type: 'text', parts: [`Assistant ${i} answer`] }, create_time: 1700000001 + i }
    };
  }
  return api;
}

const api = makeApi(18);
const turns = normalizeConversation(api);
const storage = {
  async get(key: string) { const value = localStorage.getItem(key); return { [key]: value === null ? undefined : JSON.parse(value) }; },
  async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); }
};
Object.assign(globalThis, { chrome: { storage: { local: storage } } });
const originalFetch = window.fetch;
const originalObserver = window.IntersectionObserver;
const normalFetch = async (): Promise<Response> => new Response(JSON.stringify(api));
Object.assign(globalThis, { fetch: normalFetch });

let controller: NativePreviewController | null = null;
let toolbar: YadaToolbar | null = null;
let reloading = false;
const promptHost = (): HTMLElement => document.getElementById('chatgpt-yada-prompt-host')!;
const modal = (): ShadowRoot => promptHost().shadowRoot!;
const promptButton = (): HTMLButtonElement => document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector('[data-prompts]')!;
const clickAction = (action: string): void => {
  const button = modal().querySelector<HTMLButtonElement>(`[data-prompt-action="${action}"]`);
  assert(button, `missing ${action}`);
  button!.click();
};
async function openPanel(): Promise<void> {
  promptButton().click();
  await until(() => !promptHost().hidden && modal().activeElement?.getAttribute('data-prompt-action') === 'add', 'prompt panel did not load');
}

function officialNavFixture(count: number, onClick?: (index: number) => void, attrs?: (index: number) => Record<string, string>): HTMLElement {
  const nav = el('div');
  nav.style.cssText = 'position:fixed;right:16px;top:120px;width:35px;height:500px;overflow:auto';
  for (let i = 0; i < count; i++) appendOfficialButton(nav, i, onClick, attrs?.(i));
  return nav;
}

function appendOfficialButton(nav: HTMLElement, index: number, onClick?: (index: number) => void, attrs?: Record<string, string>): HTMLButtonElement {
  const button = document.createElement('button');
  const extra = attrs ?? { 'data-toc-item-index': String(index) };
  for (const [key, value] of Object.entries(extra)) button.setAttribute(key, value);
  button.textContent = '—';
  button.style.cssText = 'display:block;width:30px;height:8px;padding:0;border:0;margin:2px 0';
  if (onClick) button.addEventListener('click', () => onClick(index));
  nav.append(button);
  return button;
}

function previewRoot(): ShadowRoot | null {
  return document.getElementById(YADA_PREVIEW_HOST_ID)?.shadowRoot ?? null;
}
function previewBox(): HTMLElement | null {
  return previewRoot()?.querySelector<HTMLElement>('.preview') ?? null;
}
function hover(button: HTMLElement): void {
  button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 }));
}
function leave(button: HTMLElement, related: EventTarget | null = document.body): void {
  button.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: related }));
}

async function apiChecks(): Promise<void> {
  const calls: string[] = [];
  const message = (id: string, role: 'user' | 'assistant'): ApiConversationMessage => ({ id, author: { role }, content: { content_type: 'text', parts: [id] }, create_time: 1700000000 });
  Object.assign(globalThis, { fetch: async (url: string) => {
    calls.push(url);
    if (url.includes('include_full_conversation')) return new Response(JSON.stringify({ current_node: 'a2', mapping: { a2: { id: 'a2', parent: 'missing', message: message('a2', 'assistant') } } }));
    if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user')], page_info: { has_previous_page: false } }));
    return new Response(JSON.stringify({ current_node: 'a2', messages: [message('u2', 'user'), message('a2', 'assistant')], page_info: { has_previous_page: true, start_cursor: 'cursor a/1' } }));
  } });
  const full = await fetchCompleteConversation('pagination', {});
  const normalized = normalizeConversation(full);
  assert(normalized.length === 2 && normalized[0].userMessageId === 'u1' && normalized[1].assistantMessageId === 'a2', 'partial response treated as complete');
  assert(calls[0].endsWith('?include_full_conversation=true') && calls[1].includes('include_has_versions=true&num_turns=100') && calls[2].includes('/messages?before=cursor+a%2F1&include_has_versions=true&num_turns=100'), 'upstream pagination contract changed');
  const branched = structuredClone(api); branched.mapping!['other'] = { id: 'other', parent: 'u0', message: message('other', 'assistant') };
  Object.assign(globalThis, { fetch: async () => new Response(JSON.stringify(branched)) });
  assert(normalizeConversation(await fetchCompleteConversation('branch', {})).at(-1)?.assistantMessageId === 'a17', 'active branch changed');
  Object.assign(globalThis, { fetch: async (url: string) => new Response(JSON.stringify(url.includes('/conversations/') ? { messages: [message('u1', 'user')], page_info: { has_previous_page: true, start_cursor: 'repeat' } } : { current_node: 'lost', mapping: {} })) });
  let rejected = false; try { await fetchCompleteConversation('stalled', {}); } catch { rejected = true; }
  assert(rejected, 'stalled partial pagination accepted');
  Object.assign(globalThis, { fetch: normalFetch });
  pass('API full parameter, actual cursor pagination/overlap merge, active branch and incomplete-page rejection');
}

function mappingChecks(): void {
  const isolated = el('div');
  document.body.append(isolated);
  for (let i = 0; i < 18; i++) {
    const button = document.createElement('button');
    button.setAttribute('data-toc-item-index', String(i));
    isolated.append(button);
  }
  const first = isolated.children[0] as HTMLButtonElement;
  const seventh = isolated.children[6] as HTMLButtonElement;
  assert(resolveOfficialTurnIndex(seventh, 18) === 6, 'valid data-toc-item-index was ignored');
  seventh.setAttribute('data-toc-item-index', '99');
  assert(resolveOfficialTurnIndex(seventh, 18) === 6, 'equal-count page order was not used after invalid index');
  isolated.remove();

  const partial = officialNavFixture(5, undefined, () => ({ 'data-toc-active': 'false' }));
  document.body.append(partial);
  assert(resolveOfficialTurnIndex(partial.children[2] as HTMLButtonElement, 18) == null, 'ambiguous index still showed a turn');
  const labeled = partial.children[2] as HTMLButtonElement;
  labeled.setAttribute('aria-label', '7');
  assert(resolveOfficialTurnIndex(labeled, 18) === 6, 'accessible number was not used as a supplement');
  labeled.setAttribute('aria-label', '7 12');
  assert(resolveOfficialTurnIndex(labeled, 18) == null, 'two in-range accessible numbers were guessed');
  labeled.setAttribute('aria-label', 'identical user question');
  assert(resolveOfficialTurnIndex(labeled, 18) == null, 'identical question text was used as a mapping key');
  partial.remove();
  const promptButton = document.createElement('button');
  promptButton.setAttribute('aria-label', 'Prompt 9');
  document.body.append(promptButton);
  assert(isOfficialNavItem(promptButton) && resolveOfficialTurnIndex(promptButton, 18) === 8, 'Prompt N official button was ignored');
  promptButton.remove();
  pass('official button mapping prefers index, then equal-count order, then a unique accessible number; never text matching');
}

async function previewViewChecks(): Promise<void> {
  const view = new PreviewView();
  const button = document.createElement('button');
  button.style.cssText = 'position:fixed;right:24px;top:240px;width:30px;height:10px';
  document.body.append(button);
  const userTime = new Date(2026, 8, 17, 8, 31, 42).getTime() / 1000;
  const turn: YadaTurn = {
    ...turns[6],
    userCreatedAt: userTime,
    userPreview: '长用户正文'.repeat(180),
    assistantPreview: 'Assistant remains visible '.repeat(80)
  };
  view.show(turn, button);
  const host = document.getElementById(YADA_PREVIEW_HOST_ID)!;
  const box = previewBox()!;
  assert(host.style.pointerEvents === 'none' && getComputedStyle(host).pointerEvents === 'none', 'preview host can intercept pointer events');
  assert(box.style.pointerEvents === 'none' && getComputedStyle(box).pointerEvents === 'none', 'preview box can intercept pointer events');
  assert(box.querySelector('[data-preview-role="Harson"]') && !box.querySelector('[data-preview-role="ChatGPT"]') && !box.textContent!.includes('User'), 'gray mode label/content');
  assert(box.querySelector('time')?.textContent === '09月17日 周四 08:31:42', 'local preview time format');
  const titleRect = box.querySelector('.preview-header strong')!.getBoundingClientRect();
  const timeRect = box.querySelector('time')!.getBoundingClientRect();
  assert(Math.abs(titleRect.top - timeRect.top) < 5 && timeRect.left > titleRect.right, 'round/time not on same row');
  view.setPreviewMode(true);
  for (const section of box.querySelectorAll<HTMLElement>('section')) {
    const label = getComputedStyle(section.querySelector('strong')!);
    assert(label.color === 'rgb(16, 163, 127)' && Number(label.fontWeight) >= 700, 'role not green/bold');
    assert(getComputedStyle(section.querySelector('p')!).webkitLineClamp === '2' && section.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom, 'independent 2-line block clipped');
  }
  assert(box.querySelector('[data-preview-role="ChatGPT"]'), 'assistant missing with long Harson text');
  await wait(1100);
  assert([...box.querySelectorAll('p')].every(p => getComputedStyle(p).webkitLineClamp === '5'), 'independent 5-line expansion failed');
  view.show({ ...turn, userCreatedAt: undefined, assistantPreview: '' }, button);
  assert(!box.querySelector('time') && formatPreviewTime(NaN) === '', 'missing time fabricated');
  assert(box.querySelector('[data-preview-role="ChatGPT"] p')?.textContent === '该轮暂无 ChatGPT 回复', 'missing assistant text was not shown');
  const oldHost = host;
  window.dispatchEvent(new Event('resize'));
  assert(document.getElementById(YADA_PREVIEW_HOST_ID) === oldHost, 'resize created a new preview host');
  view.hide();
  assert(box.hidden, 'hide did not close preview');
  view.dispose();
  button.remove();
  assert(!document.getElementById(YADA_PREVIEW_HOST_ID), 'disposed preview host leaked');
  pass('Harson gray / Harson+ChatGPT green; green bold labels; local same-row time; missing-time omission; independent 2/5-line previews; pointer-events none');
}

async function controllerChecks(): Promise<void> {
  const fetchWas = window.fetch;
  const observerWas = window.IntersectionObserver;
  controller = new NativePreviewController();
  assert(window.fetch === fetchWas && window.IntersectionObserver === observerWas, 'controller wrapped fetch or IntersectionObserver');
  assert(!document.getElementById('chatgpt-yada-rail-host'), 'rail host was created before official navigation');
  assert(!document.querySelector('[aria-label^="跳到第"], .mark-bar, .marks[role="navigation"]'), 'custom navigation marks were created');
  controller.syncRoute();
  await wait(80);
  assert(!document.getElementById('chatgpt-yada-rail-host') && !previewBox(), 'second navigation appeared before official buttons');
  pass('no fetch/IntersectionObserver wrapping; no rail or custom marks while official navigation is absent');

  let clicks = 0;
  let prevented = false;
  const nav = officialNavFixture(18, index => { clicks += 1; prevented = prevented || index < 0; });
  nav.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', event => { if (event.defaultPrevented) prevented = true; });
  });
  document.body.append(nav);
  const target = nav.children[6] as HTMLButtonElement;
  hover(target);
  await until(() => !!previewBox() && !previewBox()!.hidden, 'official hover did not show preview');
  assert(previewBox()!.textContent?.includes('第 7 轮'), 'hover mapped to the wrong turn');
  assert(previewBox()!.textContent?.includes('identical user question'), 'preview lost user text');
  target.click();
  assert(clicks === 1 && !prevented, 'official button click was intercepted');
  leave(target);
  await frame();
  assert(previewBox()?.hidden !== false, 'preview stayed open after pointerout');
  pass('official hover shows the matching turn; native click is unchanged');

  const duplicate = nav.children[11] as HTMLButtonElement;
  hover(duplicate);
  await until(() => previewBox()?.textContent?.includes('第 12 轮') === true, 'identical user questions were text-matched');
  assert(previewBox()!.textContent?.includes('identical user question'), 'turn 12 lost the shared user text');
  leave(duplicate);
  nav.remove();

  const manyApi = makeApi(180, 'fixture-many');
  Object.assign(globalThis, { fetch: async () => new Response(JSON.stringify(manyApi)) });
  history.replaceState({}, '', '/c/fixture-many');
  controller.syncRoute();
  const manyNav = officialNavFixture(180);
  document.body.append(manyNav);
  await wait(120);
  hover(manyNav.children[149] as HTMLButtonElement);
  await until(() => previewBox()?.textContent?.includes('第 150 轮') === true, '180 official buttons mapped to the wrong turn');
  leave(manyNav.children[149] as HTMLButtonElement);
  manyNav.remove();
  Object.assign(globalThis, { fetch: normalFetch });
  history.replaceState({}, '', '/c/fixture-1');
  controller.syncRoute();
  pass('100-300 official buttons still map by stable index, not by text');

  const ambiguous = officialNavFixture(5, undefined, () => ({ 'data-toc-active': 'false' }));
  document.body.append(ambiguous);
  hover(ambiguous.children[1] as HTMLButtonElement);
  await wait(80);
  assert(!previewBox() || previewBox()!.hidden, 'ambiguous official buttons showed a guessed preview');
  ambiguous.remove();
  pass('index that cannot be uniquely resolved does not show a preview');

  const liveNav = officialNavFixture(18);
  document.body.append(liveNav);
  hover(liveNav.children[2] as HTMLButtonElement);
  await until(() => previewBox()?.textContent?.includes('第 3 轮') === true, 'route-cleanup fixture missing preview');
  const previousBox = previewBox();
  let secondCalls = 0;
  Object.assign(globalThis, {
    fetch: async () => {
      secondCalls++;
      await wait(400);
      return new Response(JSON.stringify(makeApi(2, 'other')));
    }
  });
  history.pushState({}, '', '/c/other');
  controller.syncRoute();
  assert(previewBox()?.hidden !== false, 'route change left the previous preview open');
  await wait(80);
  const callsAfterSwitch = secondCalls;
  history.pushState({}, '', '/c/third');
  controller.syncRoute();
  await wait(500);
  assert(callsAfterSwitch >= 1, 'new conversation was not requested');
  assert(!previewBox() || previewBox()!.hidden || previewBox() === previousBox && previousBox!.hidden, 'stale preview survived a second route change');
  liveNav.remove();
  Object.assign(globalThis, { fetch: normalFetch });
  history.replaceState({}, '', '/c/fixture-1');
  controller.dispose();
  controller = null;
  pass('route change closes preview and abandons the previous conversation request');
}

async function liveRefreshChecks(): Promise<void> {
  let payload = makeApi(18, 'fixture-live');
  let failLoads = 0;
  let delayMs = 0;
  let reads = 0;
  const readsById: Record<string, number> = {};
  const conversationFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/api/auth/session')) return new Response('{}');
    if (url.includes('include_full_conversation')) {
      const id = decodeURIComponent(url.match(/\/conversation\/([^/?]+)/)?.[1] ?? '');
      reads++;
      readsById[id] = (readsById[id] ?? 0) + 1;
      if (delayMs) await wait(delayMs);
      if (failLoads > 0) {
        failLoads--;
        return new Response('nope', { status: 500 });
      }
      return new Response(JSON.stringify(payload));
    }
    return new Response('nope', { status: 500 });
  };
  Object.assign(globalThis, { fetch: conversationFetch });

  controller = new NativePreviewController();
  history.replaceState({}, '', '/c/fixture-live');
  let clicks = 0;
  const nav = officialNavFixture(18, () => { clicks += 1; });
  document.body.append(nav);
  controller.syncRoute();
  await wait(80);
  hover(nav.children[0] as HTMLButtonElement);
  await until(() => previewBox()?.textContent?.includes('第 1 轮') === true, 'initial 18-turn preview missing');
  assert(nav.querySelectorAll('button').length === 18, 'official navigation did not start with 18 buttons');
  await wait(700);
  const afterInitial = reads;
  leave(nav.children[0] as HTMLButtonElement);
  hover(nav.children[6] as HTMLButtonElement);
  await wait(120);
  assert(previewBox()?.textContent?.includes('第 7 轮') === true, 'mapped hover lost the existing turn');
  assert(reads === afterInitial, 'mapped hover repeated the conversation request');
  leave(nav.children[6] as HTMLButtonElement);
  pass('initial API has 18 turns and 18 official buttons; mapped hover does not refetch');

  payload = makeApi(19, 'fixture-live');
  const nineteenth = appendOfficialButton(nav, 18, () => { clicks += 1; });
  hover(nineteenth);
  await until(() => previewBox()?.textContent?.includes('第 19 轮') === true, 'hovering the 19th official button did not refresh preview data');
  assert(reads > afterInitial, 'unmapped 19th button did not reread the conversation');
  nineteenth.click();
  assert(clicks === 1, 'official 19th button click was intercepted');
  leave(nineteenth);
  await wait(700);
  pass('same-route 19th official button rereads API and shows 第 19 轮; native click unchanged');

  const afterNineteenth = reads;
  payload = makeApi(30, 'fixture-live');
  for (let i = 19; i < 30; i++) appendOfficialButton(nav, i);
  await wait(900);
  const stormReads = reads - afterNineteenth;
  assert(stormReads >= 1 && stormReads <= 2, `button inserts caused a request storm: ${stormReads}`);
  pass('rapid extra official buttons coalesce into a limited number of requests');

  delayMs = 180;
  payload = makeApi(33, 'fixture-live');
  const pendingStart = reads;
  const pendingButton = appendOfficialButton(nav, 30);
  hover(pendingButton);
  await wait(80);
  appendOfficialButton(nav, 31);
  appendOfficialButton(nav, 32);
  await wait(900);
  const pendingReads = reads - pendingStart;
  assert(pendingReads >= 1 && pendingReads <= 2, `in-flight refresh was not coalesced: ${pendingReads}`);
  delayMs = 0;
  leave(pendingButton);
  nav.remove();
  controller.dispose();
  controller = null;
  pass('in-flight API plus new ticks appends at most one pending refresh');

  failLoads = 1;
  payload = makeApi(18, 'fixture-recover');
  const recoverStart = reads;
  controller = new NativePreviewController();
  history.replaceState({}, '', '/c/fixture-recover');
  const recoverNav = officialNavFixture(18);
  document.body.append(recoverNav);
  controller.syncRoute();
  await wait(120);
  assert(reads === recoverStart + 1, 'failed first load was not attempted');
  hover(recoverNav.children[4] as HTMLButtonElement);
  await until(() => previewBox()?.textContent?.includes('第 5 轮') === true, 'hover after a failed load did not recover preview data');
  leave(recoverNav.children[4] as HTMLButtonElement);
  recoverNav.remove();
  controller.dispose();
  controller = null;
  pass('first API failure recovers on the next unmapped hover');

  payload = makeApi(18, 'timer-old');
  controller = new NativePreviewController();
  history.replaceState({}, '', '/c/timer-old');
  const oldNav = officialNavFixture(18);
  document.body.append(oldNav);
  controller.syncRoute();
  await until(() => (readsById['timer-old'] ?? 0) >= 1, 'old conversation was not read');
  hover(oldNav.children[2] as HTMLButtonElement);
  await until(() => previewBox()?.textContent?.includes('第 3 轮') === true, 'old conversation preview missing before route change');
  delayMs = 500;
  payload = makeApi(19, 'timer-old');
  appendOfficialButton(oldNav, 18);
  payload = makeApi(2, 'timer-new');
  delayMs = 0;
  history.pushState({}, '', '/c/timer-new');
  controller.syncRoute();
  oldNav.remove();
  const newNav = officialNavFixture(2);
  document.body.append(newNav);
  await wait(800);
  hover(newNav.children[1] as HTMLButtonElement);
  await until(() => previewBox()?.textContent?.includes('第 2 轮') === true, 'new conversation preview missing after cancelled refresh');
  assert(!previewBox()!.textContent!.includes('第 19 轮'), 'cancelled old refresh overwrote the new conversation');
  assert((readsById['timer-new'] ?? 0) >= 1 && (readsById['timer-new'] ?? 0) <= 2, 'route change left stale timers requesting the new conversation repeatedly');
  leave(newNav.children[1] as HTMLButtonElement);
  newNav.remove();
  controller.dispose();
  controller = null;
  history.replaceState({}, '', '/c/fixture-1');
  Object.assign(globalThis, { fetch: normalFetch });
  pass('route change cancels old request/timer; old results cannot overwrite the new conversation');
}

async function run(): Promise<void> {
  if (savedChecks.length) {
    toolbar = new YadaToolbar(); toolbar.mount(); toolbar.setVisible(true);
    await until(() => document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector('[data-preview-mode]')?.getAttribute('aria-pressed') === 'true', 'preview mode lost on reload');
    await openPanel();
    assert(modal().querySelector('.yada-prompt-item-title')?.textContent === 'Reload retained', 'prompt lost on reload');
    assert((await readLibrary()).prompts[0].id === 'existing-210-id', 'ID lost on reload');
    pass('real browser reload retains preview preference and existing v1 prompt IDs/content');
    sessionStorage.removeItem('yada-reload-checks'); return;
  }

  await apiChecks();
  mappingChecks();
  assert(closestOfficialButton(document.createTextNode('x')) == null, 'closestOfficialButton must ignore non-elements');
  await previewViewChecks();
  await controllerChecks();
  await liveRefreshChecks();
  await nativeBootstrapChecks(assert, pass);

  toolbar = new YadaToolbar(); toolbar.mount(); toolbar.setVisible(true);
  const mode = document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector<HTMLButtonElement>('[data-preview-mode]')!;
  await wait(); mode.click(); await until(() => localStorage.getItem(PREVIEW_KEY) === 'true', 'preview preference not retained');
  const original = { id: 'existing-210-id', title: '<img src=x onerror=alert(1)>', content: '  Full prompt\nwith whitespace\n' + 'Body '.repeat(200), createdAt: 10, updatedAt: 20 };
  await saveLibrary({ version: 1, prompts: [original] }); await openPanel();
  const panel = modal().querySelector<HTMLElement>('.yada-prompt-panel')!, list = modal().querySelector<HTMLElement>('.yada-prompt-list')!;
  assert(promptHost().parentElement === document.body && !modal().querySelector('input[type="search"], .yada-prompt-footer'), 'search/footer or wrong host');
  assert(modal().querySelector('.yada-prompt-header')!.querySelectorAll('button').length === 2, 'header must only have add/close');
  assert(!modal().querySelector('img') && getComputedStyle(panel).minHeight === '0px' && panel.getBoundingClientRect().height < 320, 'one-item panel not compact/safe');
  const card = modal().querySelector<HTMLElement>('.yada-prompt-item')!, icons = [...card.querySelectorAll<HTMLButtonElement>('button')];
  assert(icons.length === 3 && icons.every(b => b.querySelector('svg') && !b.textContent!.trim() && b.title === b.getAttribute('aria-label')), 'icons must be SVG-only and accessible');
  assert(icons.map(b => b.title).join(',') === '复制提示词,编辑提示词,删除提示词', 'wrong icon labels');
  assert(icons.every(b => b.getBoundingClientRect().width === 30) && getComputedStyle(card).cursor === 'default', 'compact icon/card cursor');
  let copied = '', copies = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text; copies++; } } });
  card.click(); assert(!copies && modal().querySelector<HTMLElement>('form')!.hidden && draft.value === 'Existing unsent draft', 'card has action');
  const copyIcon = icons[0], oldSvg = copyIcon.innerHTML; copyIcon.click(); await wait();
  assert(copied === original.content && !promptHost().hidden && copyIcon.innerHTML !== oldSvg && !copyIcon.textContent!.trim(), 'copy is truncated/title included/closes/not check icon');
  await wait(1400); assert(copyIcon.innerHTML === oldSvg, 'check icon did not restore');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
  const exec = document.execCommand.bind(document); let fallback = '';
  document.execCommand = (command: string): boolean => { if (command === 'copy') { fallback = (document.activeElement as HTMLTextAreaElement).value; return true; } return exec(command); };
  copyIcon.click(); await wait(); assert(fallback === original.content && !promptHost().hidden, 'clipboard fallback failed'); document.execCommand = exec;
  assert(draft.value === 'Existing unsent draft', 'copy changed draft');
  pass('body Shadow DOM compact modal; no search/footer; exactly 3 accessible 30px SVG icons; inert card; full-content copy/check/reset/fallback stays open');
  clickAction('edit'); modal().querySelector<HTMLInputElement>('[name="title"]')!.value = 'Updated title';
  modal().querySelector<HTMLTextAreaElement>('[name="content"]')!.value = 'Updated body'; modal().querySelector<HTMLButtonElement>('[type="submit"]')!.click();
  await until(() => modal().querySelector('.yada-prompt-item-title')?.textContent === 'Updated title', 'edit failed');
  let library = await readLibrary(); assert(library.prompts[0].id === original.id && library.prompts[0].createdAt === 10 && library.prompts[0].updatedAt > 20, 'edit lost ID/createdAt');
  clickAction('add'); modal().querySelector<HTMLInputElement>('[name="title"]')!.value = 'Second'; modal().querySelector<HTMLTextAreaElement>('[name="content"]')!.value = 'Second body'; modal().querySelector<HTMLButtonElement>('[type="submit"]')!.click();
  await until(() => modal().querySelectorAll('.yada-prompt-item').length === 2, 'add failed');
  assert(panel.getBoundingClientRect().height < 400, 'two-item panel not natural height');
  clickAction('delete'); await until(() => modal().querySelectorAll('.yada-prompt-item').length === 1, 'delete failed');
  assert((await readLibrary()).prompts[0].id === original.id, 'delete affected another prompt');
  clickAction('close');
  await saveLibrary({ version: 1, prompts: Array.from({ length: 40 }, (_, i) => ({ id: `many-${i}`, title: `Prompt ${i}`, content: 'Long preview '.repeat(60), createdAt: i, updatedAt: i })) }); await openPanel();
  assert(list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto' && panel.scrollHeight <= panel.clientHeight + 1 && panel.getBoundingClientRect().height <= Math.min(innerHeight * .72, 680) + 1, 'only list should scroll within max-height');
  const headerTop = modal().querySelector('.yada-prompt-header')!.getBoundingClientRect().top, pageTop = document.scrollingElement!.scrollTop;
  list.scrollTop = 500; await frame(); assert(modal().querySelector('.yada-prompt-header')!.getBoundingClientRect().top === headerTop && document.scrollingElement!.scrollTop === pageTop, 'header/page scrolled');
  const wheel = new WheelEvent('wheel', { bubbles:true, cancelable:true, deltaY:500 }); modal().querySelector('.yada-prompt-backdrop')!.dispatchEvent(wheel); assert(wheel.defaultPrevented, 'backdrop wheel leaks');
  clickAction('edit'); assert(list.hidden && modal().querySelector('form')!.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom, 'editor is scroll-clipped'); clickAction('cancel');
  document.documentElement.classList.add('dark'); await wait(); assert(modal().querySelector<HTMLElement>('.yada-prompt-modal')!.dataset.toolkitTheme === 'dark', 'dark theme lost'); document.documentElement.classList.remove('dark');
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); assert(promptHost().hidden, 'escape close failed');
  await openPanel(); (modal().querySelector('.yada-prompt-backdrop') as HTMLElement).click(); assert(promptHost().hidden, 'backdrop close failed');
  pass('add/edit/delete preserve unrelated IDs and createdAt; 1–2 items shrink; many items scroll only list; header/editor fixed; theme/Escape/backdrop');
  await saveLibrary({ version:1, prompts:[{ ...original, title:'Reload retained' }] });
  assert(localStorage.getItem(PROMPT_KEY), 'v1 key lost'); toolbar.dispose(); toolbar = null;
  assert(!document.getElementById('chatgpt-yada-prompt-host'), 'disposed modal leaked');
  assert(window.fetch === originalFetch || window.fetch === normalFetch, 'production path wrapped window.fetch');
  assert(window.IntersectionObserver === originalObserver, 'production path wrapped IntersectionObserver');
  sessionStorage.setItem('yada-reload-checks', JSON.stringify(result.checks)); reloading = true; location.reload();
}

void run().catch(error => { result.error = error.stack ?? String(error); }).finally(() => {
  if (!reloading) { controller?.dispose(); toolbar?.dispose(); result.done = true; }
});
