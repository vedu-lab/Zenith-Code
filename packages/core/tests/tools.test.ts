import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool, ToolRegistry } from '../src/tools/index.js';
import { IPolicyEngine, ToolActionIntent } from '../src/interfaces/index.js';
import { PolicyViolationError } from '../src/errors/index.js';

class MockFileTool extends BaseTool<{ path: string; content: string }, string> {
  readonly name = 'write_file';
  readonly description = 'Writes file to disk';
  readonly schema = z.object({ path: z.string(), content: z.string() });

  protected createIntent(input: { path: string; content: string }): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:write',
      target: input.path,
      parameters: { bytes: input.content.length },
    };
  }

  protected async executeAction(input: { path: string; content: string }): Promise<string> {
    return `Wrote ${input.content.length} bytes to ${input.path}`;
  }
}

describe('BaseTool & ToolRegistry', () => {
  it('should block execution when policy engine returns deny', async () => {
    const mockPolicy: IPolicyEngine = {
      evaluate: vi.fn().mockResolvedValue({
        result: 'deny',
        reason: 'Protected system directory',
      }),
    };

    const tool = new MockFileTool(mockPolicy);

    await expect(tool.execute({ path: '/etc/hosts', content: 'test' })).rejects.toThrow(
      PolicyViolationError,
    );
    expect(mockPolicy.evaluate).toHaveBeenCalledWith({
      toolName: 'write_file',
      actionType: 'fs:write',
      target: '/etc/hosts',
      parameters: { bytes: 4 },
    });
  });

  it('should execute when policy engine returns allow', async () => {
    const mockPolicy: IPolicyEngine = {
      evaluate: vi.fn().mockResolvedValue({
        result: 'allow',
        reason: 'Authorized workspace write',
      }),
    };

    const tool = new MockFileTool(mockPolicy);
    const result = await tool.execute({ path: 'src/app.ts', content: 'hello' });

    expect(result).toBe('Wrote 5 bytes to src/app.ts');
  });

  it('should manage tools inside ToolRegistry', () => {
    const registry = new ToolRegistry();
    const mockPolicy: IPolicyEngine = { evaluate: vi.fn() };
    const tool = new MockFileTool(mockPolicy);

    registry.register(tool as unknown as BaseTool<unknown, unknown>);
    expect(registry.get('write_file')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });
});
