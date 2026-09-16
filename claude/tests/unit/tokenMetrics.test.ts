import { describe, expect, it, vi } from 'vitest';
import {
  TokenMetricsCalculator,
  buildCountableActiveBranch,
  createCounterRefreshCoordinator,
  type CountTokens,
  type HashText,
} from '../../src/pages/content/counter/tokenMetrics';
import { CLAUDE_ROOT_MESSAGE_ID } from '../../src/pages/content/conversation/buildActiveBranch';
import type { ClaudeConversation, RawClaudeMessage } from '../../src/pages/content/conversation/types';

const hashText: HashText = async (text) => `hash:${text}`;
const countTokens: CountTokens = (text) => text.length;

const message = (
  uuid: string,
  parent: string,
  sender: RawClaudeMessage['sender'],
  content: RawClaudeMessage['content'],
  extra: Partial<RawClaudeMessage> = {},
): RawClaudeMessage => ({
  uuid,
  parent_message_uuid: parent,
  sender,
  content,
  stop_reason: 'end_turn',
  ...extra,
});

const conversation = (
  chatMessages: RawClaudeMessage[],
  leaf = chatMessages.at(-1)?.uuid ?? '',
  extra: Record<string, unknown> = {},
): ClaudeConversation => ({
  current_leaf_message_uuid: leaf,
  chat_messages: chatMessages,
  ...extra,
});

