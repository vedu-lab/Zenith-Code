import { ErrorCode, ForgeError } from '../errors/index.js';
import { ParallelRunConfig } from './types.js';

export interface BudgetCheckResult {
  readonly canProceed: boolean;
  readonly reason?: string | undefined;
}

export class ParallelGovernor {
  private readonly config: ParallelRunConfig;
  private readonly agentCosts = new Map<string, number>();
  private totalCostUsd = 0;

  constructor(config: ParallelRunConfig) {
    this.config = config;

    for (const agent of config.agents) {
      this.agentCosts.set(agent.id, 0);
    }
  }

  /**
   * Validates caps before starting and generates cost warning.
   */
  validatePreflight(): { warning: string } {
    const agentCount = this.config.agents.length;

    // 1. Enforce concurrency cap
    if (agentCount > this.config.maxConcurrency) {
      throw new ForgeError({
        code: ErrorCode.PARALLEL_CONCURRENCY_EXCEEDED,
        message: `Requested ${agentCount} parallel agents exceeds maximum concurrency cap of ${this.config.maxConcurrency}.`,
        context: {
          requestedCount: agentCount,
          maxConcurrency: this.config.maxConcurrency,
        },
        remediation: `Reduce number of agents or increase maxConcurrency setting.`,
      });
    }

    // 2. Enforce total budget cap against declared agent budgets
    const sumBudgets = this.config.agents.reduce((sum, a) => sum + a.budgetUsd, 0);
    if (sumBudgets > this.config.totalCostCapUsd) {
      throw new ForgeError({
        code: ErrorCode.PARALLEL_BUDGET_EXCEEDED,
        message: `Sum of agent budgets ($${sumBudgets.toFixed(2)}) exceeds total cost cap of $${this.config.totalCostCapUsd.toFixed(2)}.`,
        context: {
          sumBudgets,
          totalCostCapUsd: this.config.totalCostCapUsd,
        },
        remediation: `Lower individual agent budgets or raise totalCostCapUsd.`,
      });
    }

    // 3. Cost warning
    const warning = `Warning: Running ${agentCount} parallel agents costs approximately ${agentCount} times as much as a single agent. Enforcing total cost cap of $${this.config.totalCostCapUsd.toFixed(2)} and concurrency cap of ${this.config.maxConcurrency}.`;

    return { warning };
  }

  /**
   * Records cost from a turn and checks if agent or global budget was exhausted.
   */
  recordAgentCost(agentId: string, turnCostUsd: number): BudgetCheckResult {
    const current = this.agentCosts.get(agentId) ?? 0;
    const updated = current + turnCostUsd;
    this.agentCosts.set(agentId, updated);
    this.totalCostUsd += turnCostUsd;

    // Check total cap
    if (this.totalCostUsd >= this.config.totalCostCapUsd) {
      return {
        canProceed: false,
        reason: `Total parallel cost ($${this.totalCostUsd.toFixed(3)}) reached total cap of $${this.config.totalCostCapUsd.toFixed(2)}.`,
      };
    }

    // Check per-agent budget
    const spec = this.config.agents.find((a) => a.id === agentId);
    if (spec && updated >= spec.budgetUsd) {
      return {
        canProceed: false,
        reason: `Agent '${agentId}' reached allocated budget ($${updated.toFixed(3)} >= $${spec.budgetUsd.toFixed(2)}).`,
      };
    }

    return { canProceed: true };
  }

  getAgentCost(agentId: string): number {
    return this.agentCosts.get(agentId) ?? 0;
  }

  getTotalCost(): number {
    return this.totalCostUsd;
  }
}
