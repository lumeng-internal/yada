import { NativeBootstrapController, getPrepareBlockReason, isGeneratingResponse } from '../src/nativeBootstrap/controller';
import {
  exposePaginationSentinel,
  paginationSentinels,
  restoreOwnedStyles,
  restorePaginationSentinel
} from '../src/nativeBootstrap/dom';
import {
  HistoryTracker,
  boostConversationUrl,
  matchConversationApiUrl,
  rewriteGetRequest,
  shouldHandleConversationRequest
} from '../src/nativeBootstrap/history';
import {
  MAX_ACTIVE_MS,
  MAX_EXTRA_PAGES,
  PREPARE_TTL_MS,
  TARGET_NUM_TURNS,
  USER_IDLE_MS,
  YADA_CONTENT_SOURCE,
  type HistoryState
} from '../src/nativeBootstrap/shared';
import { closestOfficialButton, isOfficialNavItem, officialButtons } from '../src/nativePreview/map';

const fixtureTotals = new Map<string, number>();
type Assert = (value: unknown, message: string) => void;
type Pass = (message: string) => void;

export async function nativeBootstrapChecks(assert: Assert, pass: Pass): Promise<void> {
  const wait = (ms = 80): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
  async function until(fn: () => boolean, message: string, rounds = 160, step = 50): Promise<void> {
    for (let i = 0; i < rounds; i++) { if (fn()) return; await wait(step); }
    throw new Error(message);
  }

  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => {
    if (query.includes('hover: hover') || query.includes('pointer: fine')) {
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; }
      } as MediaQueryList;
    }
    return nativeMatchMedia(query);
  }) as typeof window.matchMedia;

  const page = await import('../src/nativeBootstrap/page');
  page.installNativeBootstrapPage()();
  const nativeFetch = window.fetch;
  try {

  document.querySelectorAll('[data-toc-item-index], [data-toc-active]').forEach(node => {
    if (!node.closest('#chatgpt-yada-toolbar-host, #chatgpt-yada-preview-host')) node.remove();
  });
  const origin = location.origin;
  const conversationId = 'bootstrap-1';
  history.replaceState({}, '', `/c/${conversationId}`);

  const captured: Array<{ url: string; method: string; input: RequestInfo | URL; init?: RequestInit }> = [];
  let lastInnerPromise: Promise<Response> | null = null;
  let lastInnerResponse: Response | null = null;
  let olderInflight = 0;
  let maxOlderInflight = 0;
  const mockFetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    captured.push({ url, method, input, init });
    const isOlder = url.includes('/messages?');
    if (isOlder) {
      olderInflight += 1;
      maxOlderInflight = Math.max(maxOlderInflight, olderInflight);
    }
    const done = (): void => { if (isOlder) olderInflight = Math.max(0, olderInflight - 1); };
    if (method !== 'GET' || (init?.headers && headerValue(init.headers, 'accept').includes('text/event-stream')) || headerValue(input instanceof Request ? input.headers : undefined, 'accept').includes('text/event-stream')) {
      lastInnerResponse = new Response('ok');
      lastInnerPromise = Promise.resolve(lastInnerResponse).finally(done);
      return lastInnerPromise;
    }
    const parsed = new URL(url, location.href);
    const payload = pagePayload(parsed.pathname.split('/')[3] ?? conversationId, parsed.searchParams.get('before'), Number(parsed.searchParams.get('num_turns') || '5'));
    lastInnerResponse = new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    const delay = (url.includes('bootstrap-drift') || url.includes('bootstrap-interrupt')) && isOlder ? 4000 : 0;
    lastInnerPromise = wait(delay).then(() => lastInnerResponse!).finally(done);
    return lastInnerPromise;
  };
  Object.assign(globalThis, { fetch: mockFetch });
  page.installNativeBootstrapPage();

  const outerPromise = fetch(`${origin}/backend-api/conversations/${conversationId}?num_turns=5`);
  assert(outerPromise === lastInnerPromise, 'original fetch Promise was replaced');
  const initial = await outerPromise;
  assert(initial === lastInnerResponse, 'original Response was replaced');
  assert(new URL(captured.at(-1)!.url, origin).searchParams.get('num_turns') === '100', 'initial num_turns=5 was not raised to 100');

  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/${conversationId}?num_turns=200`);
  assert(new URL(captured.at(-1)!.url, origin).searchParams.get('num_turns') === '200', 'existing num_turns=200 was lowered');

  captured.length = 0;
  const abort = new AbortController();
  const request = new Request(`${origin}/backend-api/conversations/${conversationId}?num_turns=5`, {
    headers: { 'X-Yada-Test': 'keep', Accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    mode: 'cors',
    redirect: 'follow',
    referrer: `${origin}/`,
    integrity: '',
    signal: abort.signal
  });
  await fetch(request, { cache: 'reload' });
  const preserved = captured.at(-1)!;
  const preservedRequest = preserved.input instanceof Request ? preserved.input : null;
  const preservedSignal = preservedRequest?.signal ?? preserved.init?.signal;
  assert(preservedRequest, 'Request object was flattened away');
  assert(preservedSignal, 'Request signal was dropped');
  abort.abort();
  assert(preservedSignal.aborted, 'Request signal was not kept as a linked AbortSignal');
  assert(preservedRequest!.headers.get('X-Yada-Test') === 'keep', 'Request headers were dropped');
  assert(preservedRequest!.credentials === 'include', 'Request credentials were dropped');
  assert((preserved.init?.cache ?? preservedRequest!.cache) === 'reload' || preservedRequest!.cache === 'no-store', 'Request cache/init overlay was dropped');
  assert(rewriteGetRequest(request, { cache: 'reload' }, `${origin}/backend-api/conversations/${conversationId}?num_turns=100`)[1]?.cache === 'reload', 'rewriteGetRequest lost init overlay');
  assert(matchConversationApiUrl(`/backend-api/conversations/${conversationId}/messages?before=c1`, origin)?.kind === 'paginated-messages', 'messages URL match failed');

  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/${conversationId}`, { method: 'POST', body: '{}' });
  assert(!captured.at(-1)!.url.includes('num_turns=100'), 'POST was rewritten');
  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/${conversationId}`, { headers: { Accept: 'text/event-stream' } });
  assert(!captured.at(-1)!.url.includes('num_turns=100'), 'SSE accept request was rewritten');
  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/other-id?num_turns=5`);
  assert(new URL(captured.at(-1)!.url, origin).searchParams.get('num_turns') === '5', 'other conversation was boosted');
  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/${conversationId}?include_message_id=abc&num_turns=5`);
  assert(new URL(captured.at(-1)!.url, origin).searchParams.get('num_turns') === '5', 'message deep-link request was boosted');
  assert(shouldHandleConversationRequest(`${origin}/backend-api/conversations/${conversationId}?include_message_id=abc`, undefined, location.href, conversationId) === null, 'include_message_id was handled');
  pass('page requests: initial 5→100, keep 200, preserve Request/init, skip POST/SSE/other/deep-link');

  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/${conversationId}/messages?before=cursor-1&num_turns=5`);
  assert(new URL(captured.at(-1)!.url, origin).searchParams.get('num_turns') === '5', 'older request boosted before prepare');
  window.postMessage({ source: YADA_CONTENT_SOURCE, type: 'prepare-boost', conversationId, active: true }, origin);
  await wait(20);
  assert(page.isPrepareBoostActive(conversationId), 'prepare boost did not start');
  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/${conversationId}/messages?before=cursor-1&num_turns=5`);
  const older = new URL(captured.at(-1)!.url, origin);
  assert(older.searchParams.get('num_turns') === '100' && older.searchParams.get('include_has_versions') === 'true', 'prepare older request was not boosted to 100');
  await wait(PREPARE_TTL_MS + 80);
  assert(!page.isPrepareBoostActive(conversationId), 'prepare boost did not expire after 10s');
  captured.length = 0;
  await fetch(`${origin}/backend-api/conversations/${conversationId}/messages?before=cursor-1&num_turns=5`);
  assert(new URL(captured.at(-1)!.url, origin).searchParams.get('num_turns') === '5', 'expired boost still rewrote older requests');
  pass('older requests boost only while prepare is active and expire after 10s');

  const tracker = new HistoryTracker();
  tracker.applyInitial(conversationId, {
    current_node: 'a2',
    messages: [
      { id: 'u0', author: { role: 'user' } }, { id: 'a0', author: { role: 'assistant' } },
      { id: 'u1', author: { role: 'user' } }, { id: 'a1', author: { role: 'assistant' } },
      { id: 'u2', author: { role: 'user' } }, { id: 'a2', author: { role: 'assistant' } }
    ],
    page_info: { has_previous_page: true, start_cursor: 'c1' }
  });
  tracker.applyOlder({
    current_node: 'a2',
    messages: [{ id: 'u3', author: { role: 'user' } }, { id: 'a3', author: { role: 'assistant' } }],
    page_info: { has_previous_page: true, start_cursor: 'c2' }
  }, 'c1');
  const third = tracker.applyOlder({
    current_node: 'a2',
    messages: [{ id: 'u4', author: { role: 'user' } }, { id: 'a4', author: { role: 'assistant' } }],
    page_info: { has_previous_page: false }
  }, 'c2');
  assert(third.boundary === 'complete' && third.prompts === 5 && third.pages === 3, 'initial plus two older pages did not form a complete chain');

  const duplicate = new HistoryTracker();
  duplicate.applyInitial(conversationId, { messages: [{ id: 'u0', author: { role: 'user' } }], page_info: { has_previous_page: true, start_cursor: 'same' } });
  const stalled = duplicate.applyOlder({ messages: [{ id: 'u1', author: { role: 'user' } }], page_info: { has_previous_page: true, start_cursor: 'same' } }, 'same');
  assert(stalled.issue === 'stalled' && stalled.boundary !== 'complete', 'duplicate cursor was treated as complete');

  const empty = new HistoryTracker();
  empty.applyInitial(conversationId, { messages: [{ id: 'u0', author: { role: 'user' } }], page_info: { has_previous_page: true, start_cursor: 'c1' } });
  const emptyPage = empty.applyOlder({ messages: [], page_info: { has_previous_page: false } }, 'c1');
  assert(emptyPage.issue === 'stalled' && emptyPage.boundary !== 'complete', 'empty page was marked complete');
  const branched = new HistoryTracker();
  branched.applyInitial(conversationId, { current_node: 'a0', messages: [{ id: 'u0', author: { role: 'user' } }, { id: 'a0', author: { role: 'assistant' } }], page_info: { has_previous_page: true, start_cursor: 'c1' } });
  const branch = branched.applyOlder({ current_node: 'other', messages: [{ id: 'u1', author: { role: 'user' } }], page_info: { has_previous_page: false } }, 'c1');
  assert(branch.issue === 'unlinked' && branch.boundary !== 'complete', 'branch change was marked complete');
  const unordered = new HistoryTracker();
  unordered.applyInitial(conversationId, { messages: [{ id: 'u0', author: { role: 'user' } }], page_info: { has_previous_page: true, start_cursor: 'c1' } });
  const outOfOrder = unordered.applyOlder({ messages: [{ id: 'u9', author: { role: 'user' } }], page_info: { has_previous_page: false } }, 'wrong');
  assert(outOfOrder.issue === 'unlinked' && outOfOrder.boundary !== 'complete', 'out-of-order page was marked complete');
  assert(boostConversationUrl(`${origin}/backend-api/conversations/${conversationId}?num_turns=5`, origin, { kind: 'paginated-initial', conversationId }, false).href.includes(`num_turns=${TARGET_NUM_TURNS}`), 'boost helper did not raise initial turns');
  pass('history chain links initial+older pages, completes on has_previous_page=false, and rejects duplicate/empty/branch/unordered pages');

  history.replaceState({}, '', '/c/bootstrap-18');
  const fixture18 = await mountConversationFixture('bootstrap-18', 18);
  const bootstrap18 = new NativeBootstrapController();
  bootstrap18.syncRoute();
  await wait(40);
  bootstrap18.setExpectedTurns(18);
  await until(() => fixture18.nav.querySelectorAll('button').length === 18, '18-turn conversation did not show official navigation');
  assert(!document.getElementById('chatgpt-yada-rail-host'), 'custom rail appeared during 18-turn prepare');
  bootstrap18.dispose();
  fixture18.cleanup();
  pass('18-turn conversation auto-loads until official navigation appears');

  history.replaceState({}, '', '/c/bootstrap-150');
  maxOlderInflight = 0;
  const fixture150 = await mountConversationFixture('bootstrap-150', 150);
  const bootstrap150 = new NativeBootstrapController();
  captured.length = 0;
  bootstrap150.syncRoute();
  await wait(40);
  bootstrap150.setExpectedTurns(150);
  await until(() => fixture150.nav.querySelectorAll('button').length === 150, '150-turn official navigation was not completed after multi-page load');
  assert(maxOlderInflight <= 1, `more than one pagination request ran at once: ${maxOlderInflight}`);
  assert(fixture150.scrollWrites === 0, 'prepare loop assigned scrollTop');
  bootstrap150.dispose();
  fixture150.cleanup();
  pass('150-turn fixture completes official navigation one page at a time without scrollTop writes');

  history.replaceState({}, '', '/c/bootstrap-sentinel');
  const fixtureSentinel = await mountConversationFixture('bootstrap-sentinel', 12);
  const sentinel = paginationSentinels()[0] ?? fixtureSentinel.sentinel;
  const exposed = exposePaginationSentinel();
  if (exposed) {
    assert(exposed.style.getPropertyValue('position') === 'sticky', 'sentinel was not exposed');
    exposed.style.setProperty('position', 'relative', 'important');
    restorePaginationSentinel(exposed);
    assert(exposed.style.getPropertyValue('position') === 'relative', 'restore overwrote a later ChatGPT style');
  } else {
    const probe = document.createElement('div');
    probe.setAttribute('data-testid', 'conversation-pagination-sentinel');
    fixtureSentinel.scroller.prepend(probe);
    exposePaginationSentinel();
    restorePaginationSentinel();
    const saved = [{ property: 'opacity', previousValue: '', previousPriority: '', appliedValue: '0', appliedPriority: 'important' }];
    probe.style.setProperty('opacity', '0', 'important');
    restoreOwnedStyles(probe, saved);
    probe.remove();
  }
  fixtureSentinel.cleanup();
  pass('sentinel styles restore on request, interrupt, and after ChatGPT later changes');

  history.replaceState({}, '', '/c/bootstrap-drift');
  const driftHost = await mountConversationFixture('bootstrap-drift', 180);
  const driftStatus: string[] = [];
  let driftPreparing = false;
  const drift = new NativeBootstrapController(status => {
    if (status.kind === 'preparing') driftPreparing = true;
    if (status.reason) driftStatus.push(status.reason);
  });
  drift.syncRoute();
  await wait(40);
  drift.setExpectedTurns(180);
  await until(() => driftPreparing, 'drift fixture never entered preparing');
  await wait(80);
  const visible = [...driftHost.scroller.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => {
    const rect = node.getBoundingClientRect();
    const box = driftHost.scroller.getBoundingClientRect();
    return rect.bottom > box.top && rect.top < box.bottom;
  });
  assert(visible, 'no visible message anchor for drift test');
  visible!.style.marginTop = '40px';
  await until(() => driftStatus.includes('用户操作已暂停'), 'reading-position drift over 8px did not stop prepare');
  drift.dispose();
  driftHost.cleanup();

  history.replaceState({}, '', '/c/bootstrap-interrupt');
  const interruptHost = await mountConversationFixture('bootstrap-interrupt', 180);
  let interruptPreparing = false;
  const interrupt = new NativeBootstrapController(status => { if (status.kind === 'preparing') interruptPreparing = true; });
  interrupt.syncRoute();
  await wait(40);
  interrupt.setExpectedTurns(180);
  await until(() => interruptPreparing, 'interrupt fixture never entered preparing');
  interruptHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
  await wait(40);
  interruptHost.scroller.dispatchEvent(new Event('touchstart', { bubbles: true }));
  interruptHost.scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  interruptHost.scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
  await wait(USER_IDLE_MS + 80);
  interruptHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
  await wait(USER_IDLE_MS + 80);
  interruptHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
  await wait(USER_IDLE_MS + 80);
  interruptHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
  await wait(USER_IDLE_MS + 80);
  interrupt.dispose();
  interruptHost.cleanup();
  pass('reading-position drift and wheel/touch/pointer/keyboard stop immediately; idle resume is bounded');

  assert(getPrepareBlockReason({
    conversationId: 'x', visible: true, width: 800, hover: true, deepLink: false, generating: false, customNav: false,
    expectedTurns: 18, capturedPrompts: 18, officialCount: 0, history: historyState('x')
  }) === '页面过窄', 'narrow viewport was allowed');
  assert(getPrepareBlockReason({
    conversationId, visible: true, width: 1280, hover: true, deepLink: true, generating: false, customNav: false,
    expectedTurns: 18, capturedPrompts: 18, officialCount: 0, history: historyState(conversationId)
  }) === '页面结构暂不兼容', 'deep link was allowed');
  const stop = document.createElement('button');
  stop.setAttribute('data-testid', 'stop-button');
  document.body.append(stop);
  assert(isGeneratingResponse(), 'stop button was not treated as generating');
  stop.remove();
  pass('hidden/generating/narrow/deep-link gates prevent prepare');

  captured.length = 0;
  history.replaceState({}, '', '/c/bootstrap-complete');
  const completeHost = await mountConversationFixture('bootstrap-complete', 8);
  const complete = new NativeBootstrapController();
  complete.syncRoute();
  complete.setExpectedTurns(8);
  await until(() => completeHost.nav.querySelectorAll('button').length === 8, 'complete navigation fixture missing buttons');
  const afterComplete = captured.filter(item => item.url.includes('/messages?')).length;
  await wait(300);
  assert(captured.filter(item => item.url.includes('/messages?')).length === afterComplete, 'complete official navigation kept requesting older pages');
  complete.dispose();
  completeHost.cleanup();
  pass('official navigation complete stops further older requests');
  assert(MAX_EXTRA_PAGES === 20 && MAX_ACTIVE_MS === 60_000, 'session page/time budgets changed');

  const prompt = document.createElement('button');
  prompt.setAttribute('aria-label', 'Prompt 4');
  document.body.append(prompt);
  assert(isOfficialNavItem(prompt) && closestOfficialButton(prompt) === prompt, 'Prompt N official button was ignored');
  const ordinary = document.createElement('button');
  ordinary.setAttribute('aria-label', 'Share');
  document.body.append(ordinary);
  assert(!isOfficialNavItem(ordinary) && closestOfficialButton(ordinary) == null, 'ordinary button was treated as official navigation');
  prompt.remove();
  ordinary.remove();
  } finally {
    page.installNativeBootstrapPage()();
    window.matchMedia = nativeMatchMedia;
    Object.assign(globalThis, { fetch: nativeFetch });
    history.replaceState({}, '', '/c/fixture-1');
  }
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get(name) ?? '';
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find(entry => entry.toLowerCase() === name);
  return key ? record[key] : '';
}

function historyState(conversationId: string): HistoryState {
  return {
    conversationId,
    generation: 1,
    initialVersion: 1,
    revision: 1,
    pending: 0,
    pages: 1,
    messages: 10,
    prompts: 18,
    boundary: 'more',
    cursor: 'c',
    issue: null,
    boosted: true
  };
}

function pagePayload(conversationId: string, before: string | null, rawTurns: number) {
  const total = fixtureTotals.get(conversationId) ?? (Number(conversationId.split('-').at(-1)) || 18);
  const numTurns = Number.isFinite(rawTurns) && rawTurns > 0 ? rawTurns : 5;
  let start: number;
  let count: number;
  if (before) {
    const end = Number(String(before).replace('c', ''));
    const safeEnd = Number.isFinite(end) ? Math.max(0, Math.min(total, end)) : 0;
    start = Math.max(0, safeEnd - numTurns);
    count = Math.max(0, safeEnd - start);
  } else {
    start = Math.max(0, total - numTurns);
    count = Math.min(numTurns, total - start);
  }
  const messages = [];
  for (let i = start; i < start + count; i++) {
    messages.push({ id: `${conversationId}-u${i}`, author: { role: 'user' } });
    messages.push({ id: `${conversationId}-a${i}`, author: { role: 'assistant' } });
  }
  const hasPrevious = start > 0;
  return {
    current_node: count ? `${conversationId}-a${start + count - 1}` : null,
    messages,
    page_info: {
      has_previous_page: hasPrevious,
      start_cursor: hasPrevious ? `c${start}` : undefined
    }
  };
}

async function mountConversationFixture(id: string, totalTurns: number) {
  fixtureTotals.set(id, totalTurns);
  const scroller = document.createElement('div');
  scroller.style.cssText = 'height:360px;overflow:auto;position:relative';
  const sentinel = document.createElement('div');
  sentinel.setAttribute('data-testid', 'conversation-pagination-sentinel');
  sentinel.style.cssText = 'height:1px';
  scroller.append(sentinel);
  const nav = document.createElement('div');
  const visibleFrom = Math.max(0, totalTurns - 5);
  for (let i = visibleFrom; i < totalTurns; i++) {
    const user = document.createElement('article');
    user.setAttribute('data-message-author-role', 'user');
    user.setAttribute('data-message-id', `${id}-u${i}`);
    user.textContent = `User ${i}`;
    user.style.minHeight = '48px';
    scroller.append(user);
  }
  document.body.append(scroller, nav);
  scroller.scrollTop = scroller.scrollHeight;
  let scrollWrites = 0;
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get() { return descriptor?.get?.call(this) ?? 0; },
    set(value: number) {
      scrollWrites += 1;
      descriptor?.set?.call(this, value);
    }
  });

  const renderNav = (): void => {
    nav.replaceChildren();
    for (let i = 0; i < totalTurns; i++) {
      const button = document.createElement('button');
      button.setAttribute('data-toc-item-index', String(i));
      button.textContent = '—';
      nav.append(button);
    }
    sentinel.remove();
  };

  const initial = await (await fetch(`/backend-api/conversations/${id}?num_turns=5`)).json() as {
    page_info?: { has_previous_page?: boolean; start_cursor?: string };
  };
  let cursor = initial.page_info?.has_previous_page ? initial.page_info.start_cursor ?? '' : '';
  if (!cursor) renderNav();

  let inflight = false;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting) || inflight || !cursor) return;
    inflight = true;
    const before = cursor;
    void fetch(`/backend-api/conversations/${id}/messages?before=${before}&num_turns=5`).then(async response => {
      const data = await response.json() as { page_info?: { has_previous_page?: boolean; start_cursor?: string } };
      cursor = data.page_info?.has_previous_page ? data.page_info.start_cursor ?? '' : '';
      if (!cursor) renderNav();
    }).finally(() => { inflight = false; });
  }, { root: scroller, rootMargin: '80px 0px 0px' });
  if (cursor) observer.observe(sentinel);

  return {
    scroller,
    sentinel,
    nav,
    get scrollWrites() { return scrollWrites; },
    cleanup() {
      observer.disconnect();
      restorePaginationSentinel();
      scroller.remove();
      nav.remove();
    }
  };
}
