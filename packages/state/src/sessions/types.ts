export type SessionStatus = 'active' | 'completed' | 'failed' | 'aborted';

export interface SessionUsageSummary {
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalCostUsd: number;
}

export interface VersionedSessionFile {
  readonly schemaVersion: '1.0.0';
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: SessionStatus;
  readonly messages: readonly unknown[];
  readonly toolCalls: readonly unknown[];
  readonly checkpointRefs: readonly string[];
  readonly memoryRefs: readonly string[];
  readonly usage: SessionUsageSummary;
  readonly stopReason?: string | undefined;
}

export interface InitProjectResult {
  readonly generatedFiles: readonly string[];
  readonly syncedFiles: readonly string[];
  readonly contradictions: readonly string[];
}
