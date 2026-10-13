import { IClock, IEventBus } from '@forge/core';
import { z } from 'zod';

export const SessionStatusSchema = z.enum(['active', 'paused', 'completed']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export interface Session {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: SessionStatus;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private activeSessionId: string | undefined;

  constructor(
    private readonly clock: IClock,
    private readonly eventBus: IEventBus,
  ) {}

  async createSession(
    title: string,
    metadata?: Readonly<Record<string, unknown>>,
  ): Promise<Session> {
    const now = this.clock.nowMs();
    const id = `sess-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const session: Session = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      metadata,
    };

    this.sessions.set(id, session);
    this.activeSessionId = id;

    await this.eventBus.publish({
      id: `evt-sess-${id}`,
      type: 'session:created',
      timestamp: now,
      actor: 'system',
      payload: { sessionId: id, title },
    });

    return session;
  }

  getActiveSession(): Session | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
  }

  async closeSession(sessionId: string, reason = 'User requested exit'): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const now = this.clock.nowMs();
    const updated: Session = {
      ...session,
      status: 'completed',
      updatedAt: now,
    };
    this.sessions.set(sessionId, updated);

    await this.eventBus.publish({
      id: `evt-close-${sessionId}`,
      type: 'session:closed',
      timestamp: now,
      actor: 'system',
      payload: { sessionId, reason },
    });

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined;
    }
  }

  listSessions(): readonly Session[] {
    return Array.from(this.sessions.values());
  }
}
