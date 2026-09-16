import { describe, expect, it, vi } from 'vitest';
import { buildActiveBranch } from '@src/pages/content/conversation/buildActiveBranch';
import { buildCanonicalTurns } from '@src/pages/content/conversation/buildCanonicalTurns';
import { sha256Hex } from '@src/pages/content/conversation/content';
import { copyCanonicalConversation } from '@src/pages/content/conversation/copyCanonicalConversation';
import type { ConversationSnapshot, ConversationStoreState } from '@src/pages/content/conversation/types';
import {
  branchedConversation,
  cyclicConversation,
  linearConversation,
  missingParentConversation,
} from '../fixtures/conversations';

const stateFor = async (
  conversation: typeof linearConversation,
  status: ConversationStoreState['status'] = 'ready',
): Promise<ConversationStoreState> => {
  const branch = await buildActiveBranch(conversation);
  const snapshot: ConversationSnapshot = {
    conversationId: conversation.uuid,
    currentLeafMessageId: conversation.current_leaf_message_uuid,
    messages: branch.messages,
    turns: buildCanonicalTurns(branch.messages),
    complete: branch.complete,
    issues: branch.issues,
    fetchedAt: 100,
  };
  return { status, snapshot, error: null };
};

describe('copyCanonicalConversation', () => {
  it('writes the complete active branch exactly once', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const result = await copyCanonicalConversation(await stateFor(linearConversation), writeText);

    expect(result.status).toBe('copied');
    expect(result.metrics).toMatchObject({ activeBranchMessageCount: 4, serializedVisibleMessageCount: 4 });
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('produces the same output independent of top, middle, or bottom mounted DOM windows', async () => {
    const state = await stateFor(linearConversation);
    const hashes: string[] = [];

    for (const _mountedWindow of ['top-7', 'middle-12', 'bottom-3']) {
      const writeText = vi.fn(async (text: string) => { hashes.push(await sha256Hex(text)); });
      await copyCanonicalConversation(state, writeText);
    }

    expect(new Set(hashes).size).toBe(1);
  });

  it('refuses an incomplete parent chain and does not write', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const state = await stateFor(missingParentConversation, 'incomplete');
    const result = await copyCanonicalConversation(state, writeText);

    expect(result.status).toBe('unavailable');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('refuses a cyclic parent chain and does not write', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const state = await stateFor(cyclicConversation as typeof linearConversation, 'incomplete');
    const result = await copyCanonicalConversation(state, writeText);

    expect(result.status).toBe('unavailable');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('refuses API error state and does not write', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const result = await copyCanonicalConversation({ status: 'error', snapshot: null, error: 'fixture failure' }, writeText);

    expect(result.status).toBe('unavailable');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('rejects a snapshot whose current leaf does not match the branch tail', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const state = await stateFor(linearConversation);
    state.snapshot = { ...state.snapshot!, currentLeafMessageId: 'msg-other-leaf' };

    const result = await copyCanonicalConversation(state, writeText);

    expect(result.status).toBe('invalid');
    expect(result.errors).toContain('leaf-mismatch');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies only the selected active side branch', async () => {
    const writes: string[] = [];
    const result = await copyCanonicalConversation(await stateFor(branchedConversation), async (text) => { writes.push(text); });

    expect(result.status).toBe('copied');
    expect(writes[0]).not.toContain('人工主分支问题');
    expect(result.metrics?.activeBranchMessageCount).toBe(6);
  });

  it('reports clipboard failure without returning copied status', async () => {
    const result = await copyCanonicalConversation(
      await stateFor(linearConversation),
      async () => { throw new Error('fixture clipboard denied'); },
    );

    expect(result.status).toBe('clipboard-error');
    expect(result.errors).toEqual(['clipboard-write-failed']);
  });

  it('does not write when the current route or leaf changes during serialization', async () => {
    const state = await stateFor(linearConversation);
    const writeText = vi.fn(async () => undefined);

    const result = await copyCanonicalConversation(state, writeText, {
      isCurrentSnapshot: () => false,
    });

    expect(result.status).toBe('stale');
    expect(writeText).not.toHaveBeenCalled();
  });
});
