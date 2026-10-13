export type EventActor = 'agent' | 'user' | 'system' | 'tool';

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
  | AuditLogEvent;

export type EventType = ForgeEvent['type'];
