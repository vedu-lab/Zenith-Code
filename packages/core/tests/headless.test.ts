import { describe, it, expect } from 'vitest';
import { HeadlessRunner } from '../src/headless/runner.js';
import { AgentLoop } from '../src/engine/agent-loop.js';
import { SystemPromptBuilder } from '../src/prompt/builder.js';
import { CoreEventBus, ForgeEvent } from '../src/events/index.js';
import { IProvider, Message, ToolDefinition, ProviderEvent } from '../src/provider/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SystemClock, IFileSystem } from '../src/interfaces/index.js';
import { ForgeConfigSchema } from '../src/config/schema.js';
import { PolicyViolationError } from '../src/errors/index.js';

class MockSuccessProvider implements IProvider {
  readonly name = 'mock-success';
  async *stream(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
  ): AsyncIterable<ProviderEvent> {
    yield { type: 'text_delta', delta: 'Task completed successfully.' };
    yield { type: 'stop_reason', reason: 'end_turn' };
  }
}

class MockHangingProvider implements IProvider {
  readonly name = 'mock-hanging';
  async *stream(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<ProviderEvent> {
    await new Promise<void>((resolve) => {
      if (options?.abortSignal?.aborted) {
        resolve();
        return;
      }
      options?.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
      setTimeout(resolve, 500);
    });
    yield { type: 'stop_reason', reason: 'cancelled' };
  }
}

describe('Headless Mode Execution & Deterministic Exit Codes', () => {
  const config = ForgeConfigSchema.parse({
    agent: { headless: true, json: true },
  });

  const createMockFs = (writtenFiles: Map<string, string>): IFileSystem => ({
    readFile: async (p) => writtenFiles.get(p) ?? '',
    writeFile: async (p, c) => {
      writtenFiles.set(p, c);
    },
    exists: async (p) => writtenFiles.has(p),
    mkdir: async () => {},
    readDir: async () => [],
    stat: async () => ({ size: 0, isDirectory: false, mtimeMs: 0 }),
    preserveLineEndings: (_o, n) => n,
  });

  it('streams events, emits artifacts, and returns exitCode 0 on success', async () => {
    const writtenFiles = new Map<string, string>();
    const mockFs = createMockFs(writtenFiles);
    const eventBus = new CoreEventBus();
    const clock = new SystemClock();
    const tools = new ToolRegistry();
    const provider = new MockSuccessProvider();
    const loop = new AgentLoop(provider, tools, eventBus, clock);
    const promptBuilder = new SystemPromptBuilder(mockFs);

    const receivedEvents: ForgeEvent[] = [];
    const runner = new HeadlessRunner(loop, promptBuilder, eventBus, config, mockFs);

    const result = await runner.run({
      task: 'Check status',
      json: true,
      artifactsDir: '/artifacts/test-session',
      onEvent: (evt) => receivedEvents.push(evt),
    });

    expect(result.exitCode).toBe(0);
    expect(result.loopResult?.completed).toBe(true);
    expect(result.artifacts?.transcriptPath).toBe('/artifacts/test-session/transcript.jsonl');
    expect(result.artifacts?.usagePath).toBe('/artifacts/test-session/usage.json');
    expect(result.artifacts?.patchPath).toBe('/artifacts/test-session/diff.patch');

    // Verify artifacts were saved to filesystem
    expect(writtenFiles.has('/artifacts/test-session/transcript.jsonl')).toBe(true);
    expect(writtenFiles.has('/artifacts/test-session/usage.json')).toBe(true);
  });

  it('returns exitCode 2 on policy violation', async () => {
    const writtenFiles = new Map<string, string>();
    const mockFs = createMockFs(writtenFiles);
    const eventBus = new CoreEventBus();
    const clock = new SystemClock();
    const tools = new ToolRegistry();

    // Provider that throws policy violation
    const policyViolatingProvider: IProvider = {
      name: 'policy-violator',
      stream: async function* () {
        throw new PolicyViolationError('exec_cmd', 'Command denied by policy in headless mode');
      },
    };

    const loop = new AgentLoop(policyViolatingProvider, tools, eventBus, clock);
    const promptBuilder = new SystemPromptBuilder(mockFs);
    const runner = new HeadlessRunner(loop, promptBuilder, eventBus, config, mockFs);

    const result = await runner.run({
      task: 'Run prohibited command',
      json: true,
    });

    expect(result.exitCode).toBe(2);
    expect(result.error).toContain('denied by policy');
  });

  it('returns exitCode 3 on timeout', async () => {
    const writtenFiles = new Map<string, string>();
    const mockFs = createMockFs(writtenFiles);
    const eventBus = new CoreEventBus();
    const clock = new SystemClock();
    const tools = new ToolRegistry();
    const provider = new MockHangingProvider();
    const loop = new AgentLoop(provider, tools, eventBus, clock);
    const promptBuilder = new SystemPromptBuilder(mockFs);
    const runner = new HeadlessRunner(loop, promptBuilder, eventBus, config, mockFs);

    const result = await runner.run({
      task: 'Hanging task',
      timeoutMs: 50, // Fast timeout
      json: true,
    });

    expect(result.exitCode).toBe(3);
    expect(result.error).toContain('timed out');
  });
});
