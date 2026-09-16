import { describe, expect, it, vi } from 'vitest';
import {
  ConversationBridgeSequenceGate,
  GenerationRefreshCoordinator,
  createDebouncedConversationRefresh,
} from '@src/pages/content/conversation/runtime';

describe('focused conversation runtime', () => {
  it('coalesces generation-settled signals into one bounded refresh', () => {
    let nextTimer = 0;
    const callbacks = new Map<number, () => void>();
    const refresh = vi.fn();
    const scheduler = createDebouncedConversationRefresh(
      refresh,
      500,
      (callback) => {
        nextTimer += 1;
        callbacks.set(nextTimer, callback);
        return nextTimer;
      },
      (timer) => { callbacks.delete(timer); },
    );

    scheduler.schedule();
    scheduler.schedule();
    expect(callbacks.size).toBe(1);
    callbacks.values().next().value?.();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('rejects an older tree response that arrives after a newer response', () => {
    const gate = new ConversationBridgeSequenceGate();
    expect(gate.accept('conversation-fixture', 8)).toBe(true);
    expect(gate.accept('conversation-fixture', 7)).toBe(false);
    expect(gate.accept('conversation-fixture', 9)).toBe(true);
  });

  it('waits for all concurrent generations before scheduling one refresh', () => {
    const schedule = vi.fn();
    const coordinator = new GenerationRefreshCoordinator(
      { schedule, cancel: vi.fn() },
      vi.fn(),
    );

    coordinator.start(1);
    coordinator.start(2);
    coordinator.settled(1);
    expect(schedule).not.toHaveBeenCalled();
    coordinator.settled(2);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('cancels pending generation work on a route change', () => {
    const schedule = vi.fn();
    const cancel = vi.fn();
    const coordinator = new GenerationRefreshCoordinator({ schedule, cancel }, vi.fn());

    coordinator.start(1);
    coordinator.stop();
    coordinator.settled(1);

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(schedule).not.toHaveBeenCalled();
  });
});
