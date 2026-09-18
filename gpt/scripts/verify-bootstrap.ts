import { NativeBootstrapController, getPrepareBlockReason, isGeneratingResponse, officialNavComplete } from '../src/nativeBootstrap/controller';
import {
  exposePaginationSentinel,
  paginationSentinels,
  restoreOwnedStyles,
  restorePaginationSentinel,
  uniquePaginationSentinel
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
  MAX_CAPTURE_MS,
  MAX_EXTRA_PAGES,
  NATIVE_NAV_WAIT_MS,
  PREPARE_TTL_MS,
  SENTINEL_WAIT_MS,
  TARGET_NUM_TURNS,
  USER_IDLE_MS,
  YADA_CONTENT_SOURCE,
  YADA_PAGE_SOURCE,
  type HistoryState
} from '../src/nativeBootstrap/shared';
import { closestOfficialButton, isOfficialNavItem, officialButtons, uniqueOfficialCount } from '../src/nativePreview/map';

const fixtureTotals = new Map<string, number>();
const deferredParts = new Map<string, { promise: Promise<Response>; resolve: (response: Response) => void }>();
let lastStreamCancel = false;
let lastStreamPulls = 0;
type Assert = (value: unknown, message: string) => void;
type Pass = (message: string) => void;
type FixtureOptions = {
  delaySentinelMs?: number;
  omitSentinel?: boolean;
  delayNavMs?: number;
  navTurns?: number;
  userTurns?: number;
  replaceSentinel?: boolean;
};

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
  const pageStates: HistoryState[] = [];
  const onPageState = (event: MessageEvent): void => {
    if (event.origin !== location.origin) return;
    const data = event.data as { source?: string; type?: string; state?: HistoryState } | null;
    if (data?.source === YADA_PAGE_SOURCE && data.type === 'history-state' && data.state) pageStates.push(data.state);
  };
  window.addEventListener('message', onPageState);
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
    for (const [part, deferred] of deferredParts) {
      if (url.includes(part)) {
        lastInnerPromise = deferred.promise.finally(done);
        return lastInnerPromise;
      }
    }
    if (method !== 'GET' || (init?.headers && headerValue(init.headers, 'accept').includes('text/event-stream')) || headerValue(input instanceof Request ? input.headers : undefined, 'accept').includes('text/event-stream')) {
      lastInnerResponse = new Response('ok');
      lastInnerPromise = Promise.resolve(lastInnerResponse).finally(done);
      return lastInnerPromise;
    }
    const parsed = new URL(url, location.href);
    const id = parsed.pathname.split('/')[3] ?? conversationId;
    if (id === 'bootstrap-huge') {
      lastInnerResponse = oversizedStreamResponse();
      lastInnerPromise = Promise.resolve(lastInnerResponse).finally(done);
      return lastInnerPromise;
    }
    if (id === 'bootstrap-timeout') {
      lastInnerResponse = hangingStreamResponse();
      lastInnerPromise = Promise.resolve(lastInnerResponse).finally(done);
      return lastInnerPromise;
    }
    if (id === 'bootstrap-stream') {
      lastInnerResponse = smallStreamResponse({ messages: [{ id: 'u0', author: { role: 'user' } }], page_info: { has_previous_page: false } });
      lastInnerPromise = Promise.resolve(lastInnerResponse).finally(done);
      return lastInnerPromise;
    }
    const payload = pagePayload(id, parsed.searchParams.get('before'), Number(parsed.searchParams.get('num_turns') || '5'));
    lastInnerResponse = new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    const delay = (url.includes('bootstrap-drift') || url.includes('bootstrap-interrupt') || url.includes('idle-debounce') || url.includes('idle-hidden') || url.includes('idle-generating')) && isOlder ? 4000 : 0;
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

  const raceA = new HistoryTracker();
  const lateA = raceA.beginRequest({ conversationId: 'A', kind: 'initial', before: null });
  raceA.notifyRoute('B');
  const liveB = raceA.beginRequest({ conversationId: 'B', kind: 'initial', before: null });
  raceA.applyInitialFrom(lateA, { messages: [{ id: 'old', author: { role: 'user' } }], page_info: { has_previous_page: false } });
  assert(raceA.snapshotState().conversationId === 'B' && raceA.snapshotState().prompts === 0, 'late conversation A overwrote B');
  raceA.applyInitialFrom(liveB, { messages: Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, author: { role: 'user' } })), page_info: { has_previous_page: false } });
  assert(raceA.snapshotState().prompts === 6 && raceA.snapshotState().conversationId === 'B', 'current conversation B was not applied');

  const inverted = new HistoryTracker();
  inverted.notifyRoute('inv');
  const firstInitial = inverted.beginRequest({ conversationId: 'inv', kind: 'initial', before: null });
  const secondInitial = inverted.beginRequest({ conversationId: 'inv', kind: 'initial', before: null });
  inverted.applyInitialFrom(firstInitial, { messages: [{ id: 'old-1', author: { role: 'user' } }], page_info: { has_previous_page: false } });
  assert(inverted.snapshotState().pages === 0 && inverted.snapshotState().initialVersion === 0, 'earlier initial response won the race');
  inverted.applyInitialFrom(secondInitial, { messages: [{ id: 'new-1', author: { role: 'user' } }, { id: 'new-2', author: { role: 'user' } }], page_info: { has_previous_page: false } });
  assert(inverted.snapshotState().initialVersion === 1 && inverted.snapshotState().prompts === 2, 'latest initial response did not establish the chain');

  const relink = new HistoryTracker();
  relink.applyInitial('relink', { messages: [{ id: 'u0', author: { role: 'user' } }], page_info: { has_previous_page: true, start_cursor: 'c1' } });
  const olderOnV1 = relink.beginRequest({ conversationId: 'relink', kind: 'older', before: 'c1' });
  const revalidate = relink.beginRequest({ conversationId: 'relink', kind: 'initial', before: null });
  const afterRevalidate = relink.applyInitialFrom(revalidate, { messages: [{ id: 'fresh', author: { role: 'user' } }], page_info: { has_previous_page: true, start_cursor: 'n1' } });
  const staleOlder = relink.applyOlderFrom(olderOnV1, { messages: [{ id: 'stale', author: { role: 'user' } }], page_info: { has_previous_page: false } });
  assert(afterRevalidate.initialVersion === 2 && staleOlder.issue !== 'unlinked' && staleOlder.cursor === 'n1' && staleOlder.prompts === 1, 'background revalidation marked the new chain unlinked or applied the old page');

  const pendingRace = new HistoryTracker();
  const oldPending = pendingRace.beginRequest({ conversationId: 'P1', kind: 'initial', before: null });
  pendingRace.notifyRoute('P2');
  pendingRace.beginRequest({ conversationId: 'P2', kind: 'initial', before: null });
  assert(pendingRace.snapshotState().pending === 1, 'new session pending was not 1 after route change');
  const afterOldEnd = pendingRace.endRequest(oldPending.requestId);
  assert(afterOldEnd.pending === 1 && afterOldEnd.conversationId === 'P2', 'old request finally reduced the new session pending');
  pass('history chain links initial+older pages, completes on has_previous_page=false, and rejects duplicate/empty/branch/unordered pages');
  pass('late A/B, inverted initials, stale older, and old pending cannot corrupt the current chain');

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
  assert(!officialNavComplete(100, 5, 5), '5 official buttons and 5 user DOM cannot prove a 100-turn conversation ready');
  assert(officialNavComplete(0, 100, 100), 'history.prompts must be the target when expectedTurns is unknown');
  assert(!officialNavComplete(0, 0, 5), 'unknown complete API and history capture cannot ready from visible DOM');
  const dupNav = document.createElement('div');
  for (let i = 0; i < 2; i++) {
    const button = document.createElement('button');
    button.setAttribute('data-toc-item-index', '0');
    dupNav.append(button);
  }
  document.body.append(dupNav);
  assert(officialButtons(dupNav).length === 2 && uniqueOfficialCount(dupNav) === 1, 'duplicate official buttons were not de-duplicated');
  dupNav.remove();
  pass('official completeness uses expectedTurns, then history.prompts, never visible user DOM alone');

  await raceTimingChecks(assert, pass, {
    origin,
    page,
    captured,
    pageStates,
    wait,
    until,
    mountConversationFixture
  });
  } finally {
    window.removeEventListener('message', onPageState);
    page.installNativeBootstrapPage()();
    window.matchMedia = nativeMatchMedia;
    Object.assign(globalThis, { fetch: nativeFetch });
    deferredParts.clear();
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

function makeSentinel(): HTMLElement {
  const sentinel = document.createElement('div');
  sentinel.setAttribute('data-testid', 'conversation-pagination-sentinel');
  sentinel.style.cssText = 'height:1px';
  return sentinel;
}

function deferPart(part: string): (response: Response) => void {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  deferredParts.set(part, { promise, resolve });
  return (response: Response) => {
    deferredParts.get(part)?.resolve(response);
    deferredParts.delete(part);
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

function smallStreamResponse(payload: unknown): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  }), { headers: { 'content-type': 'application/json' } });
}

