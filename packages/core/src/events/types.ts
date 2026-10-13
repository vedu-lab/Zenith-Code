export type EventActor = 'agent' | 'user' | 'system' | 'tool' | 'orchestrator';

export interface BaseEvent {
  readonly id: string;
  readonly type: string;
  readonly timestamp: number;
  readonly actor: EventActor;
}

export interface TurnStartedEvent extends BaseEvent {
  readonly type: 'turn.started';
  readonly payload: {
    readonly turnIndex: number;
    readonly sessionId: string;
    readonly model: string;
  };
}

export interface TurnCompletedEvent extends BaseEvent {
  readonly type: 'turn.completed';
  readonly payload: {
    readonly turnIndex: number;
    readonly sessionId: string;
    readonly stopReason: string;
    readonly durationMs: number;
  };
}

export interface ModelDeltaEvent extends BaseEvent {
  readonly type: 'model.delta';
  readonly payload: {
    readonly turnIndex: number;
    readonly delta: string;
    readonly role?: string | undefined;
  };
}

export interface ToolRequestedEvent extends BaseEvent {
  readonly type: 'tool.requested';
  readonly payload: {
    readonly turnIndex: number;
    readonly callId: string;
    readonly toolName: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

export interface ToolExecutedEventPayload {
  readonly turnIndex: number;
  readonly callId: string;
  readonly toolName: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly output?: unknown;
  readonly error?: string | undefined;
}

export interface ToolExecutedEvent extends BaseEvent {
  readonly type: 'tool.executed';
  readonly payload: ToolExecutedEventPayload;
}

export interface FileReadEvent extends BaseEvent {
  readonly type: 'file.read';
  readonly payload: {
    readonly filePath: string;
    readonly lineCount: number;
    readonly byteCount: number;
  };
}

export interface FileWrittenEvent extends BaseEvent {
  readonly type: 'file.written';
  readonly payload: {
    readonly filePath: string;
    readonly byteCount: number;
    readonly isNew: boolean;
  };
}

export interface UsageUpdatedEvent extends BaseEvent {
  readonly type: 'usage.updated';
  readonly payload: {
    readonly sessionId: string;
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly costUsd: number;
    readonly cacheReadTokens?: number | undefined;
    readonly cacheWriteTokens?: number | undefined;
  };
}

export interface ForgeErrorEvent extends BaseEvent {
  readonly type: 'error';
  readonly payload: {
    readonly code: string;
    readonly message: string;
    readonly context?: Readonly<Record<string, unknown>> | undefined;
    readonly remediation?: string | undefined;
  };
}

// Backward-compatible events
export interface StateTransitionEvent extends BaseEvent {
  readonly type: 'state:transition';
  readonly payload: {
    readonly entity: string;
    readonly entityId: string;
    readonly fromState: string;
    readonly toState: string;
    readonly reason: string;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  };
}

export interface SessionCreatedEvent extends BaseEvent {
  readonly type: 'session:created';
  readonly payload: {
    readonly sessionId: string;
    readonly title: string;
  };
}

export interface SessionClosedEvent extends BaseEvent {
  readonly type: 'session:closed';
  readonly payload: {
    readonly sessionId: string;
    readonly reason: string;
  };
}

export interface CheckpointCreatedEvent extends BaseEvent {
  readonly type: 'checkpoint:created';
  readonly payload: {
    readonly checkpointId: string;
    readonly sessionId: string;
    readonly description: string;
    readonly filesChanged: readonly string[];
  };
}

export interface CheckpointRestoredEvent extends BaseEvent {
  readonly type: 'checkpoint:restored';
  readonly payload: {
    readonly checkpointId: string;
    readonly sessionId: string;
  };
}

export interface ToolProposedEvent extends BaseEvent {
  readonly type: 'tool:proposed';
  readonly payload: {
    readonly callId: string;
    readonly toolName: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

export interface ToolApprovedEvent extends BaseEvent {
  readonly type: 'tool:approved';
  readonly payload: {
    readonly callId: string;
    readonly toolName: string;
    readonly approvedBy: 'policy' | 'user';
  };
}

export interface ToolRejectedEvent extends BaseEvent {
  readonly type: 'tool:rejected';
  readonly payload: {
    readonly callId: string;
    readonly toolName: string;
    readonly reason: string;
  };
}

export interface AgentStepEvent extends BaseEvent {
  readonly type: 'agent:step';
  readonly payload: {
    readonly stepNumber: number;
    readonly message: string;
  };
}

export interface AuditLogEvent extends BaseEvent {
  readonly type: 'audit:log';
  readonly payload: {
    readonly level: 'info' | 'warn' | 'security' | 'error';
    readonly action: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
}

// Trust, Verification, Planning, Escalation & Handoff Events
export interface VerificationStartedEvent extends BaseEvent {
  readonly type: 'verification.started';
  readonly payload: {
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly stage: string;
    readonly changedFiles: readonly string[];
  };
}

export interface VerificationCompletedEvent extends BaseEvent {
  readonly type: 'verification.completed';
  readonly payload: {
    readonly attempt: number;
    readonly success: boolean;
    readonly stage: string;
    readonly evidence?: Readonly<Record<string, unknown>> | undefined;
    readonly error?: string | undefined;
  };
}

export interface FakeVerificationEvent extends BaseEvent {
  readonly type: 'verification.fake_detected';
  readonly payload: {
    readonly reason:
      | 'no_tests_run'
      | 'tests_weakened_or_skipped'
      | 'zero_tests_collected'
      | 'source_and_tests_edited_together';
    readonly details: string;
  };
}

export interface PlanCreatedEvent extends BaseEvent {
  readonly type: 'plan.created';
  readonly payload: {
    readonly planId: string;
    readonly steps: readonly string[];
    readonly files: readonly string[];
    readonly commands: readonly string[];
    readonly estimatedCostUsd: number;
    readonly estimatedDurationSeconds: number;
  };
}

export interface PlanDriftDetectedEvent extends BaseEvent {
  readonly type: 'plan.drift_detected';
  readonly payload: {
    readonly driftType: 'unplanned_files' | 'unplanned_dependencies' | 'cost_spike' | 'turns_spike';
    readonly details: string;
    readonly unplannedItems: readonly string[];
  };
}

export interface ModelEscalatedEvent extends BaseEvent {
  readonly type: 'model.escalated';
  readonly payload: {
    readonly fromModel: string;
    readonly toModel: string;
    readonly reason: string;
    readonly thresholdDetails?: Readonly<Record<string, unknown>> | undefined;
  };
}

export interface HandoffCreatedEvent extends BaseEvent {
  readonly type: 'handoff.created';
  readonly payload: {
    readonly handoffId: string;
    readonly reason:
      | 'verification_failed'
      | 'budget_exhausted'
      | 'policy_denial'
      | 'loop_detected'
      | 'user_requested';
    readonly briefSummary: string;
    readonly checkpointId?: string | undefined;
  };
}

export interface ParallelStartedEvent extends BaseEvent {
  readonly type: 'parallel.started';
  readonly payload: {
    readonly runId: string;
    readonly mode: 'compete' | 'collaborate';
    readonly agentCount: number;
    readonly maxConcurrency: number;
    readonly totalCostCapUsd: number;
    readonly costWarning: string;
  };
}

export interface ParallelAgentStartedEvent extends BaseEvent {
  readonly type: 'parallel.agent_started';
  readonly payload: {
    readonly runId: string;
    readonly agentId: string;
    readonly name: string;
    readonly model: string;
    readonly strategy: string;
    readonly worktreePath: string;
    readonly budgetUsd: number;
    readonly declaredOwnership?: readonly string[] | undefined;
  };
}

export interface ParallelAgentProgressEvent extends BaseEvent {
  readonly type: 'parallel.agent_progress';
  readonly payload: {
    readonly runId: string;
    readonly agentId: string;
    readonly turnIndex: number;
    readonly costUsd: number;
    readonly status: string;
    readonly elapsedMs: number;
    readonly testStatus: string;
  };
}

export interface ParallelAgentCompletedEvent extends BaseEvent {
  readonly type: 'parallel.agent_completed';
  readonly payload: {
    readonly runId: string;
    readonly agentId: string;
    readonly status: 'completed' | 'failed' | 'budget_exhausted' | 'crashed';
    readonly costUsd: number;
    readonly turns: number;
    readonly durationMs: number;
    readonly testStatus: string;
    readonly touchedFiles: readonly string[];
    readonly error?: string | undefined;
  };
}

export interface ParallelReviewStartedEvent extends BaseEvent {
  readonly type: 'parallel.review_started';
  readonly payload: {
    readonly runId: string;
    readonly candidateIds: readonly string[];
    readonly mode: string;
  };
}

export interface ParallelReviewCompletedEvent extends BaseEvent {
  readonly type: 'parallel.review_completed';
  readonly payload: {
    readonly runId: string;
    readonly winnerId?: string | undefined;
    readonly recommendedReconciliation: string;
    readonly rankingsSummary: string;
  };
}

export interface ParallelReconciliationStartedEvent extends BaseEvent {
  readonly type: 'parallel.reconciliation_started';
  readonly payload: {
    readonly runId: string;
    readonly strategy: string;
    readonly candidateIds: readonly string[];
  };
}

export interface ParallelReconciliationCompletedEvent extends BaseEvent {
  readonly type: 'parallel.reconciliation_completed';
  readonly payload: {
    readonly runId: string;
    readonly success: boolean;
    readonly reVerificationPassed: boolean;
    readonly conflictCount: number;
    readonly approved: boolean;
  };
}

export interface ParallelWorktreeCleanedEvent extends BaseEvent {
  readonly type: 'parallel.worktree_cleaned';
  readonly payload: {
    readonly runId: string;
    readonly agentId: string;
    readonly worktreePath: string;
  };
}

export type ForgeEvent =
  | TurnStartedEvent
  | TurnCompletedEvent
  | ModelDeltaEvent
  | ToolRequestedEvent
  | ToolExecutedEvent
  | FileReadEvent
  | FileWrittenEvent
  | UsageUpdatedEvent
  | ForgeErrorEvent
  | StateTransitionEvent
  | SessionCreatedEvent
  | SessionClosedEvent
  | CheckpointCreatedEvent
  | CheckpointRestoredEvent
  | ToolProposedEvent
  | ToolApprovedEvent
  | ToolRejectedEvent
  | AgentStepEvent
  | AuditLogEvent
  | VerificationStartedEvent
  | VerificationCompletedEvent
  | FakeVerificationEvent
  | PlanCreatedEvent
  | PlanDriftDetectedEvent
  | ModelEscalatedEvent
  | HandoffCreatedEvent
  | ParallelStartedEvent
  | ParallelAgentStartedEvent
  | ParallelAgentProgressEvent
  | ParallelAgentCompletedEvent
  | ParallelReviewStartedEvent
  | ParallelReviewCompletedEvent
  | ParallelReconciliationStartedEvent
  | ParallelReconciliationCompletedEvent
  | ParallelWorktreeCleanedEvent;

export type EventType = ForgeEvent['type'];
