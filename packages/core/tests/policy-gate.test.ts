import { describe, it, expect, vi } from 'vitest';
import {
  BaseTool,
  PolicyGate,
  ToolActionIntent,
  PolicyDecision,
  AgentLoop,
  CoreEventBus,
  SystemClock,
  ToolRegistry,
  PolicyViolationError,
  ErrorCode,
  IProvider,
  ProviderEvent,
  Message,
  ToolDefinition,
} from '../src/index.js';
import { z } from 'zod';

class MockSecuredTool extends BaseTool<{ targetFile: string }, string> {
  readonly name = 'secure_action';
  readonly description = 'Executes a secured action';
  readonly schema = z.object({ targetFile: z.string() });
  override readonly isReadOnly = false;

  constructor(policyGate: PolicyGate, eventBus?: CoreEventBus) {
    super(policyGate, eventBus);
  }

  protected createIntent(input: { targetFile: string }): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:write',
      target: input.targetFile,
      parameters: { targetFile: input.targetFile },
    };
  }

  protected async executeAction(input: { targetFile: string }): Promise<string> {
    return `Action succeeded for ${input.targetFile}`;
  }
}

describe('PolicyGate Enforcement & Integration with AgentLoop', () => {
  it('should throw PolicyViolationError with POLICY_VIOLATION code when policy denies intent', async () => {
    const denyGate: PolicyGate = {
      check: async (intent: ToolActionIntent): Promise<PolicyDecision> => {
        if (intent.target.includes('/etc/passwd')) {
          return {
            result: 'deny',
            reason: 'Access to system files is forbidden by security policy',
          };
        }
        return { result: 'allow', reason: 'Allowed' };
      },
    };

    const tool = new MockSecuredTool(denyGate);

    // Forbidden path should throw PolicyViolationError
    await expect(tool.execute({ targetFile: '/etc/passwd' })).rejects.toThrow(PolicyViolationError);

    try {
      await tool.execute({ targetFile: '/etc/passwd' });
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      const polErr = err as PolicyViolationError;
      expect(polErr.code).toBe(ErrorCode.POLICY_VIOLATION);
      expect(polErr.message).toContain('forbidden by security policy');
    }

    // Allowed path should succeed
    const successResult = await tool.execute({ targetFile: '/workspace/app.ts' });
    expect(successResult).toBe('Action succeeded for /workspace/app.ts');
  });

  it('should throw PolicyViolationError when policy gate returns ask (unauthorized without user approval)', async () => {
    const askGate: PolicyGate = {
      check: async (): Promise<PolicyDecision> => ({
        result: 'ask',
        reason: 'Action requires user confirmation',
        requiredCapabilities: ['fs:write'],
      }),
    };

    const tool = new MockSecuredTool(askGate);

    await expect(tool.execute({ targetFile: '/workspace/important.db' })).rejects.toThrow(
      /Action 'secure_action' requires user confirmation/,
    );
  });

  it('AgentLoop should catch PolicyViolationError, emit tool.executed failure, and return error to model without crashing', async () => {
    const denyGate: PolicyGate = {
      check: async (intent: ToolActionIntent): Promise<PolicyDecision> => {
        if (intent.target === 'blocked.txt') {
          return { result: 'deny', reason: 'Blocked by policy rule' };
        }
        return { result: 'allow', reason: 'Allowed' };
      },
    };

    const eventBus = new CoreEventBus();
    const clock = new SystemClock();
    const tools = new ToolRegistry();
    const securedTool = new MockSecuredTool(denyGate, eventBus);
    tools.register(securedTool);

    // Scripted LLM turns:
    // Turn 1: LLM tries to write to blocked.txt
    // Turn 2: LLM receives policy error, switches to allowed.txt and finishes
    const scriptedTurns: ProviderEvent[][] = [
      [
        { type: 'text_delta', delta: 'Trying to modify blocked.txt' },
        {
          type: 'tool_call',
          id: 'call_blocked',
          name: 'secure_action',
          arguments: { targetFile: 'blocked.txt' },
        },
        { type: 'stop_reason', reason: 'tool_use' },
      ],
      [
        {
          type: 'text_delta',
          delta: 'Permission was denied. Now writing to allowed.txt instead.',
        },
        {
          type: 'tool_call',
          id: 'call_allowed',
          name: 'secure_action',
          arguments: { targetFile: 'allowed.txt' },
        },
        { type: 'stop_reason', reason: 'tool_use' },
      ],
      [
        { type: 'text_delta', delta: 'All tasks completed successfully.' },
        { type: 'stop_reason', reason: 'end_turn' },
      ],
    ];

    let currentTurn = 0;
    const mockProvider: IProvider = {
      name: 'scripted-provider',
      async *stream(
        _messages: readonly Message[],
        _tools: readonly ToolDefinition[],
      ): AsyncIterable<ProviderEvent> {
        const events = scriptedTurns[currentTurn] ?? [{ type: 'stop_reason', reason: 'end_turn' }];
        currentTurn++;
        for (const evt of events) {
          yield evt;
        }
      },
    };

    const toolExecutedSpy = vi.fn();
    eventBus.subscribe('tool.executed', toolExecutedSpy);

    const loop = new AgentLoop(mockProvider, tools, eventBus, clock);
    const result = await loop.run('Perform file modification', {
      sessionId: 'sess-policy-test',
      maxTurns: 5,
    });

    expect(result.completed).toBe(true);
    expect(result.totalTurns).toBe(3);

    // Check that tool message contained the policy error
    const toolMessages = result.messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);

    const blockedToolMsg = toolMessages.find((m) => m.toolCallId === 'call_blocked');
    expect(blockedToolMsg?.isError).toBe(true);
    expect(blockedToolMsg?.content).toContain('Blocked by policy rule');

    const allowedToolMsg = toolMessages.find((m) => m.toolCallId === 'call_allowed');
    expect(allowedToolMsg?.isError).toBe(false);
    expect(allowedToolMsg?.content).toBe('Action succeeded for allowed.txt');

    // tool.executed event for blocked call had success: false
    const blockedEvent = toolExecutedSpy.mock.calls.find(
      (c) =>
        (c[0] as { payload: { toolName: string; success: boolean } }).payload.success === false,
    );
    expect(blockedEvent).toBeDefined();
  });
});
