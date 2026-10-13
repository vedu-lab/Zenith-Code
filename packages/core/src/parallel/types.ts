export type ParallelMode = 'compete' | 'collaborate';

export type AgentRunStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'budget_exhausted' | 'crashed';

export interface AgentSpec {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly strategy: string;
  readonly budgetUsd: number;
  readonly prompt: string;
  /** In collaborate mode: disjoint glob patterns of files owned by this agent (e.g. ['src/auth/**']) */
  readonly declaredOwnership?: readonly string[] | undefined;
}

export interface ParallelRunConfig {
  readonly mode: ParallelMode;
  readonly agents: readonly AgentSpec[];
  readonly totalCostCapUsd: number;
  readonly maxConcurrency: number;
  readonly workspaceRoot: string;
  readonly testCommand?: string | undefined;
  readonly typecheckCommand?: string | undefined;
  readonly lintCommand?: string | undefined;
  readonly reconciliationPreference?: 'pick' | 'cherry_pick' | 'merge' | undefined;
  readonly requireUserApproval?: boolean | undefined;
}

export interface AgentResult {
  readonly agentId: string;
  readonly spec: AgentSpec;
  readonly status: AgentRunStatus;
  readonly worktreePath: string;
  readonly costUsd: number;
  readonly turns: number;
  readonly durationMs: number;
  readonly testStatus: 'passed' | 'failed' | 'untested';
  readonly touchedFiles: readonly string[];
  readonly diff: string;
  readonly error?: string | undefined;
  readonly checkpointId?: string | undefined;
}

export interface ReviewScore {
  readonly correctness: number; // 0-100
  readonly scope: number; // 0-100 (penalized for scope creep)
  readonly style: number; // 0-100 (penalized for lint/style issues)
  readonly security: number; // 0-100 (penalized for security violations)
  readonly total: number; // Weighted composite score 0-100
}

export interface CandidateEvaluation {
  readonly agentId: string;
  readonly rank: number;
  readonly score: ReviewScore;
  readonly testPassed: boolean;
  readonly testOutput: string;
  readonly scopeViolations: readonly string[];
  readonly pros: readonly string[];
  readonly cons: readonly string[];
}

export interface ReviewerReport {
  readonly candidates: readonly CandidateEvaluation[];
  readonly winnerId: string | undefined;
  readonly recommendedReconciliation: 'pick' | 'cherry_pick' | 'merge';
  readonly summary: string;
  readonly evidence: readonly string[];
}

export interface MergeConflict {
  readonly type: 'textual' | 'semantic';
  readonly filePath: string;
  readonly description: string;
  readonly conflictHunks?: readonly string[] | undefined;
}

export interface ReconciliationResult {
  readonly strategyUsed: 'pick' | 'cherry_pick' | 'merge';
  readonly mergedFiles: readonly string[];
  readonly conflicts: readonly MergeConflict[];
  readonly reVerificationPassed: boolean;
  readonly mergedDiff: string;
  readonly approved: boolean;
  readonly reasoning: string;
}

export interface WorktreeInfo {
  readonly agentId: string;
  readonly path: string;
  readonly isGitWorktree: boolean;
  readonly branchName?: string | undefined;
  readonly createdAtMs: number;
}
