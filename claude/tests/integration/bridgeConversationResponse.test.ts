import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('injected conversation response bridge', () => {
  it('does not publish a failed host tree response as a canonical conversation', async () => {
    const source = await readFile(
      new URL('../../public/counter/injected/bridge.js', import.meta.url),
      'utf8',
    );
    const postMessage = vi.fn();
    const failedResponse = {
      ok: false,
      headers: { get: () => 'application/json' },
      clone: () => ({ json: async () => ({ error: 'fixture failure' }) }),
    };
    const windowObject = {
      fetch: vi.fn(async () => failedResponse),
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      postMessage,
    };
    const context = {
      window: windowObject,
      history: { pushState: vi.fn(), replaceState: vi.fn() },
      Request,
      URL,
      CustomEvent: class FixtureCustomEvent {},
      TextDecoder,
      TextEncoder,
      crypto,
      Uint8Array,
    };

    vm.runInNewContext(source, context);
    await windowObject.fetch(
      'https://claude.ai/api/organizations/org-fixture/chat_conversations/conversation-fixture?tree=true',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(postMessage.mock.calls.some(([value]) => (
      (value as { type?: string }).type === 'cc:conversation'
    ))).toBe(false);
  });
});
