import { describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '@src/pages/content/conversation/conversationStore';
import type {
  ConversationClient,
  ConversationClientResult,
  ConversationRequestContext,
} from '@src/pages/content/conversation/types';
import {
  branchedConversation,
  linearConversation,
  makeLongConversation,
  missingParentConversation,
  streamingConversation,
} from '../fixtures/conversations';

const linearContext = { organizationId: 'org-fixture', conversationId: 'conversation-linear' };

const result = (conversation: ConversationClientResult['conversation'], fetchedAt = 100): ConversationClientResult => ({
  source: 'api',
  fetchedAt,
  conversation,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('ConversationStore', () => {
  it('loads a complete canonical snapshot and notifies subscribers', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(linearConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.load(linearContext);

    expect(store.getState()).toMatchObject({ status: 'ready', error: null });
    expect(store.getState().snapshot?.messages).toHaveLength(4);
    expect(store.getState().snapshot?.turns.map((turn) => turn.id)).toEqual(['msg-user-001', 'msg-user-002']);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    const calls = listener.mock.calls.length;
    store.clear();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('marks a broken parent chain incomplete instead of ready', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(missingParentConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);

    await store.load({ organizationId: 'org-fixture', conversationId: 'conversation-missing-parent' });

    expect(store.getState().status).toBe('incomplete');
    expect(store.getState().snapshot?.complete).toBe(false);
    expect(store.getState().snapshot?.issues.some((issue) => issue.code === 'missing-parent')).toBe(true);
  });

  it('suppresses a slow response after the route changes', async () => {
    const slow = deferred<ConversationClientResult>();
    const client: ConversationClient = {
      fetchConversation: vi.fn((context: ConversationRequestContext) => {
        if (context.conversationId === 'conversation-linear') return slow.promise;
        return Promise.resolve(result(branchedConversation, 200));
      }),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);

    const first = store.load(linearContext);
    await store.load({ organizationId: 'org-fixture', conversationId: 'conversation-branched' });
    slow.resolve(result(linearConversation, 300));
    await first;

    expect(store.getState().snapshot?.conversationId).toBe('conversation-branched');
    expect(store.getState().snapshot?.currentLeafMessageId).toBe('msg-assistant-side-002');
  });

  it('preserves the current snapshot as stale when a refresh fails', async () => {
    let fail = false;
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => {
        if (fail) throw new Error('fixture network failure');
        return result(linearConversation);
      }),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);
    await store.load(linearContext);
    fail = true;

    await store.load(linearContext, { force: true });

    expect(store.getState().status).toBe('stale');
    expect(store.getState().snapshot?.conversationId).toBe('conversation-linear');
    expect(store.getState().error).toBe('fixture network failure');
  });

  it('marks the last complete snapshot stale while generation is in progress', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(linearConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);
    await store.load(linearContext);

    store.markStale();

    expect(store.getState().status).toBe('stale');
    expect(store.getState().snapshot?.complete).toBe(true);
  });

  it('does not mark an initial streaming assistant snapshot ready', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(streamingConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);

    await store.load(linearContext);

    expect(store.getState().status).toBe('incomplete');
    expect(store.getState().snapshot?.complete).toBe(false);
  });

  it('retains the last complete snapshot as stale when a streaming payload arrives', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(linearConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);
    await store.load(linearContext);
    const completeSnapshot = store.getState().snapshot;

    await store.applyConversation(linearContext, streamingConversation, 300);

    expect(store.getState().status).toBe('stale');
    expect(store.getState().snapshot).toBe(completeSnapshot);
  });

  it('reports an error without a prior snapshot', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => { throw new Error('fixture failure'); }),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);

    await store.load(linearContext);

    expect(store.getState()).toEqual({ status: 'error', snapshot: null, error: 'fixture failure' });
  });

  it('rebuilds the active branch when an intercepted payload changes the leaf', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(branchedConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);
    await store.load({ organizationId: 'org-fixture', conversationId: 'conversation-branched' });

    await store.applyConversation(
      { organizationId: 'org-fixture', conversationId: 'conversation-branched' },
      { ...branchedConversation, current_leaf_message_uuid: 'msg-assistant-main' },
      300,
    );

    expect(store.getState().status).toBe('ready');
    expect(store.getState().snapshot?.currentLeafMessageId).toBe('msg-assistant-main');
    expect(store.getState().snapshot?.turns).toHaveLength(2);
  });

  it('ignores intercepted payloads for a different current route', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(linearConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);
    await store.load(linearContext);

    const applied = await store.applyConversation(
      { organizationId: 'org-fixture', conversationId: 'conversation-branched' },
      branchedConversation,
      300,
    );

    expect(applied).toBe(false);
    expect(store.getState().snapshot?.conversationId).toBe('conversation-linear');
  });

  it('does not let an older intercepted payload overwrite a newer leaf snapshot', async () => {
    const client: ConversationClient = {
      fetchConversation: vi.fn(async () => result(linearConversation)),
      invalidate: vi.fn(),
    };
    const store = new ConversationStore(client);
    await store.load(linearContext);

    const older = store.applyConversation(linearContext, makeLongConversation(120), 200);
    const newer = store.applyConversation(linearContext, linearConversation, 300);
    await Promise.all([older, newer]);

    expect(store.getState().snapshot?.currentLeafMessageId).toBe('msg-assistant-002');
    expect(store.getState().snapshot?.fetchedAt).toBe(300);
  });
});
