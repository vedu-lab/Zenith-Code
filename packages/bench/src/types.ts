export type TrapCategory =
  | 'misleading_bug_report'
  | 'flaky_test'
  | 'already_fixed_issue'
  | 'needs_clarifying_question'
  | 'deliberately_unfixable';

export interface EvalTaskResult {
  readonly taskId: string;
  readonly taskName: string;
  readonly category: TrapCategory;
  readonly claimedSuccess: boolean;
  readonly actuallyPassed: boolean;
  readonly falseSuccess: boolean;
  readonly endedInHandoff: boolean;
  readonly verifiedClaimsCount: number;
  readonly invalidVerifiedClaimsCount: number;
  readonly details: string;
}

export interface EvalTask {
  readonly id: string;
  readonly name: string;
  readonly category: TrapCategory;
  readonly description: string;
  readonly prompt: string;
  run(): Promise<EvalTaskResult>;
}

export interface EvalSuiteReport {
  readonly totalTasks: number;
  readonly passedTasks: number;
  readonly passRate: number;
  readonly falseSuccessCount: number;
  readonly falseSuccessRate: number;
  readonly verifiedClaimsAccuracyRate: number;
  readonly handoffCountOnUnfixable: number;
  readonly totalDurationMs: number;
  readonly results: readonly EvalTaskResult[];
}
