import { describe, it, expect } from 'vitest';
import { SessionReplayEngine, SessionDataToReplay } from '../src/engine/replay.js';
import { CoreEventBus, ForgeEvent } from '../src/events/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ITool } from '../src/tools/base.js';
import { z } from 'zod';

describe('Deterministic Session Replay & Drift Detection', () => {
  const sampleSession: SessionDataToReplay = {
    id: 'sess-replay-101',
    title: 'Fix typo in README',
    turns: [
      {
        turnIndex: 1,
        userMessage: 'Please fix typo in README',
        modelOutput: 'I will read the README.md first.',
        toolCalls: [
          {
            id: 'call-1',
            toolName: 'read_file',
            parameters: { filePath: 'README.md' },
            output: { content: '# Helo World' },
          },
        ],
      },
      {
        turnIndex: 2,
        modelOutput: 'Now replacing typo.',
        toolCalls: [
          {
            id: 'call-2',
            toolName: 'write_file',
            parameters: { filePath: 'README.md', content: '# Hello World' },
            output: { success: true },
          },
        ],
      },
    ],
  };

  it('replays turns deterministically and publishes events without live tool execution', async () => {
    const eventBus = new CoreEventBus();
    const publishedEvents: ForgeEvent[] = [];
    eventBus.subscribeAllSync((e) => publishedEvents.push(e));

    const engine = new SessionReplayEngine(eventBus);
    const result = await engine.replay(sampleSession);

    expect(result.success).toBe(true);
    expect(result.turnsReplayed).toBe(2);
    expect(result.liveToolsRan).toBe(false);
    expect(result.driftDetected).toBe(false);

    const eventTypes = publishedEvents.map((e) => e.type);
    expect(eventTypes).toContain('turn.started');
    expect(eventTypes).toContain('model.delta');
    expect(eventTypes).toContain('tool.requested');
    expect(eventTypes).toContain('tool.executed');
    expect(eventTypes).toContain('turn.completed');
  });

  it('detects drift when --live-tools produces different results', async () => {
    const toolRegistry = new ToolRegistry();

    // Mock live tool that returns different content (drift!)
    const liveReadFileTool: ITool<Record<string, unknown>, unknown> = {
      name: 'read_file',
      description: 'Reads file',
      isReadOnly: true,
      schema: z.record(z.unknown()),
      getParametersSchema: () => ({}),
      execute: async () => ({ content: '# Completely different live content' }),
    };
    toolRegistry.register(liveReadFileTool as unknown as ITool<unknown, unknown>);

    const engine = new SessionReplayEngine();
    const result = await engine.replay(sampleSession, {
      liveTools: true,
      toolRegistry,
    });

    expect(result.success).toBe(true);
    expect(result.liveToolsRan).toBe(true);
    expect(result.driftDetected).toBe(true);
    expect(result.drifts.length).toBeGreaterThan(0);
    expect(result.drifts[0]?.toolName).toBe('read_file');
    expect(result.drifts[0]?.diffDescription).toContain('differ');
  });
});
