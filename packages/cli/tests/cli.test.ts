import { describe, it, expect } from 'vitest';
import { bootstrapApp, NodeFileSystem, parseCliArgs } from '../src/index.js';
import { IProvider, Message, ToolDefinition, ProviderEvent } from '@forge/core';

class MockCliProvider implements IProvider {
  readonly name = 'mock-cli-provider';
  async *stream(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
  ): AsyncIterable<ProviderEvent> {
    yield { type: 'text_delta', delta: 'CLI test completed.' };
    yield { type: 'stop_reason', reason: 'end_turn' };
  }
}

describe('CLI Bootstrap & Drivers', () => {
  it('should parse CLI arguments accurately', () => {
    const args = parseCliArgs([
      'run',
      'add a function to utils.ts',
      '--headless',
      '--json',
      '--model',
      'qwen2.5-coder:latest',
      '--max-turns',
      '15',
    ]);

    expect(args.command).toBe('run');
    expect(args.task).toBe('add a function to utils.ts');
    expect(args.headless).toBe(true);
    expect(args.json).toBe(true);
    expect(args.model).toBe('qwen2.5-coder:latest');
    expect(args.maxTurns).toBe(15);
  });

  it('should initialize container with all dependencies injected and run loop', async () => {
    const mockProvider = new MockCliProvider();
    const container = await bootstrapApp({ provider: mockProvider });

    expect(container.clock).toBeDefined();
    expect(container.fs).toBeDefined();
    expect(container.processRunner).toBeDefined();
    expect(container.eventBus).toBeDefined();
    expect(container.policyEngine).toBeDefined();
    expect(container.sessionManager).toBeDefined();
    expect(container.tools.list().length).toBeGreaterThanOrEqual(8);

    const session = await container.sessionManager.createSession('Test CLI Session');
    expect(session.title).toBe('Test CLI Session');

    const result = await container.agentLoop.run('Ping', {
      sessionId: session.id,
    });
    expect(result.completed).toBe(true);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);

    container.sqliteStore.close();
  });

  it('should run in headless mode returning exitCode 0', async () => {
    const mockProvider = new MockCliProvider();
    const container = await bootstrapApp({ provider: mockProvider });

    const result = await container.headlessRunner.run({
      task: 'Self check',
      json: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.loopResult?.completed).toBe(true);

    container.sqliteStore.close();
  });

  it('should preserve CRLF line endings when modifying content', () => {
    const fs = new NodeFileSystem();
    const original = 'first line\r\nsecond line\r\n';
    const modified = 'first line\nsecond line\nthird line\n';

    const preserved = fs.preserveLineEndings(original, modified);
    expect(preserved).toBe('first line\r\nsecond line\r\nthird line\r\n');
  });

  it('should preserve LF line endings when modifying content', () => {
    const fs = new NodeFileSystem();
    const original = 'first line\nsecond line\n';
    const modified = 'first line\r\nsecond line\r\nthird line\r\n';

    const preserved = fs.preserveLineEndings(original, modified);
    expect(preserved).toBe('first line\nsecond line\nthird line\n');
  });
});
