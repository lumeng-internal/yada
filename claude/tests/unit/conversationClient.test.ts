import { describe, expect, it, vi } from 'vitest';
import { ConversationClientImpl } from '@src/pages/content/conversation/conversationClient';
import type { BridgePort } from '@src/pages/content/conversation/bridge';
import { linearConversation } from '../fixtures/conversations';

const context = { organizationId: 'org-fixture', conversationId: 'conversation-linear' };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('ConversationClientImpl', () => {
  it('coalesces concurrent requests for the same conversation', async () => {
    const pending = deferred<typeof linearConversation>();
    const bridge: BridgePort = {
      requestConversation: vi.fn(() => pending.promise),
      on: vi.fn(() => () => undefined),
    };
    const client = new ConversationClientImpl(() => bridge, () => 1234);

    const first = client.fetchConversation(context);
    const second = client.fetchConversation(context);
    pending.resolve(linearConversation);

    await expect(first).resolves.toMatchObject({ source: 'api', fetchedAt: 1234 });
    await expect(second).resolves.toMatchObject({ source: 'api', fetchedAt: 1234 });
    expect(bridge.requestConversation).toHaveBeenCalledTimes(1);
  });

  it('returns the cached snapshot until force refresh or invalidation', async () => {
    const bridge: BridgePort = {
      requestConversation: vi.fn(async () => linearConversation),
      on: vi.fn(() => () => undefined),
    };
    const client = new ConversationClientImpl(() => bridge, () => 1234);

    await client.fetchConversation(context);
    await client.fetchConversation(context);
    await client.fetchConversation(context, { force: true });
    client.invalidate(context.conversationId);
    await client.fetchConversation(context);

    expect(bridge.requestConversation).toHaveBeenCalledTimes(3);
  });

  it('rejects an aborted consumer without converting the transport result into an error cache', async () => {
    const pending = deferred<typeof linearConversation>();
    const bridge: BridgePort = {
      requestConversation: vi.fn(() => pending.promise),
      on: vi.fn(() => () => undefined),
    };
    const client = new ConversationClientImpl(() => bridge, () => 1234);
    const controller = new AbortController();

    const aborted = client.fetchConversation(context, { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    pending.resolve(linearConversation);
    await expect(client.fetchConversation(context)).resolves.toMatchObject({ conversation: linearConversation });
    expect(bridge.requestConversation).toHaveBeenCalledTimes(1);
  });

  it('does not let an invalidated in-flight response repopulate the cache', async () => {
    const oldResponse = deferred<typeof linearConversation>();
    const freshResponse = deferred<typeof linearConversation>();
    const requestConversation = vi.fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => freshResponse.promise);
    const bridge: BridgePort = {
      requestConversation,
      on: vi.fn(() => () => undefined),
    };
    const client = new ConversationClientImpl(() => bridge, () => 1234);

    const oldRequest = client.fetchConversation(context);
    client.invalidate(context.conversationId);
    const freshRequest = client.fetchConversation(context);
    freshResponse.resolve({ ...linearConversation, uuid: 'fresh-conversation' });
    oldResponse.resolve({ ...linearConversation, uuid: 'old-conversation' });

    await expect(oldRequest).resolves.toMatchObject({ conversation: { uuid: 'old-conversation' } });
    await expect(freshRequest).resolves.toMatchObject({ conversation: { uuid: 'fresh-conversation' } });
    await expect(client.fetchConversation(context)).resolves.toMatchObject({
      conversation: { uuid: 'fresh-conversation' },
    });
    expect(requestConversation).toHaveBeenCalledTimes(2);
  });

  it('fails clearly when the existing bridge is unavailable', async () => {
    const client = new ConversationClientImpl(() => null, () => 1234);
    await expect(client.fetchConversation(context)).rejects.toThrow('Conversation bridge unavailable');
  });
});
