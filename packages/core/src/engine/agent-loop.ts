import { IProvider, Message, ToolCall, StopReason } from '../provider/types.js';
import { globalCapabilityRegistry } from '../provider/capabilities.js';
import { ToolRegistry } from '../tools/registry.js';
import { IEventBus } from '../events/index.js';
import { IClock } from '../interfaces/index.js';
import { ForgeError, ErrorCode } from '../errors/index.js';

export interface AgentLoopOptions {
  readonly sessionId: string;
  readonly model?: string | undefined;
  readonly maxTurns?: number | undefined;
  readonly systemPrompt?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly temperature?: number | undefined;
  readonly enablePromptCaching?: boolean | undefined;
}

export interface AgentLoopRunResult {
  readonly sessionId: string;
  readonly totalTurns: number;
  readonly completed: boolean;
  readonly stopReason: string;
  readonly messages: readonly Message[];
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
}

export class AgentLoop {
  constructor(
    private readonly provider: IProvider,
    private readonly tools: ToolRegistry,
    private readonly eventBus: IEventBus,
    private readonly clock: IClock,
  ) {}

  async run(initialUserMessage: string, options: AgentLoopOptions): Promise<AgentLoopRunResult> {
    const maxTurns = options.maxTurns ?? 30;
    const model = options.model ?? 'default';
    const caps = globalCapabilityRegistry.get(model);

    const messages: Message[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: initialUserMessage });

    let turnIndex = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let finalStopReason = 'end_turn';

