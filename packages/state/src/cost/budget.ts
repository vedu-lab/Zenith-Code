import { BudgetLimits, BudgetEvaluation } from './types.js';

export interface CurrentMetrics {
  readonly costUsd: number;
  readonly durationMs: number;
  readonly turns: number;
  readonly tokens: number;
  readonly filesChanged: number;
}

export class BudgetEnforcer {
  constructor(private readonly limits: BudgetLimits = {}) {}

  getLimits(): BudgetLimits {
    return this.limits;
  }

  evaluate(current: CurrentMetrics): BudgetEvaluation {
    const checks: {
      metric: 'cost' | 'time' | 'turns' | 'tokens' | 'files_changed';
      val: number;
      limit?: number | undefined;
      name: string;
      unit: string;
    }[] = [
      {
        metric: 'cost',
        val: current.costUsd,
        limit: this.limits.maxCostUsd,
        name: 'Cost',
        unit: '$',
      },
      {
        metric: 'time',
        val: current.durationMs,
        limit: this.limits.maxTimeMs,
        name: 'Execution Time',
        unit: 'ms',
      },
      {
        metric: 'turns',
        val: current.turns,
        limit: this.limits.maxTurns,
        name: 'Agent Turns',
        unit: 'turns',
      },
      {
        metric: 'tokens',
        val: current.tokens,
        limit: this.limits.maxTokens,
        name: 'Total Tokens',
        unit: 'tokens',
      },
      {
        metric: 'files_changed',
        val: current.filesChanged,
        limit: this.limits.maxFilesChanged,
        name: 'Files Changed',
        unit: 'files',
      },
    ];

    const warnings: string[] = [];
    let breachReason: string | undefined = undefined;
    let worstAction: 'ok' | 'warn' | 'stop' = 'ok';

    const details = checks.map((chk) => {
      if (chk.limit === undefined || chk.limit <= 0) {
        return {
          metric: chk.metric,
          current: chk.val,
          limit: 0,
          percentage: 0,
          status: 'ok' as const,
        };
      }

      const percentage = (chk.val / chk.limit) * 100;
      let status: 'ok' | 'warn' | 'stop' = 'ok';
      let message: string | undefined = undefined;

      if (percentage >= 100) {
        status = 'stop';
        worstAction = 'stop';
        message = `${chk.name} budget exceeded: ${chk.val} / ${chk.limit} ${chk.unit} (${percentage.toFixed(1)}%)`;
        if (!breachReason) {
          breachReason = message;
        }
      } else if (percentage >= 80) {
        status = 'warn';
        if (worstAction !== 'stop') {
          worstAction = 'warn';
        }
        message = `${chk.name} approaching budget limit: ${chk.val} / ${chk.limit} ${chk.unit} (${percentage.toFixed(1)}%)`;
        warnings.push(message);
      }

      return {
        metric: chk.metric,
        current: chk.val,
        limit: chk.limit,
        percentage: Number(percentage.toFixed(1)),
        status,
        ...(message ? { message } : {}),
      };
    });

    return {
      action: worstAction,
      warnings,
      ...(breachReason ? { breachReason } : {}),
      details,
    };
  }
}
