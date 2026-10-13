import { IEventBus, ForgeEvent } from '@forge/core';
import { AgentSidePanelState, PendingToolApproval } from './types.js';

export class AgentSidePanelController {
  private state: AgentSidePanelState = {
    status: 'idle',
    turnIndex: 0,
    streamingDelta: '',
    messages: [],
    pendingApprovals: [],
    recentDiffs: [],
  };

  private readonly listeners = new Set<(state: AgentSidePanelState) => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly eventBus: IEventBus) {
    this.unsubscribe = this.eventBus.subscribeAll((event: ForgeEvent) => {
      this.handleEvent(event);
    });
  }

  private handleEvent(event: ForgeEvent): void {
    switch (event.type) {
      case 'session:created': {
        this.updateState({
          sessionId: event.payload.sessionId,
          status: 'idle',
          messages: [],
          pendingApprovals: [],
        });
        break;
      }

      case 'turn.started': {
        this.updateState({
          status: 'running',
          turnIndex: event.payload.turnIndex,
          streamingDelta: '',
        });
        break;
      }

      case 'model.delta': {
        this.updateState({
          streamingDelta: this.state.streamingDelta + event.payload.delta,
        });
        break;
      }

      case 'turn.completed': {
        const text = this.state.streamingDelta;
        const newMessages = [...this.state.messages];
        if (text.trim().length > 0) {
          newMessages.push({
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
          });
        }
        this.updateState({
          status: 'idle',
          streamingDelta: '',
          messages: newMessages,
        });
        break;
      }

      case 'tool:proposed': {
        const approval: PendingToolApproval = {
          callId: event.payload.callId,
          toolName: event.payload.toolName,
          parameters: event.payload.parameters,
          command:
            typeof event.payload.parameters['command'] === 'string'
              ? String(event.payload.parameters['command'])
              : undefined,
          diff:
            typeof event.payload.parameters['diff'] === 'string'
              ? String(event.payload.parameters['diff'])
              : undefined,
          filePath:
            typeof event.payload.parameters['filePath'] === 'string'
              ? String(event.payload.parameters['filePath'])
              : undefined,
        };
        this.updateState({
          status: 'waiting_approval',
          pendingApprovals: [...this.state.pendingApprovals, approval],
        });
        break;
      }

      case 'tool:approved':
      case 'tool:rejected': {
        const remaining = this.state.pendingApprovals.filter(
          (a) => a.callId !== event.payload.callId,
        );
        this.updateState({
          status: remaining.length > 0 ? 'waiting_approval' : 'running',
          pendingApprovals: remaining,
        });
        break;
      }

      case 'file.written': {
        const diffEntry = {
          filePath: event.payload.filePath,
          diffText: `Updated ${event.payload.filePath} (${event.payload.byteCount} bytes)`,
          timestamp: Date.now(),
        };
        this.updateState({
          recentDiffs: [diffEntry, ...this.state.recentDiffs.slice(0, 19)],
        });
        break;
      }

      case 'checkpoint:created': {
        const diffSummary = event.payload.filesChanged
          .map((f) => `Checkpoint ${event.payload.checkpointId}: ${f}`)
          .join('\n');
        this.updateState({
          recentDiffs: [
            {
              filePath: `Checkpoint: ${event.payload.checkpointId}`,
              diffText: diffSummary || event.payload.description,
              timestamp: Date.now(),
            },
            ...this.state.recentDiffs.slice(0, 19),
          ],
        });
        break;
      }

      case 'error': {
        this.updateState({
          status: 'error',
          messages: [
            ...this.state.messages,
            {
              id: `err-${Date.now()}`,
              role: 'error',
              content: `[${event.payload.code}] ${event.payload.message}`,
              timestamp: Date.now(),
            },
          ],
        });
        break;
      }
    }
  }

  private updateState(partial: Partial<AgentSidePanelState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Listener safety
      }
    }
  }

  approve(callId: string): void {
    const item = this.state.pendingApprovals.find((a) => a.callId === callId);
    if (!item) return;

    this.eventBus.publish({
      id: `evt-${Date.now()}`,
      type: 'tool:approved',
      actor: 'user',
      timestamp: Date.now(),
      payload: {
        callId,
        toolName: item.toolName,
        approvedBy: 'user',
      },
    });
  }

  reject(callId: string, reason: string = 'User rejected action'): void {
    const item = this.state.pendingApprovals.find((a) => a.callId === callId);
    if (!item) return;

    this.eventBus.publish({
      id: `evt-${Date.now()}`,
      type: 'tool:rejected',
      actor: 'user',
      timestamp: Date.now(),
      payload: {
        callId,
        toolName: item.toolName,
        reason,
      },
    });
  }

  addDiff(filePath: string, diffText: string): void {
    this.updateState({
      recentDiffs: [{ filePath, diffText, timestamp: Date.now() }, ...this.state.recentDiffs],
    });
  }

  getState(): AgentSidePanelState {
    return this.state;
  }

  onStateChange(listener: (state: AgentSidePanelState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.listeners.clear();
    this.unsubscribe();
  }
}