    while (turnIndex < maxTurns) {
      if (options.abortSignal?.aborted) {
        finalStopReason = 'cancelled';
        break;
      }

      turnIndex++;
      const turnStartMs = this.clock.nowMs();

      await this.eventBus.publish({
        id: `turn-start-${turnIndex}-${turnStartMs}`,
        type: 'turn.started',
        timestamp: turnStartMs,
        actor: 'agent',
        payload: {
          turnIndex,
          sessionId: options.sessionId,
          model,
        },
      });

      const toolDefs = this.tools.getDefinitions();
      const collectedToolCalls: ToolCall[] = [];
      let accumulatedAssistantText = '';
      let turnStopReason: StopReason = 'end_turn';

      // Stream from LLM provider
      try {
        const stream = this.provider.stream(messages, toolDefs, {
          model,
          temperature: options.temperature,
          abortSignal: options.abortSignal,
          enablePromptCaching: options.enablePromptCaching ?? caps.supportsPromptCaching,
        });

        for await (const event of stream) {
          if (options.abortSignal?.aborted) {
            turnStopReason = 'cancelled';
            break;
          }

          if (event.type === 'text_delta') {
            accumulatedAssistantText += event.delta;
            await this.eventBus.publish({
              id: `evt-delta-${this.clock.nowMs()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'model.delta',
              timestamp: this.clock.nowMs(),
              actor: 'agent',
              payload: {
                turnIndex,
                delta: event.delta,
                role: 'assistant',
              },
            });
          } else if (event.type === 'tool_call') {
            collectedToolCalls.push(event);
          } else if (event.type === 'usage') {
            totalPromptTokens += event.inputTokens;
            totalCompletionTokens += event.outputTokens;
            totalCacheReadTokens += event.cacheReadTokens ?? 0;
            totalCacheWriteTokens += event.cacheWriteTokens ?? 0;

            const costUsd =
              (event.inputTokens / 1_000_000) * caps.pricing.inputPerMillion +
              (event.outputTokens / 1_000_000) * caps.pricing.outputPerMillion +
              ((event.cacheReadTokens ?? 0) / 1_000_000) * (caps.pricing.cacheReadPerMillion ?? 0) +
              ((event.cacheWriteTokens ?? 0) / 1_000_000) *
                (caps.pricing.cacheWritePerMillion ?? 0);

            await this.eventBus.publish({
              id: `evt-usage-${this.clock.nowMs()}`,
              type: 'usage.updated',
              timestamp: this.clock.nowMs(),
              actor: 'system',
              payload: {
                sessionId: options.sessionId,
                model,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                totalTokens: event.inputTokens + event.outputTokens,
                costUsd,
                cacheReadTokens: event.cacheReadTokens,
                cacheWriteTokens: event.cacheWriteTokens,
              },
            });
          } else if (event.type === 'stop_reason') {
            turnStopReason = event.reason;
          }
        }
      } catch (streamError) {
        const errorMsg = streamError instanceof Error ? streamError.message : String(streamError);
        await this.eventBus.publish({
          id: `evt-err-${this.clock.nowMs()}`,
          type: 'error',
          timestamp: this.clock.nowMs(),
          actor: 'agent',
          payload: {
            code: streamError instanceof ForgeError ? streamError.code : ErrorCode.PROVIDER_ERROR,
            message: errorMsg,
          },
        });
        throw streamError;
      }

      // Add assistant response to conversation history
      messages.push({
        role: 'assistant',
        content: accumulatedAssistantText,
        toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
      });

      // If no tool calls, model finished its task
      if (collectedToolCalls.length === 0) {
        finalStopReason = turnStopReason;
        const turnDurationMs = this.clock.nowMs() - turnStartMs;
        await this.eventBus.publish({
          id: `turn-comp-${turnIndex}-${this.clock.nowMs()}`,
          type: 'turn.completed',
          timestamp: this.clock.nowMs(),
          actor: 'agent',
          payload: {
            turnIndex,
            sessionId: options.sessionId,
            stopReason: finalStopReason,
            durationMs: turnDurationMs,
          },
        });
        break;
      }

      // Separate read-only tools (which can run in parallel) from mutating tools (which run sequentially)
      const readOnlyCalls: ToolCall[] = [];
      const mutatingCalls: ToolCall[] = [];

      for (const call of collectedToolCalls) {
        if (this.tools.isReadOnly(call.name)) {
          readOnlyCalls.push(call);
        } else {
          mutatingCalls.push(call);
        }
      }

      // Execute read-only tools in parallel
      const readOnlyResults = await Promise.all(
        readOnlyCalls.map(async (call) => {
          const tool = this.tools.get(call.name);
          if (!tool) {
            return {
              call,
              output: `Error: Tool '${call.name}' not found.`,
              isError: true,
            };
          }
          try {
            const result = await tool.execute(call.arguments);
            return {
              call,
              output: typeof result === 'string' ? result : JSON.stringify(result),
              isError: false,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              call,
              output: `Error executing tool '${call.name}': ${msg}`,
              isError: true,
            };
          }
        }),
      );

      for (const res of readOnlyResults) {
        messages.push({
          role: 'tool',
          content: res.output,
          toolCallId: res.call.id,
          name: res.call.name,
          isError: res.isError,
        });
      }

      // Execute mutating tools sequentially
      for (const call of mutatingCalls) {
        const tool = this.tools.get(call.name);
        if (!tool) {
          messages.push({
            role: 'tool',
            content: `Error: Tool '${call.name}' not found.`,
            toolCallId: call.id,
            name: call.name,
            isError: true,
          });
          continue;
        }

        try {
          const result = await tool.execute(call.arguments);
          messages.push({
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            toolCallId: call.id,
            name: call.name,
            isError: false,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Tool execution errors go back to the model so it can repair/self-correct; NEVER crash loop!
          messages.push({
            role: 'tool',
            content: `Error executing tool '${call.name}': ${msg}`,
            toolCallId: call.id,
            name: call.name,
            isError: true,
          });
        }
      }

      const turnDurationMs = this.clock.nowMs() - turnStartMs;
      await this.eventBus.publish({
        id: `turn-comp-${turnIndex}-${this.clock.nowMs()}`,
        type: 'turn.completed',
        timestamp: this.clock.nowMs(),
        actor: 'agent',
        payload: {
          turnIndex,
          sessionId: options.sessionId,
          stopReason: 'tool_use',
          durationMs: turnDurationMs,
        },
      });
    }

    const isCompleted =
      finalStopReason !== 'tool_use' &&
      finalStopReason !== 'max_tokens' &&
      finalStopReason !== 'cancelled';
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const estimatedCostUsd =
      (totalPromptTokens / 1_000_000) * caps.pricing.inputPerMillion +
      (totalCompletionTokens / 1_000_000) * caps.pricing.outputPerMillion +
      (totalCacheReadTokens / 1_000_000) * (caps.pricing.cacheReadPerMillion ?? 0) +
      (totalCacheWriteTokens / 1_000_000) * (caps.pricing.cacheWritePerMillion ?? 0);

    return {
      sessionId: options.sessionId,
      totalTurns: turnIndex,
      completed: isCompleted,
      stopReason: finalStopReason === 'tool_use' ? 'max_turns' : finalStopReason,
      messages,
      totalTokens,
      estimatedCostUsd,
    };
  }
}
