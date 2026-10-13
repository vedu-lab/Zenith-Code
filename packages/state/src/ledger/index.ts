import { IClock, IEventBus } from '@forge/core';

export interface TokenUsageEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
}

export class UsageLedger {
  private readonly entries: TokenUsageEntry[] = [];

  constructor(
    private readonly clock: IClock,
    private readonly eventBus?: IEventBus,
  ) {}

  async recordUsage(
    sessionId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    costPerMillionPrompt = 3.0,
    costPerMillionCompletion = 15.0,
  ): Promise<TokenUsageEntry> {
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd =
      (promptTokens / 1_000_000) * costPerMillionPrompt +
      (completionTokens / 1_000_000) * costPerMillionCompletion;

    const entry: TokenUsageEntry = {
      id: `usage-${this.clock.nowMs()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      timestamp: this.clock.nowMs(),
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
    };

    this.entries.push(entry);

    if (this.eventBus) {
      await this.eventBus.publish({
        id: `evt-usage-${entry.id}`,
        type: 'state:transition',
        timestamp: entry.timestamp,
        actor: 'system',
        payload: {
          entity: 'usage_ledger',
          entityId: sessionId,
          fromState: 'unrecorded',
          toState: 'recorded',
          reason: 'Token consumption recorded',
          metadata: { ...entry },
        },
      });
    }

    return entry;
  }

  getTotalTokens(sessionId?: string): number {
    return this.getEntries(sessionId).reduce((sum, e) => sum + e.totalTokens, 0);
  }

  getTotalCost(sessionId?: string): number {
    return this.getEntries(sessionId).reduce((sum, e) => sum + e.estimatedCostUsd, 0);
  }

  getEntries(sessionId?: string): readonly TokenUsageEntry[] {
    return sessionId ? this.entries.filter((e) => e.sessionId === sessionId) : [...this.entries];
  }
}
