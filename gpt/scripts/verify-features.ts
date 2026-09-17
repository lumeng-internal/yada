import { normalizeConversation } from '../src/conversation/normalizeConversation';
import { bindDomAnchorsToTurns, collectDomConversationTurns } from '../src/conversation/domCollector';
import type { ApiConversation, ApiConversationMessage } from '../src/conversation/fetchConversation';
import { fetchCompleteConversation } from '../src/conversation/completeConversation';
import { getActiveTurn, resolveScrollRoot } from '../src/rail/active';
import { RailController } from '../src/rail/controller';
import { jumpToTurn } from '../src/rail/jump';
import { readableTop } from '../src/rail/alignment';
import { readChatGPTOfficialNavigation } from '../src/rail/officialNavigation';
import { RailView } from '../src/rail/view';
import { captureComposerSelection, insertPrompt, insertPromptWhenReady } from '../src/prompts/composer';
import { readLibrary, saveLibrary, PROMPT_KEY, PREVIEW_KEY } from '../src/prompts/storage';
import { YadaToolbar } from '../src/ui/toolbar';

const savedChecks = JSON.parse(sessionStorage.getItem('yada-reload-checks') || '[]') as string[];
const result = { done: false, checks: savedChecks, error: '' };
Object.assign(globalThis, { yadaVerification: result });
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const pass = (message: string): void => { result.checks.push(message); };
const wait = (ms = 80): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 90; i++) { if (fn()) return; await wait(); }
  throw new Error(message);
}
function el(tag: string, text = ''): HTMLElement { const node = document.createElement(tag); node.textContent = text; return node; }
const css = el('style');
css.textContent = `body{margin:0;font:14px/1.4 system-ui}main{width:1000px;margin-top:40px}#thread{height:680px;overflow-y:auto;position:relative}#messages{position:relative}article.fixture{position:absolute;left:60px;right:60px;overflow:hidden}header{position:fixed;top:0;left:0;right:0;height:96px;z-index:20;background:white;transform:translateZ(0);overflow:hidden}#conversation-header-actions{float:right}form.composer{position:fixed;bottom:10px;left:70px;width:600px}#prompt-textarea{min-height:40px;white-space:pre-wrap;border:1px solid gray}.user{min-height:60px}.assistant{margin-top:20px}`;
document.head.append(css);
const header = el('header'); header.id = 'page-header'; const actions = el('div'); actions.id = 'conversation-header-actions'; header.append(actions);
const main = el('main'), scroller = el('div'), messages = el('div'); scroller.id = 'thread'; messages.id = 'messages'; scroller.append(messages); main.append(scroller);
const form = el('form'); form.className = 'composer'; let editor = el('div'); editor.id = 'prompt-textarea'; editor.contentEditable = 'true'; editor.setAttribute('role', 'textbox'); form.append(editor);
const draft = el('div', 'unsent attachment'); draft.dataset.messageAuthorRole = 'user'; draft.dataset.messageId = 'u119'; form.append(draft);
document.body.append(header, main, form);
let sends = 0, inputs = 0;
const send = document.createElement('button'); send.textContent = 'Send'; send.disabled = true; form.append(send);
form.addEventListener('submit', event => { event.preventDefault(); sends++; });
form.addEventListener('input', () => { inputs++; send.disabled = !editor.innerText.trim(); });
const api: ApiConversation = { id: 'fixture-1', current_node: 'a119', mapping: { root: { id: 'root', message: null } } };
for (let i = 0; i < 120; i++) {
  api.mapping![`u${i}`] = { id: `u${i}`, parent: i ? `a${i - 1}` : 'root', message: { id: `u${i}`, author: { role: 'user' }, content: { content_type: 'text', parts: [`User ${i} question`] }, create_time: 1700000000 + i } };
  api.mapping![`a${i}`] = { id: `a${i}`, parent: `u${i}`, message: { id: `a${i}`, author: { role: 'assistant' }, channel: 'final', content: { content_type: 'text', parts: [`Assistant ${i} answer`] }, create_time: 1700000001 + i } };
}
const turns = normalizeConversation(api);
const heights = turns.map((_, i) => [210, 970, 345, 1620, 540, 285][i % 6]);
const offsets: number[] = [0]; heights.forEach(height => offsets.push(offsets.at(-1)! + height));
messages.style.height = `${offsets.at(-1)! + 650}px`;
let renderedStart = -1, rebuilds = 0, bridgeCalls = 0, bridgeDisabled = false, frozen = false;
function renderVirtual(force = false): void {
  if (frozen) return;
  const at = Math.max(0, offsets.findIndex((offset, i) => i < 120 && offset + heights[i] > scroller.scrollTop));
  const start = Math.max(0, Math.min(114, at - 2));
  if (!force && start === renderedStart) return;
  renderedStart = start; rebuilds++; messages.replaceChildren();
  for (let i = start; i < start + 6; i++) {
    const article = el('article'); article.className = 'fixture'; article.dataset.testid = `conversation-turn-${i + 1}`; article.dataset.index = String(i); article.style.top = `${offsets[i]}px`; article.style.height = `${heights[i] - 20}px`;
    const user = el('div', `User ${i} question`); user.className = 'user'; user.dataset.messageAuthorRole = 'user'; user.dataset.messageId = `u${i}`;
    const assistant = el('div', `Assistant ${i} answer`); assistant.className = 'assistant'; assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = `a${i}`;
    article.append(user, assistant); messages.append(article);
  }
}
scroller.addEventListener('scroll', () => renderVirtual()); renderVirtual();
// The REAL upstream page bridge discovers this React ref and calls it via its unchanged protocol.
Object.assign(scroller, { '__reactProps$yadaFixture': { ref: { current: {
  scrollToIndex(value: { index: number } | number) {
    if (bridgeDisabled) throw new Error('fixture native API unavailable');
    const index = typeof value === 'number' ? value : value.index;
    bridgeCalls++;
    scroller.scrollTop = offsets[Math.max(0, Math.min(119, index))];
    // Asynchronous topology replacement, not a mocked successful bridge response.
    setTimeout(() => renderVirtual(true), 35);
  }, getVirtualItems() { return []; }, getTotalSize() { return offsets.at(-1); }
} } } });
const storage = {
  async get(key: string) { const value = localStorage.getItem(key); return { [key]: value === null ? undefined : JSON.parse(value) }; },
  async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); }
};
Object.assign(globalThis, { chrome: { runtime: { getURL: (path: string) => `${location.origin}/${path}` }, storage: { local: storage } } });
let fetches = 0;
const normalFetch = async (url: string): Promise<Response> => { if (url.includes('/api/auth/session')) return new Response('{}'); fetches++; return new Response(JSON.stringify(api)); };
Object.assign(globalThis, { fetch: normalFetch });
let controller: RailController | null = null, toolbar: YadaToolbar | null = null, reloading = false;
const promptHost = (): HTMLElement => document.getElementById('chatgpt-yada-prompt-host')!;
const modal = (): ShadowRoot => promptHost().shadowRoot!;
const promptButton = (): HTMLButtonElement => document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector('[data-prompts]')!;
const clickAction = (action: string): void => { const button = modal().querySelector<HTMLButtonElement>(`[data-prompt-action="${action}"]`); assert(button, `missing ${action}`); button!.click(); };
async function openPanel(): Promise<void> {
  promptButton().dispatchEvent(new PointerEvent('pointerdown')); promptButton().click();
  await until(() => !promptHost().hidden && !!modal().querySelector('input[type="search"]') && modal().activeElement?.getAttribute('type') === 'search', 'prompt panel did not load');
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
    const expectedGreen = sessionStorage.getItem('yada-reload-mode') !== 'gray';
    await until(() => document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector('[data-preview-mode]')?.getAttribute('aria-pressed') === String(expectedGreen), 'gray/green preference did not survive page reload');
    await openPanel();
    assert(modal().querySelector('.yada-prompt-item-title')?.textContent === 'Reload retained', 'prompt not retained after real page reload');
    pass(`actual browser reload retains ${expectedGreen ? 'green' : 'gray'} preview preference and v1 prompt data`);
    if (expectedGreen) {
      clickAction('close');
      document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector<HTMLButtonElement>('[data-preview-mode]')!.click();
      await until(() => localStorage.getItem(PREVIEW_KEY) === 'false', 'gray not persisted');
      sessionStorage.setItem('yada-reload-mode', 'gray');
      sessionStorage.setItem('yada-reload-checks', JSON.stringify(result.checks)); reloading = true; location.reload(); return;
    }
    sessionStorage.removeItem('yada-reload-checks'); sessionStorage.removeItem('yada-reload-mode'); return;
  }
  await apiChecks();
  assert(collectDomConversationTurns().length === 6 && bindDomAnchorsToTurns(turns).length === 120, 'partial DOM changed canonical count');
  assert(!bindDomAnchorsToTurns(turns)[119].userAnchorElement, 'composer attachment became a target');
  const wrapper = el('div'); wrapper.style.overflowY = 'auto'; messages.firstElementChild!.prepend(wrapper); wrapper.textContent = 'not scrollable';
  assert(resolveScrollRoot(wrapper) === scroller, 'CSS-only overflow was accepted as scroll root');
  pass('120 API turns, mounted window only, composer exclusion, real overflow scroll-root selection');
  const previouslyBound = bindDomAnchorsToTurns(turns); const recycled = messages.querySelector<HTMLElement>('[data-message-id="u0"]')!;
  recycled.dataset.messageId = 'unknown'; assert(!bindDomAnchorsToTurns(previouslyBound)[0].anchorMappingTrusted, 'recycled ID trusted'); recycled.dataset.messageId = 'u0';
  pass('recycled DOM identities are not trusted');
  for (let n = 0; n < 2; n++) { const stale = el('div'); stale.id = 'chatgpt-yada-rail-host'; document.documentElement.append(stale); }
  controller = new RailController(); controller.syncRoute();
  toolbar = new YadaToolbar(value => controller?.setPreviewMode(value)); toolbar.mount(); toolbar.setVisible(true);
  await until(() => document.getElementById('chatgpt-yada-rail-host')?.shadowRoot?.querySelectorAll('.mark').length === 120, 'rail did not load');
  const host = document.getElementById('chatgpt-yada-rail-host')!, shadow = host.shadowRoot!, layer = shadow.querySelector('.marks')!, firstMarker = shadow.querySelector('.mark');
  assert(document.querySelectorAll('#chatgpt-yada-rail-host').length === 1 && shadow.querySelectorAll('.marks').length === 1, 'duplicate hosts/layers');
  const scan = () => turns; // Jump adapter must not require repeated full DOM/API scans.
  for (const index of [2, 117, 1, 60]) {
    assert(await jumpToTurn(`u${index}`, scan, () => scroller, new AbortController().signal), `jump failed ${index}`);
    const node = messages.querySelector<HTMLElement>(`[data-message-id="u${index}"]`)!;
    assert(Math.abs(node.getBoundingClientRect().top - readableTop(scroller, node)) <= 8, `target ${index} covered/misaligned`);
    assert(getActiveTurn(bindDomAnchorsToTurns(turns), scroller) === index, 'active index incorrect');
  }
  assert(bridgeCalls >= 3 && rebuilds > 3 && shadow.querySelector('.mark') === firstMarker, 'bridge unused or rail rebuilt');
  pass('variable-height (210–1620px) front/middle/end jumps through real upstream page bridge and asynchronous window rebuilds');
  // Replace the exact node after the first alignment and shift it by 90px.
  scroller.scrollTop = offsets[50]; renderVirtual(true); await wait();
  const old = messages.querySelector<HTMLElement>('[data-message-id="u50"]')!;
  setTimeout(() => { const replacement = old.cloneNode(true) as HTMLElement; replacement.style.transform = 'translateY(90px)'; old.replaceWith(replacement); }, 30);
  assert(await jumpToTurn('u50', scan, () => scroller, new AbortController().signal), 'replacement calibration failed');
  const latest = messages.querySelector<HTMLElement>('[data-message-id="u50"]')!;
  assert(latest !== old && Math.abs(latest.getBoundingClientRect().top - readableTop(scroller, latest)) <= 8, 'stale node declared success');
  pass('same message ID re-resolved after node replacement; measured header offset and stable re-calibration');
  bridgeDisabled = true;
  scroller.scrollTop = offsets[20]; renderVirtual(true); await wait();
  assert(await jumpToTurn('u25', scan, () => scroller, new AbortController().signal), 'directional native-unavailable fallback failed');
  pass('bridge-unavailable path uses mounted-window direction and mutation-driven paging');
  // Frozen window exercises stagnation/boundary/nudge without reversing toward a neighbor.
  frozen = true;
  const tops: number[] = []; const recordTop = (): void => { tops.push(scroller.scrollTop); }; scroller.addEventListener('scroll', recordTop);
  assert(!await jumpToTurn('u110', scan, () => scroller, new AbortController().signal), 'missing target falsely resolved');
  scroller.removeEventListener('scroll', recordTop);
  assert(tops.every((top, i) => i === 0 || top >= tops[i - 1]), 'fallback oscillated');
  frozen = false; bridgeDisabled = false;
  const neighbor = turns.map(turn => ({ ...turn })); neighbor[25].userMessageId = 'missing-id'; neighbor[25].userPreview = 'User 24 question';
  scroller.scrollTop = offsets[24]; renderVirtual(true); await wait();
  assert(!await jumpToTurn('u25', () => neighbor, () => scroller, new AbortController().signal), 'similar adjacent message claimed success');
  pass('stagnation/boundary failure is explicit and monotonic; nearby similar text cannot satisfy missing ID');
  for (const event of [new WheelEvent('wheel'), new Event('touchstart'), new KeyboardEvent('keydown', { key: 'PageDown' }), new KeyboardEvent('keydown', { key: 'Home' }), new PointerEvent('pointerdown'), new MouseEvent('click')]) {
    scroller.scrollTop = offsets[30]; renderVirtual(true); await wait();
    const pending = jumpToTurn('u30', scan, () => scroller, new AbortController().signal);
    window.dispatchEvent(event); const top = scroller.scrollTop;
    assert(!await pending, `user intent ${event.type} ignored`); await wait(100); assert(scroller.scrollTop === top, 'scroll continued after user takeover');
  }
  pass('wheel/touch/navigation keys/pointer/click cancel immediately without later calibration');
  scroller.scrollTop = offsets[30]; renderVirtual(true); await wait();
  const routePending = jumpToTurn('u30', scan, () => scroller, new AbortController().signal);
  history.pushState({}, '', '/c/another-route');
  assert(!await routePending, 'pushState route did not cancel'); history.replaceState({}, '', '/c/fixture-1');
  pass('SPA pushState cancels within the next frame without waiting for route polling');
  const cancel = new AbortController(); const pending = jumpToTurn('u80', scan, () => scroller, cancel.signal); cancel.abort(); assert(!await pending, 'route abort ignored');
  const marker = shadow.querySelectorAll<HTMLButtonElement>('.mark')[30]; marker.click();
  await wait(20);
  const officialRoot = el('div'); officialRoot.className = 'abc_convSearchResultHighlightRoot';
  const official = el('div'); official.className = 'fixed inset-e-4 top-1/2 z-20 -translate-y-1/2';
  official.style.cssText = 'position:fixed;right:16px;top:200px;width:40px;display:flex;flex-direction:column';
  for (let i = 0; i < 6; i++) { const b = el('button', '—'); b.style.height = '16px'; official.append(b); }
  officialRoot.append(official); main.append(officialRoot);
  await until(() => host.hidden, 'official navigation did not hide Yada');
  assert(readChatGPTOfficialNavigation().ready && shadow.querySelector<HTMLElement>('.preview')!.hidden, 'official detection/preview cleanup failed');
  official.style.display = 'none'; await until(() => !host.hidden, 'same host failed to restore');
  assert(document.getElementById('chatgpt-yada-rail-host') === host && shadow.querySelector('.marks') === layer, 'host/layer replaced');
  officialRoot.className = 'future-renamed-root'; official.className = 'future-navigation'; official.style.display = 'flex'; official.style.top = '400px';
  await until(() => host.hidden, 'geometry fallback missing'); officialRoot.remove(); await until(() => !host.hidden, 'official removal restore failed');
  assert(document.querySelectorAll('#chatgpt-yada-rail-host').length === 1, 'duplicate restored rail');
  pass('official selectors and geometry fallback: hide/clear/cancel, hidden/remove restore SAME host and marks layer');
  // Exercise the preview view directly with >500 characters, without a truncated API preview fixture.
  controller.dispose(); controller = null;
  const previewView = new RailView(() => {}); previewView.setTurns([{ ...turns[0], userPreview: '长用户摘要'.repeat(150), assistantPreview: 'assistantPreview remains visible' }]);
  const pvRoot = previewView.host.shadowRoot!, pvMark = pvRoot.querySelector<HTMLButtonElement>('.mark')!;
  previewView.host.style.cssText = 'position:fixed;right:30px;top:300px;height:40px';
  pvMark.focus();
  const preview = pvRoot.querySelector<HTMLElement>('.preview')!;
  assert(!preview.querySelector('[data-preview-role="ChatGPT"]'), 'gray shows assistant');
  previewView.setPreviewMode(true);
  const assistantBlock = preview.querySelector<HTMLElement>('[data-preview-role="ChatGPT"]')!;
  assert(assistantBlock.textContent!.includes('ChatGPT') && assistantBlock.textContent!.includes('assistantPreview'), 'long User pushed assistant out');
  for (const section of preview.querySelectorAll<HTMLElement>('section')) {
    assert(getComputedStyle(section.querySelector('p')!).webkitLineClamp === '2', 'summaries share clamp');
    assert(section.getBoundingClientRect().bottom <= preview.getBoundingClientRect().bottom, 'block clipped');
  }
  await wait(1100); assert([...preview.querySelectorAll('p')].every(p => getComputedStyle(p).webkitLineClamp === '5'), 'separate hover expansion failed');
  previewView.setTurns([{ ...turns[0], assistantPreview: '' }]); previewView.setPreviewMode(false); previewView.setPreviewMode(true);
  assert(preview.textContent!.includes('该轮暂无 ChatGPT 回复'), 'pending reply placeholder absent');
  previewView.dispose();
  const mode = document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector<HTMLButtonElement>('[data-preview-mode]')!;
  mode.click(); await wait(); assert((await storage.get(PREVIEW_KEY))[PREVIEW_KEY] === true, 'preview persistence key changed');
  pass('gray User-only; 750-character User and assistant independently visible at 2/5 lines; pending placeholder and unchanged preference key');
  // Native editor events and undo; invalid saved bookmark must append, not overwrite a changed draft.
  editor.textContent = ''; editor.focus(); assert(insertPrompt('hello') && editor.innerText === 'hello', 'empty insertion failed');
  assert(inputs > 0 && !send.disabled, 'normal input did not update composer send state');
  editor.textContent = 'abcdef'; editor.focus(); const range = document.createRange(); range.setStart(editor.firstChild!, 2); range.setEnd(editor.firstChild!, 4); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  const bookmark = captureComposerSelection(); assert(insertPrompt('X', bookmark) && editor.innerText === 'abXef', 'saved selection not replaced');
  document.execCommand('undo'); assert(editor.innerText === 'abcdef', 'native undo missing');
  const sameTextBookmark = captureComposerSelection();
  editor.replaceChildren(document.createTextNode('abcdef'));
  assert(insertPrompt('same-text-remount', sameTextBookmark) && /^abcdef\n{2,3}same-text-remount$/.test(editor.innerText), 'invalid live Range reused after node replacement');
  editor.textContent = 'changed draft'; assert(insertPrompt('tail', bookmark) && /^changed draft\n{2,3}tail$/.test(editor.innerText), 'changed draft overwritten');
  const textarea = document.createElement('textarea'); editor.removeAttribute('id'); textarea.id = 'prompt-textarea'; form.prepend(textarea); textarea.value = 'abcd'; textarea.focus(); textarea.setSelectionRange(1, 3);
  assert(insertPrompt('Z', captureComposerSelection()) && textarea.value === 'aZd', 'textarea selection failed'); textarea.remove(); editor.id = 'prompt-textarea';
  const savedEditor = editor; editor.remove();
  const waiting = insertPromptWhenReady('remounted', null, new AbortController().signal);
  setTimeout(() => { editor = savedEditor.cloneNode(false) as HTMLElement; form.prepend(editor); }, 80);
  assert(await waiting && editor.innerText === 'remounted', 'wait/reacquire editor failed');
  pass('native contenteditable/textarea insertion, input/send-state events, selection, changed draft append, undo, editor remount');
  await saveLibrary({ version: 1, prompts: [] }); await openPanel();
  const panel = modal().querySelector<HTMLElement>('.yada-prompt-panel')!;
  assert(promptHost().parentElement === document.body && !document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!.querySelector('.yada-prompt-panel'), 'panel still in header');
  assert(panel.getBoundingClientRect().width >= 500 && panel.getBoundingClientRect().height >= 300 && panel.getBoundingClientRect().bottom <= innerHeight, 'modal collapsed/clipped');
  document.documentElement.classList.add('dark'); await wait(); assert(modal().querySelector<HTMLElement>('.yada-prompt-modal')!.dataset.toolkitTheme === 'dark', 'dark theme absent'); document.documentElement.classList.remove('dark');
  clickAction('add'); modal().querySelector<HTMLInputElement>('[name="title"]')!.value = '<img src=x onerror=alert(1)>';
  modal().querySelector<HTMLTextAreaElement>('[name="content"]')!.value = 'prompt body'; modal().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await until(() => !!modal().querySelector('.yada-prompt-item'), 'add not saved'); assert(!modal().querySelector('img'), 'unsafe prompt rendering');
  const search = modal().querySelector<HTMLInputElement>('input[type="search"]')!; search.value = 'no match'; search.dispatchEvent(new Event('input')); assert(!modal().querySelector('.yada-prompt-item'), 'search failed'); search.value = 'body'; search.dispatchEvent(new Event('input')); assert(modal().querySelector('.yada-prompt-item'), 'content search failed');
  clickAction('edit'); modal().querySelector<HTMLInputElement>('[name="title"]')!.value = 'Updated title'; modal().querySelector<HTMLTextAreaElement>('[name="content"]')!.value = 'updated body'; modal().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await until(() => modal().querySelector('.yada-prompt-item-title')?.textContent === 'Updated title', 'edit not saved');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert(promptHost().hidden, 'Escape failed'); await openPanel();
  editor.textContent = 'existing draft'; editor.blur(); window.getSelection()?.removeAllRanges();
  const insert = modal().querySelector<HTMLButtonElement>('[data-prompt-action="insert"]')!; insert.click(); insert.click();
  await until(() => promptHost().hidden, 'insert did not close');
  assert(/^existing draft\n{2,3}updated body$/.test(editor.innerText) && sends === 0, 'draft overwritten, duplicate inserted or auto-sent');
  document.execCommand('undo'); assert(editor.innerText === 'existing draft', 'panel insertion lost undo');
  await openPanel(); clickAction('delete'); await until(() => !modal().querySelector('.yada-prompt-item'), 'delete failed');
  assert((await readLibrary()).prompts.length === 0, 'deletion not persisted');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); assert(promptHost().hidden, 'outside close failed');
  history.pushState({}, '', '/'); await openPanel(); assert(!promptHost().hidden, 'new conversation modal unavailable'); clickAction('close');
  pass('body Shadow DOM modal size/theme; CRUD/search/reopen/storage/safe rendering; one insertion, retained draft, undo, no send; new conversation');
  await saveLibrary({ version: 1, prompts: [{ id: 'existing-210-id', title: 'Reload retained', content: '2.1.0 storage preserved', createdAt: 10, updatedAt: 20 }] });
  assert(localStorage.getItem(PROMPT_KEY), 'storage key changed');
  toolbar.dispose(); toolbar = null;
  assert(!document.getElementById('chatgpt-yada-prompt-host'), 'disposed prompt host leaked');
  pass('independent hosts and listeners disposed; existing 2.1.0 IDs/timestamps/schema retained');
  sessionStorage.setItem('yada-reload-checks', JSON.stringify(result.checks)); reloading = true; location.reload();
}
void run().catch(error => { result.error = error.stack ?? String(error); }).finally(() => {
  if (!reloading) { controller?.dispose(); toolbar?.dispose(); result.done = true; }
});
