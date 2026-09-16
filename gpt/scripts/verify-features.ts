import { normalizeConversation } from "../src/conversation/normalizeConversation";
import { bindDomAnchorsToTurns, collectDomConversationTurns } from "../src/conversation/domCollector";
import type { ApiConversation } from "../src/conversation/fetchConversation";
import { activeTurnAtLine, getActiveTurn, resolveScrollRoot } from "../src/rail/active";
import { RailController } from "../src/rail/controller";
import { jumpToTurn } from "../src/rail/jump";
import { captureComposerSelection, insertPrompt } from "../src/prompts/composer";
import { parseLibrary, readLibrary, saveLibrary, PROMPT_KEY, PREVIEW_KEY } from "../src/prompts/storage";
import { YadaToolbar } from "../src/ui/toolbar";

const result = { done: false, checks: [] as string[], error: "" };
Object.assign(globalThis, { yadaVerification: result });
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const pass = (message: string): void => { result.checks.push(message); };
const wait = (ms = 200): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn: () => boolean, message: string): Promise<void> {
  for (let n = 0; n < 70; n++) { if (fn()) return; await wait(100); }
  throw new Error(message);
}
function el(tag: string, text = ""): HTMLElement { const element = document.createElement(tag); element.textContent = text; return element; }
const css = el('style'); css.textContent = 'body{margin:0} main{width:1000px;margin-top:80px} #thread{height:600px;overflow-y:auto;position:relative} #messages{height:48000px;position:relative} article{position:absolute;height:300px;left:60px;right:60px} form{position:fixed;bottom:10px;left:70px;width:600px} #prompt-textarea{min-height:40px;white-space:pre-wrap;border:1px solid gray} header{position:fixed;top:0;right:0;height:60px}'; document.head.append(css);
const header = el('header'); header.id = 'page-header'; const actions = el('div'); actions.id = 'conversation-header-actions'; header.append(actions);
const main = el('main'), scroller = el('div'), messages = el('div'); scroller.id = 'thread'; messages.id = 'messages'; scroller.append(messages); main.append(scroller);
const form = el('form'), editor = el('div'); editor.id = 'prompt-textarea'; editor.contentEditable = 'true'; editor.setAttribute('role', 'textbox'); form.append(editor);
const draft = el('div', 'unsent attachment'); draft.setAttribute('data-message-author-role', 'user'); draft.setAttribute('data-message-id', 'u119'); form.append(draft);
document.body.append(header, main, form);
let sends = 0; form.addEventListener('submit', e => { e.preventDefault(); sends++; });
const api: ApiConversation = { id: 'fixture-1', current_node: 'a119', mapping: { root: { id: 'root', message: null } } };
for (let index = 0; index < 120; index++) {
  api.mapping![`u${index}`] = { id: `u${index}`, parent: index ? `a${index - 1}` : 'root', message: { id: `u${index}`, author: { role: 'user' }, content: { content_type: 'text', parts: [`User ${index} question`] }, create_time: 1700000000 + index } };
  api.mapping![`a${index}`] = { id: `a${index}`, parent: `u${index}`, message: { id: `a${index}`, author: { role: 'assistant' }, channel: 'final', content: { content_type: 'text', parts: [`Assistant ${index} answer`] }, create_time: 1700000001 + index } };
}
const turns = normalizeConversation(api);
let renderedStart = -1;
function renderVirtual(): void {
  const start = Math.max(0, Math.min(114, Math.floor(scroller.scrollTop / 400) - 2));
  if (start === renderedStart) return;
  renderedStart = start; messages.replaceChildren();
  for (let index = start; index < start + 6; index++) {
    const article = el('article'); article.dataset.testid = `conversation-turn-${index}`; article.style.top = `${index * 400}px`;
    const user = el('div', `User ${index} question`); user.dataset.messageAuthorRole = 'user'; user.dataset.messageId = `u${index}`;
    const assistant = el('div', `Assistant ${index} answer`); assistant.dataset.messageAuthorRole = 'assistant'; assistant.dataset.messageId = `a${index}`;
    article.append(user, assistant); messages.append(article);
  }
}
scroller.addEventListener('scroll', renderVirtual); renderVirtual();
const storage = {
  async get(key: string) { const value = localStorage.getItem(key); return { [key]: value === null ? undefined : JSON.parse(value) }; },
  async set(values: Record<string, unknown>) { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)); }
};
Object.assign(globalThis, { chrome: { storage: { local: storage } } });
let fetches = 0;
Object.assign(globalThis, { fetch: async (url: string) => { if (url.includes('/api/auth/session')) return new Response('{}'); fetches++; return new Response(JSON.stringify(api)); } });
let controller: RailController | null = null, toolbar: YadaToolbar | null = null;
async function run(): Promise<void> {
  assert(collectDomConversationTurns().length === 6, 'draft entered collected turns');
  assert(bindDomAnchorsToTurns(turns).length === 120, 'API turns lost with partial DOM');
  assert(!bindDomAnchorsToTurns(turns)[119].userAnchorElement, 'draft accepted as anchor');
  pass('API keeps 120 turns with 6 mounted turns; composer attachments excluded');
  assert(activeTurnAtLine([{ index: 50, top: -50 }, { index: 51, top: 500 }], 200) === 50, 'global index shifted');
  assert(resolveScrollRoot(messages.firstElementChild as HTMLElement) === scroller, 'wrong scroll root');
  pass('internal scroll root and global reading-line index');
  const duplicate = turns.slice(0, 2).map(turn => ({ ...turn, userMessageId: undefined, assistantMessageId: undefined, userMarkdown: 'same', assistantMarkdown: 'same' }));
  const fake = { ...collectDomConversationTurns()[0], userMessageId: undefined, assistantMessageId: undefined, userTextFingerprint: 'same', assistantTextFingerprint: 'same' };
  assert(bindDomAnchorsToTurns(duplicate, [fake]).every(turn => !turn.anchorMappingTrusted), 'duplicate fingerprint trusted');
  const previouslyBound = bindDomAnchorsToTurns(turns);
  const user = messages.querySelector<HTMLElement>('[data-message-id="u0"]')!; user.dataset.messageId = 'unknown';
  assert(!bindDomAnchorsToTurns(previouslyBound)[0].anchorMappingTrusted, 'recycled node trusted'); user.dataset.messageId = 'u0';
  pass('ambiguous fingerprints and recycled IDs cannot cause an exact jump');
  for (let n = 0; n < 2; n++) { const old = el('div'); old.id = 'chatgpt-yada-rail-host'; document.documentElement.append(old); }
  controller = new RailController(); controller.syncRoute();
  toolbar = new YadaToolbar(value => controller!.setPreviewMode(value)); toolbar.mount(); toolbar.setVisible(true);
  await until(() => document.getElementById('chatgpt-yada-rail-host')?.shadowRoot?.querySelectorAll('.mark').length === 120, 'rail did not load');
  const host = document.getElementById('chatgpt-yada-rail-host')!, shadow = host.shadowRoot!, layer = shadow.querySelector('.marks')!, firstMarker = shadow.querySelector('.mark');
  assert(document.querySelectorAll('#chatgpt-yada-rail-host').length === 1 && shadow.querySelectorAll('.marks').length === 1, 'duplicate hosts/layers');
  const rightBefore = parseFloat(host.style.right); main.style.width = '700px'; await wait(400);
  assert(parseFloat(host.style.right) > rightBefore + 200, 'Activity narrowing did not move rail');
  main.style.width = '1000px'; await wait(400);
  assert(parseFloat(host.style.right) === rightBefore && shadow.querySelector('.marks') === layer, 'rail replaced on panel close');
  pass('historical duplicate cleanup; one host/layer survives panel open and close');
  const scan = () => bindDomAnchorsToTurns(turns);
  for (const index of [117, 1, 60]) {
    const found = await jumpToTurn(`u${index}`, scan, () => scroller, new AbortController().signal);
    assert(found, `jump failed for ${index}`);
    assert(Math.abs(messages.querySelector(`[data-message-id="u${index}"]`)!.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 80) < 2, `jump ${index} misaligned`);
    assert(getActiveTurn(scan(), scroller) === index, `active global index wrong at ${index}`);
  }
  assert(shadow.querySelector('.mark') === firstMarker && shadow.querySelector('.marks') === layer, 'scroll rebuilt rail');
  pass('virtualized front/middle/end jumps, fresh rescans, second alignment, no marker rebuild');
  const cancellation = new AbortController(); const pending = jumpToTurn('u0', scan, () => scroller, cancellation.signal); cancellation.abort(); assert(!await pending, 'cancel ignored');
  const origin = scroller.scrollTop;
  const missing = await jumpToTurn('missing', () => [{ ...turns[0], id: 'missing', userAnchorElement: null, anchorMappingTrusted: false }], () => scroller, new AbortController().signal);
  assert(!missing && scroller.scrollTop === origin, 'failed target did not restore view');
  pass('jump cancellation and missing-target failure keep page usable');
  const marker = shadow.querySelectorAll<HTMLButtonElement>('.mark')[60]; const rect = marker.getBoundingClientRect();
  layer.dispatchEvent(new PointerEvent('pointermove', { clientY: rect.top + rect.height / 2, bubbles: true }));
  const preview = shadow.querySelector<HTMLElement>('.preview')!;
  assert(!preview.hidden && preview.textContent!.includes('第 61 轮') && !preview.textContent!.includes('Assistant'), 'default preview wrong');
  const toolbarRoot = document.getElementById('chatgpt-yada-toolbar-host')!.shadowRoot!;
  (toolbarRoot.querySelector('[data-preview-mode]') as HTMLButtonElement).click(); await wait(1100);
  assert(preview.textContent!.includes('Assistant 60') && preview.dataset.expanded === 'true', 'expanded assistant preview wrong');
  assert((await storage.get(PREVIEW_KEY))[PREVIEW_KEY] === true, 'preview preference lost');
  document.documentElement.classList.add('dark'); await wait(50); assert(host.dataset.yadaTheme === 'dark', 'dark theme missing'); document.documentElement.classList.remove('dark');
  pass('same-marker hover gradient, delayed preview, persistent mode and dark theme');
  // Native contenteditable block insertion can expose an extra newline in innerText.
  editor.textContent = ''; editor.focus(); assert(insertPrompt('hello'), 'empty insertion failed'); assert(editor.innerText === 'hello', 'empty insertion content');
  editor.textContent = 'draft'; editor.blur(); window.getSelection()?.removeAllRanges(); assert(insertPrompt('prompt'), 'append failed'); assert(/^draft\n{2,3}prompt$/.test(editor.innerText), `draft overwritten: ${JSON.stringify(editor.innerText)} / ${editor.innerHTML}`);
  editor.textContent = 'abcdef'; editor.focus(); const range = document.createRange(); range.setStart(editor.firstChild!, 2); range.collapse(true); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const bookmark = captureComposerSelection(); assert(insertPrompt('X', bookmark), 'caret insertion failed'); assert(editor.innerText === 'abXcdef', 'caret ignored');
  document.execCommand('undo'); assert(editor.innerText === 'abcdef', 'native undo missing');
  const textarea = document.createElement('textarea'); editor.removeAttribute('id'); textarea.id = 'prompt-textarea'; form.append(textarea); textarea.value = 'abcd'; textarea.focus(); textarea.setSelectionRange(1, 3); assert(insertPrompt('Z', captureComposerSelection()), 'textarea insertion'); assert(textarea.value === 'aZd', 'textarea selection ignored'); textarea.remove(); editor.id = 'prompt-textarea';
  pass('contenteditable and textarea: empty, append, saved caret, selection and native undo');
  await saveLibrary({ version: 1, prompts: [] });
  const promptButton = toolbarRoot.querySelector<HTMLButtonElement>('[data-prompts]')!;
  const panel = () => toolbarRoot.querySelector<HTMLElement>('.prompt-panel')!;
  const clickText = (text: string): void => { const button = Array.from(panel().querySelectorAll('button')).find(b => b.textContent === text); assert(button, `missing button ${text}`); button!.click(); };
  const openPanel = async (): Promise<void> => { promptButton.dispatchEvent(new PointerEvent('pointerdown')); promptButton.click(); await until(() => !!panel().querySelector('input[type="search"]'), 'prompt load failed'); };
  await openPanel(); clickText('新增提示词');
  panel().querySelector<HTMLInputElement>('input')!.value = '<img src=x onerror=alert(1)>';
  panel().querySelector<HTMLTextAreaElement>('textarea')!.value = 'prompt body'; clickText('保存'); await until(() => !!panel().querySelector('.prompt-insert'), 'prompt save failed');
  assert(!panel().querySelector('img'), 'prompt HTML injection');
  let search = panel().querySelector<HTMLInputElement>('input')!; search.value = 'no match'; search.dispatchEvent(new Event('input')); assert(!panel().querySelector('.prompt-row'), 'search did not filter'); search.value = 'body'; search.dispatchEvent(new Event('input')); assert(!!panel().querySelector('.prompt-row'), 'content search failed');
  clickText('编辑'); panel().querySelector<HTMLInputElement>('input')!.value = 'Updated title'; panel().querySelector<HTMLTextAreaElement>('textarea')!.value = 'updated body'; clickText('保存'); await until(() => !!panel().querySelector('.prompt-insert'), 'edit save failed');
  assert((await readLibrary()).prompts[0].content === 'updated body', 'edit not persisted');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert(panel().hidden, 'Escape failed');
  await openPanel(); editor.textContent = 'existing draft'; window.getSelection()?.removeAllRanges(); (panel().querySelector('.prompt-insert') as HTMLButtonElement).click(); assert(panel().hidden && /^existing draft\n{2,3}updated body$/.test(editor.innerText), 'prompt insertion overwrote draft');
  await openPanel(); clickText('删除'); await until(() => !panel().querySelector('.prompt-row'), 'delete failed'); assert((await readLibrary()).prompts.length === 0, 'delete not persisted');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); assert(panel().hidden, 'outside close failed');
  let rejected = false; try { parseLibrary({ version: 2, prompts: [] }); } catch { rejected = true; } assert(rejected, 'unknown storage version discarded');
  assert(localStorage.getItem(PROMPT_KEY) && sends === 0, 'storage missing or automatic send');
  pass('prompt CRUD, content search, persistence/reopen, safe text, outside/Escape, no automatic send');
  const beforeRoute = fetches; history.pushState({}, '', '/c/fixture-2'); controller.syncRoute(); await until(() => fetches > beforeRoute && shadow.querySelectorAll('.mark').length === 120, 'route reload failed'); assert(document.getElementById('chatgpt-yada-rail-host') === host, 'route recreated host');
  controller.dispose(); toolbar.dispose(); await wait(300); assert(!document.getElementById('chatgpt-yada-rail-host') && !document.getElementById('chatgpt-yada-toolbar-host'), 'dispose leaked UI');
  const afterDispose = fetches; messages.append(el('div', 'mutation')); window.dispatchEvent(new Event('resize')); await wait(700); assert(fetches === afterDispose, 'disposed observer fetched');
  pass('route clears old state while preserving host; dispose removes UI and pending refreshes');
}
void run().catch(error => { result.error = error.stack ?? String(error); }).finally(() => { controller?.dispose(); toolbar?.dispose(); result.done = true; });
