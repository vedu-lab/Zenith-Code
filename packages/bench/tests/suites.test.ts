import { describe, it, expect } from 'vitest';
import {
  StandardBenchmarkRunner,
  createSweBenchTasks,
  createTerminalBenchTasks,
  createAiderPolyglotTasks,
} from '../src/index.js';

describe('Benchmark Suites Harness (SWE-bench, Terminal-Bench, Aider Polyglot)', () => {
  it('runs SWE-bench Verified tasks and reports pass rate, tokens, and cost', async () => {
    const runner = new StandardBenchmarkRunner();
    const tasks = createSweBenchTasks();
    const report = await runner.runSuite('swe-bench-verified', tasks, {
      model: 'claude-3-5-sonnet',
      seed: 42,
      pinnedVersion: '2024.10.15',
    });

    expect(report.suite).toBe('swe-bench-verified');
    expect(report.totalTasks).toBe(3);
    expect(report.passedTasks).toBe(3);
    expect(report.passRate).toBe(100);
    expect(report.seed).toBe(42);
    expect(report.meanTokensPerTask).toBeGreaterThan(0);
    expect(report.totalCostUsd).toBeGreaterThan(0);
    expect(report.results[0]?.transcriptPath).toContain('.forge/benchmarks/swe-bench-verified');
  });

  it('runs Terminal-Bench tasks with fixed seeds', async () => {
    const runner = new StandardBenchmarkRunner();
    const tasks = createTerminalBenchTasks();
    const report = await runner.runSuite('terminal-bench', tasks, {
      model: 'claude-3-5-sonnet',
      seed: 42,
    });

    expect(report.suite).toBe('terminal-bench');
    expect(report.totalTasks).toBe(2);
    expect(report.passRate).toBe(100);
  });

  it('runs Aider Polyglot multi-language benchmarks', async () => {
    const runner = new StandardBenchmarkRunner();
    const tasks = createAiderPolyglotTasks();
    const report = await runner.runSuite('aider-polyglot', tasks, {
      model: 'claude-3-5-sonnet',
      seed: 42,
    });

    expect(report.suite).toBe('aider-polyglot');
    expect(report.totalTasks).toBe(3);
    expect(report.passRate).toBe(100);
  });
});
