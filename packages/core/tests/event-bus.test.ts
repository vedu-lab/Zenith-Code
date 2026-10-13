import { describe, it, expect, vi } from 'vitest';
import { CoreEventBus, TurnStartedEvent, FileWrittenEvent } from '../src/events/index.js';

describe('CoreEventBus', () => {
  it('should dispatch to sync and async subscribers', async () => {
    const bus = new CoreEventBus();
    const syncCalls: string[] = [];
    const asyncCalls: string[] = [];

    bus.subscribeSync('turn.started', (evt) => {
      syncCalls.push(evt.payload.sessionId);
    });

    bus.subscribe('turn.started', async (evt) => {
      await new Promise((r) => setTimeout(r, 5));
      asyncCalls.push(evt.payload.sessionId);
    });

    const event: TurnStartedEvent = {
      id: 'turn-1',
      type: 'turn.started',
      timestamp: Date.now(),
      actor: 'agent',
      payload: { turnIndex: 1, sessionId: 'sess-abc', model: 'claude-3-5-sonnet' },
    };

    await bus.publish(event);

    expect(syncCalls).toEqual(['sess-abc']);
    expect(asyncCalls).toEqual(['sess-abc']);
  });

  it('should support publishSync without waiting for async subscribers', () => {
    const bus = new CoreEventBus();
    const syncFn = vi.fn();
    const asyncFn = vi.fn().mockImplementation(async () => {});

    bus.subscribeSync('file.written', syncFn);
    bus.subscribe('file.written', asyncFn);

    const event: FileWrittenEvent = {
      id: 'fw-1',
      type: 'file.written',
      timestamp: Date.now(),
      actor: 'tool',
      payload: { filePath: 'src/main.ts', byteCount: 100, isNew: true },
    };

    bus.publishSync(event);

    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(asyncFn).toHaveBeenCalledTimes(1);
  });

  it('should isolate errors in handlers from crashing event publisher', async () => {
    const bus = new CoreEventBus();

    bus.subscribeSync('turn.started', () => {
      throw new Error('Explosion in sync handler');
    });

    bus.subscribe('turn.started', async () => {
      throw new Error('Explosion in async handler');
    });

    const event: TurnStartedEvent = {
      id: 'turn-2',
      type: 'turn.started',
      timestamp: Date.now(),
      actor: 'agent',
      payload: { turnIndex: 1, sessionId: 'sess-xyz', model: 'gpt-4o' },
    };

    // publish should not throw!
    await expect(bus.publish(event)).resolves.not.toThrow();
  });

  it('should manage history buffer', async () => {
    const bus = new CoreEventBus(3);

    for (let i = 1; i <= 5; i++) {
      await bus.publish({
        id: `evt-${i}`,
        type: 'turn.started',
        timestamp: i,
        actor: 'agent',
        payload: { turnIndex: i, sessionId: `s-${i}`, model: 'test' },
      });
    }

    const history = bus.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0]?.id).toBe('evt-3');
    expect(history[2]?.id).toBe('evt-5');

    bus.clearHistory();
    expect(bus.getHistory()).toHaveLength(0);
  });
});
