import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from '../src/engine/agent-loop.js';
import { IProvider, Message, ToolDefinition, ProviderEvent } from '../src/provider/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { BaseTool } from '../src/tools/base.js';
import { CoreEventBus } from '../src/events/index.js';
import { SystemClock, AllowAllPolicyGate, ToolActionIntent } from '../src/interfaces/index.js';
import { z } from 'zod';

class MockReadOnlyTool extends BaseTool<{ key: string }, string> {
  readonly name = 'get_data';
  readonly description = 'Get data';
  readonly schema = z.object({ key: z.string() });
  override readonly isReadOnly = true;

  constructor(policyGate = new AllowAllPolicyGate(), eventBus?: CoreEventBus) {
    super(policyGate, eventBus);
  }

  protected createIntent(input: { key: string }): ToolActionIntent {
    return { toolName: this.name, actionType: 'fs:read', target: input.key, parameters: {} };
  }

  protected async executeAction(input: { key: string }): Promise<string> {
    if (input.key === 'error') {
      throw new Error('Database locked');
    }
    return `Data for ${input.key}`;
  }
}

class ScriptedMockProvider implements IProvider {
  readonly name = 'scripted-mock';
  private turn = 0;

  constructor(private readonly turns: ProviderEvent[][]) {}

  async *stream(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
  ): AsyncIterable<ProviderEvent> {
    const events = this.turns[this.turn] ?? [
      { type: 'text_delta', delta: 'Finished.' },
      { type: 'stop_reason', reason: 'end_turn' },
    ];
    this.turn++;

    for (const evt of events) {
      yield evt;
    }
  }
}

describe('AgentLoop Integration with Scripted Tool Calls', () => {
  it('should execute scripted turns, parallelize read-only tools, feed errors back, and complete', async () => {
    const scriptedEvents: ProviderEvent[][] = [
      // Turn 1: Model calls two read-only tools simultaneously (one valid, one failing)
      [
        { type: 'text_delta', delta: 'I will query the database.' },
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'get_data',
          arguments: { key: 'user_profile' },
        },
        {
          type: 'tool_call',
          id: 'call_2',
          name: 'get_data',
          arguments: { key: 'error' },
        },
        { type: 'stop_reason', reason: 'tool_use' },
      ],
      // Turn 2: Model receives tool results (including the error), self-corrects, and finishes
      [
        {
          type: 'text_delta',
          delta: 'Understood. Handled the error and found user_profile successfully.',
        },
        { type: 'stop_reason', reason: 'end_turn' },
      ],
    ];

    const provider = new ScriptedMockProvider(scriptedEvents);
    const eventBus = new CoreEventBus();
    const clock = new SystemClock();

    const tools = new ToolRegistry();
    const mockTool = new MockReadOnlyTool(new AllowAllPolicyGate(), eventBus);
    tools.register(mockTool);

    const turnStartedSpy = vi.fn();
    const toolExecutedSpy = vi.fn();

    eventBus.subscribe('turn.started', turnStartedSpy);
    eventBus.subscribe('tool.executed', toolExecutedSpy);

    const loop = new AgentLoop(provider, tools, eventBus, clock);

    const result = await loop.run('Fetch user profile', {
      sessionId: 'sess-test-loop',
      maxTurns: 5,
    });

    expect(result.completed).toBe(true);
    expect(result.totalTurns).toBe(2);
    expect(result.stopReason).toBe('end_turn');

    // Verify messages conversation history
    const toolMessages = result.messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);

    const successMsg = toolMessages.find((m) => m.toolCallId === 'call_1');
    const errorMsg = toolMessages.find((m) => m.toolCallId === 'call_2');

    expect(successMsg?.content).toBe('Data for user_profile');
    expect(successMsg?.isError).toBe(false);

    expect(errorMsg?.content).toContain('Database locked');
    expect(errorMsg?.isError).toBe(true);

    // Verify events were emitted properly
    expect(turnStartedSpy).toHaveBeenCalledTimes(2);
    expect(toolExecutedSpy).toHaveBeenCalledTimes(2);
  });
});
