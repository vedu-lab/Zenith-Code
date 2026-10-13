import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AnthropicProvider,
  OpenAIProvider,
  OpenAICompatibleProvider,
  GeminiProvider,
  OllamaProvider,
  FailoverProvider,
  ProviderManager,
} from '../src/provider/index.js';
import { ForgeConfigSchema } from '../src/config/index.js';

describe('Provider Adapters (Recorded Fixtures & Mock Streams)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockSseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('AnthropicProvider: should stream text deltas, tool calls, and usage from SSE events', async () => {
    const anthropicSseChunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant","usage":{"input_tokens":120,"cache_creation_input_tokens":40,"cache_read_input_tokens":80}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_call_1","name":"read_file"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"filePath\\": \\"src/"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"utils.ts\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":35}}\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createMockSseResponse(anthropicSseChunks));

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const events: unknown[] = [];

    for await (const event of provider.stream(
      [{ role: 'user', content: 'Read utils.ts' }],
      [{ name: 'read_file', description: 'Read file', parameters: { type: 'object' } }],
      { enablePromptCaching: true },
    )) {
      events.push(event);
    }

    const toolDeltas = events.filter((e) => (e as { type: string }).type === 'tool_call_delta');
    const toolCalls = events.filter((e) => (e as { type: string }).type === 'tool_call');
    const usages = events.filter((e) => (e as { type: string }).type === 'usage');
    const stopReasons = events.filter((e) => (e as { type: string }).type === 'stop_reason');

    expect(toolDeltas).toHaveLength(2);
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as { name: string }).name).toBe('read_file');
    expect((toolCalls[0] as { arguments: Record<string, unknown> }).arguments).toEqual({
      filePath: 'src/utils.ts',
    });

    expect(usages).toHaveLength(1);
    expect((usages[0] as { inputTokens: number }).inputTokens).toBe(120);
    expect((usages[0] as { cacheReadTokens: number }).cacheReadTokens).toBe(80);

    expect(stopReasons).toHaveLength(1);
    expect((stopReasons[0] as { reason: string }).reason).toBe('tool_use');
  });

  it('OpenAIProvider: should stream text and accumulate tool calls', async () => {
    const openAiSseChunks = [
      'data: {"choices":[{"delta":{"content":"Thinking..."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_99","function":{"name":"write_file","arguments":"{\\"filePath\\": \\"test.txt\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":", \\"content\\": \\"hello\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":50,"completion_tokens":20}}\n\n',
      'data: [DONE]\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createMockSseResponse(openAiSseChunks));

    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const events: unknown[] = [];

    for await (const event of provider.stream([{ role: 'user', content: 'Write file' }], [])) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => (e as { type: string }).type === 'text_delta');
    const toolCalls = events.filter((e) => (e as { type: string }).type === 'tool_call');
    const stopReasons = events.filter((e) => (e as { type: string }).type === 'stop_reason');

    expect(textDeltas).toHaveLength(1);
    expect((textDeltas[0] as { delta: string }).delta).toBe('Thinking...');

    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as { arguments: Record<string, unknown> }).arguments).toEqual({
      filePath: 'test.txt',
      content: 'hello',
    });

    expect(stopReasons).toHaveLength(1);
    expect((stopReasons[0] as { reason: string }).reason).toBe('tool_use');
  });

  it('OpenAICompatibleProvider: should use custom baseUrl and headers', async () => {
    const openAiChunks = [
      'data: {"choices":[{"delta":{"content":"Done!"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
      expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer ds-test-key');
      return Promise.resolve(createMockSseResponse(openAiChunks));
    });

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'ds-test-key',
    });

    const events: unknown[] = [];
    for await (const event of provider.stream([{ role: 'user', content: 'Hi' }], [])) {
      events.push(event);
    }

    expect(events.some((e) => (e as { type: string }).type === 'text_delta')).toBe(true);
  });

  it('GeminiProvider: should stream text and functionCalls', async () => {
    const geminiChunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Searching..."}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_dir","args":{"dirPath":"."}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":40,"candidatesTokenCount":15}}\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createMockSseResponse(geminiChunks));

    const provider = new GeminiProvider({ apiKey: 'gemini-key' });
    const events: unknown[] = [];

    for await (const event of provider.stream([{ role: 'user', content: 'List files' }], [])) {
      events.push(event);
    }

    const toolCalls = events.filter((e) => (e as { type: string }).type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as { name: string }).name).toBe('list_dir');
  });

  it('OllamaProvider: should stream native tool calls and usage', async () => {
    const ollamaLines = [
      JSON.stringify({
        message: { role: 'assistant', content: 'Checking...' },
        done: false,
      }) + '\n',
      JSON.stringify({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'read_file',
                arguments: { filePath: 'README.md' },
              },
            },
          ],
        },
        done: false,
      }) + '\n',
      JSON.stringify({
        done: true,
        prompt_eval_count: 55,
        eval_count: 18,
      }) + '\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(createMockSseResponse(ollamaLines));

    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
    const events: unknown[] = [];

    for await (const event of provider.stream(
      [{ role: 'user', content: 'Read readme' }],
      [{ name: 'read_file', description: 'Read', parameters: {} }],
      { model: 'qwen2.5-coder:latest' },
    )) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => (e as { type: string }).type === 'text_delta');
    const toolCalls = events.filter((e) => (e as { type: string }).type === 'tool_call');
    const usages = events.filter((e) => (e as { type: string }).type === 'usage');

    expect(textDeltas).toHaveLength(1);
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as { name: string }).name).toBe('read_file');
    expect(usages).toHaveLength(1);
    expect((usages[0] as { inputTokens: number }).inputTokens).toBe(55);
  });

  it('FailoverProvider: should switch to backup provider when primary fails', async () => {
    let primaryCalled = false;
    let backupCalled = false;

    const primary = {
      name: 'primary-cloud',
      stream: async function* () {
        primaryCalled = true;
        throw new Error('500 Internal Server Error from primary');
      },
    };

    const backup = {
      name: 'backup-local',
      stream: async function* () {
        backupCalled = true;
        yield { type: 'text_delta' as const, delta: 'Backup response' };
        yield { type: 'stop_reason' as const, reason: 'end_turn' as const };
      },
    };

    const failover = new FailoverProvider([primary, backup]);
    const events: unknown[] = [];

    for await (const event of failover.stream([{ role: 'user', content: 'Hello' }], [])) {
      events.push(event);
    }

    expect(primaryCalled).toBe(true);
    expect(backupCalled).toBe(true);
    expect(events.some((e) => (e as { delta: string }).delta === 'Backup response')).toBe(true);
  });

  it('ProviderManager: should resolve configured models per role', () => {
    const config = ForgeConfigSchema.parse({
      models: {
        main: 'claude-3-5-sonnet',
        fast: 'gpt-4o-mini',
        planner: 'claude-3-5-sonnet',
      },
    });

    const manager = new ProviderManager(config);
    const mainResolved = manager.getProviderForRole('main');
    const fastResolved = manager.getProviderForRole('fast');

    expect(mainResolved.model).toBe('claude-3-5-sonnet');
    expect(mainResolved.provider.name).toBe('anthropic');

    expect(fastResolved.model).toBe('gpt-4o-mini');
    expect(fastResolved.provider.name).toBe('openai');
  });
});
