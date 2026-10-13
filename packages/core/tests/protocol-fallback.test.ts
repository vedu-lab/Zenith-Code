import { describe, it, expect } from 'vitest';
import {
  formatFallbackSystemInstructions,
  parseFallbackToolCalls,
  injectFallbackProtocol,
} from '../src/provider/protocol-fallback.js';
import { ToolDefinition, Message } from '../src/provider/types.js';

describe('Tool Calling Protocol Fallback', () => {
  const tools: ToolDefinition[] = [
    {
      name: 'read_file',
      description: 'Read file contents',
      parameters: {
        type: 'object',
        properties: { filePath: { type: 'string' } },
        required: ['filePath'],
      },
    },
  ];

  it('should inject XML tool instructions into system prompt', () => {
    const formatted = formatFallbackSystemInstructions(tools);
    expect(formatted).toContain('<tool_call>');
    expect(formatted).toContain('read_file');
    expect(formatted).toContain('Parameters JSON Schema');
  });

  it('should inject instructions into existing system message', () => {
    const messages: Message[] = [{ role: 'system', content: 'You are an assistant.' }];
    const injected = injectFallbackProtocol(messages, tools);

    expect(injected).toHaveLength(1);
    expect(injected[0]?.content).toContain('You are an assistant.');
    expect(injected[0]?.content).toContain('<tool_call>');
  });

  it('should create system message if none exists', () => {
    const messages: Message[] = [{ role: 'user', content: 'Please read foo.txt' }];
    const injected = injectFallbackProtocol(messages, tools);

    expect(injected).toHaveLength(2);
    expect(injected[0]?.role).toBe('system');
    expect(injected[0]?.content).toContain('<tool_call>');
  });

  it('should parse valid XML tool calls from model output', () => {
    const modelOutput = `I will read the file now.\n<tool_call>\n{\n  "name": "read_file",\n  "arguments": { "filePath": "src/utils.ts" }\n}\n</tool_call>\nPlease wait.`;

    const { toolCalls, cleanedText } = parseFallbackToolCalls(modelOutput);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe('read_file');
    expect(toolCalls[0]?.arguments).toEqual({ filePath: 'src/utils.ts' });
    expect(cleanedText).toBe('I will read the file now.\n\nPlease wait.');
  });
});
