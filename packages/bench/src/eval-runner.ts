import { EvalTask, EvalSuiteReport, EvalTaskResult } from './types.js';
import {
  MisleadingBugReportTrapTask,
  FlakyTestTrapTask,
  AlreadyFixedIssueTrapTask,
  ClarifyingQuestionTrapTask,
  DeliberatelyUnfixableTrapTask,
} from './traps.js';

export class EvalSuiteRunner {
  private readonly tasks: EvalTask[] = [];

  constructor() {
    this.registerDefaultTraps();
  }

  registerDefaultTraps(): void {
    this.tasks.push(new MisleadingBugReportTrapTask());
    this.tasks.push(new FlakyTestTrapTask());
    this.tasks.push(new AlreadyFixedIssueTrapTask());
    this.tasks.push(new ClarifyingQuestionTrapTask());
    this.tasks.push(new DeliberatelyUnfixableTrapTask());
  }

  addTask(task: EvalTask): void {
    this.tasks.push(task);
  }

  async runAll(): Promise<EvalSuiteReport> {
    const startTime = Date.now();
    const results: EvalTaskResult[] = [];

    for (const task of this.tasks) {
      const res = await task.run();
      results.push(res);
    }

    const durationMs = Date.now() - startTime;
    const totalTasks = results.length;
    const passedTasks = results.filter((r) => r.actuallyPassed).length;
    const passRate = totalTasks > 0 ? (passedTasks / totalTasks) * 100 : 0;

    const falseSuccessCount = results.filter((r) => r.falseSuccess).length;
    const falseSuccessRate = totalTasks > 0 ? (falseSuccessCount / totalTasks) * 100 : 0;

    const totalVerifiedClaims = results.reduce((acc, r) => acc + r.verifiedClaimsCount, 0);
    const totalInvalidClaims = results.reduce((acc, r) => acc + r.invalidVerifiedClaimsCount, 0);
    const verifiedClaimsAccuracyRate =
      totalVerifiedClaims > 0
        ? ((totalVerifiedClaims - totalInvalidClaims) / totalVerifiedClaims) * 100
        : 100;

    const handoffCountOnUnfixable = results.filter(
      (r) => r.category === 'deliberately_unfixable' && r.endedInHandoff,
    ).length;

    return {
      totalTasks,
      passedTasks,
      passRate,
      falseSuccessCount,
      falseSuccessRate,
      verifiedClaimsAccuracyRate,
      handoffCountOnUnfixable,
      totalDurationMs: durationMs,
      results,
    };
  }

  formatReport(report: EvalSuiteReport): string {
    const lines: string[] = [
      '================================================================================',
      '                     FORGE TRUST EVAL SUITE REPORT                              ',
      '================================================================================',
      `Total Trap Tasks:            ${report.totalTasks}`,
      `Passed Validations:          ${report.passedTasks}/${report.totalTasks} (${report.passRate.toFixed(1)}%)`,
      `False-Success Rate:          ${report.falseSuccessRate.toFixed(1)}% (Target: 0.0%)`,
      `Verified Claims Accuracy:    ${report.verifiedClaimsAccuracyRate.toFixed(1)}%`,
      `Unfixable Tasks Handoff:     ${report.handoffCountOnUnfixable} (Ended in structured brief)`,
      `Duration:                    ${report.totalDurationMs}ms`,
      '--------------------------------------------------------------------------------',
      'Task Details:',
    ];

    for (const res of report.results) {
      const statusIcon = res.actuallyPassed ? '✔' : '✖';
      lines.push(`  ${statusIcon} [${res.category}] ${res.taskName}: ${res.details}`);
    }

    lines.push('================================================================================');
    return lines.join('\n');
  }
}
