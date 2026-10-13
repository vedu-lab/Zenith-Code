import { IEventBus } from '../events/index.js';
import { ToolRegistry } from '../tools/registry.js';

export interface RecordedToolCall {
  readonly id: string;
  readonly toolName: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly output: unknown;
  readonly error?: string | undefined;
}

export interface ReplayTurn {
  readonly turnIndex: number;
  readonly userMessage?: string | undefined;
  readonly modelOutput: string;
  readonly toolCalls: readonly RecordedToolCall[];
}

export interface ReplayDrift {
  readonly turnIndex: number;
  readonly toolName: string;
  readonly callId: string;
  readonly recordedOutput: unknown;
  readonly liveOutput: unknown;
  readonly diffDescription: string;
}

export interface SessionDataToReplay {
  readonly id: string;
  readonly title?: string | undefined;
  readonly turns: readonly ReplayTurn[];
}

export interface ReplayOptions {
  readonly liveTools?: boolean | undefined;
  readonly toolRegistry?: ToolRegistry | undefined;
  readonly onStep?: ((turn: ReplayTurn, turnIndex: number) => void) | undefined;
}

export interface ReplayResult {
  readonly sessionId: string;
  readonly turnsReplayed: number;
  readonly liveToolsRan: boolean;
  readonly driftDetected: boolean;
  readonly drifts: readonly ReplayDrift[];
  readonly success: boolean;
}

export class SessionReplayEngine {
  constructor(private readonly eventBus?: IEventBus | undefined) {}

  async replay(session: SessionDataToReplay, options: ReplayOptions = {}): Promise<ReplayResult> {
    const isLive = options.liveTools ?? false;
    const drifts: ReplayDrift[] = [];

    for (const turn of session.turns) {
      const turnStartMs = Date.now();

      // 1. Publish turn.started event
      if (this.eventBus) {
        await this.eventBus.publish({
          id: `replay-turn-start-${turn.turnIndex}`,
          type: 'turn.started',
          timestamp: turnStartMs,
          actor: 'agent',
          payload: {
            turnIndex: turn.turnIndex,
            sessionId: session.id,
            model: 'replay-mode',
          },
        });
      }

      // 2. Publish recorded model delta
      if (this.eventBus && turn.modelOutput) {
        await this.eventBus.publish({
          id: `replay-delta-${turn.turnIndex}`,
          type: 'model.delta',
          timestamp: Date.now(),
          actor: 'agent',
          payload: {
            turnIndex: turn.turnIndex,
            delta: turn.modelOutput,
            role: 'assistant',
          },
        });
      }

      // 3. Step through tool calls
      for (const toolCall of turn.toolCalls) {
        const callStartMs = Date.now();

        if (this.eventBus) {
          await this.eventBus.publish({
            id: `replay-req-${toolCall.id}`,
            type: 'tool.requested',
            timestamp: callStartMs,
            actor: 'agent',
            payload: {
              turnIndex: turn.turnIndex,
              callId: toolCall.id,
              toolName: toolCall.toolName,
              parameters: toolCall.parameters as Record<string, unknown>,
            },
          });
        }

        let effectiveOutput = toolCall.output;
        let isSuccess = !toolCall.error;

        // If --live-tools is requested, execute against live tool registry
        if (isLive && options.toolRegistry) {
          const liveTool = options.toolRegistry.get(toolCall.toolName);
          if (liveTool) {
            try {
              const liveResult = await liveTool.execute(toolCall.parameters);
              effectiveOutput = liveResult;
              isSuccess = true;

              // Check for drift against recorded output
              const recordedStr = JSON.stringify(toolCall.output ?? null);
              const liveStr = JSON.stringify(liveResult ?? null);

              if (recordedStr !== liveStr) {
                drifts.push({
                  turnIndex: turn.turnIndex,
                  toolName: toolCall.toolName,
                  callId: toolCall.id,
                  recordedOutput: toolCall.output,
                  liveOutput: liveResult,
                  diffDescription: `Recorded and live tool outputs differ for '${toolCall.toolName}' in turn ${turn.turnIndex}`,
                });
              }
            } catch (err) {
              isSuccess = false;
              effectiveOutput = undefined;
              drifts.push({
                turnIndex: turn.turnIndex,
                toolName: toolCall.toolName,
                callId: toolCall.id,
                recordedOutput: toolCall.output,
                liveOutput: null,
                diffDescription: `Live tool execution threw error: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }
        }

        // Publish tool.executed event
        if (this.eventBus) {
          await this.eventBus.publish({
            id: `replay-exec-${toolCall.id}`,
            type: 'tool.executed',
            timestamp: Date.now(),
            actor: 'tool',
            payload: {
              turnIndex: turn.turnIndex,
              callId: toolCall.id,
              toolName: toolCall.toolName,
              success: isSuccess,
              durationMs: Date.now() - callStartMs,
              output: effectiveOutput,
              ...(toolCall.error ? { error: toolCall.error } : {}),
            },
          });
        }
      }

      // 4. Publish turn.completed event
      if (this.eventBus) {
        await this.eventBus.publish({
          id: `replay-turn-comp-${turn.turnIndex}`,
          type: 'turn.completed',
          timestamp: Date.now(),
          actor: 'agent',
          payload: {
            turnIndex: turn.turnIndex,
            sessionId: session.id,
            stopReason: 'end_turn',
            durationMs: Date.now() - turnStartMs,
          },
        });
      }

      options.onStep?.(turn, turn.turnIndex);
    }

    return {
      sessionId: session.id,
      turnsReplayed: session.turns.length,
      liveToolsRan: isLive,
      driftDetected: drifts.length > 0,
      drifts,
      success: true,
    };
  }
}
