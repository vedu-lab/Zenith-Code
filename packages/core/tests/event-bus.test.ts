import { describe, it, expect, vi } from 'vitest';
import { CoreEventBus, ForgeEvent, StateTransitionEvent } from '../src/events/index.js';

describe('CoreEventBus', () => {
  it('should publish and receive typed events', async () => {
    const bus = new CoreEventBus();
    const handler = vi.fn();

    const unsubscribe = bus.subscribe('state:transition', handler);

    const event: StateTransitionEvent = {
      id: 'evt-1',
      type: 'state:transition',
      timestamp: 1000,
      actor: 'system',
      payload: {
        entity: 'session',
        entityId: 'sess-123',
        fromState: 'idle',
        toState: 'busy',
        reason: 'agent loop started',
      },
    };

    await bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);

    unsubscribe();
    await bus.publish(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should notify global subscribers for all event types', async () => {
    const bus = new CoreEventBus();
    const globalHandler = vi.fn();

    bus.subscribeAll(globalHandler);

    const event: ForgeEvent = {
      id: 'evt-2',
      type: 'agent:step',
      timestamp: 2000,
      actor: 'agent',
      payload: {
        stepNumber: 1,
        message: 'Thinking...',
      },
    };

    await bus.publish(event);

    expect(globalHandler).toHaveBeenCalledWith(event);
    expect(bus.getHistory()).toHaveLength(1);
  });

  it('should cap history to maxHistorySize', async () => {
    const bus = new CoreEventBus(2);

    for (let i = 1; i <= 3; i++) {
      await bus.publish({
        id: `evt-${i}`,
        type: 'agent:step',
        timestamp: i,
        actor: 'agent',
        payload: { stepNumber: i, message: `step ${i}` },
      });
    }

    const history = bus.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe('evt-2');
    expect(history[1]?.id).toBe('evt-3');
  });
});