describe('current active conversation token metrics', () => {
  it('counts one complete active parent chain in order', async () => {
    const tree = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'hello' }]),
      message('a1', 'u1', 'assistant', [{ type: 'text', text: 'world' }]),
    ]);

    const branch = buildCountableActiveBranch(tree);
    expect(branch.messages.map((item) => item.uuid)).toEqual(['u1', 'a1']);
    expect(branch.complete).toBe(true);

    const metrics = await new TokenMetricsCalculator().compute('c1', tree, countTokens, hashText);
    expect(metrics.totalTokens).toBe(10);
    expect(metrics.trunkMessageCount).toBe(2);
    expect(metrics.estimateIncomplete).toBe(false);
  });

  it('counts only the branch selected by current leaf', async () => {
    const tree = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'root' }]),
      message('a-old', 'u1', 'assistant', [{ type: 'text', text: 'discarded branch' }]),
      message('a-current', 'u1', 'assistant', [{ type: 'text', text: 'kept' }]),
    ], 'a-current');

    const metrics = await new TokenMetricsCalculator().compute('c1', tree, countTokens, hashText);
    expect(metrics.totalTokens).toBe('rootkept'.length);
    expect(metrics.trunkMessageCount).toBe(2);
  });

  it('uses message UUID plus normalized content hash as the incremental cache key', async () => {
    const tokenizer = vi.fn(countTokens);
    const calculator = new TokenMetricsCalculator();
    const first = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'same\r\n' }]),
    ]);
    const normalizedEquivalent = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'same\n' }]),
    ]);
    const changed = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'changed' }]),
    ]);

    await calculator.compute('c1', first, tokenizer, hashText);
    await calculator.compute('c1', normalizedEquivalent, tokenizer, hashText);
    await calculator.compute('c1', changed, tokenizer, hashText);

    expect(tokenizer).toHaveBeenCalledTimes(2);
  });

  it('excludes thinking, counts safe tool payloads, and counts visible tool results', async () => {
    const tree = conversation([
      message('a1', CLAUDE_ROOT_MESSAGE_ID, 'assistant', [
        { type: 'thinking', thinking: 'secret' },
        { type: 'redacted_thinking', data: 'secret' },
        { type: 'tool_use', id: 'private-id', name: 'search', input: { q: 'cats' } },
        { type: 'tool_result', tool_use_id: 'private-id', content: [{ type: 'text', text: 'visible result' }] },
      ]),
    ]);

    const branch = buildCountableActiveBranch(tree);
    expect(branch.messages[0]?.countableText).toContain('search');
    expect(branch.messages[0]?.countableText).toContain('cats');
    expect(branch.messages[0]?.countableText).toContain('visible result');
    expect(branch.messages[0]?.countableText).not.toContain('secret');
    expect(branch.messages[0]?.countableText).not.toContain('private-id');
  });

  it('marks image, PDF, and unknown blocks as incomplete without inventing tokens', async () => {
    const tree = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [
        { type: 'text', text: 'count me' },
        { type: 'image', source: { data: 'not-counted' } },
        { type: 'document', title: 'file.pdf' },
        { type: 'file', file_name: 'visible.txt', extracted_content: 'visible file text' },
        { type: 'future_block', payload: 'unknown' },
      ]),
    ]);

    const metrics = await new TokenMetricsCalculator().compute('c1', tree, countTokens, hashText);
    expect(metrics.totalTokens).toBe('count me\nvisible file text'.length);
    expect(metrics.nonTextBlockCount).toBe(4);
    expect(metrics.unknownBlockCount).toBe(1);
    expect(metrics.estimateIncomplete).toBe(true);
  });

  it('marks explicit Claude compaction metadata as estimate-incomplete', async () => {
    const tree = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'hello' }]),
    ], 'u1', { is_compacted: true });

    const metrics = await new TokenMetricsCalculator().compute('c1', tree, countTokens, hashText);
    expect(metrics.compacted).toBe(true);
    expect(metrics.estimateIncomplete).toBe(true);
  });

  it('marks a broken parent chain incomplete', async () => {
    const tree = conversation([
      message('a1', 'missing', 'assistant', [{ type: 'text', text: 'partial' }]),
    ]);

    const metrics = await new TokenMetricsCalculator().compute('c1', tree, countTokens, hashText);
    expect(metrics.branchComplete).toBe(false);
    expect(metrics.estimateIncomplete).toBe(true);
  });

  it('switches conversation caches and restores unchanged cached messages', async () => {
    const tokenizer = vi.fn(countTokens);
    const calculator = new TokenMetricsCalculator();
    const first = conversation([
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'first' }]),
    ]);
    const second = conversation([
      message('u2', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'second' }]),
    ]);

    await calculator.compute('c1', first, tokenizer, hashText);
    await calculator.compute('c2', second, tokenizer, hashText);
    await calculator.compute('c1', first, tokenizer, hashText);

    expect(tokenizer).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the active branch when current leaf changes and only tokenizes changed membership', async () => {
    const tokenizer = vi.fn(countTokens);
    const calculator = new TokenMetricsCalculator();
    const messages = [
      message('u1', CLAUDE_ROOT_MESSAGE_ID, 'human', [{ type: 'text', text: 'root' }]),
      message('a1', 'u1', 'assistant', [{ type: 'text', text: 'one' }]),
      message('a2', 'u1', 'assistant', [{ type: 'text', text: 'two' }]),
    ];

    const first = await calculator.compute('c1', conversation(messages, 'a1'), tokenizer, hashText);
    const second = await calculator.compute('c1', conversation(messages, 'a2'), tokenizer, hashText);

    expect(first.currentLeafMessageId).toBe('a1');
    expect(second.currentLeafMessageId).toBe('a2');
    expect(tokenizer).toHaveBeenCalledTimes(3);
  });

  it('debounces overlapping generation completions into one forced refresh', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const markStale = vi.fn();
    const coordinator = createCounterRefreshCoordinator({ refresh, markStale, delayMs: 500 });

    coordinator.generationStarted(1);
    coordinator.generationStarted(2);
    coordinator.generationSettled(1);
    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
    coordinator.generationSettled(2);
    vi.advanceTimersByTime(499);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(true);
    expect(markStale).toHaveBeenCalledTimes(2);

    coordinator.dispose();
    vi.useRealTimers();
  });

  it('does not expose a scroll-triggered refresh path', () => {
    const coordinator = createCounterRefreshCoordinator({ refresh: vi.fn(), markStale: vi.fn() });
    expect('scroll' in coordinator).toBe(false);
    coordinator.dispose();
  });

  it('processes a 121-message active branch within the local performance gate', async () => {
    const messages: RawClaudeMessage[] = [];
    let parent = CLAUDE_ROOT_MESSAGE_ID;
    for (let index = 0; index < 121; index += 1) {
      const uuid = `m-${index}`;
      messages.push(message(uuid, parent, index % 2 === 0 ? 'human' : 'assistant', [
        { type: 'text', text: `message ${index} with deterministic fixture content` },
      ]));
      parent = uuid;
    }

    const started = performance.now();
    const metrics = await new TokenMetricsCalculator().compute(
      'performance',
      conversation(messages),
      countTokens,
      hashText,
    );
    const elapsedMs = performance.now() - started;

    expect(metrics.trunkMessageCount).toBe(121);
    expect(elapsedMs).toBeLessThan(250);
  });
});
