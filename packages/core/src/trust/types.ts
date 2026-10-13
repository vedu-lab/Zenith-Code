export type EvidenceTag = 'Verified' | 'Inferred' | 'Not checked' | 'Assumed';

export type VerificationStage =
  're_read' | 'typecheck_lint' | 'existing_tests' | 'tdd_regression' | 'smoke_command';

export interface EvidenceRecord {
  readonly stage: VerificationStage;
  readonly command?: string | undefined;
  readonly exitCode: number;
  readonly outputExcerpt: string;
  readonly durationMs: number;
  readonly timestamp: number;
  readonly auditEventId?: string | undefined;
}

export interface ClaimWithEvidence {
  readonly claim: string;
  readonly tag: EvidenceTag;
  readonly evidence?: EvidenceRecord | undefined;
  readonly note?: string | undefined;
}

export interface FakeVerificationFinding {
  readonly reason:
    | 'no_tests_run'
    | 'tests_weakened_or_skipped'
    | 'zero_tests_collected'
    | 'source_and_tests_edited_together';
  readonly details: string;
}

export interface VerificationResult {
  readonly passed: boolean;
  readonly stage: VerificationStage;
  readonly attempt: number;
  readonly evidence: readonly EvidenceRecord[];
  readonly fakeFindings: readonly FakeVerificationFinding[];
  readonly error?: string | undefined;
  readonly remediation?: string | undefined;
}

export interface TrustPlan {
  readonly planId: string;
  readonly steps: readonly string[];
  readonly files: readonly string[];
  readonly commands: readonly string[];
  readonly risks: readonly string[];
  readonly verificationMethod: string;
  readonly costEstimateUsd: {
    readonly low: number;
    readonly expected: number;
    readonly high: number;
  };
  readonly durationSecondsEstimate: {
    readonly min: number;
    readonly max: number;
  };
}

export interface PlanDriftReport {
  readonly hasDrift: boolean;
  readonly unplannedFiles: readonly string[];
  readonly unplannedDependencies: readonly string[];
  readonly costSpike: boolean;
  readonly turnSpike: boolean;
  readonly details: string;
}

export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

export interface ComplexityClassification {
  readonly level: ComplexityLevel;
  readonly modelRole: 'fast' | 'main';
  readonly reason: string;
}

export interface EscalationConfig {
  readonly maxFailedVerificationAttempts?: number | undefined; // default 2
  readonly maxFilesTouchedBeforeEscalation?: number | undefined; // default 3
  readonly maxToolValidationErrors?: number | undefined; // default 2
  readonly fastModelMaxContextTokens?: number | undefined; // default 32_000
}

export interface EscalationDecision {
  readonly shouldEscalate: boolean;
  readonly targetModelRole: 'main';
  readonly reason: string;
  readonly trigger?:
    | 'attempts_exceeded'
    | 'files_exceeded'
    | 'tool_errors_exceeded'
    | 'low_confidence'
    | 'context_overflow'
    | undefined;
}

export interface AttemptLog {
  readonly attemptNumber: number;
  readonly action: string;
  readonly failureReason: string;
}

export interface HandoffBrief {
  readonly handoffId: string;
  readonly goal: string;
  readonly checkpointId?: string | undefined;
  readonly currentDiffSummary: string;
  readonly attempts: readonly AttemptLog[];
  readonly leadingHypothesis: string;
  readonly hypothesisEvidence: string;
  readonly verifiedItems: readonly string[];
  readonly unverifiedItems: readonly string[];
  readonly openQuestions: readonly string[];
  readonly nextSteps: readonly string[];
  readonly reproCommands: readonly string[];
}
