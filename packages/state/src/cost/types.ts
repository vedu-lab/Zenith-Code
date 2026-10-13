export interface ModelPricing {
  readonly model: string;
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion?: number;
  readonly cacheWritePerMillion?: number;
  readonly isLocal: boolean;
}

export interface CostEstimate {
  readonly low: number;
  readonly expected: number;
  readonly high: number;
  readonly currency: 'USD';
  readonly assumptions: readonly string[];
  readonly tokensEstimated: {
    readonly input: number;
    readonly output: number;
  };
}

export interface BudgetLimits {
  readonly maxCostUsd?: number;
  readonly maxTimeMs?: number;
  readonly maxTurns?: number;
  readonly maxTokens?: number;
  readonly maxFilesChanged?: number;
}

export type BudgetAction = 'ok' | 'warn' | 'stop';

export interface BudgetCheckResult {
  readonly metric: 'cost' | 'time' | 'turns' | 'tokens' | 'files_changed';
  readonly current: number;
  readonly limit: number;
  readonly percentage: number;
  readonly status: BudgetAction;
  readonly message?: string;
}

export interface BudgetEvaluation {
  readonly action: BudgetAction;
  readonly warnings: readonly string[];
  readonly breachReason?: string;
  readonly details: readonly BudgetCheckResult[];
}

export interface UsageRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
}
