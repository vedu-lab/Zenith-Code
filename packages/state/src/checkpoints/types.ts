export interface FileSnapshotEntry {
  readonly path: string;
  readonly content: string;
  readonly mode: number;
  readonly isCrlf: boolean;
  readonly hash: string;
}

export type FileSnapshot = { readonly path: string; readonly content: string };

export interface CodeSnapshot {
  readonly type: 'shadow_git' | 'file_tree';
  readonly commitSha?: string | undefined;
  readonly files: readonly FileSnapshotEntry[];
}

export interface ConversationSnapshot {
  readonly messages: readonly unknown[];
  readonly todos: readonly unknown[];
  readonly loadedMemory: readonly unknown[];
  readonly capabilities: readonly string[];
  readonly model: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface BackgroundProcessRecord {
  readonly pid: number;
  readonly command: string;
}

export interface EnvironmentSnapshot {
  readonly cwd: string;
  readonly envVarNames: readonly string[];
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly lockfileHashes: Readonly<Record<string, string>>;
  readonly backgroundProcesses: readonly BackgroundProcessRecord[];
}

export interface Checkpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly parentCheckpointId: string | null;
  readonly branch: string;
  readonly timestamp: number;
  readonly description: string;
  readonly code: CodeSnapshot;
  readonly conversation: ConversationSnapshot;
  readonly environment: EnvironmentSnapshot;
}

export interface FileDiffEntry {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted';
  readonly oldContent?: string | undefined;
  readonly newContent?: string | undefined;
  readonly diffText: string;
}

export interface CheckpointDiff {
  readonly checkpointAId: string;
  readonly checkpointBId: string;
  readonly addedFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly fileDiffs: readonly FileDiffEntry[];
  readonly conversationChanges: {
    readonly messagesDiffCount: number;
    readonly todoDiffCount: number;
  };
}

export type RewindTarget = 'code' | 'conversation' | 'both';

export interface RewindResult {
  readonly checkpointId: string;
  readonly target: RewindTarget;
  readonly restored: {
    readonly code: boolean;
    readonly conversation: boolean;
    readonly filesRestored: readonly string[];
    readonly filesDeleted: readonly string[];
  };
  readonly notRestored: {
    readonly databaseChanges: readonly string[];
    readonly networkEffects: readonly string[];
    readonly backgroundProcesses: readonly string[];
  };
}

export interface BranchResult {
  readonly branchName: string;
  readonly baseCheckpointId: string;
  readonly currentCheckpointId: string;
}
