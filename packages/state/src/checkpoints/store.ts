import crypto from 'node:crypto';
import { IClock, IEventBus, IFileSystem, IProcessRunner } from '@forge/core';
import {
  Checkpoint,
  CheckpointDiff,
  FileDiffEntry,
  RewindResult,
  RewindTarget,
  BranchResult,
  ConversationSnapshot,
  EnvironmentSnapshot,
  FileSnapshotEntry,
  FileSnapshot,
} from './types.js';
import { ShadowGitManager } from './shadow-git.js';

export interface CheckpointStoreOptions {
  readonly workspaceRoot?: string | undefined;
  readonly shadowGitDir?: string | undefined;
  readonly processRunner?: IProcessRunner | undefined;
  readonly fs?: IFileSystem | undefined;
}

export interface CreateCheckpointParams {
  readonly sessionId: string;
  readonly description: string;
  readonly conversation?: Partial<ConversationSnapshot> | undefined;
  readonly environment?: Partial<EnvironmentSnapshot> | undefined;
  readonly branchName?: string | undefined;
  readonly customFiles?: readonly FileSnapshotEntry[] | undefined;
}

export class CheckpointStore {
  private readonly checkpoints = new Map<string, Checkpoint>();
  private readonly shadowGit: ShadowGitManager;
  private currentBranch = 'main';
  private latestCheckpointId: string | null = null;

  constructor(
    private readonly clock: IClock,
    private readonly eventBus: IEventBus,
    optionsOrFs: CheckpointStoreOptions | IFileSystem = {},
  ) {
    const options: CheckpointStoreOptions =
      typeof (optionsOrFs as IFileSystem).readFile === 'function'
        ? { fs: optionsOrFs as IFileSystem }
        : (optionsOrFs as CheckpointStoreOptions);

    const root = options.workspaceRoot ?? process.cwd();
    this.shadowGit = new ShadowGitManager({
      workspaceRoot: root,
      shadowGitDir: options.shadowGitDir,
      processRunner: options.processRunner,
      fs: options.fs,
    });
  }

  getCurrentBranch(): string {
    return this.currentBranch;
  }

