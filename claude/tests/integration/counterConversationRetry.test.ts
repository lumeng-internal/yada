import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('counter Conversation API recovery', () => {
  it('schedules a low-frequency conversation retry after the active request fails', async () => {
    const source = await readFile(
      new URL('../../src/pages/content/counter/content/main.js', import.meta.url),
      'utf8',
    );
    const handlers = new Map<string, (payload?: Record<string, unknown>) => unknown>();
    const timers: Array<() => unknown> = [];
    const requestConversation = vi.fn().mockResolvedValue(undefined);
    const element = { closest: () => null, parentElement: null };
    class CounterUI {
      initialize() {}
      attachHeader() {}
      attachUsageLine() {}
      setUsage() {}
      setConversationMetrics() {}
      setConversationUnavailable() {}
      setPendingCache() {}
      tick() {}
    }
    const windowStub = {
      location: { pathname: '/chat/case-a' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const documentStub = {
      body: {},
      cookie: 'lastActiveOrg=org-a',
      hidden: false,
      querySelector: () => element,
      addEventListener: vi.fn(),
    };
    const context = {
      globalThis: null as unknown,
      window: windowStub,
      document: documentStub,
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      setTimeout: (callback: () => unknown) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout: vi.fn(),
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
      Date,
      Math,
      Promise,
      ClaudeCounter: {
        DOM: {
          CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"]',
          MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"]',
        },
        ui: { CounterUI },
        injectBridgeOnce: () => Promise.resolve(),
        bridge: {
          on: (event: string, handler: (payload?: Record<string, unknown>) => unknown) => handlers.set(event, handler),
          requestUsage: vi.fn().mockResolvedValue(null),
          requestConversation,
        },
        tokens: {
          computeConversationMetrics: vi.fn(),
        },
      },
    };
    context.globalThis = context;
    vm.runInNewContext(source, context);
    await Promise.resolve();

    handlers.get('cc:conversation_error')?.({ conversationId: 'case-a' });

    expect(timers).toHaveLength(1);
    await timers[0]?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(requestConversation).toHaveBeenCalledWith('org-a', 'case-a');
  });
});
