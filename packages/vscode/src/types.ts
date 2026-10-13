export type FimModelFamily = 'qwen' | 'deepseek' | 'starcoder' | 'generic';

export interface FimPrompt {
  readonly prefix: string;
  readonly suffix: string;
  readonly prompt: string;
  readonly modelFamily: FimModelFamily;
}

export interface CompletionPosition {
  readonly line: number;
  readonly character: number;
}

export interface OpenFileContext {
  readonly path: string;
  readonly content: string;
}

export interface CompletionRequest {
  readonly filePath: string;
  readonly fileContent: string;
  readonly position: CompletionPosition;
  readonly languageId?: string | undefined;
  readonly openFiles?: readonly OpenFileContext[] | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface CompletionItem {
  readonly label: string;
  readonly insertText: string;
  readonly detail?: string | undefined;
  readonly cached?: boolean | undefined;
  readonly latencyMs?: number | undefined;
}

export interface InlineCompletionItem {
  readonly insertText: string;
  readonly range?:
    | {
        readonly startLine: number;
        readonly startChar: number;
        readonly endLine: number;
        readonly endChar: number;
      }
    | undefined;
}

export interface InlineCompletionList {
  readonly items: readonly InlineCompletionItem[];
}

export interface InlineCompletionContext {
  readonly triggerKind: 'invoke' | 'automatic';
  readonly selectedCompletionInfo?: unknown;
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: (listener: () => void) => { dispose: () => void };
}

export interface IFimProvider {
  readonly model: string;
  readonly family: FimModelFamily;
  complete(
    prompt: FimPrompt,
    options?: {
      readonly maxTokens?: number | undefined;
      readonly signal?: AbortSignal | undefined;
      readonly temperature?: number | undefined;
    },
  ): Promise<{ text: string; latencyMs: number }>;
}

export interface PendingToolApproval {
  readonly callId: string;
  readonly toolName: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly command?: string | undefined;
  readonly diff?: string | undefined;
  readonly filePath?: string | undefined;
}

export interface AgentSidePanelState {
  readonly status: 'idle' | 'running' | 'waiting_approval' | 'error';
  readonly sessionId?: string | undefined;
  readonly turnIndex: number;
  readonly streamingDelta: string;
  readonly messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: string;
    readonly timestamp: number;
  }[];
  readonly pendingApprovals: readonly PendingToolApproval[];
  readonly recentDiffs: readonly {
    readonly filePath: string;
    readonly diffText: string;
    readonly timestamp: number;
  }[];
}