  async createCheckpoint(
    sessionId: string,
    description: string,
    paramsOrFiles?:
      | Partial<CreateCheckpointParams>
      | readonly FileSnapshot[]
      | readonly { readonly path: string; readonly content: string }[],
  ): Promise<Checkpoint> {
    const timestamp = this.clock.nowMs();
    const id = `chk-${timestamp}-${Math.random().toString(36).slice(2, 7)}`;
    const params: Partial<CreateCheckpointParams> = Array.isArray(paramsOrFiles)
      ? {
          customFiles: paramsOrFiles.map((f) => ({
            path: f.path,
            content: f.content,
            mode: 0o644,
            isCrlf: f.content.includes('\r\n'),
            hash: crypto.createHash('sha256').update(f.content).digest('hex'),
          })),
        }
      : paramsOrFiles
        ? (paramsOrFiles as Partial<CreateCheckpointParams>)
        : {};

    const branch = params.branchName ?? this.currentBranch;

    let codeSnapshot = await this.shadowGit.snapshot(description);
    if (params.customFiles) {
      codeSnapshot = {
        ...codeSnapshot,
        files: params.customFiles,
      };
    }

    const conversation: ConversationSnapshot = {
      messages: params.conversation?.messages ?? [],
      todos: params.conversation?.todos ?? [],
      loadedMemory: params.conversation?.loadedMemory ?? [],
      capabilities: params.conversation?.capabilities ?? [],
      model: params.conversation?.model ?? 'claude-3-5-sonnet',
      settings: params.conversation?.settings ?? {},
    };

    const environment: EnvironmentSnapshot = {
      cwd: params.environment?.cwd ?? this.shadowGit.workspaceRoot,
      envVarNames: params.environment?.envVarNames ?? Object.keys(process.env).sort(),
      toolVersions: params.environment?.toolVersions ?? { node: process.version },
      lockfileHashes: params.environment?.lockfileHashes ?? {},
      backgroundProcesses: params.environment?.backgroundProcesses ?? [],
    };

    const checkpoint: Checkpoint = {
      id,
      sessionId,
      parentCheckpointId: this.latestCheckpointId,
      branch,
      timestamp,
      description,
      code: codeSnapshot,
      conversation,
      environment,
    };

    this.checkpoints.set(id, checkpoint);
    this.latestCheckpointId = id;

    await this.eventBus.publish({
      id: `evt-chk-create-${id}`,
      type: 'checkpoint:created',
      timestamp,
      actor: 'system',
      payload: {
        checkpointId: id,
        sessionId,
        description,
        filesChanged: codeSnapshot.files.map((f) => f.path),
      },
    });

    return checkpoint;
  }

  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id);
  }

  listCheckpoints(branchName?: string): readonly Checkpoint[] {
    const list = Array.from(this.checkpoints.values());
    if (branchName) {
      return list.filter((c) => c.branch === branchName);
    }
    return list;
  }

  async branch(branchName: string, fromCheckpointId?: string): Promise<BranchResult> {
    const baseId = fromCheckpointId ?? this.latestCheckpointId;
    if (!baseId) {
      throw new Error('Cannot branch: no existing checkpoint to branch from');
    }

    const baseCheckpoint = this.checkpoints.get(baseId);
    if (!baseCheckpoint) {
      throw new Error(`Base checkpoint not found: ${baseId}`);
    }

    this.currentBranch = branchName;
    const newCheckpoint = await this.createCheckpoint(
      baseCheckpoint.sessionId,
      `Branched to ${branchName} from ${baseCheckpoint.id}`,
      {
        branchName,
        customFiles: baseCheckpoint.code.files,
        conversation: baseCheckpoint.conversation,
        environment: baseCheckpoint.environment,
      },
    );

    return {
      branchName,
      baseCheckpointId: baseId,
      currentCheckpointId: newCheckpoint.id,
    };
  }

  async diff(checkpointAId: string, checkpointBId: string): Promise<CheckpointDiff> {
    const a = this.checkpoints.get(checkpointAId);
    const b = this.checkpoints.get(checkpointBId);

    if (!a || !b) {
      throw new Error(
        `Both checkpoints must exist for diff: A=${checkpointAId} (${Boolean(a)}), B=${checkpointBId} (${Boolean(b)})`,
      );
    }

    const filesA = new Map<string, FileSnapshotEntry>(a.code.files.map((f) => [f.path, f]));
    const filesB = new Map<string, FileSnapshotEntry>(b.code.files.map((f) => [f.path, f]));

    const addedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const fileDiffs: FileDiffEntry[] = [];

    for (const [pathB, entryB] of filesB.entries()) {
      const entryA = filesA.get(pathB);
      if (!entryA) {
        addedFiles.push(pathB);
        fileDiffs.push({
          path: pathB,
          status: 'added',
          newContent: entryB.content,
          diffText: `+ ${entryB.content}`,
        });
      } else if (entryA.hash !== entryB.hash) {
        modifiedFiles.push(pathB);
        fileDiffs.push({
          path: pathB,
          status: 'modified',
          oldContent: entryA.content,
          newContent: entryB.content,
          diffText: `--- ${pathB}\n+++ ${pathB}\n@@ modified @@`,
        });
      }
    }

    for (const [pathA, entryA] of filesA.entries()) {
      if (!filesB.has(pathA)) {
        deletedFiles.push(pathA);
        fileDiffs.push({
          path: pathA,
          status: 'deleted',
          oldContent: entryA.content,
          diffText: `- ${entryA.content}`,
        });
      }
    }

    const messagesDiff = Math.abs(b.conversation.messages.length - a.conversation.messages.length);
    const todoDiff = Math.abs(b.conversation.todos.length - a.conversation.todos.length);

    return {
      checkpointAId,
      checkpointBId,
      addedFiles,
      modifiedFiles,
      deletedFiles,
      fileDiffs,
      conversationChanges: {
        messagesDiffCount: messagesDiff,
        todoDiffCount: todoDiff,
      },
    };
  }

  async rewind(
    checkpointId: string,
    options: { target?: RewindTarget } = {},
  ): Promise<RewindResult> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Cannot rewind to non-existent checkpoint: ${checkpointId}`);
    }

    const target = options.target ?? 'both';
    let filesRestored: string[] = [];
    let filesDeleted: string[] = [];
    let codeRestored = false;
    let convRestored = false;

    if (target === 'code' || target === 'both') {
      const res = await this.shadowGit.restore(checkpoint.code);
      filesRestored = res.restored;
      filesDeleted = res.deleted;
      codeRestored = true;
    }

    if (target === 'conversation' || target === 'both') {
      convRestored = true;
    }

    this.latestCheckpointId = checkpoint.id;

    await this.eventBus.publish({
      id: `evt-chk-restore-${checkpointId}`,
      type: 'checkpoint:restored',
      timestamp: this.clock.nowMs(),
      actor: 'system',
      payload: {
        checkpointId,
        sessionId: checkpoint.sessionId,
      },
    });

    return {
      checkpointId,
      target,
      restored: {
        code: codeRestored,
        conversation: convRestored,
        filesRestored,
        filesDeleted,
      },
      notRestored: {
        databaseChanges: [
          'External database state modified outside the filesystem cannot be restored.',
        ],
        networkEffects: [
          'External HTTP requests, API calls, and web fetch side-effects cannot be undone.',
        ],
        backgroundProcesses: [
          'Background processes running prior to rewind are recorded but not resurrected.',
        ],
      },
    };
  }

  async restoreCheckpoint(id: string): Promise<Checkpoint | undefined> {
    const cp = this.checkpoints.get(id);
    if (!cp) return undefined;
    await this.rewind(id, { target: 'both' });
    return cp;
  }
}
