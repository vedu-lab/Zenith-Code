import { describe, it, expect } from 'vitest';
import { SystemClock } from '@forge/core';
import { BenchmarkHarness } from '../src/index.js';

describe('Benchmark Package', () => {
  it('should run benchmark tasks and generate report', async () => {
    const clock = new SystemClock();
    const harness = new BenchmarkHarness(clock);

    harness.addTask({
      id: 'task-1',
      name: 'Format file test',
      description: 'Checks formatting speed',
      run: async () => true,
    });

    harness.addTask({
      id: 'task-2',
      name: 'Broken command test',
      description: 'Simulates failure',
      run: async () => false,
    });

    const report = await harness.runAll();
    expect(report.totalTasks).toBe(2);
    expect(report.passedTasks).toBe(1);
    expect(report.passRate).toBe(50);
    expect(report.results).toHaveLength(2);
  });
});
