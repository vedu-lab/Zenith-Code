import {
  IProvider,
  Message,
  ToolDefinition,
  ProviderStreamOptions,
  ProviderEvent,
} from '../types.js';
import { ProviderError, ErrorCode } from '../../errors/index.js';

export interface AnthropicAdapterOptions {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
}

export class AnthropicProvider implements IProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(options: AnthropicAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
  }

  async *stream(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
    options: ProviderStreamOptions = {},
  ): AsyncIterable<ProviderEvent> {
    const apiKey = this.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new ProviderError(
        this.name,
        'Missing Anthropic API key. Set ANTHROPIC_API_KEY or configure provider.',
        {
          code: ErrorCode.PROVIDER_AUTH_ERROR,
        },
      );
    }

    const model = options.model ?? 'claude-3-5-sonnet-20241022';

    // Separate system messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // System prompt with optional prompt caching
    let systemPayload: unknown;
    if (systemMessages.length > 0) {
      const combined = systemMessages.map((m) => m.content).join('\n\n');
      if (options.enablePromptCaching) {
        systemPayload = [
          {
            type: 'text',
            text: combined,
            cache_control: { type: 'ephemeral' },
          },
        ];
      } else {
        systemPayload = combined;
      }
    }

    // Map conversation messages to Anthropic format
    const formattedMessages: unknown[] = [];
    for (const msg of conversationMessages) {
      if (msg.role === 'user') {
        formattedMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const contentBlocks: unknown[] = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        formattedMessages.push({
          role: 'assistant',
          content: contentBlocks.length > 0 ? contentBlocks : msg.content,
        });
      } else if (msg.role === 'tool') {
        formattedMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId ?? 'unknown',
              content: msg.content,
              is_error: msg.isError ?? false,
            },
          ],
        });
      }
    }

    // Map tools to Anthropic format
    const formattedTools = tools.map((t, idx) => {
      const base: Record<string, unknown> = {
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      };
      if (options.enablePromptCaching && idx === tools.length - 1) {
        base['cache_control'] = { type: 'ephemeral' };
      }
      return base;
    });

    const requestBody: Record<string, unknown> = {
      model,
      messages: formattedMessages,
      max_tokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0,
      stream: true,
    };
    if (systemPayload !== undefined) {
      requestBody['system'] = systemPayload;
    }
    if (formattedTools.length > 0) {
      requestBody['tools'] = formattedTools;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: options.abortSignal ?? null,
      });
    } catch (err) {
      throw new ProviderError(
        this.name,
        `Network request failed: ${err instanceof Error ? err.message : String(err)}`,
        {
          code: ErrorCode.PROVIDER_NETWORK_ERROR,
          cause: err,
          isRetryable: true,
        },
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      const isRateLimit = response.status === 429;
      throw new ProviderError(this.name, `HTTP ${response.status}: ${errorText}`, {
        code: isRateLimit ? ErrorCode.PROVIDER_RATE_LIMIT : ErrorCode.PROVIDER_ERROR,
        statusCode: response.status,
        isRetryable: isRateLimit || response.status >= 500,
      });
    }

    if (!response.body) {
      throw new ProviderError(this.name, 'Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let currentToolCall: { id: string; name: string; rawArgs: string } | null = null;
    let inputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>;
            const eventType = parsed['type'] as string;

            if (eventType === 'message_start') {
              const msg = parsed['message'] as Record<string, unknown> | undefined;
              const usage = msg?.['usage'] as Record<string, unknown> | undefined;
              if (usage) {
                inputTokens = Number(usage['input_tokens'] ?? 0);
                cacheReadTokens = Number(usage['cache_read_input_tokens'] ?? 0);
                cacheWriteTokens = Number(usage['cache_creation_input_tokens'] ?? 0);
              }
            } else if (eventType === 'content_block_start') {
              const block = parsed['content_block'] as Record<string, unknown> | undefined;
              if (block?.['type'] === 'tool_use') {
                currentToolCall = {
                  id: String(block['id'] ?? `call-${Date.now()}`),
                  name: String(block['name'] ?? ''),
                  rawArgs: '',
                };
              }
            } else if (eventType === 'content_block_delta') {
              const delta = parsed['delta'] as Record<string, unknown> | undefined;
              if (delta?.['type'] === 'text_delta') {
                yield { type: 'text_delta', delta: String(delta['text'] ?? '') };
              } else if (delta?.['type'] === 'input_json_delta' && currentToolCall) {
                const argChunk = String(delta['partial_json'] ?? '');
                currentToolCall.rawArgs += argChunk;
                yield {
                  type: 'tool_call_delta',
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  argumentsDelta: argChunk,
                };
              }
            } else if (eventType === 'content_block_stop') {
              if (currentToolCall) {
                let parsedArgs: Record<string, unknown> = {};
                try {
                  parsedArgs = currentToolCall.rawArgs
                    ? (JSON.parse(currentToolCall.rawArgs) as Record<string, unknown>)
                    : {};
                } catch {
                  parsedArgs = {};
                }
                yield {
                  type: 'tool_call',
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  arguments: parsedArgs,
                };
                currentToolCall = null;
              }
            } else if (eventType === 'message_delta') {
              const delta = parsed['delta'] as Record<string, unknown> | undefined;
              const usage = parsed['usage'] as Record<string, unknown> | undefined;
              const outputTokens = Number(usage?.['output_tokens'] ?? 0);

              if (inputTokens > 0 || outputTokens > 0) {
                yield {
                  type: 'usage',
                  inputTokens,
                  outputTokens,
                  cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
                  cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
                };
              }

              const stopReason = String(delta?.['stop_reason'] ?? '');
              if (stopReason) {
                yield {
                  type: 'stop_reason',
                  reason: stopReason === 'tool_use' ? 'tool_use' : 'end_turn',
                };
              }
            }
          } catch {
            // Ignore JSON line parse errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