function oversizedStreamResponse(): Response {
  lastStreamCancel = false;
  lastStreamPulls = 0;
  const chunk = new Uint8Array(2 * 1024 * 1024);
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      lastStreamPulls += 1;
      controller.enqueue(chunk);
      if (lastStreamPulls > 20) controller.close();
    },
    cancel() {
      lastStreamCancel = true;
    }
  }), { headers: { 'content-type': 'application/json' } });
}

function hangingStreamResponse(): Response {
  lastStreamCancel = false;
  return new Response(new ReadableStream<Uint8Array>({
    pull() {
      return new Promise(() => undefined);
    },
    cancel() {
      lastStreamCancel = true;
    }
  }), { headers: { 'content-type': 'application/json' } });
}

async function mountConversationFixture(id: string, totalTurns: number, options: FixtureOptions = {}) {
  fixtureTotals.set(id, totalTurns);
  const scroller = document.createElement('div');
  scroller.style.cssText = 'height:360px;overflow:auto;position:relative';
  let sentinel = makeSentinel();
  if (!options.omitSentinel && !options.delaySentinelMs) scroller.append(sentinel);
  const nav = document.createElement('div');
  const visibleCount = options.userTurns ?? Math.min(5, totalTurns);
  const visibleFrom = Math.max(0, totalTurns - visibleCount);
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
    const count = options.navTurns ?? totalTurns;
    for (let i = 0; i < count; i++) {
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
  if (!cursor) {
    if (options.delayNavMs) window.setTimeout(renderNav, options.delayNavMs);
    else renderNav();
  }

  let inflight = false;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting) || inflight || !cursor) return;
    inflight = true;
    const before = cursor;
    void fetch(`/backend-api/conversations/${id}/messages?before=${before}&num_turns=5`).then(async response => {
      const data = await response.json() as { page_info?: { has_previous_page?: boolean; start_cursor?: string } };
      cursor = data.page_info?.has_previous_page ? data.page_info.start_cursor ?? '' : '';
      if (!cursor) {
        if (options.delayNavMs) window.setTimeout(renderNav, options.delayNavMs);
        else renderNav();
        return;
      }
      if (options.replaceSentinel !== false) {
        const next = makeSentinel();
        if (sentinel.isConnected) sentinel.replaceWith(next);
        else scroller.prepend(next);
        sentinel = next;
        observer.disconnect();
        observer.observe(sentinel);
      }
    }).finally(() => { inflight = false; });
  }, { root: scroller, rootMargin: '80px 0px 0px' });

  const attachSentinel = (): void => {
    if (!sentinel.isConnected) scroller.prepend(sentinel);
    if (cursor) observer.observe(sentinel);
  };
  if (options.delaySentinelMs) window.setTimeout(attachSentinel, options.delaySentinelMs);
  else if (!options.omitSentinel && cursor) observer.observe(sentinel);

  return {
    scroller,
    get sentinel() { return sentinel; },
    nav,
    attachSentinel,
    renderNav,
    get scrollWrites() { return scrollWrites; },
    cleanup() {
      observer.disconnect();
      restorePaginationSentinel();
      scroller.remove();
      nav.remove();
    }
  };
}

