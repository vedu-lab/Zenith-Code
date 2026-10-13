import fs from 'node:fs';
import path from 'node:path';
import { IClock, IEventBus } from '@forge/core';
import { VersionedSessionFile } from './types.js';
import { exportSession, importSession } from './portability.js';
import { ISqliteDatabase, SqliteStore } from '../db/index.js';

export interface SessionManagerOptions {
  readonly workspaceRoot?: string | undefined;
  readonly sessionDir?: string | undefined;
  readonly sqliteStore?: SqliteStore | undefined;
}

export class SessionManager {
  private readonly sessionDir: string;
  private readonly sessions = new Map<string, VersionedSessionFile>();
  private activeSessionId: string | undefined;
  readonly db?: ISqliteDatabase | undefined;

  constructor(
    private readonly clock: IClock,
    private readonly eventBus: IEventBus,
    options: SessionManagerOptions = {},
  ) {
    const root = options.workspaceRoot ?? process.cwd();
    this.sessionDir = options.sessionDir ?? path.join(root, '.forge', 'sessions');
    this.db = options.sqliteStore?.raw;

    if (!fs.existsSync(this.sessionDir)) {
      try {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      } catch {
        // Ignore
      }
    }

    this.loadSessionsFromDisk();
  }

  private loadSessionsFromDisk(): void {
    if (!fs.existsSync(this.sessionDir)) return;
    try {
      const files = fs.readdirSync(this.sessionDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const fullPath = path.join(this.sessionDir, file);
        try {
          const raw = fs.readFileSync(fullPath, 'utf8');
          const session = importSession(raw);
          this.sessions.set(session.id, session);
        } catch {
          // Ignore invalid session files
        }
      }
    } catch {
      // Ignore
    }
  }

  private saveSessionToDisk(session: VersionedSessionFile): void {
    const fullPath = path.join(this.sessionDir, `${session.id}.json`);
    const json = exportSession(session, 'json');
    fs.writeFileSync(fullPath, json, 'utf8');
  }

  async createSession(title: string): Promise<VersionedSessionFile> {
    const now = this.clock.nowMs();
    const id = `sess_${now}_${Math.random().toString(36).slice(2, 6)}`;

    const session: VersionedSessionFile = {
      schemaVersion: '1.0.0',
      id,
      title,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      messages: [],
      toolCalls: [],
      checkpointRefs: [],
      memoryRefs: [],
      usage: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCostUsd: 0,
      },
    };

    this.sessions.set(id, session);
    this.activeSessionId = id;
    this.saveSessionToDisk(session);

    await this.eventBus.publish({
      id: `evt-sess-start-${id}`,
      type: 'session:created',
      timestamp: now,
      actor: 'agent',
      payload: { sessionId: id, title },
    });

    return session;
  }

  getActiveSession(): VersionedSessionFile | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  getSession(id: string): VersionedSessionFile | undefined {
    return this.sessions.get(id);
  }

  listSessions(): readonly VersionedSessionFile[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async resumeSession(id: string): Promise<VersionedSessionFile> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    const resumed: VersionedSessionFile = {
      ...session,
      status: 'active',
      updatedAt: this.clock.nowMs(),
    };

    this.sessions.set(id, resumed);
    this.activeSessionId = id;
    this.saveSessionToDisk(resumed);

    await this.eventBus.publish({
      id: `evt-sess-resume-${id}`,
      type: 'state:transition',
      timestamp: resumed.updatedAt,
      actor: 'agent',
      payload: {
        entity: 'session',
        entityId: id,
        fromState: session.status,
        toState: 'active',
        reason: 'Session resumed',
      },
    });

    return resumed;
  }

  async closeSession(id: string, stopReason = 'completed'): Promise<VersionedSessionFile> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }

    const closed: VersionedSessionFile = {
      ...session,
      status: 'completed',
      stopReason,
      updatedAt: this.clock.nowMs(),
    };

    this.sessions.set(id, closed);
    if (this.activeSessionId === id) {
      this.activeSessionId = undefined;
    }
    this.saveSessionToDisk(closed);

    await this.eventBus.publish({
      id: `evt-sess-end-${id}`,
      type: 'session:closed',
      timestamp: closed.updatedAt,
      actor: 'agent',
      payload: { sessionId: id, reason: stopReason },
    });

    return closed;
  }
}
