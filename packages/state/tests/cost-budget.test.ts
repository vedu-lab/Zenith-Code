import { describe, it, expect } from 'vitest';
import { SystemClock, CoreEventBus } from '@forge/core';
import {
  calculateCost,
  getPricingForModel,
  CostEstimator,
  BudgetEnforcer,
  UsageLedger,
} from '../src/cost/index.js';
import { SqliteStore } from '../src/db/index.js';

describe('Cost & Budgets Subsystem', () => {
  it('charges $0 for local models while pricing cloud models accurately', () => {
    // Local models
    expect(calculateCost('ollama/llama3.1', { promptTokens: 10000, completionTokens: 5000 })).toBe(
      0,
    );
    expect(
      calculateCost('llama-3-70b-local', { promptTokens: 10000, completionTokens: 5000 }),
    ).toBe(0);
    expect(getPricingForModel('ollama').isLocal).toBe(true);

    // Cloud models
    const sonnetCost = calculateCost('claude-3-5-sonnet', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    // 3.0 + 15.0 + 0.3 + 3.75 = 22.05
    expect(sonnetCost).toBeCloseTo(22.05, 2);
  });

  it('CostEstimator returns low, expected, and high estimates with stated assumptions', () => {
    const estimator = new CostEstimator();
    const est = estimator.estimate(
      'Implement full database checkpoint rewind and test suite',
      'claude-3-5-sonnet',
    );

    expect(est.low).toBeGreaterThan(0);
    expect(est.expected).toBeGreaterThan(est.low);
    expect(est.high).toBeGreaterThan(est.expected);
    expect(est.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(est.tokensEstimated.input).toBeGreaterThan(0);
    expect(est.tokensEstimated.output).toBeGreaterThan(0);
  });

  it('BudgetEnforcer issues warnings at 80% and stops execution at 100%', () => {
    const enforcer = new BudgetEnforcer({
      maxCostUsd: 1.0,
      maxTurns: 10,
      maxTokens: 50000,
    });

    // 1. Safe zone (under 80%)
    const safeEval = enforcer.evaluate({
      costUsd: 0.5,
      durationMs: 5000,
      turns: 5,
      tokens: 20000,
      filesChanged: 2,
    });
    expect(safeEval.action).toBe('ok');
    expect(safeEval.warnings).toHaveLength(0);

    // 2. Warning zone (80% - 99%)
    const warnEval = enforcer.evaluate({
      costUsd: 0.85,
      durationMs: 5000,
      turns: 8,
      tokens: 41000,
      filesChanged: 2,
    });
    expect(warnEval.action).toBe('warn');
    expect(warnEval.warnings.length).toBeGreaterThan(0);

    // 3. Breach zone (>= 100%)
    const stopEval = enforcer.evaluate({
      costUsd: 1.05,
      durationMs: 5000,
      turns: 10,
      tokens: 52000,
      filesChanged: 2,
    });
    expect(stopEval.action).toBe('stop');
    expect(stopEval.breachReason).toBeDefined();
    expect(stopEval.breachReason).toContain('Cost budget exceeded');
  });

  it('UsageLedger tracks records in SQLite and filters queries by --since periods', async () => {
    const clock = new SystemClock();
    const eventBus = new CoreEventBus();
    const sqliteStore = new SqliteStore({ filename: ':memory:' });
    const ledger = new UsageLedger(clock, { sqliteStore, eventBus });

    await ledger.recordUsage({
      sessionId: 'sess-a',
      model: 'claude-3-5-sonnet',
      promptTokens: 1000,
      completionTokens: 200,
      latencyMs: 150,
    });

    await ledger.recordUsage({
      sessionId: 'sess-a',
      model: 'claude-3-5-sonnet',
      promptTokens: 2000,
      completionTokens: 400,
      latencyMs: 200,
    });

    const report7d = ledger.queryUsage({ since: '7d' });
    expect(report7d.recordsCount).toBe(2);
    expect(report7d.totalPromptTokens).toBe(3000);
    expect(report7d.totalCompletionTokens).toBe(600);
    expect(report7d.totalCostUsd).toBeGreaterThan(0);
    expect(report7d.averageLatencyMs).toBe(175);

    // Estimate tuning
    const tuning = ledger.logEstimateVsActual({
      taskId: 'task-1',
      estimatedCost: 0.05,
      actualCost: 0.04,
      estimatedTokens: 3000,
      actualTokens: 2800,
    });
    expect(tuning.varianceRatio).toBeCloseTo(0.2, 1);

    sqliteStore.close();
  });
});