async function raceTimingChecks(
  assert: Assert,
  pass: Pass,
  ctx: {
    origin: string;
    page: typeof import('../src/nativeBootstrap/page');
    captured: Array<{ url: string }>;
    pageStates: HistoryState[];
    wait: (ms?: number) => Promise<void>;
    until: (fn: () => boolean, message: string, rounds?: number, step?: number) => Promise<void>;
    mountConversationFixture: typeof mountConversationFixture;
  }
): Promise<void> {
  const { origin, page, captured, pageStates, wait, until, mountConversationFixture } = ctx;

  history.replaceState({}, '', '/c/delay-sentinel');
  const delayHost = await mountConversationFixture('delay-sentinel', 120, { delaySentinelMs: 1000 });
  const delayKinds: string[] = [];
  const delay = new NativeBootstrapController(status => { delayKinds.push(status.kind); if (status.reason) delayKinds.push(status.reason); });
  delay.syncRoute();
  delay.setExpectedTurns(120);
  await wait(200);
  assert(!delayKinds.includes('页面结构暂不兼容'), 'missing sentinel was treated as incompatible before 3s');
  assert(!uniquePaginationSentinel(), 'delayed sentinel appeared too early');
  await until(() => Boolean(uniquePaginationSentinel()), 'sentinel did not appear after 1s', 40, 50);
  await until(() => delayKinds.includes('preparing') || delayHost.nav.querySelectorAll('button').length === 120, 'delayed sentinel did not start loading');
  delay.dispose();
  delayHost.cleanup();
  pass('API-first delayed sentinel still starts loading');

  history.replaceState({}, '', '/c/late-attr');
  const lateHost = await mountConversationFixture('late-attr', 120, { omitSentinel: true });
  const bare = document.createElement('div');
  lateHost.scroller.prepend(bare);
  const lateKinds: string[] = [];
  const late = new NativeBootstrapController(status => { lateKinds.push(status.kind); });
  late.syncRoute();
  late.setExpectedTurns(120);
  window.setTimeout(() => bare.setAttribute('data-testid', 'conversation-pagination-sentinel'), 500);
  await until(() => Boolean(uniquePaginationSentinel()), 'late data-testid was not recognized', 40, 50);
  await until(() => lateKinds.includes('preparing') || lateHost.nav.querySelectorAll('button').length > 0, 'late data-testid did not allow prepare');
  late.dispose();
  lateHost.cleanup();
  pass('element inserted before data-testid is still recognized');

  history.replaceState({}, '', '/c/detached-sentinel');
  const detachedHost = await mountConversationFixture('detached-sentinel', 120, { omitSentinel: true });
  const detachedNode = makeSentinel();
  const detachedKinds: string[] = [];
  const detached = new NativeBootstrapController(status => { detachedKinds.push(status.kind); });
  detached.syncRoute();
  detached.setExpectedTurns(120);
  await wait(120);
  assert(!uniquePaginationSentinel(), 'detached sentinel was treated as connected');
  detachedHost.scroller.prepend(detachedNode);
  await until(() => Boolean(uniquePaginationSentinel()), 'attached sentinel was not recognized');
  await until(() => detachedKinds.includes('preparing') || detachedHost.nav.querySelectorAll('button').length > 0, 'detached-then-attached sentinel did not continue');
  detached.dispose();
  detachedHost.cleanup();
  pass('detached sentinel is recognized after it joins the document');

  history.replaceState({}, '', '/c/replace-sentinel');
  const replaceHost = await mountConversationFixture('replace-sentinel', 250, { replaceSentinel: true });
  const replaceCtrl = new NativeBootstrapController();
  replaceCtrl.syncRoute();
  replaceCtrl.setExpectedTurns(250);
  await until(() => replaceHost.nav.querySelectorAll('button').length === 250, 'replaced sentinels stopped pagination', 200, 50);
  replaceCtrl.dispose();
  replaceHost.cleanup();
  pass('sentinel replacement after each page still continues');

  history.replaceState({}, '', '/c/missing-sentinel');
  const missingHost = await mountConversationFixture('missing-sentinel', 120, { omitSentinel: true });
  const missingReasons: string[] = [];
  const missing = new NativeBootstrapController(status => { if (status.reason) missingReasons.push(status.reason); });
  missing.syncRoute();
  missing.setExpectedTurns(120);
  await until(() => missingReasons.includes('页面结构暂不兼容'), 'missing sentinel did not time out as incompatible', Math.ceil(SENTINEL_WAIT_MS / 50) + 20, 50);
  missing.dispose();
  missingHost.cleanup();
  pass('sentinel missing for 3s is incompatible');

  history.replaceState({}, '', '/c/delay-nav');
  const delayNavHost = await mountConversationFixture('delay-nav', 18, { delayNavMs: 1500 });
  const delayNavKinds: string[] = [];
  const delayNav = new NativeBootstrapController(status => { delayNavKinds.push(status.kind); });
  delayNav.syncRoute();
  delayNav.setExpectedTurns(18);
  await wait(200);
  assert(!delayNavKinds.includes('ready'), 'official nav ready before it existed');
  await until(() => delayNavKinds.includes('ready'), 'official nav appearing after 1.5s did not become ready', 80, 50);
  delayNav.dispose();
  delayNavHost.cleanup();
  pass('complete history waits for delayed official navigation');

  history.replaceState({}, '', '/c/no-nav');
  const noNavHost = await mountConversationFixture('no-nav', 18, { delayNavMs: 10_000 });
  const noNavReasons: string[] = [];
  const noNav = new NativeBootstrapController(status => { if (status.reason) noNavReasons.push(status.reason); });
  noNav.syncRoute();
  noNav.setExpectedTurns(18);
  await until(() => noNavReasons.includes('历史完整但 ChatGPT 未显示官方导航'), 'missing official nav did not time out', Math.ceil(NATIVE_NAV_WAIT_MS / 50) + 20, 50);
  noNav.dispose();
  noNavHost.cleanup();
  pass('official navigation missing for 2.5s stays incomplete');

  history.replaceState({}, '', '/c/partial-nav');
  const partialHost = await mountConversationFixture('partial-nav', 100, { navTurns: 5, userTurns: 5 });
  const partialKinds: string[] = [];
  const partial = new NativeBootstrapController(status => { partialKinds.push(status.kind); });
  partial.syncRoute();
  partial.setExpectedTurns(100);
  await wait(400);
  assert(!partialKinds.includes('ready'), '5 user DOM and 5 official buttons were treated as a complete 100-turn conversation');
  await until(() => partialKinds.includes('incomplete') || partialKinds.includes('preparing'), 'partial official nav should wait, not ready');
  partial.dispose();
  partialHost.cleanup();
  pass('known 100-turn API does not ready from 5 visible user/official nodes');

  history.replaceState({}, '', '/c/prompts-target');
  const promptsHost = await mountConversationFixture('prompts-target', 100);
  const promptKinds: string[] = [];
  const promptsCtrl = new NativeBootstrapController(status => { promptKinds.push(status.kind); });
  promptsCtrl.syncRoute();
  await until(() => promptKinds.includes('ready') && promptsHost.nav.querySelectorAll('button').length === 100, 'history.prompts was not used as the official nav target');
  promptsCtrl.dispose();
  promptsHost.cleanup();
  pass('when expectedTurns is unknown, history.prompts is the official nav target');

  history.replaceState({}, '', '/c/race-a');
  pageStates.length = 0;
  const releaseA = deferPart('conversations/race-a?');
  const fetchA = fetch(`${origin}/backend-api/conversations/race-a?num_turns=5`);
  history.pushState({}, '', '/c/race-b');
  const fetchB = fetch(`${origin}/backend-api/conversations/race-b?num_turns=5`);
  await fetchB;
  releaseA(jsonResponse({
    messages: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, author: { role: 'user' } })),
    page_info: { has_previous_page: false }
  }));
  await fetchA;
  await until(() => pageStates.some(state => state.conversationId === 'race-b' && state.pages > 0), 'conversation B never captured');
  assert(!pageStates.some(state => state.conversationId === 'race-b' && state.prompts === 8), 'late conversation A overwrote B through the page hook');
  pass('late conversation A response cannot overwrite B');

  history.replaceState({}, '', '/c/invert');
  pageStates.length = 0;
  const releaseFirst = deferPart('conversations/invert?num_turns=100&order=1');
  const releaseSecond = deferPart('conversations/invert?num_turns=100&order=2');
  const invertFirst = fetch(`${origin}/backend-api/conversations/invert?num_turns=5&order=1`);
  const invertSecond = fetch(`${origin}/backend-api/conversations/invert?num_turns=5&order=2`);
  releaseSecond(jsonResponse({
    messages: [{ id: 'second-u', author: { role: 'user' } }, { id: 'second-a', author: { role: 'assistant' } }],
    page_info: { has_previous_page: false }
  }));
  await invertSecond;
  await until(() => pageStates.some(state => state.conversationId === 'invert' && state.initialVersion === 1), 'latest initial was not applied');
  releaseFirst(jsonResponse({
    messages: [{ id: 'first-u', author: { role: 'user' } }],
    page_info: { has_previous_page: false }
  }));
  await invertFirst;
  await wait(80);
  const invertLast = [...pageStates].reverse().find(state => state.conversationId === 'invert' && state.pages > 0);
  assert(invertLast?.prompts === 1 && invertLast.initialVersion === 1, 'earlier initial response overwrote the latest chain');
  pass('only the latest valid initial response establishes a new initialVersion');

  history.replaceState({}, '', '/c/bootstrap-huge');
  pageStates.length = 0;
  lastStreamCancel = false;
  const huge = await fetch(`${origin}/backend-api/conversations/bootstrap-huge`);
  await until(() => pageStates.some(state => state.conversationId === 'bootstrap-huge' && state.issue === 'capture-unavailable'), '16MiB stream did not stop capture');
  assert(lastStreamPulls >= 8 && lastStreamPulls < 20, `16MiB stream was not stopped during read: ${lastStreamPulls} pulls`);
  const hugeReader = huge.body?.getReader();
  assert(hugeReader, 'original oversized Response lost its body');
  const hugeChunk = await hugeReader!.read();
  assert(!hugeChunk.done && (hugeChunk.value?.byteLength ?? 0) > 0, 'original Response could not be read after clone cancelled');
  await hugeReader!.cancel();
  pass('clone read stops at 16MiB without content-length; original Response remains readable');

  history.replaceState({}, '', '/c/bootstrap-stream');
  const streamed = await fetch(`${origin}/backend-api/conversations/bootstrap-stream`);
  const streamedJson = await streamed.json() as { messages?: unknown[] };
  assert(Array.isArray(streamedJson.messages), 'original streamed Response was not readable after clone capture');
  pass('original Response remains readable after streaming clone capture');

  history.replaceState({}, '', '/c/bootstrap-timeout');
  pageStates.length = 0;
  lastStreamCancel = false;
  void fetch(`${origin}/backend-api/conversations/bootstrap-timeout`);
  await until(() => pageStates.some(state => state.conversationId === 'bootstrap-timeout' && state.issue === 'capture-unavailable'), 'timed-out capture did not stop the session', Math.ceil(MAX_CAPTURE_MS / 50) + 20, 50);
  await wait(80);
  const stats = page.nativeBootstrapCaptureStats();
  assert(stats.readers === 0 && stats.captures === 0, `timed-out capture left a reader behind readers=${stats.readers} captures=${stats.captures} cancelled=${lastStreamCancel}`);
  pass('capture timeout stops the current session and releases the reader');

  history.replaceState({}, '', '/c/cancel-reader');
  pageStates.length = 0;
  lastStreamCancel = false;
  const releaseHang = deferPart('conversations/cancel-reader');
  void fetch(`${origin}/backend-api/conversations/cancel-reader?num_turns=5`);
  await wait(40);
  history.pushState({}, '', '/c/after-cancel');
  releaseHang(hangingStreamResponse());
  await wait(80);
  const afterCancel = page.nativeBootstrapCaptureStats();
  assert(afterCancel.captures === 0, 'route change left the previous clone reader active');
  pass('route change cancels the previous clone reader');

  history.replaceState({}, '', '/c/idle-debounce');
  const idleHost = await mountConversationFixture('idle-debounce', 180);
  let idlePreparing = 0;
  let idlePaused = false;
  const idle = new NativeBootstrapController(status => {
    if (status.kind === 'preparing') idlePreparing += 1;
    if (status.reason === '用户操作已暂停') idlePaused = true;
  });
  idle.syncRoute();
  idle.setExpectedTurns(180);
  await until(() => idlePreparing > 0, 'idle debounce fixture never entered preparing');
  const preparingBeforePause = idlePreparing;
  idleHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
  await until(() => idlePaused, 'first wheel did not pause prepare');
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    idleHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
    await wait(500);
    assert(idlePreparing === preparingBeforePause, 'prepare resumed while the user was still scrolling');
  }
  await until(() => idlePreparing > preparingBeforePause, 'prepare did not resume 2.5s after the last user action', 80, 50);
  idle.dispose();
  idleHost.cleanup();
  pass('continuous scrolling never resumes; resume happens only after 2.5s of quiet');

  history.replaceState({}, '', '/c/idle-hidden');
  const hiddenHost = await mountConversationFixture('idle-hidden', 180);
  let hiddenPreparing = 0;
  let hiddenPaused = false;
  const hidden = new NativeBootstrapController(status => {
    if (status.kind === 'preparing') hiddenPreparing += 1;
    if (status.reason === '用户操作已暂停') hiddenPaused = true;
  });
  hidden.syncRoute();
  hidden.setExpectedTurns(180);
  await until(() => hiddenPreparing > 0, 'hidden-idle fixture never entered preparing');
  const hiddenBefore = hiddenPreparing;
  hiddenHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
  await until(() => hiddenPaused, 'hidden-idle fixture did not pause');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(USER_IDLE_MS + 200);
  assert(hiddenPreparing === hiddenBefore, 'hidden page resumed after the idle timer');
  delete (document as Document & { visibilityState?: string }).visibilityState;
  hidden.dispose();
  hiddenHost.cleanup();

  history.replaceState({}, '', '/c/idle-generating');
  const generatingHost = await mountConversationFixture('idle-generating', 180);
  let generatingPreparing = 0;
  let generatingPaused = false;
  const generating = new NativeBootstrapController(status => {
    if (status.kind === 'preparing') generatingPreparing += 1;
    if (status.reason === '用户操作已暂停') generatingPaused = true;
  });
  generating.syncRoute();
  generating.setExpectedTurns(180);
  await until(() => generatingPreparing > 0, 'generating-idle fixture never entered preparing');
  const generatingBefore = generatingPreparing;
  generatingHost.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }));
  await until(() => generatingPaused, 'generating-idle fixture did not pause');
  const stop = document.createElement('button');
  stop.setAttribute('data-testid', 'stop-button');
  document.body.append(stop);
  await wait(USER_IDLE_MS + 200);
  assert(generatingPreparing === generatingBefore, 'generating response resumed after the idle timer');
  stop.remove();
  generating.dispose();
  generatingHost.cleanup();
  pass('hidden or generating pages do not resume when the idle timer fires');
}
