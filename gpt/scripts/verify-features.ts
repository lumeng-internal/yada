import { normalizeConversation } from '../src/conversation/normalizeConversation';
import type { ApiConversation, ApiConversationMessage } from '../src/conversation/fetchConversation';
import { fetchCompleteConversation } from '../src/conversation/completeConversation';
import { NativeSkeleton, findScrollRoot, getTurnEl, syncActive } from '../src/rail/nativeSkeleton';
import { RailController } from '../src/rail/controller';
import { jumpToTurn, targetY } from '../src/rail/jump';
import { readChatGPTOfficialNavigation } from '../src/rail/officialNavigation';
import { RailView, formatPreviewTime } from '../src/rail/view';
import { readLibrary, saveLibrary, PROMPT_KEY, PREVIEW_KEY } from '../src/prompts/storage';
import { YadaToolbar } from '../src/ui/toolbar';

const savedChecks = JSON.parse(sessionStorage.getItem('yada-reload-checks') || '[]') as string[];
const result = { done: false, checks: savedChecks, error: '' };
Object.assign(globalThis, { yadaVerification: result });
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const pass = (message: string): void => { result.checks.push(message); };
const wait = (ms = 80): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
async function until(fn: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 90; i++) { if (fn()) return; await wait(); }
  throw new Error(message);
}
function el(tag: string, text = ''): HTMLElement { const node = document.createElement(tag); node.textContent = text; return node; }
const css = el('style');
css.textContent = `body{margin:0;font:14px/1.4 system-ui}main{width:1000px;margin-top:40px}#thread{height:680px;overflow-y:auto;position:relative}header{position:fixed;top:0;left:0;right:0;height:96px;z-index:20;background:white;overflow:hidden}#conversation-header-actions{float:right}#messages{padding-bottom:650px}section{margin:0}#draft{position:fixed;bottom:10px}`;
document.head.append(css);
const header = el('header'); header.id = 'page-header'; const actions = el('div'); actions.id = 'conversation-header-actions'; header.append(actions);
const main = el('main'), scroller = el('div'), messages = el('div');
scroller.id = 'thread'; messages.id = 'messages'; messages.className = 'fixture_convSearchResultHighlightRoot';
scroller.append(messages); main.append(scroller);
const draft = el('textarea') as HTMLTextAreaElement; draft.id = 'draft'; draft.value = 'Existing unsent draft';
document.body.append(header, main, draft);
const phantom = el('div'); phantom.dataset.turnIdContainer = 'client-created-root'; messages.append(phantom);
const api: ApiConversation = { id: 'fixture-1', current_node: 'a119', mapping: { root: { id: 'root', message: null } } };
for (let i = 0; i < 120; i++) {
  api.mapping![`u${i}`] = { id: `u${i}`, parent: i ? `a${i - 1}` : 'root', message: { id: `u${i}`, author: { role: 'user' }, content: { content_type: 'text', parts: ['identical user question'] }, create_time: 1700000000 + i } };
  api.mapping![`a${i}`] = { id: `a${i}`, parent: `u${i}`, message: { id: `a${i}`, author: { role: 'assistant' }, channel: 'final', content: { content_type: 'text', parts: [`Assistant ${i} answer`] }, create_time: 1700000001 + i } };
  for (const role of ['user', 'assistant']) {
    const container = el('div'); const id = `${role === 'user' ? 'u' : 'a'}${i}`; container.dataset.turnIdContainer = id;
    container.style.height = `${role === 'user' ? 100 : [210, 970, 345, 1620, 540, 285][i % 6]}px`;
    if (i < 6) { const section = el('section', role === 'user' ? 'identical user question' : `Answer ${i}`); section.dataset.turn = role; section.dataset.turnId = id; container.append(section); }
    messages.append(container);
  }
}
const turns = normalizeConversation(api), skeleton = new NativeSkeleton();
const storage = {
  async get(key: string) { const value = localStorage.getItem(key); return { [key]: value === null ? undefined : JSON.parse(value) }; },
  async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); }
};
Object.assign(globalThis, { chrome: { storage: { local: storage } } });
const normalFetch = async (): Promise<Response> => new Response(JSON.stringify(api));
Object.assign(globalThis, { fetch: normalFetch });
let controller: RailController | null = null, toolbar: YadaToolbar | null = null, reloading = false;
const promptHost = (): HTMLElement => document.getElementById('chatgpt-yada-prompt-host')!;
const modal = (): ShadowRoot => promptHost().shadowRoot!;
const promptButton = (): HTMLButtonElement => document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector('[data-prompts]')!;
const clickAction = (action: string): void => { const button = modal().querySelector<HTMLButtonElement>(`[data-prompt-action="${action}"]`); assert(button, `missing ${action}`); button!.click(); };
async function openPanel(): Promise<void> {
  promptButton().click();
  await until(() => !promptHost().hidden && modal().activeElement?.getAttribute('data-prompt-action') === 'add', 'prompt panel did not load');
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
  assert(normalizeConversation(await fetchCompleteConversation('branch', {})).at(-1)?.assistantMessageId === 'a119', 'active branch changed');
  Object.assign(globalThis, { fetch: async (url: string) => new Response(JSON.stringify(url.includes('/conversations/') ? { messages: [message('u1', 'user')], page_info: { has_previous_page: true, start_cursor: 'repeat' } } : { current_node: 'lost', mapping: {} })) });
  let rejected = false; try { await fetchCompleteConversation('stalled', {}); } catch { rejected = true; }
  assert(rejected, 'stalled partial pagination accepted');
  Object.assign(globalThis, { fetch: normalFetch });
  pass('API full parameter, actual cursor pagination/overlap merge, active branch and incomplete-page rejection');
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
  const entries = skeleton.scan(turns);
  assert(entries.length === 120 && entries[119].turnContainerId === 'u119' && entries[0].skeletonIndex === 1, 'skeleton count/phantom/order');
  assert(messages.querySelectorAll('section[data-turn="user"]').length === 6, 'fixture must only mount six user bodies');
  const sparse = skeleton.scan([turns[119], turns[0]]);
  assert(sparse[119].turn?.userMessageId === 'u119' && sparse[0].turn?.userMessageId === 'u0' && sparse[1].turn === null, 'exact IDs must reserve turns before ordinal mapping');
  const ordinal = skeleton.scan(turns.map(turn => ({ ...turn, userMessageId: 'api-' + turn.id, turnDomId: null })));
  assert(ordinal[119].turn?.userMessageId === 'api-u119', 'ordered API fallback absent');
  assert(skeleton.scan().every(entry => !entry.turn), 'API-free skeleton must work');
  // No phantom and index-zero user must also be observed correctly.
  phantom.remove(); assert(skeleton.scan().length === 120 && skeleton.scan()[0].skeletonIndex === 0, 'even parity failed'); messages.prepend(phantom);
  const nested = el('div'); nested.dataset.turnIdContainer = 'nested-false-turn'; getTurnEl('u0')!.append(nested);
  assert(skeleton.scan().length === 120, 'nested containers counted'); nested.remove();
  assert(findScrollRoot(getTurnEl('u0')) === scroller, 'scroll root incorrect');
  pass('120 persistent user skeletons / 6 mounted bodies; phantom/direct-child/parity; exact API identity then ordered enrichment');
  for (const index of [1, 60, 119, 2]) {
    const abort = new AbortController();
    assert(await jumpToTurn(entries[index], entries, abort.signal), `jump failed ${index}`);
    assert(Math.abs(scroller.scrollTop - targetY(getTurnEl(`u${index}`)!, scroller)) < 2, `wrong container ${index}`);
    assert(syncActive(entries, scroller) === index, `wrong active ${index}`);
    abort.abort();
  }
  pass('front/middle/end and identical-text turns jump by distinct container IDs without mounted messages');
  const abort = new AbortController(); scroller.scrollTop = 0;
  const long = jumpToTurn(entries[60], entries, abort.signal);
  assert(scroller.scrollTop > 10000, 'long jump must be synchronous direct scroll'); await long; abort.abort();
  const shortAbort = new AbortController(), target = targetY(getTurnEl('u60')!, scroller);
  scroller.scrollTop = target - 300; const short = jumpToTurn(entries[60], entries, shortAbort.signal);
  assert(scroller.scrollTop < target - 250, 'short jump was immediate'); await wait(90);
  assert(scroller.scrollTop > target - 300 && scroller.scrollTop < target, 'short jump lacks rAF easing');
  assert(await short, 'short jump failed'); assert(Math.abs(scroller.scrollTop - target) < 2, 'short jump alignment'); shortAbort.abort();
  pass('>600px direct jump and 280ms short-distance rAF interpolation');
  const official = el('div'); official.style.cssText = 'position:fixed;right:16px;top:120px;width:35px;height:500px;overflow:auto';
  let nativeCalls = -1;
  for (let i = 0; i < 120; i++) {
    const b = document.createElement('button'); b.dataset.tocItemIndex = String(entries[i].skeletonIndex); b.textContent = '—'; b.style.cssText = 'display:block;width:30px;height:3px;padding:0;border:0';
    b.addEventListener('click', () => { nativeCalls = i; }); official.append(b);
  }
  document.body.append(official);
  assert(await jumpToTurn(entries[60], entries, new AbortController().signal) && nativeCalls === 60, 'native skeleton-index click failed');
  [...official.children].forEach((b, i) => b.setAttribute('data-toc-item-index', String(i)));
  await jumpToTurn(entries[60], entries, new AbortController().signal); assert(nativeCalls === 60, 'ordinal native-index fallback failed');
  [...official.children].forEach(b => { b.removeAttribute('data-toc-item-index'); b.setAttribute('data-toc-active', 'false'); });
  await jumpToTurn(entries[60], entries, new AbortController().signal); assert(nativeCalls === 60, 'active-only native buttons not called');
  official.remove(); pass('official buttons outside main: exact skeleton index, changed ordinal semantics and visible-order fallback');
  const correction = new AbortController(); await jumpToTurn(entries[70], entries, correction.signal);
  const started = performance.now();
  for (const ms of [200, 600, 1200, 2000]) {
    await wait(Math.max(0, ms - 80 - (performance.now() - started)));
    const old = getTurnEl('u70')!, fresh = old.cloneNode(true) as HTMLElement;
    fresh.style.transform = `translateY(${ms / 2}px)`; old.replaceWith(fresh);
    await wait(Math.max(0, ms + 55 - (performance.now() - started)));
    assert(getTurnEl('u70') === fresh && Math.abs(scroller.scrollTop - targetY(fresh, scroller)) < 2, `fresh-node correction failed at ${ms}ms`);
  }
  correction.abort(); getTurnEl('u70')!.style.transform = '';
  pass('200/600/1200/2000ms corrections re-query replaced target containers and correct >40px error');
  for (const event of [new WheelEvent('wheel'), new Event('touchstart'), ...['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].map(key => new KeyboardEvent('keydown', { key }))]) {
    const cancel = new AbortController(); await jumpToTurn(entries[60], entries, cancel.signal);
    window.dispatchEvent(event); scroller.scrollTop += 120; const top = scroller.scrollTop;
    await wait(240); assert(scroller.scrollTop === top, `continued after ${event.type}/${(event as KeyboardEvent).key}`); cancel.abort();
  }
  const routeAbort = new AbortController(); await jumpToTurn(entries[60], entries, routeAbort.signal);
  history.pushState({}, '', '/c/route-changed'); scroller.scrollTop += 120; const routeTop = scroller.scrollTop;
  await wait(260); assert(scroller.scrollTop === routeTop, 'route did not cancel correction'); routeAbort.abort(); history.replaceState({}, '', '/c/fixture-1');
  pass('wheel/touch/all scroll keys and SPA route changes immediately stop subsequent correction');
  // Fetch remains pending while the skeleton renders: API is not a navigation prerequisite.
  let resolveApi!: (value: Response) => void;
  Object.assign(globalThis, { fetch: () => new Promise<Response>(resolve => { resolveApi = resolve; }) });
  controller = new RailController(); controller.syncRoute();
  const host = document.getElementById('chatgpt-yada-rail-host')!, shadow = host.shadowRoot!, layer = shadow.querySelector('.marks')!, marker = shadow.querySelector<HTMLButtonElement>('.mark')!;
  assert(shadow.querySelectorAll('.mark').length === 120 && !host.hidden, 'API-pending rail not ready');
  marker.focus(); assert(shadow.querySelector('.preview')!.textContent === '第 1 轮', 'unmatched preview should be round only');
  resolveApi(new Response(JSON.stringify(api))); Object.assign(globalThis, { fetch: normalFetch }); await wait(250);
  assert(shadow.querySelector('.mark') === marker, 'API enrichment rebuilt markers');
  marker.focus(); shadow.querySelectorAll<HTMLButtonElement>('.mark')[60].click();
  document.body.append(official); const inserted = performance.now(); await frame();
  assert(host.hidden && performance.now() - inserted < 100, `native insertion did not suppress in one frame/100ms: hidden=${host.hidden}, latency=${performance.now()-inserted}, ready=${readChatGPTOfficialNavigation().ready}, rect=${JSON.stringify(official.getBoundingClientRect())}`);
  assert(readChatGPTOfficialNavigation().ready && shadow.querySelector<HTMLElement>('.preview')!.hidden, 'preview not cleared');
  assert(!host.title, 'jump was not cancelled on official insertion');
  official.hidden = true; await frame(); assert(!host.hidden, 'hidden native did not restore rail');
  official.hidden = false; await frame(); assert(host.hidden, 'unhidden native failed');
  official.setAttribute('aria-hidden', 'true'); await frame(); assert(!host.hidden, 'aria-hidden native failed');
  official.removeAttribute('aria-hidden'); official.style.visibility = 'hidden'; await frame(); assert(!host.hidden, 'visibility hidden native failed');
  official.style.visibility = 'visible'; official.style.top = '-600px'; await frame(); assert(!host.hidden, 'offscreen native suppressed rail');
  official.style.top = '120px'; await frame(); assert(host.hidden, 'restored native failed');
  official.remove(); await frame(); assert(!host.hidden && document.getElementById(host.id) === host && shadow.querySelector('.marks') === layer && shadow.querySelector('.mark') === marker, 'host/layer/marker was rebuilt');
  pass(`official insertion hides within one frame (<100ms); hidden/aria/visibility/viewport/removal restore same host and marks; preview and jump cleared`);
  history.pushState({}, '', '/'); await frame(); await frame(); assert(host.hidden, 'route exit not cleared');
  history.replaceState({}, '', '/c/api-failure'); Object.assign(globalThis, { fetch: async () => { throw new Error('offline fixture'); } });
  await frame(); await wait(250); assert(shadow.querySelectorAll('.mark').length === 120 && !host.hidden, 'API failure removed skeleton rail');
  controller.dispose(); controller = null; Object.assign(globalThis, { fetch: normalFetch }); history.replaceState({}, '', '/c/fixture-1');
  pass('API pending/failure leaves navigation usable; SPA lifecycle resets without React/page bridge');
  const previewView = new RailView(() => {}), userTime = new Date(2026, 8, 17, 8, 31, 42).getTime() / 1000;
  const previewEntry = { ...entries[6], index: 0, turn: { ...turns[6], userCreatedAt: userTime, userPreview: '长用户正文'.repeat(180), assistantPreview: 'Assistant remains visible '.repeat(80) } };
  previewView.setEntries([previewEntry]); previewView.host.style.cssText = 'position:fixed;right:30px;top:300px;height:40px';
  const pv = previewView.host.shadowRoot!, pvMark = pv.querySelector<HTMLButtonElement>('.mark')!; pvMark.focus();
  const preview = pv.querySelector<HTMLElement>('.preview')!;
  assert(preview.querySelector('[data-preview-role="Harson"]') && !preview.querySelector('[data-preview-role="ChatGPT"]') && !preview.textContent!.includes('User'), 'gray mode label/content');
  assert(preview.querySelector('time')?.textContent === '09月17日 周四 08:31:42', 'local preview time format');
  const titleRect = preview.querySelector('.preview-header strong')!.getBoundingClientRect(), timeRect = preview.querySelector('time')!.getBoundingClientRect();
  assert(Math.abs(titleRect.top - timeRect.top) < 5 && timeRect.left > titleRect.right, 'round/time not on same row');
  previewView.setPreviewMode(true);
  for (const section of preview.querySelectorAll<HTMLElement>('section')) {
    const label = getComputedStyle(section.querySelector('strong')!);
    assert(label.color === 'rgb(16, 163, 127)' && Number(label.fontWeight) >= 700, 'role not green/bold');
    assert(getComputedStyle(section.querySelector('p')!).webkitLineClamp === '2' && section.getBoundingClientRect().bottom <= preview.getBoundingClientRect().bottom, 'independent 2-line block clipped');
  }
  assert(preview.querySelector('[data-preview-role="ChatGPT"]'), 'assistant missing with long Harson text');
  await wait(1100); assert([...preview.querySelectorAll('p')].every(p => getComputedStyle(p).webkitLineClamp === '5'), 'independent 5-line expansion failed');
  previewView.setEntries([{ ...previewEntry, turn: { ...previewEntry.turn, userCreatedAt: undefined } }]);
  assert(!preview.querySelector('time') && formatPreviewTime(NaN) === '', 'missing time fabricated');
  previewView.dispose(); pass('Harson gray / Harson+ChatGPT green; green bold labels; local same-row time; missing-time omission; independent 2/5-line previews');
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
  // Clipboard API failure must use the real textarea selection + execCommand fallback.
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
  sessionStorage.setItem('yada-reload-checks', JSON.stringify(result.checks)); reloading = true; location.reload();
}
void run().catch(error => { result.error = error.stack ?? String(error); }).finally(() => {
  if (!reloading) { controller?.dispose(); toolbar?.dispose(); result.done = true; }
});
