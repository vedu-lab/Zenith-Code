import { IEventBus, ForgeEvent } from '../events/index.js';
import { AgentLoop, AgentLoopRunResult } from '../engine/agent-loop.js';
import { SystemPromptBuilder } from '../prompt/builder.js';
import { ForgeConfig } from '../config/schema.js';

export interface HeadlessRunOptions {
  readonly task: string;
  readonly sessionId?: string | undefined;
  readonly json?: boolean | undefined;
  readonly maxTurns?: number | undefined;
  readonly model?: string | undefined;
  readonly projectRoot?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly onEvent?: ((event: ForgeEvent) => void) | undefined;
}

export interface HeadlessRunResult {
  readonly exitCode: 0 | 1 | 2;
  readonly loopResult?: AgentLoopRunResult | undefined;
  readonly error?: string | undefined;
}

export class HeadlessRunner {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly promptBuilder: SystemPromptBuilder,
    private readonly eventBus: IEventBus,
    private readonly config: ForgeConfig,
  ) {}

  async run(options: HeadlessRunOptions): Promise<HeadlessRunResult> {
    const isJson = options.json ?? this.config.agent.json;
    const sessionId =
      options.sessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const model = options.model ?? this.config.models.main;
    const maxTurns = options.maxTurns ?? this.config.agent.maxTurns;

    // Attach NDJSON stream subscriber
    const unsubscribe = this.eventBus.subscribeAllSync((event) => {
      options.onEvent?.(event);

      if (isJson) {
        // Output clean single-line NDJSON
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(event));
      } else {
        // Human-readable headless output
        if (event.type === 'model.delta') {
          process.stdout.write((event.payload as { delta: string }).delta);
        } else if (event.type === 'tool.requested') {
          const p = event.payload as { toolName: string };
          // eslint-disable-next-line no-console
          console.log(`\n[tool:call] ${p.toolName}`);
        } else if (event.type === 'tool.executed') {
          const p = event.payload as { toolName: string; success: boolean; durationMs: number };
          // eslint-disable-next-line no-console
          console.log(
            `[tool:done] ${p.toolName} (${p.success ? 'ok' : 'failed'}, ${p.durationMs}ms)`,
          );
        }
      }
    });

    try {
      const systemPrompt = await this.promptBuilder.build({
        variant: this.config.agent.systemPromptVariant,
        projectRoot: options.projectRoot,
      });

      const loopResult = await this.agentLoop.run(options.task, {
        sessionId,
        model,
        maxTurns,
        systemPrompt,
        abortSignal: options.abortSignal,
      });

      unsubscribe();

      if (loopResult.completed) {
        return { exitCode: 0, loopResult };
      } else {
        return {
          exitCode: 1,
          loopResult,
          error: `Task did not complete successfully. Stop reason: ${loopResult.stopReason}`,
        };
      }
    } catch (error) {
      unsubscribe();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (isJson) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            id: `evt-fatal-${Date.now()}`,
            type: 'error',
            timestamp: Date.now(),
            actor: 'system',
            payload: { code: 'FATAL_ERROR', message: errorMsg },
          }),
        );
      } else {
        console.error(`\n[Fatal Error] ${errorMsg}`);
      }
      return { exitCode: 1, error: errorMsg };
    }
  }
}
