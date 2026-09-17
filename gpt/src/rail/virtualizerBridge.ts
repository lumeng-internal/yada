/* Port of GPT Conversation Toolkit features/virtualizer-bridge.js.
 * Copyright (c) 2026 bujue3709. MIT; see THIRD_PARTY_NOTICES.md.
 * The page protocol and resource path are intentionally unchanged.
 */
const CONTENT_SOURCE = 'CGPT_TOOLKIT';
const PAGE_SOURCE = 'CGPT_TOOLKIT_PAGE';
const REQUEST_TYPE = 'VIRTUALIZER_SCROLL_TO_INDEX';
const RESULT_TYPE = 'VIRTUALIZER_SCROLL_TO_INDEX_RESULT';
export type BridgeResult = { ok: boolean; reason?: string; method?: string; attemptedIndex?: number | null };
let injection: Promise<boolean> | null = null;
let sequence = 0;

function injectPageScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) { resolve(false); return; }
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('features/virtualizer-bridge-page.js');
    const finish = (ok: boolean): void => { clearTimeout(timer); script.remove(); resolve(ok); };
    const timer = window.setTimeout(() => finish(false), 1200);
    script.onload = () => finish(true); script.onerror = () => finish(false);
    (document.head || document.documentElement).append(script);
  });
}
async function initBridge(): Promise<boolean> {
  injection ??= injectPageScript();
  const ok = await injection;
  if (!ok) injection = null;
  return ok;
}
export async function requestVirtualizerScrollToIndex(candidates: number[], signal: AbortSignal): Promise<BridgeResult> {
  const normalized = [...new Set(candidates.filter(n => Number.isFinite(n) && n >= 0).map(Math.trunc))];
  if (!normalized.length) return { ok: false, reason: 'invalid_index' };
  if (signal.aborted) return { ok: false, reason: 'cancelled' };
  const injected = await new Promise<boolean>(resolve => {
    const abort = (): void => resolve(false);
    signal.addEventListener('abort', abort, { once: true });
    void initBridge().then(ok => { signal.removeEventListener('abort', abort); resolve(ok); });
  });
  if (signal.aborted || !injected) return { ok: false, reason: signal.aborted ? 'cancelled' : 'bridge_injection_failed' };
  const requestId = `virtualizer:${Date.now()}:${++sequence}`;
  return new Promise(resolve => {
    let finished = false;
    const finish = (result: BridgeResult): void => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      window.removeEventListener('message', listener); signal.removeEventListener('abort', abort); resolve(result);
    };
    const abort = (): void => finish({ ok: false, reason: 'cancelled' });
    const listener = (event: MessageEvent): void => {
      const data = event.data;
      if (event.source !== window || data?.source !== PAGE_SOURCE || data.type !== RESULT_TYPE || data.requestId !== requestId) return;
      finish({ ok: Boolean(data.ok), reason: data.reason || '', method: data.method || '', attemptedIndex: Number.isFinite(data.attemptedIndex) ? data.attemptedIndex : null });
    };
    const timer = window.setTimeout(() => finish({ ok: false, reason: 'timeout' }), 1200);
    signal.addEventListener('abort', abort, { once: true }); window.addEventListener('message', listener);
    if (signal.aborted) { abort(); return; }
    window.postMessage({ source: CONTENT_SOURCE, type: REQUEST_TYPE, requestId, index: normalized[0], candidates: normalized,
      options: { align: 'center', behavior: 'auto', timeoutMs: 1200 } }, '*');
  });
}
