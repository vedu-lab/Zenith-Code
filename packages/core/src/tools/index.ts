import { z } from 'zod';
import { IPolicyEngine, ToolActionIntent } from '../interfaces/index.js';
import { PolicyViolationError, ToolExecutionError } from '../errors/index.js';

export interface ITool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<TInput>;
  execute(input: TInput): Promise<TOutput>;
}

export abstract class BaseTool<TInput, TOutput> implements ITool<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: z.ZodType<TInput>;

  constructor(protected readonly policyEngine: IPolicyEngine) {}

  protected abstract createIntent(input: TInput): ToolActionIntent;
  protected abstract executeAction(input: TInput): Promise<TOutput>;

  async execute(input: TInput): Promise<TOutput> {
    const parsed = this.schema.parse(input);
    const intent = this.createIntent(parsed);

    const decision = await this.policyEngine.evaluate(intent);
    if (decision.result === 'deny') {
      throw new PolicyViolationError(this.name, decision.reason, {
        intentTarget: intent.target,
        parameters: intent.parameters,
      });
    }

    try {
      return await this.executeAction(parsed);
    } catch (error) {
      if (error instanceof PolicyViolationError) {
        throw error;
      }
      throw new ToolExecutionError(
        this.name,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ITool<unknown, unknown>>();

  register(tool: ITool<unknown, unknown>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ITool<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): readonly ITool<unknown, unknown>[] {
    return Array.from(this.tools.values());
  }
}
