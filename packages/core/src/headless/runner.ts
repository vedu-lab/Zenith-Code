import path from 'node:path';
import { IEventBus, ForgeEvent } from '../events/index.js';
import { AgentLoop, AgentLoopRunResult } from '../engine/agent-loop.js';
import { SystemPromptBuilder } from '../prompt/builder.js';
import { ForgeConfig } from '../config/schema.js';
import { IFileSystem } from '../interfaces/index.js';
import { PolicyViolationError } from '../errors/index.js';

export type HeadlessExitCode = 0 | 1 | 2 | 3 | 4;

export interface HeadlessRunOptions {
  readonly task: string;
  readonly sessionId?: string | undefined;
  readonly json?: boolean | undefined;
  readonly maxTurns?: number | undefined;
  readonly model?: string | undefined;
  readonly projectRoot?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly artifactsDir?: string | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly onEvent?: ((event: ForgeEvent) => void) | undefined;
}

export interface HeadlessRunResult {
  readonly exitCode: HeadlessExitCode;
  readonly loopResult?: AgentLoopRunResult | undefined;
  readonly error?: string | undefined;
  readonly artifacts?:
    | {
        readonly transcriptPath?: string | undefined;
        readonly patchPath?: string | undefined;
        readonly usagePath?: string | undefined;
      }
    | undefined;
}

export class HeadlessRunner {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly promptBuilder: SystemPromptBuilder,
    private readonly eventBus: IEventBus,
    private readonly config: ForgeConfig,
    private readonly fs?: IFileSystem | undefined,
  ) {}

  async run(options: HeadlessRunOptions): Promise<HeadlessRunResult> {
    const isJson = options.json ?? this.config.agent.json;
    const sessionId =
      options.sessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const model = options.model ?? this.config.models.main;
    const maxTurns = options.maxTurns ?? this.config.agent.maxTurns;
    const recordedEvents: ForgeEvent[] = [];
    let hadPolicyViolation = false;

    // Attach NDJSON stream subscriber
    const unsubscribe = this.eventBus.subscribeAllSync((event) => {
      recordedEvents.push(event);
      options.onEvent?.(event);

      if (event.type === 'error') {
        const payload = event.payload as { code?: string; message?: string };
        if (
          payload.code === 'POLICY_VIOLATION' ||
          (payload.message && /policy/i.test(payload.message))
        ) {
          hadPolicyViolation = true;
        }
      }

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

    // Timeout controller
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutController = new AbortController();
    let isTimedOut = false;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        timeoutController.abort(new Error(`Execution timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    // Combine abort signals
    const activeSignal = options.abortSignal
      ? anySignal(options.abortSignal, timeoutController.signal)
      : timeoutController.signal;

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
        abortSignal: activeSignal,
      });

      if (timeoutTimer) clearTimeout(timeoutTimer);
      unsubscribe();

      // Emit artifacts if requested / fs available
      const artifacts = await this.emitArtifacts(sessionId, recordedEvents, loopResult, options);

      if (isTimedOut || activeSignal.aborted) {
        return {
          exitCode: 3,
          loopResult,
          error: `Execution timed out or aborted (${options.timeoutMs ?? 0}ms)`,
          artifacts,
        };
      }

      if (hadPolicyViolation) {
        return {
          exitCode: 2,
          loopResult,
          error: 'Task encountered a policy violation',
          artifacts,
        };
      }

      if (loopResult.completed) {
        return { exitCode: 0, loopResult, artifacts };
      } else {
        return {
          exitCode: 1,
          loopResult,
          error: `Task did not complete successfully. Stop reason: ${loopResult.stopReason}`,
          artifacts,
        };
      }
    } catch (error) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      unsubscribe();

      if (isTimedOut || (error instanceof Error && error.name === 'AbortError' && isTimedOut)) {
        return {
          exitCode: 3,
          error: `Execution timed out after ${options.timeoutMs}ms`,
        };
      }

      if (error instanceof PolicyViolationError || hadPolicyViolation) {
        return {
          exitCode: 2,
          error: error instanceof Error ? error.message : String(error),
        };
      }

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

  private async emitArtifacts(
    sessionId: string,
    events: readonly ForgeEvent[],
    loopResult: AgentLoopRunResult,
    options: HeadlessRunOptions,
  ): Promise<HeadlessRunResult['artifacts']> {
    if (!this.fs) return undefined;

    const baseDir = options.artifactsDir ?? path.join('.forge', 'artifacts', sessionId);

    try {
      await this.fs.mkdir(baseDir);

      const transcriptPath = path.join(baseDir, 'transcript.jsonl');
      const lines = events.map((e) => JSON.stringify(e)).join('\n');
      await this.fs.writeFile(transcriptPath, lines);

      const usagePath = path.join(baseDir, 'usage.json');
      const usageContent = JSON.stringify(
        {
          sessionId,
          turns: loopResult.totalTurns,
          completed: loopResult.completed,
          totalTokens: loopResult.totalTokens,
          estimatedCostUsd: loopResult.estimatedCostUsd,
          stopReason: loopResult.stopReason,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      );
      await this.fs.writeFile(usagePath, usageContent);

      const patchPath = path.join(baseDir, 'diff.patch');
      await this.fs.writeFile(patchPath, '# Forge Diff Patch Artifact\n');

      return {
        transcriptPath,
        usagePath,
        patchPath,
      };
    } catch {
      // Artifact emission failure should not crash execution
      return undefined;
    }
  }
}

function anySignal(...signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
  }
  return controller.signal;
}
