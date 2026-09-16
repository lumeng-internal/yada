import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('counter bridge readiness', () => {
  it('does not post a conversation request before the injected listener is loaded', async () => {
    const source = await readFile(
      new URL('../../src/pages/content/counter/content/bridge-client.js', import.meta.url),
      'utf8',
    );
    const listeners = new Map<string, (event: unknown) => void>();
    const postMessage = vi.fn();
    const appended: Array<{ onload?: () => void }> = [];
    const context = {
      globalThis: null as unknown,
      browser: { runtime: { getURL: (path: string) => path } },
      window: {
        addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
        postMessage,
      },
      document: {
        getElementById: () => null,
        createElement: () => ({}),
        head: { appendChild: (script: { onload?: () => void }) => appended.push(script) },
        documentElement: { appendChild: (script: { onload?: () => void }) => appended.push(script) },
      },
      setTimeout,
      clearTimeout,
      Date,
      Math,
      Promise,
      ClaudeCounter: { DOM: { BRIDGE_SCRIPT_ID: 'fixture-bridge-script' } },
    };
    context.globalThis = context;
    vm.runInNewContext(source, context);

    const bridge = (context as unknown as {
      ClaudeCounter: { bridge: { requestConversation(org: string, conversation: string): Promise<unknown> } };
    }).ClaudeCounter.bridge;
    const result = bridge.requestConversation('org-fixture', 'conversation-fixture');
    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();

    appended[0]?.onload?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(postMessage).toHaveBeenCalledTimes(1);
    const posted = postMessage.mock.calls[0]?.[0] as { requestId: string; kind?: string };
    expect(posted.kind).toBe('conversation');
    listeners.get('message')?.({
      source: context.window,
      data: {
        cc: 'ClaudeCounter',
        type: 'cc:response',
        requestId: posted.requestId,
        ok: true,
        payload: { uuid: 'conversation-fixture' },
      },
    });
    await expect(result).resolves.toMatchObject({ uuid: 'conversation-fixture' });
  });
});
