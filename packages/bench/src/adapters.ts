import { IClock, SystemClock } from '@forge/core';

export type BenchmarkSuiteType = 'swe-bench-verified' | 'terminal-bench' | 'aider-polyglot';

export interface BenchmarkTaskDefinition {
  readonly id: string;
  readonly suite: BenchmarkSuiteType;
  readonly name: string;
  readonly prompt: string;
  readonly repo: string;
  readonly baseCommit: string;
  readonly language?: string | undefined;
  readonly seed?: number | undefined;
  run(seed: number): Promise<{
    passed: boolean;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    eventsCount: number;
    details: string;
  }>;
}

export interface DetailedTaskResult {
  readonly taskId: string;
  readonly suite: BenchmarkSuiteType;
  readonly name: string;
  readonly passed: boolean;
  readonly wallClockTimeMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly eventsCount: number;
  readonly transcriptPath: string;
  readonly details: string;
}

export interface DetailedBenchmarkReport {
  readonly suite: BenchmarkSuiteType;
  readonly model: string;
  readonly pinnedVersion: string;
  readonly seed: number;
  readonly totalTasks: number;
  readonly passedTasks: number;
  readonly passRate: number;
  readonly medianWallClockTimeMs: number;
  readonly meanTokensPerTask: number;
  readonly meanCostPerTaskUsd: number;
  readonly totalCostUsd: number;
  readonly results: readonly DetailedTaskResult[];
}

export class StandardBenchmarkRunner {
  constructor(private readonly clock: IClock = new SystemClock()) {}

  async runSuite(
    suite: BenchmarkSuiteType,
    tasks: readonly BenchmarkTaskDefinition[],
    options: {
      model?: string | undefined;
      seed?: number | undefined;
      pinnedVersion?: string | undefined;
      transcriptDir?: string | undefined;
    } = {},
  ): Promise<DetailedBenchmarkReport> {
    const seed = options.seed ?? 42;
    const model = options.model ?? 'claude-3-5-sonnet';
    const pinnedVersion = options.pinnedVersion ?? 'v1.0.0-pinned';
    const transcriptDir = options.transcriptDir ?? `.forge/benchmarks/${suite}`;

    const taskResults: DetailedTaskResult[] = [];

    for (const task of tasks) {
      const startMs = this.clock.nowMs();
      const outcome = await task.run(seed);
      const wallClockTimeMs = this.clock.nowMs() - startMs;

      taskResults.push({
        taskId: task.id,
        suite: task.suite,
        name: task.name,
        passed: outcome.passed,
        wallClockTimeMs,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        costUsd: outcome.costUsd,
        eventsCount: outcome.eventsCount,
        transcriptPath: `${transcriptDir}/${task.id}.jsonl`,
        details: outcome.details,
      });
    }

    // Calculate median wall-clock time
    const sortedTimes = [...taskResults.map((r) => r.wallClockTimeMs)].sort((a, b) => a - b);
    const medianWallClockTimeMs =
      sortedTimes.length === 0
        ? 0
        : sortedTimes.length % 2 === 1
          ? (sortedTimes[Math.floor(sortedTimes.length / 2)] ?? 0)
          : Math.round(
              ((sortedTimes[sortedTimes.length / 2 - 1] ?? 0) +
                (sortedTimes[sortedTimes.length / 2] ?? 0)) /
                2,
            );

    const totalPassed = taskResults.filter((r) => r.passed).length;
    const totalCostUsd = taskResults.reduce((acc, r) => acc + r.costUsd, 0);
    const totalTokens = taskResults.reduce((acc, r) => acc + (r.inputTokens + r.outputTokens), 0);

    const totalTasks = taskResults.length;
    const passRate = totalTasks > 0 ? (totalPassed / totalTasks) * 100 : 0;
    const meanTokensPerTask = totalTasks > 0 ? Math.round(totalTokens / totalTasks) : 0;
    const meanCostPerTaskUsd = totalTasks > 0 ? totalCostUsd / totalTasks : 0;

    return {
      suite,
      model,
      pinnedVersion,
      seed,
      totalTasks,
      passedTasks: totalPassed,
      passRate,
      medianWallClockTimeMs,
      meanTokensPerTask,
      meanCostPerTaskUsd,
      totalCostUsd,
      results: taskResults,
    };
  }
}
