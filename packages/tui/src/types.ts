import { PolicyMode } from '@forge/safety';

export type TuiViewMode =
  | 'chat'
  | 'permission'
  | 'capability'
  | 'plan_preview'
  | 'rewind_picker'
  | 'memory_browser'
  | 'checkpoints_tree'
  | 'parallel_dashboard'
  | 'reviewer_report';

export interface ParallelAgentDisplayState {
  readonly agentId: string;
  readonly name: string;
  readonly model: string;
  readonly strategy: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'budget_exhausted' | 'crashed';
  readonly costUsd: number;
  readonly budgetUsd: number;
  readonly elapsedMs: number;
  readonly testStatus: string;
  readonly touchedFilesCount: number;
  readonly error?: string | undefined;
}

export interface ParallelDashboardData {
  readonly runId: string;
  readonly mode: 'compete' | 'collaborate';
  readonly costWarning: string;
  readonly totalCostUsd: number;
  readonly totalCostCapUsd: number;
  readonly maxConcurrency: number;
  readonly agents: readonly ParallelAgentDisplayState[];
  readonly reviewerSummary?: string | undefined;
  readonly winnerId?: string | undefined;
  readonly mergedDiff?: string | undefined;
}

export interface TuiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system' | 'error';
  readonly content: string;
  readonly timestamp: number;
}

export interface TuiToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly status: 'pending' | 'running' | 'success' | 'failure';
  readonly output?: unknown;
  readonly error?: string | undefined;
  readonly durationMs?: number | undefined;
}

export interface TuiTodo {
  readonly id: string;
  readonly content: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export type PermissionDecision = 'allow_once' | 'allow_task' | 'deny';

export interface PermissionRequest {
  readonly id: string;
  readonly toolName: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly command?: string | undefined;
  readonly filePath?: string | undefined;
  readonly diff?: string | undefined;
  readonly onDecide: (decision: PermissionDecision, feedback?: string) => void;
}

export type CapabilityDecision = 'grant' | 'grant_task' | 'deny';

export interface CapabilityPromptRequest {
  readonly id: string;
  readonly resourcePattern: string;
  readonly action: string;
  readonly durationMs: number;
  readonly scope: 'task' | 'session';
  readonly onDecide: (decision: CapabilityDecision) => void;
}

export interface PlanPreviewData {
  readonly steps: readonly string[];
  readonly files: readonly string[];
  readonly commands: readonly string[];
  readonly risks: readonly string[];
  readonly costEstimate: {
    readonly low: number;
    readonly expected: number;
    readonly high: number;
  };
  readonly timeEstimateSeconds: {
    readonly min: number;
    readonly max: number;
  };
  readonly model: string;
  readonly budgets?:
    | {
        readonly maxCost?: number | undefined;
        readonly maxTurns?: number | undefined;
        readonly maxTokens?: number | undefined;
      }
    | undefined;
}

export interface SlashCommandContext {
  readonly setViewMode: (mode: TuiViewMode) => void;
  readonly addMessage: (message: TuiMessage) => void;
  readonly clearMessages: () => void;
  readonly currentModel: string;
  readonly cwd: string;
  readonly mode: PolicyMode;
  readonly setMode?: ((mode: PolicyMode) => void) | undefined;
  readonly interruptRunning?: (() => void) | undefined;
  readonly onExit?: (() => void) | undefined;
}

export interface SlashCommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly usage?: string | undefined;
  readonly handler: (args: string, context: SlashCommandContext) => Promise<void> | void;
}
