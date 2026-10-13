import { describe, it, expect } from 'vitest';
import { HeadlessRunner } from '../src/headless/runner.js';
import { AgentLoop } from '../src/engine/agent-loop.js';
import { SystemPromptBuilder } from '../src/prompt/builder.js';
import { CoreEventBus, ForgeEvent } from '../src/events/index.js';
import { IProvider, Message, ToolDefinition, ProviderEvent } from '../src/provider/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { SystemClock, IFileSystem } from '../src/interfaces/index.js';
import { ForgeConfigSchema } from '../src/config/schema.js';

class MockHeadlessProvider implements IProvider {
  readonly name = 'headless-provider';
  async *stream(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
  ): AsyncIterable<ProviderEvent> {
    yield { type: 'text_delta', delta: 'Task completed successfully.' };
    yield { type: 'stop_reason', reason: 'end_turn' };
  }
}

describe('Headless Mode Execution & NDJSON Streaming', () => {
  it('should stream events and return exitCode 0 on success', async () => {
    const config = ForgeConfigSchema.parse({
      agent: { headless: true, json: true },
    });

    const eventBus = new CoreEventBus();
    const clock = new SystemClock();
    const tools = new ToolRegistry();
    const provider = new MockHeadlessProvider();
    const loop = new AgentLoop(provider, tools, eventBus, clock);

    const mockFs: IFileSystem = {
      readFile: async () => '',
      writeFile: async () => {},
      exists: async () => false,
      mkdir: async () => {},
      readDir: async () => [],
      stat: async () => ({ size: 0, isDirectory: false, mtimeMs: 0 }),
      preserveLineEndings: (_o, n) => n,
    };
    const promptBuilder = new SystemPromptBuilder(mockFs);

    const receivedEvents: ForgeEvent[] = [];
    const runner = new HeadlessRunner(loop, promptBuilder, eventBus, config);

    const result = await runner.run({
      task: 'Check status',
      json: true,
      onEvent: (evt) => receivedEvents.push(evt),
    });

    expect(result.exitCode).toBe(0);
    expect(result.loopResult?.completed).toBe(true);

    const eventTypes = receivedEvents.map((e) => e.type);
    expect(eventTypes).toContain('turn.started');
    expect(eventTypes).toContain('model.delta');
    expect(eventTypes).toContain('turn.completed');
  });
});
