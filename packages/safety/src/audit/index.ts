import { IClock, IEventBus, ForgeEvent, AuditLogEvent } from '@forge/core';

export interface AuditRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly level: 'info' | 'warn' | 'security' | 'error';
  readonly action: string;
  readonly actor: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export class AuditLogger {
  private readonly logs: AuditRecord[] = [];
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly clock: IClock,
    private readonly eventBus?: IEventBus,
  ) {
    if (this.eventBus) {
      this.unsubscribe = this.eventBus.subscribeAll((event: ForgeEvent) => {
        this.recordFromEvent(event);
      });
    }
  }

  record(
    level: 'info' | 'warn' | 'security' | 'error',
    action: string,
    actor: string,
    details: Readonly<Record<string, unknown>>,
  ): AuditRecord {
    const entry: AuditRecord = {
      id: `audit-${this.clock.nowMs()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: this.clock.nowMs(),
      level,
      action,
      actor,
      details,
    };
    this.logs.push(entry);

    if (this.eventBus) {
      const event: AuditLogEvent = {
        id: entry.id,
        type: 'audit:log',
        timestamp: entry.timestamp,
        actor: 'system',
        payload: {
          level: entry.level,
          action: entry.action,
          details: entry.details,
        },
      };
      // Fire-and-forget publish
      void this.eventBus.publish(event);
    }

    return entry;
  }

  private recordFromEvent(event: ForgeEvent): void {
    if (event.type === 'audit:log') {
      return;
    }
    this.logs.push({
      id: `audit-${event.id}`,
      timestamp: event.timestamp,
      level: event.type.startsWith('tool:rejected') ? 'security' : 'info',
      action: event.type,
      actor: event.actor,
      details: event as unknown as Record<string, unknown>,
    });
  }

  getRecords(): readonly AuditRecord[] {
    return [...this.logs];
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
}
