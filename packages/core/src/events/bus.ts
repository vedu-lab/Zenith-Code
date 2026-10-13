import { ForgeEvent } from './types.js';

export type AsyncEventHandler<T extends ForgeEvent = ForgeEvent> = (
  event: T,
) => Promise<void> | void;
export type SyncEventHandler<T extends ForgeEvent = ForgeEvent> = (event: T) => void;

export interface IEventBus {
  publish<T extends ForgeEvent>(event: T): Promise<void>;
  publishSync<T extends ForgeEvent>(event: T): void;
  subscribe<T extends ForgeEvent>(type: T['type'], handler: AsyncEventHandler<T>): () => void;
  subscribeSync<T extends ForgeEvent>(type: T['type'], handler: SyncEventHandler<T>): () => void;
  subscribeAll(handler: AsyncEventHandler<ForgeEvent>): () => void;
  subscribeAllSync(handler: SyncEventHandler<ForgeEvent>): () => void;
  getHistory(): readonly ForgeEvent[];
  clearHistory(): void;
}

export class CoreEventBus implements IEventBus {
  private readonly asyncHandlers = new Map<string, Set<AsyncEventHandler<ForgeEvent>>>();
  private readonly syncHandlers = new Map<string, Set<SyncEventHandler<ForgeEvent>>>();
  private readonly globalAsyncHandlers = new Set<AsyncEventHandler<ForgeEvent>>();
  private readonly globalSyncHandlers = new Set<SyncEventHandler<ForgeEvent>>();
  private readonly history: ForgeEvent[] = [];
  private readonly maxHistorySize: number;

  constructor(maxHistorySize = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  private record(event: ForgeEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  async publish<T extends ForgeEvent>(event: T): Promise<void> {
    this.record(event);

    // 1. Run sync subscribers first
    this.dispatchSync(event);

    // 2. Run async subscribers and await completion
    const promises: Promise<void>[] = [];
    const typeAsync = this.asyncHandlers.get(event.type);
    if (typeAsync) {
      for (const handler of typeAsync) {
        try {
          const result = handler(event);
          if (result && typeof result.then === 'function') {
            promises.push(result);
          }
        } catch (error) {
          console.error(`[EventBus] Sync error in async handler for ${event.type}:`, error);
        }
      }
    }

    for (const handler of this.globalAsyncHandlers) {
      try {
        const result = handler(event);
        if (result && typeof result.then === 'function') {
          promises.push(result);
        }
      } catch (error) {
        console.error(`[EventBus] Sync error in global async handler for ${event.type}:`, error);
      }
    }

    if (promises.length > 0) {
      const settled = await Promise.allSettled(promises);
      for (const res of settled) {
        if (res.status === 'rejected') {
          console.error(`[EventBus] Async handler rejection for ${event.type}:`, res.reason);
        }
      }
    }
  }

  publishSync<T extends ForgeEvent>(event: T): void {
    this.record(event);
    this.dispatchSync(event);

    // Fire async handlers without awaiting
    const typeAsync = this.asyncHandlers.get(event.type);
    if (typeAsync) {
      for (const handler of typeAsync) {
        try {
          const res = handler(event);
          if (res && typeof res.catch === 'function') {
            res.catch((err: unknown) => {
              console.error(`[EventBus] Unhandled background async error for ${event.type}:`, err);
            });
          }
        } catch (err) {
          console.error(`[EventBus] Unhandled background async error for ${event.type}:`, err);
        }
      }
    }

    for (const handler of this.globalAsyncHandlers) {
      try {
        const res = handler(event);
        if (res && typeof res.catch === 'function') {
          res.catch((err: unknown) => {
            console.error(
              `[EventBus] Unhandled background global async error for ${event.type}:`,
              err,
            );
          });
        }
      } catch (err) {
        console.error(`[EventBus] Unhandled background global async error for ${event.type}:`, err);
      }
    }
  }

  private dispatchSync<T extends ForgeEvent>(event: T): void {
    const typeSync = this.syncHandlers.get(event.type);
    if (typeSync) {
      for (const handler of typeSync) {
        try {
          handler(event);
        } catch (error) {
          console.error(`[EventBus] Error in sync handler for ${event.type}:`, error);
        }
      }
    }

    for (const handler of this.globalSyncHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`[EventBus] Error in global sync handler for ${event.type}:`, error);
      }
    }
  }

  subscribe<T extends ForgeEvent>(type: T['type'], handler: AsyncEventHandler<T>): () => void {
    const rawHandler = handler as unknown as AsyncEventHandler<ForgeEvent>;
    let set = this.asyncHandlers.get(type);
    if (!set) {
      set = new Set();
      this.asyncHandlers.set(type, set);
    }
    set.add(rawHandler);

    return () => {
      set?.delete(rawHandler);
      if (set?.size === 0) {
        this.asyncHandlers.delete(type);
      }
    };
  }

  subscribeSync<T extends ForgeEvent>(type: T['type'], handler: SyncEventHandler<T>): () => void {
    const rawHandler = handler as unknown as SyncEventHandler<ForgeEvent>;
    let set = this.syncHandlers.get(type);
    if (!set) {
      set = new Set();
      this.syncHandlers.set(type, set);
    }
    set.add(rawHandler);

    return () => {
      set?.delete(rawHandler);
      if (set?.size === 0) {
        this.syncHandlers.delete(type);
      }
    };
  }

  subscribeAll(handler: AsyncEventHandler<ForgeEvent>): () => void {
    this.globalAsyncHandlers.add(handler);
    return () => {
      this.globalAsyncHandlers.delete(handler);
    };
  }

  subscribeAllSync(handler: SyncEventHandler<ForgeEvent>): () => void {
    this.globalSyncHandlers.add(handler);
    return () => {
      this.globalSyncHandlers.delete(handler);
    };
  }

  getHistory(): readonly ForgeEvent[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history.length = 0;
  }
}
