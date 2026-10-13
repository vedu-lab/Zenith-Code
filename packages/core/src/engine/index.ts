import { IClock, ILlmProvider, IPolicyEngine, AgentChatMessage } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { ToolRegistry } from '../tools/index.js';
import { ToolExecutionError } from '../errors/index.js';

export interface AgentLoopDependencies {
  readonly clock: IClock;
  readonly eventBus: IEventBus;
  readonly provider: ILlmProvider;
  readonly policyEngine: IPolicyEngine;
  readonly tools: ToolRegistry;
}

export interface AgentLoopOptions {
  readonly maxSteps?: number;
  readonly sessionId: string;
}

export interface AgentStepResult {
  readonly stepNumber: number;
  readonly messages: readonly AgentChatMessage[];
  readonly completed: boolean;
}

export class AgentLoop {
  constructor(private readonly deps: AgentLoopDependencies) {}

  async runStep(
    stepNumber: number,
    conversation: readonly AgentChatMessage[],
    options: AgentLoopOptions,
  ): Promise<AgentStepResult> {
    const timestamp = this.deps.clock.nowMs();

    await this.deps.eventBus.publish({
      id: `step-${stepNumber}-${timestamp}`,
      type: 'agent:step',
      timestamp,
      actor: 'agent',
      payload: {
        stepNumber,
        message: `Executing loop step ${stepNumber} for session ${options.sessionId}`,
      },
    });

    const response = await this.deps.provider.chat(conversation);
    const updatedMessages: AgentChatMessage[] = [...conversation, response.message];

    if (response.message.toolCalls && response.message.toolCalls.length > 0) {
      for (const call of response.message.toolCalls) {
        await this.deps.eventBus.publish({
          id: `prop-${call.id}`,
          type: 'tool:proposed',
          timestamp: this.deps.clock.nowMs(),
          actor: 'agent',
          payload: {
            callId: call.id,
            toolName: call.name,
            parameters: call.arguments,
          },
        });

        const tool = this.deps.tools.get(call.name);
        if (!tool) {
          const notFoundError = `Tool '${call.name}' not found`;
          await this.deps.eventBus.publish({
            id: `rej-${call.id}`,
            type: 'tool:rejected',
            timestamp: this.deps.clock.nowMs(),
            actor: 'system',
            payload: {
              callId: call.id,
              toolName: call.name,
              reason: notFoundError,
            },
          });

          updatedMessages.push({
            role: 'tool',
            content: notFoundError,
            toolCallId: call.id,
          });
          continue;
        }

        const startMs = this.deps.clock.nowMs();
        try {
          const result = await tool.execute(call.arguments);
          const durationMs = this.deps.clock.nowMs() - startMs;

          await this.deps.eventBus.publish({
            id: `exec-${call.id}`,
            type: 'tool:executed',
            timestamp: this.deps.clock.nowMs(),
            actor: 'tool',
            payload: {
              callId: call.id,
              toolName: call.name,
              success: true,
              durationMs,
              output: result,
            },
          });

          updatedMessages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            toolCallId: call.id,
          });
        } catch (err) {
          const durationMs = this.deps.clock.nowMs() - startMs;
          const errorMessage = err instanceof Error ? err.message : String(err);

          await this.deps.eventBus.publish({
            id: `exec-fail-${call.id}`,
            type: 'tool:executed',
            timestamp: this.deps.clock.nowMs(),
            actor: 'tool',
            payload: {
              callId: call.id,
              toolName: call.name,
              success: false,
              durationMs,
              error: errorMessage,
            },
          });

          if (err instanceof ToolExecutionError) {
            updatedMessages.push({
              role: 'tool',
              content: `Error: ${err.message}`,
              toolCallId: call.id,
            });
          } else {
            throw err;
          }
        }
      }
      return { stepNumber, messages: updatedMessages, completed: false };
    }

    return { stepNumber, messages: updatedMessages, completed: true };
  }
}
