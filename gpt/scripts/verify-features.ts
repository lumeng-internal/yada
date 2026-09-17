import { normalizeConversation } from '../src/conversation/normalizeConversation';
import type { ApiConversation, ApiConversationMessage } from '../src/conversation/fetchConversation';
import { fetchCompleteConversation } from '../src/conversation/completeConversation';
import { NativeSkeleton, bindTurnsToSkeletons, findScrollRoot, getTurnEl, skeletonSignature, syncActive } from '../src/rail/nativeSkeleton';
import { RailController } from '../src/rail/controller';
import { jumpToTurn, targetY } from '../src/rail/jump';
import { readChatGPTOfficialNavigation } from '../src/rail/officialNavigation';
import { RailView, formatPreviewTime } from '../src/rail/view';
import { readLibrary, saveLibrary, PROMPT_KEY, PREVIEW_KEY } from '../src/prompts/storage';
import { YadaToolbar } from '../src/ui/toolbar';
import { HISTORY_SOURCE, getHistoryPageStatus, rewriteConversationHistoryRequest, wrapFetchForHistory } from '../src/history/historyPage';
import { HistoryHydrator, captureReadingAnchor, restoreReadingAnchor } from '../src/history/historyHydrator';
import type { HistoryBridge } from '../src/history/historyClient';
import type { HistoryLimits, HistoryPageResult } from '../src/history/historyState';
import {
  canUseMessageFallback,
  clearPendingJump,
  markMessageFallbackUsed,
  messageFallbackUsed,
  messageQueryHref,
  readPendingJump,
  writePendingJump
} from '../src/history/pendingNavigation';

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
const TURN_COUNT = 18;
const HEIGHTS = [210, 970, 345, 1620, 540, 285];
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
const api: ApiConversation = { id: 'fixture-1', current_node: 'a17', mapping: { root: { id: 'root', message: null } } };
for (let i = 0; i < TURN_COUNT; i++) {
  api.mapping![`u${i}`] = { id: `u${i}`, parent: i ? `a${i - 1}` : 'root', message: { id: `u${i}`, author: { role: 'user' }, content: { content_type: 'text', parts: ['identical user question'] }, create_time: 1700000000 + i } };
  api.mapping![`a${i}`] = { id: `a${i}`, parent: `u${i}`, message: { id: `a${i}`, author: { role: 'assistant' }, channel: 'final', content: { content_type: 'text', parts: [`Assistant ${i} answer`] }, create_time: 1700000001 + i } };
}
function addTurn(i: number, withBody: boolean): HTMLElement[] {
  const user = el('div'); user.dataset.turnIdContainer = `u${i}`; user.style.height = '100px';
  if (withBody) { const section = el('section', 'identical user question'); section.dataset.turn = 'user'; section.dataset.turnId = `u${i}`; user.append(section); }
  const assistant = el('div'); assistant.dataset.turnIdContainer = `a${i}`; assistant.style.height = `${HEIGHTS[i % HEIGHTS.length]}px`;
  if (withBody) { const section = el('section', `Answer ${i}`); section.dataset.turn = 'assistant'; section.dataset.turnId = `a${i}`; assistant.append(section); }
  return [user, assistant];
}
function mountWindow(from: number, to: number, bodies = 2): void {
  [...messages.children].forEach(node => {
    if (node === phantom || (node instanceof HTMLElement && node.dataset.testid?.includes('conversation-pagination-sentinel'))) return;
    if (node instanceof HTMLElement && node.hasAttribute('data-turn-id-container')) node.remove();
  });
  const frag = document.createDocumentFragment();
  for (let i = from; i <= to; i++) frag.append(...addTurn(i, i < from + bodies));
  phantom.after(frag);
}
mountWindow(13, 17, 2);
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
function okPage(extra: Partial<HistoryPageResult> = {}): HistoryPageResult {
  return { ok: true, status: 200, triggered: true, generation: 1, hasSentinel: true, conversationId: 'fixture-1', ...extra };
}
function mockBridge(handler: (n: number, emit: (event: Record<string, unknown>) => void) => HistoryPageResult | Promise<HistoryPageResult>): HistoryBridge {
  let n = 0;
  const listeners: Array<(event: { type: string }) => void> = [];
  const emit = (event: Record<string, unknown>): void => { for (const listener of listeners) listener(event as { type: string }); };
  return {
    async query() { return { generation: n, hasSentinel: true, conversationId: 'fixture-1' }; },
    async loadPage() { const result = await handler(n, emit); n++; return result; },
    subscribe(listener) { listeners.push(listener); return () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); }; }
  };
}
function makeHydrator(bridge: HistoryBridge, limits?: Partial<HistoryLimits>): HistoryHydrator {
  const hydrator = new HistoryHydrator({
    getConversationId: () => 'fixture-1',
    skeletonSignature: () => skeletonSignature(skeleton.collect()),
    materializedCount: () => skeleton.scan(turns).filter(entry => entry.materialized).length,
    totalCount: () => turns.length,
    isMaterialized: id => skeleton.scan(turns).some(entry => entry.userMessageId === id && entry.materialized),
    applyBindings: () => undefined,
    onStatus: () => undefined,
    bridge,
    limits
  });
  hydrator.reset('fixture-1');
  return hydrator;
}
function attachPager(): { sentinel: HTMLElement; io: IntersectionObserver } {
  const sentinel = el('div'); sentinel.dataset.testid = 'conversation-pagination-sentinel';
  messages.prepend(sentinel);
  let page = 0;
  const io = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    page++;
    if (page === 1) mountWindow(8, 17, 2);
    else { mountWindow(0, 17, 2); sentinel.remove(); io.disconnect(); }
  });
  io.observe(sentinel);
  return { sentinel, io };
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
async function historyContractChecks(): Promise<void> {
  const origin = location.origin;
  const rewritten = rewriteConversationHistoryRequest(`${origin}/backend-api/conversations/fixture-1?num_turns=5`, 'GET', 'fixture-1');
  assert(rewritten?.includes('num_turns=100') && rewritten.includes('include_has_versions=true'), 'num_turns=5 was not raised to 100');
  assert(rewriteConversationHistoryRequest(`${origin}/backend-api/conversations/fixture-1?num_turns=200`, 'GET', 'fixture-1')?.includes('num_turns=200'), 'larger num_turns was reduced');
  const seen: string[] = [];
  const wrapped = wrapFetchForHistory(async (input: RequestInfo | URL) => {
    seen.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify({ page_info: { has_previous_page: false } }));
  }, () => 'fixture-1');
  await wrapped(`${origin}/backend-api/conversations/fixture-1?num_turns=5`);
  assert(seen[0].includes('num_turns=100'), 'wrapped GET did not raise num_turns');
  await wrapped(`${origin}/backend-api/conversations/fixture-1`, { method: 'POST', body: '{}' });
  assert(seen[1].endsWith('/conversations/fixture-1') && !seen[1].includes('num_turns='), 'POST was rewritten');
  await wrapped(`${origin}/backend-api/conversations/other-id?num_turns=5`);
  assert(seen[2].includes('num_turns=5'), 'other conversation was rewritten');
  await wrapped(`${origin}/backend-api/conversations/fixture-1?include_message_id=abc&num_turns=5`);
  assert(seen[3].includes('include_message_id=abc') && seen[3].includes('num_turns=5'), 'deep link was rewritten');
  await wrapped(`${origin}/backend-api/conversations/fixture-1?num_turns=5`, { headers: { accept: 'text/event-stream' } });
  assert(seen[4].includes('num_turns=5'), 'SSE was rewritten');
  pass('initial ChatGPT GET num_turns raised to 100; POST/SSE/send/deep-link left unchanged');
  const probe = el('div'); probe.style.cssText = 'position:fixed;top:0;left:0;width:40px;height:40px;background:red'; document.body.append(probe);
  let ordinary = 0;
  const ordinaryIo = new IntersectionObserver(() => { ordinary++; });
  ordinaryIo.observe(probe);
  await until(() => ordinary > 0, 'ordinary IntersectionObserver targets were intercepted');
  ordinaryIo.disconnect(); probe.remove();
  const first = el('div'); first.dataset.testid = 'conversation-pagination-sentinel'; messages.prepend(first);
  let sentinelCalls = 0;
  const sentinelIo = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) sentinelCalls++; });
  sentinelIo.observe(first);
  const generationOne = getHistoryPageStatus().generation;
  window.postMessage({ source: HISTORY_SOURCE, type: 'load-page', conversationId: 'fixture-1', nonce: 101 }, location.origin);
  await until(() => sentinelCalls > 0, 'synthetic sentinel callback did not fire');
  first.remove(); sentinelIo.unobserve(first);
  const second = el('div'); second.dataset.testid = 'conversation-pagination-sentinel'; messages.prepend(second);
  sentinelIo.observe(second);
  assert(getHistoryPageStatus().generation > generationOne, 'sentinel replacement did not bump generation');
  second.remove(); sentinelIo.disconnect();
  pass('ordinary IntersectionObserver behavior preserved; replaced sentinel starts a new generation');
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
  clearPendingJump();
  await historyContractChecks();
  const partial = skeleton.scan(turns);
  assert(partial.length === 18, 'API 18 turns must create 18 rail entries');
  assert(partial.filter(entry => entry.materialized).length === 5, 'initial 5 skeletons must not shrink the rail');
  assert(partial.slice(0, 13).every(entry => !entry.materialized && entry.turnContainerId === null), 'unloaded early turns were materialized');
  assert(partial.slice(13).every((entry, i) => entry.materialized && entry.turnContainerId === `u${13 + i}` && entry.userMessageId === `u${13 + i}`), 'last 5 skeletons bound to the wrong API turns');
  assert(partial[13].index === 13, 'global index of the first visible turn was reset');
  const mismatched = bindTurnsToSkeletons(turns, skeleton.collect().map((hit, i) => ({ ...hit, turnContainerId: `sk-${i}` })));
  assert(mismatched.every(entry => !entry.materialized), 'unproven skeleton window was index-mapped onto the first API turns');
  const onlyMid = skeleton.collect().map((hit, i) => i === 2 ? hit : { ...hit, turnContainerId: `other-${i}` });
  const filled = bindTurnsToSkeletons(turns, onlyMid);
  assert(filled.slice(13).every((entry, i) => entry.materialized && entry.turnContainerId === onlyMid[i].turnContainerId), 'unique proven offset did not fill the same window');
  const preview = skeleton.scan();
  assert(preview.length === 5 && preview.every(entry => !entry.turn), 'API-free skeleton preview missing');
  phantom.remove(); assert(skeleton.scan().length === 5 && skeleton.scan()[0].skeletonIndex === 0, 'even parity failed'); messages.prepend(phantom);
  const nested = el('div'); nested.dataset.turnIdContainer = 'nested-false-turn'; getTurnEl('u13')!.append(nested);
  assert(skeleton.scan(turns).length === 18, 'nested containers counted'); nested.remove();
  assert(findScrollRoot(getTurnEl('u13')) === scroller, 'scroll root incorrect');
  pass('API-first 18 markers with only the latest 5 skeletons; last-five binding; no first-five mapping');

  mountWindow(13, 17, 2);
  const growing = makeHydrator(mockBridge(n => {
    if (n === 0) mountWindow(8, 17, 2);
    else mountWindow(0, 17, 2);
    return okPage({ generation: n + 1, hasPreviousPage: n === 0, cursor: n === 0 ? 'c1' : null });
  }));
  await growing.startAuto();
  assert(skeleton.scan(turns).every(entry => entry.materialized), 'auto hydrate did not reach 18 skeletons');
  growing.dispose();
  mountWindow(13, 17, 2);
  const http = makeHydrator(mockBridge((_n, emit) => {
    emit({ type: 'fetch-result', status: 429, ok: false, conversationId: 'fixture-1', generation: 1, hasSentinel: true });
    return okPage({ status: 429, ok: false });
  }));
  await http.startAuto();
  assert(http.status === 'PARTIAL_STOPPED' && skeleton.collect().length === 5, '429 did not stop');
  http.dispose();
  const stalled = makeHydrator(mockBridge(() => okPage({ cursor: 'same' })), { stallRounds: 2, pageTimeoutMs: 80 });
  await stalled.startAuto();
  assert(stalled.status === 'PARTIAL_STOPPED', 'cursor/no-growth stall did not stop');
  stalled.dispose();
  const paged = makeHydrator(mockBridge(n => { mountWindow(Math.max(0, 12 - n), 17, 2); return okPage({ hasPreviousPage: true, cursor: `c${n}` }); }), { maxPages: 2, pageTimeoutMs: 80 });
  await paged.startAuto();
  assert(paged.status === 'PARTIAL_STOPPED', 'page cap did not stop');
  paged.dispose();
  const timed = makeHydrator(mockBridge(async () => { await wait(40); return okPage({ hasPreviousPage: true, cursor: 'late' }); }), { maxMs: 20, pageTimeoutMs: 80 });
  await timed.startAuto();
  assert(timed.status === 'PARTIAL_STOPPED', 'time cap did not stop');
  timed.dispose();
  const failed = makeHydrator(mockBridge(() => ({ ...okPage(), ok: false, status: 500, triggered: true })));
  await failed.startAuto();
  assert(failed.status === 'PARTIAL_STOPPED', 'network/HTTP failure did not stop');
  failed.dispose();
  mountWindow(13, 17, 2);
  let liveSwitch = true;
  const switching = makeHydrator(mockBridge(async () => {
    await wait(30);
    if (!liveSwitch) return { ...okPage(), triggered: false, ok: false, status: 0 };
    mountWindow(0, 17, 2);
    return okPage({ hasPreviousPage: false });
  }), { pageTimeoutMs: 80 });
  const running = switching.startAuto();
  liveSwitch = false;
  switching.reset('other');
  await running;
  assert(skeleton.collect().every(hit => Number(hit.turnContainerId.slice(1)) >= 13), 'old hydrate polluted the new conversation');
  switching.dispose();
  mountWindow(13, 17, 2);
  let pages = 0;
  const pausing = makeHydrator(mockBridge(async () => {
    pages++;
    await wait(40);
    mountWindow(Math.max(0, 13 - pages), 17, 2);
    return okPage({ hasPreviousPage: true, cursor: `p${pages}` });
  }), { idleMs: 80, maxResumes: 3, pageTimeoutMs: 200, maxPages: 20 });
  void pausing.startAuto();
  await wait(20);
  pausing.pause();
  window.dispatchEvent(new WheelEvent('wheel'));
  window.dispatchEvent(new Event('touchstart'));
  window.dispatchEvent(new PointerEvent('pointerdown'));
  const pausedAt = pages;
  await wait(50);
  assert(pages === pausedAt || pages === pausedAt + 1, 'pause did not stop promptly');
  await wait(120);
  assert(pages > pausedAt, 'idle resume did not run');
  pausing.pause(); await wait(120);
  pausing.pause(); await wait(120);
  pausing.pause();
  const afterThree = pages;
  await wait(150);
  assert(pages === afterThree, 'resume continued after 3 idle recoveries');
  pausing.dispose();
  mountWindow(13, 17, 2);
  scroller.scrollTop = targetY(getTurnEl('u16')!, scroller);
  const beforeTop = getTurnEl('u16')!.getBoundingClientRect().top;
  const anchor = captureReadingAnchor();
  mountWindow(8, 17, 2);
  restoreReadingAnchor(anchor);
  assert(Math.abs(getTurnEl('u16')!.getBoundingClientRect().top - beforeTop) < 6, 'reading anchor was not restored');
  pass('native hydrate stop bounds, session isolation, 3 idle resumes, and reading-anchor restore');

  mountWindow(13, 17, 2);
  let resolveApi!: (value: Response) => void;
  Object.assign(globalThis, { fetch: () => new Promise<Response>(resolve => { resolveApi = resolve; }) });
  controller = new RailController(); controller.syncRoute();
  const host = document.getElementById('chatgpt-yada-rail-host')!, shadow = host.shadowRoot!, layer = shadow.querySelector('.marks')!;
  assert(shadow.querySelectorAll('.mark').length === 5 && !host.hidden, 'API-pending rail should show current skeletons only');
  resolveApi(new Response(JSON.stringify(api))); Object.assign(globalThis, { fetch: normalFetch });
  await until(() => shadow.querySelectorAll('.mark').length === 18, 'API 18 turns did not render 18 markers');
  const marker = shadow.querySelector<HTMLButtonElement>('.mark')!;
  marker.focus();
  assert(shadow.querySelector('.preview')!.textContent?.includes('第 1 轮'), 'first marker is not global round 1');
  shadow.querySelectorAll<HTMLButtonElement>('.mark')[13].focus();
  assert(shadow.querySelector('.preview')!.textContent?.includes('第 14 轮'), 'visible turn 14 was shown as round 1');
  mountWindow(8, 17, 2); await wait(250);
  assert(shadow.querySelector('.mark') === marker && shadow.querySelectorAll('.mark').length === 18, '5→10 rebuilt markers');
  mountWindow(0, 17, 2); await wait(250);
  assert(shadow.querySelector('.mark') === marker && shadow.querySelectorAll('.mark').length === 18 && shadow.querySelector('.marks') === layer, '10→18 rebuilt markers');
  scroller.scrollTop = targetY(getTurnEl('u13')!, scroller); await wait(40);
  assert(syncActive(skeleton.scan(turns), scroller) === 13, 'active index was local instead of global');
  pass('API 18 markers with 5 DOM skeletons; 5→10→18 keeps marker nodes; global round numbers');

  const officialNav = el('div'); officialNav.style.cssText = 'position:fixed;right:16px;top:120px;width:35px;height:500px;overflow:auto';
  for (let i = 0; i < TURN_COUNT; i++) {
    const b = document.createElement('button'); b.dataset.tocItemIndex = String(i); b.textContent = '—'; b.style.cssText = 'display:block;width:30px;height:3px;padding:0;border:0';
    officialNav.append(b);
  }
  document.body.append(officialNav); const inserted = performance.now(); await frame();
  assert(host.hidden && performance.now() - inserted < 100, `native insertion did not suppress in one frame/100ms: hidden=${host.hidden}, latency=${performance.now()-inserted}, ready=${readChatGPTOfficialNavigation().ready}, rect=${JSON.stringify(officialNav.getBoundingClientRect())}`);
  assert(readChatGPTOfficialNavigation().ready && shadow.querySelector<HTMLElement>('.preview')!.hidden, 'preview not cleared');
  officialNav.hidden = true; await frame(); assert(!host.hidden, 'hidden native did not restore rail');
  officialNav.hidden = false; await frame(); assert(host.hidden, 'unhidden native failed');
  officialNav.setAttribute('aria-hidden', 'true'); await frame(); assert(!host.hidden, 'aria-hidden native failed');
  officialNav.removeAttribute('aria-hidden'); officialNav.style.visibility = 'hidden'; await frame(); assert(!host.hidden, 'visibility hidden native failed');
  officialNav.style.visibility = 'visible'; officialNav.style.top = '-600px'; await frame(); assert(!host.hidden, 'offscreen native suppressed rail');
  officialNav.style.top = '120px'; await frame(); assert(host.hidden, 'restored native failed');
  officialNav.remove(); await frame(); assert(!host.hidden && document.getElementById(host.id) === host && shadow.querySelector('.marks') === layer && shadow.querySelector('.mark') === marker, 'host/layer/marker was rebuilt');
  pass(`official insertion hides within one frame (<100ms); hidden/aria/visibility/viewport/removal restore same host and marks; preview and jump cleared`);

  const loaded = skeleton.scan(turns);
  assert(await jumpToTurn(loaded[16], loaded, new AbortController().signal), 'loaded turn 16 failed');
  assert(Math.abs(scroller.scrollTop - targetY(getTurnEl('u16')!, scroller)) < 2, 'jump 16 used the wrong container');
  mountWindow(13, 17, 2);
  attachPager();
  const unloaded = skeleton.scan(turns);
  assert(!unloaded[1].materialized, 'turn 2 should start unloaded');
  assert(await jumpToTurn(unloaded[1], unloaded, new AbortController().signal, {
    materialize: async () => {
      for (let i = 0; i < 4 && !skeleton.scan(turns)[1].materialized; i++) {
        window.postMessage({ source: HISTORY_SOURCE, type: 'load-page', conversationId: 'fixture-1', nonce: Date.now() + i }, location.origin);
        await wait(40);
      }
      await until(() => skeleton.scan(turns)[1].materialized, 'turn 2 never materialized');
      return skeleton.scan(turns)[1];
    }
  }), 'unloaded turn 2 did not hydrate then jump');
  assert(getTurnEl('u1') && Math.abs(scroller.scrollTop - targetY(getTurnEl('u1')!, scroller)) < 2, 'turn 2 jumped to the wrong id');
  pass('loaded turn 16 jumps directly; unloaded turn 2 hydrates then jumps by userMessageId');

  const abort = new AbortController(); scroller.scrollTop = 0;
  const long = jumpToTurn(loaded[10], loaded, abort.signal);
  assert(scroller.scrollTop > 600, 'long jump must be synchronous direct scroll'); await long; abort.abort();
  const shortAbort = new AbortController(), target = targetY(getTurnEl('u10')!, scroller);
  scroller.scrollTop = target - 300; const short = jumpToTurn(loaded[10], loaded, shortAbort.signal);
  assert(scroller.scrollTop < target - 250, 'short jump was immediate'); await wait(90);
  assert(scroller.scrollTop > target - 300 && scroller.scrollTop < target, 'short jump lacks rAF easing');
  assert(await short, 'short jump failed'); assert(Math.abs(scroller.scrollTop - target) < 2, 'short jump alignment'); shortAbort.abort();
  pass('>600px direct jump and 280ms short-distance rAF interpolation');
  const official = el('div'); official.style.cssText = 'position:fixed;right:16px;top:120px;width:35px;height:500px;overflow:auto';
  let nativeCalls = -1;
  for (let i = 0; i < TURN_COUNT; i++) {
    const b = document.createElement('button'); b.dataset.tocItemIndex = String(loaded[i].skeletonIndex); b.textContent = '—'; b.style.cssText = 'display:block;width:30px;height:3px;padding:0;border:0';
    b.addEventListener('click', () => { nativeCalls = i; }); official.append(b);
  }
  document.body.append(official);
  assert(await jumpToTurn(loaded[10], loaded, new AbortController().signal) && nativeCalls === 10, 'native skeleton-index click failed');
  [...official.children].forEach((b, i) => b.setAttribute('data-toc-item-index', String(i)));
  await jumpToTurn(loaded[10], loaded, new AbortController().signal); assert(nativeCalls === 10, 'ordinal native-index fallback failed');
  [...official.children].forEach(b => { b.removeAttribute('data-toc-item-index'); b.setAttribute('data-toc-active', 'false'); });
  await jumpToTurn(loaded[10], loaded, new AbortController().signal); assert(nativeCalls === 10, 'active-only native buttons not called');
  official.remove(); pass('official buttons outside main: exact skeleton index, changed ordinal semantics and visible-order fallback');
  const correction = new AbortController(); await jumpToTurn(loaded[12], loaded, correction.signal);
  const started = performance.now();
  for (const ms of [200, 600, 1200, 2000]) {
    await wait(Math.max(0, ms - 80 - (performance.now() - started)));
    const old = getTurnEl('u12')!, fresh = old.cloneNode(true) as HTMLElement;
    fresh.style.transform = `translateY(${ms / 2}px)`; old.replaceWith(fresh);
    await wait(Math.max(0, ms + 55 - (performance.now() - started)));
    assert(getTurnEl('u12') === fresh && Math.abs(scroller.scrollTop - targetY(fresh, scroller)) < 2, `fresh-node correction failed at ${ms}ms`);
  }
  correction.abort(); getTurnEl('u12')!.style.transform = '';
  pass('200/600/1200/2000ms corrections re-query replaced target containers and correct >40px error');
  for (const event of [new WheelEvent('wheel'), new Event('touchstart'), ...['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].map(key => new KeyboardEvent('keydown', { key }))]) {
    const cancel = new AbortController(); await jumpToTurn(loaded[10], loaded, cancel.signal);
    window.dispatchEvent(event); scroller.scrollTop += 120; const top = scroller.scrollTop;
    await wait(240); assert(scroller.scrollTop === top, `continued after ${event.type}/${(event as KeyboardEvent).key}`); cancel.abort();
  }
  const routeAbort = new AbortController(); await jumpToTurn(loaded[10], loaded, routeAbort.signal);
  history.pushState({}, '', '/c/route-changed'); scroller.scrollTop += 120; const routeTop = scroller.scrollTop;
  await wait(260); assert(scroller.scrollTop === routeTop, 'route did not cancel correction'); routeAbort.abort(); history.replaceState({}, '', '/c/fixture-1');
  pass('wheel/touch/all scroll keys and SPA route changes immediately stop subsequent correction');

  history.pushState({}, '', '/'); await frame(); await frame(); assert(host.hidden, 'route exit not cleared');
  history.replaceState({}, '', '/c/api-failure'); Object.assign(globalThis, { fetch: async () => { throw new Error('offline fixture'); } });
  await frame(); await wait(250); assert(shadow.querySelectorAll('.mark').length === 18 && !host.hidden, 'API failure removed skeleton rail');
  controller.dispose(); controller = null; Object.assign(globalThis, { fetch: normalFetch }); history.replaceState({}, '', '/c/fixture-1');
  pass('API pending/failure leaves navigation usable; SPA lifecycle resets without React/page bridge');

  clearPendingJump(); sessionStorage.removeItem('chatgpt-yada:message-fallback:fixture-1');
  writePendingJump({ conversationId: 'fixture-1', userMessageId: 'u2', index: 1, attempted: true });
  assert(readPendingJump()?.userMessageId === 'u2', 'pending target was not stored');
  markMessageFallbackUsed('fixture-1');
  assert(messageFallbackUsed('fixture-1') && !canUseMessageFallback('fixture-1'), 'fallback was not limited to once per conversation/tab');
  const withQuery = messageQueryHref(`${location.origin}/c/fixture-1`);
  assert(withQuery?.includes('message='), 'empty message query was not added');
  assert(messageQueryHref(`${location.origin}/c/fixture-1?message=`) === null, 'message fallback formed a refresh loop');
  clearPendingJump();
  pass('?message= fallback runs once, restores pending target, and cannot loop');

  const previewView = new RailView(() => {}), userTime = new Date(2026, 8, 17, 8, 31, 42).getTime() / 1000;
  const previewEntry = { ...loaded[6], index: 0, turn: { ...turns[6], userCreatedAt: userTime, userPreview: '长用户正文'.repeat(180), assistantPreview: 'Assistant remains visible '.repeat(80) } };
  previewView.setEntries([previewEntry]); previewView.host.style.cssText = 'position:fixed;right:30px;top:300px;height:40px';
  const pv = previewView.host.shadowRoot!, pvMark = pv.querySelector<HTMLButtonElement>('.mark')!; pvMark.focus();
  const previewBox = pv.querySelector<HTMLElement>('.preview')!;
  assert(previewBox.querySelector('[data-preview-role="Harson"]') && !previewBox.querySelector('[data-preview-role="ChatGPT"]') && !previewBox.textContent!.includes('User'), 'gray mode label/content');
  assert(previewBox.querySelector('time')?.textContent === '09月17日 周四 08:31:42', 'local preview time format');
  const titleRect = previewBox.querySelector('.preview-header strong')!.getBoundingClientRect(), timeRect = previewBox.querySelector('time')!.getBoundingClientRect();
  assert(Math.abs(titleRect.top - timeRect.top) < 5 && timeRect.left > titleRect.right, 'round/time not on same row');
  previewView.setPreviewMode(true);
  for (const section of previewBox.querySelectorAll<HTMLElement>('section')) {
    const label = getComputedStyle(section.querySelector('strong')!);
    assert(label.color === 'rgb(16, 163, 127)' && Number(label.fontWeight) >= 700, 'role not green/bold');
    assert(getComputedStyle(section.querySelector('p')!).webkitLineClamp === '2' && section.getBoundingClientRect().bottom <= previewBox.getBoundingClientRect().bottom, 'independent 2-line block clipped');
  }
  assert(previewBox.querySelector('[data-preview-role="ChatGPT"]'), 'assistant missing with long Harson text');
  await wait(1100); assert([...previewBox.querySelectorAll('p')].every(p => getComputedStyle(p).webkitLineClamp === '5'), 'independent 5-line expansion failed');
  previewView.setEntries([{ ...previewEntry, turn: { ...previewEntry.turn!, userCreatedAt: undefined } }]);
  assert(!previewBox.querySelector('time') && formatPreviewTime(NaN) === '', 'missing time fabricated');
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
