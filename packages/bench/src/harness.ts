import { IClock } from '@forge/core';

export interface BenchmarkTask {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  run(): Promise<boolean>;
}

export interface TaskResult {
  readonly taskId: string;
  readonly taskName: string;
  readonly passed: boolean;
  readonly durationMs: number;
}

export interface BenchmarkReport {
  readonly totalTasks: number;
  readonly passedTasks: number;
  readonly passRate: number;
  readonly totalDurationMs: number;
  readonly results: readonly TaskResult[];
}

export class BenchmarkHarness {
  private readonly tasks: BenchmarkTask[] = [];

  constructor(private readonly clock: IClock) {}

  addTask(task: BenchmarkTask): void {
    this.tasks.push(task);
  }

  async runAll(): Promise<BenchmarkReport> {
    const startMs = this.clock.nowMs();
    const results: TaskResult[] = [];

    for (const task of this.tasks) {
      const taskStart = this.clock.nowMs();
      let passed = false;
      try {
        passed = await task.run();
      } catch {
        passed = false;
      }
      const durationMs = this.clock.nowMs() - taskStart;

      results.push({
        taskId: task.id,
        taskName: task.name,
        passed,
        durationMs,
      });
    }

    const totalDurationMs = this.clock.nowMs() - startMs;
    const passedTasks = results.filter((r) => r.passed).length;
    const totalTasks = results.length;
    const passRate = totalTasks > 0 ? (passedTasks / totalTasks) * 100 : 0;

    return {
      totalTasks,
      passedTasks,
      passRate,
      totalDurationMs,
      results,
    };
  }
}
