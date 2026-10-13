import { z } from 'zod';
import { PolicyGate, ToolActionIntent, AllowAllPolicyGate } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { PolicyViolationError, ToolExecutionError } from '../errors/index.js';

export { AllowAllPolicyGate };

export interface ITool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<TInput>;
  readonly isReadOnly: boolean;
  execute(input: TInput): Promise<TOutput>;
  getParametersSchema(): Record<string, unknown>;
}

export abstract class BaseTool<TInput, TOutput> implements ITool<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: z.ZodType<TInput>;
  readonly isReadOnly: boolean = false;

  constructor(
    protected readonly policyGate: PolicyGate,
    protected readonly eventBus?: IEventBus | undefined,
  ) {}

  protected abstract createIntent(input: TInput): ToolActionIntent;
  protected abstract executeAction(input: TInput): Promise<TOutput>;

  getParametersSchema(): Record<string, unknown> {
    // Generate a minimal JSON schema definition from description & known parameters
    return {
      type: 'object',
      properties: {},
    };
  }

  async execute(input: TInput): Promise<TOutput> {
    const parseResult = this.schema.safeParse(input);
    if (!parseResult.success) {
      throw new ToolExecutionError(
        this.name,
        `Validation failed for tool arguments: ${parseResult.error.message}`,
        parseResult.error,
        { issues: parseResult.error.issues },
      );
    }
    const validatedInput = parseResult.data;
    const intent = this.createIntent(validatedInput);

    const startMs = Date.now();
    const callId = `call-${startMs}-${Math.random().toString(36).slice(2, 7)}`;

    if (this.eventBus) {
      await this.eventBus.publish({
        id: `evt-req-${callId}`,
        type: 'tool.requested',
        timestamp: startMs,
        actor: 'agent',
        payload: {
          turnIndex: 0,
          callId,
          toolName: this.name,
          parameters: validatedInput as Record<string, unknown>,
        },
      });
    }

    try {
      const gate = this.policyGate as unknown as {
        check?: (i: ToolActionIntent) => Promise<{ result: string; reason: string }>;
        evaluate?: (i: ToolActionIntent) => Promise<{ result: string; reason: string }>;
      };
      const decision =
        typeof gate.check === 'function' ? await gate.check(intent) : await gate.evaluate!(intent);

      if (decision.result !== 'allow') {
        const reason =
          decision.result === 'ask'
            ? `Action '${this.name}' requires user confirmation: ${decision.reason}`
            : decision.reason;
        throw new PolicyViolationError(this.name, reason, {
          intentTarget: intent.target,
          parameters: intent.parameters,
        });
      }

      const output = await this.executeAction(validatedInput);
      const durationMs = Date.now() - startMs;

      if (this.eventBus) {
        await this.eventBus.publish({
          id: `evt-exec-${callId}`,
          type: 'tool.executed',
          timestamp: Date.now(),
          actor: 'tool',
          payload: {
            turnIndex: 0,
            callId,
            toolName: this.name,
            success: true,
            durationMs,
            output,
          },
        });
      }

      return output;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.eventBus) {
        await this.eventBus.publish({
          id: `evt-exec-fail-${callId}`,
          type: 'tool.executed',
          timestamp: Date.now(),
          actor: 'tool',
          payload: {
            turnIndex: 0,
            callId,
            toolName: this.name,
            success: false,
            durationMs,
            error: errorMessage,
          },
        });
      }

      if (error instanceof PolicyViolationError || error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(this.name, errorMessage, error);
    }
  }
}
