export type EventActor = 'agent' | 'user' | 'system' | 'tool';

export interface BaseEvent {
  readonly id: string;
  readonly type: string;
  readonly timestamp: number;
  readonly actor: EventActor;
}

export interface StateTransitionEvent extends BaseEvent {
  readonly type: 'state:transition';
  readonly payload: {
    readonly entity: string;
    readonly entityId: string;
    readonly fromState: string;
    readonly toState: string;
    readonly reason: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
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

export interface ToolExecutedEvent extends BaseEvent {
  readonly type: 'tool:executed';
  readonly payload: {
    readonly callId: string;
    readonly toolName: string;
    readonly success: boolean;
    readonly durationMs: number;
    readonly output?: unknown;
    readonly error?: string;
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
  | StateTransitionEvent
  | SessionCreatedEvent
  | SessionClosedEvent
  | CheckpointCreatedEvent
  | CheckpointRestoredEvent
  | ToolProposedEvent
  | ToolApprovedEvent
  | ToolRejectedEvent
  | ToolExecutedEvent
  | AgentStepEvent
  | AuditLogEvent;

export type EventType = ForgeEvent['type'];

export type EventHandler<T extends ForgeEvent = ForgeEvent> = (event: T) => void | Promise<void>;

export interface IEventBus {
  publish<T extends ForgeEvent>(event: T): Promise<void>;
  subscribe<T extends ForgeEvent>(type: T['type'], handler: EventHandler<T>): () => void;
  subscribeAll(handler: EventHandler<ForgeEvent>): () => void;
  getHistory(): readonly ForgeEvent[];
}

export class CoreEventBus implements IEventBus {
  private readonly handlers = new Map<string, Set<EventHandler<ForgeEvent>>>();
  private readonly globalHandlers = new Set<EventHandler<ForgeEvent>>();
  private readonly history: ForgeEvent[] = [];
  private readonly maxHistorySize: number;

  constructor(maxHistorySize = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  async publish<T extends ForgeEvent>(event: T): Promise<void> {
    this.history.push(event);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    const typeHandlers = this.handlers.get(event.type);
    const promises: Array<void | Promise<void>> = [];

    if (typeHandlers) {
      for (const handler of typeHandlers) {
        promises.push(handler(event));
      }
    }

    for (const handler of this.globalHandlers) {
      promises.push(handler(event));
    }

    await Promise.all(promises);
  }

  subscribe<T extends ForgeEvent>(type: T['type'], handler: EventHandler<T>): () => void {
    const rawHandler = handler as unknown as EventHandler<ForgeEvent>;
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(rawHandler);

    return () => {
      set?.delete(rawHandler);
      if (set?.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  subscribeAll(handler: EventHandler<ForgeEvent>): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  getHistory(): readonly ForgeEvent[] {
    return [...this.history];
  }
}
