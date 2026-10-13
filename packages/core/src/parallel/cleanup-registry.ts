export interface CleanupHandler {
  readonly id: string;
  readonly cleanup: () => Promise<void>;
}

export class CleanupRegistry {
  private static instance: CleanupRegistry | undefined;
  private readonly handlers = new Map<string, () => Promise<void>>();
  private isHooked = false;
  private isCleaningUp = false;

  static getInstance(): CleanupRegistry {
    if (!CleanupRegistry.instance) {
      CleanupRegistry.instance = new CleanupRegistry();
    }
    return CleanupRegistry.instance;
  }

  register(id: string, cleanup: () => Promise<void>): void {
    this.handlers.set(id, cleanup);
    this.ensureSignalHooks();
  }

  unregister(id: string): void {
    this.handlers.delete(id);
  }

  async cleanup(id: string): Promise<void> {
    const handler = this.handlers.get(id);
    if (handler) {
      this.handlers.delete(id);
      try {
        await handler();
      } catch (err) {
        // Do not swallow completely; log to stderr or record
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[CleanupRegistry] Failed to clean up ${id}: ${msg}\n`);
      }
    }
  }

  async cleanupAll(): Promise<void> {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    const entries = Array.from(this.handlers.entries());
    this.handlers.clear();

    for (const [id, handler] of entries) {
      try {
        await handler();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[CleanupRegistry] Failed to clean up ${id}: ${msg}\n`);
      }
    }

    this.isCleaningUp = false;
  }

  getRegisteredIds(): readonly string[] {
    return Array.from(this.handlers.keys());
  }

  private ensureSignalHooks(): void {
    if (this.isHooked) return;
    this.isHooked = true;

    const handleSignal = (): void => {
      void this.cleanupAll().finally(() => {
        // Allow exit
      });
    };

    // Only hook in non-browser Node runtime
    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      process.once('SIGINT', handleSignal);
      process.once('SIGTERM', handleSignal);
    }
  }
}
