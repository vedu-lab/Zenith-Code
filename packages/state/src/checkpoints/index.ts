import { IClock, IEventBus, IFileSystem } from '@forge/core';

export interface FileSnapshot {
  readonly path: string;
  readonly content: string;
}

export interface Checkpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly description: string;
  readonly files: readonly FileSnapshot[];
}

export class CheckpointStore {
  private readonly checkpoints = new Map<string, Checkpoint>();

  constructor(
    private readonly clock: IClock,
    private readonly eventBus: IEventBus,
    private readonly fs?: IFileSystem,
  ) {}

  async createCheckpoint(
    sessionId: string,
    description: string,
    files: readonly FileSnapshot[],
  ): Promise<Checkpoint> {
    const timestamp = this.clock.nowMs();
    const id = `chk-${timestamp}-${Math.random().toString(36).slice(2, 7)}`;
    const checkpoint: Checkpoint = {
      id,
      sessionId,
      timestamp,
      description,
      files,
    };

    this.checkpoints.set(id, checkpoint);

    await this.eventBus.publish({
      id: `evt-chk-create-${id}`,
      type: 'checkpoint:created',
      timestamp,
      actor: 'system',
      payload: {
        checkpointId: id,
        sessionId,
        description,
        filesChanged: files.map((f) => f.path),
      },
    });

    return checkpoint;
  }

  async restoreCheckpoint(id: string): Promise<Checkpoint | undefined> {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) {
      return undefined;
    }

    if (this.fs) {
      for (const file of checkpoint.files) {
        await this.fs.writeFile(file.path, file.content);
      }
    }

    await this.eventBus.publish({
      id: `evt-chk-restore-${id}`,
      type: 'checkpoint:restored',
      timestamp: this.clock.nowMs(),
      actor: 'system',
      payload: {
        checkpointId: id,
        sessionId: checkpoint.sessionId,
      },
    });

    return checkpoint;
  }

  listCheckpoints(sessionId?: string): readonly Checkpoint[] {
    const all = Array.from(this.checkpoints.values());
    return sessionId ? all.filter((c) => c.sessionId === sessionId) : all;
  }
}
