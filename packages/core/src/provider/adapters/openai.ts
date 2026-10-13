import {
  IProvider,
  Message,
  ToolDefinition,
  ProviderStreamOptions,
  ProviderEvent,
} from '../types.js';
import { ProviderError, ErrorCode } from '../../errors/index.js';

export interface OpenAIAdapterOptions {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly organization?: string | undefined;
  readonly defaultHeaders?: Record<string, string> | undefined;
  readonly providerName?: string | undefined;
}

export class OpenAIProvider implements IProvider {
  readonly name: string;
  protected readonly apiKey: string | undefined;
  protected readonly baseUrl: string;
  protected readonly organization: string | undefined;
  protected readonly defaultHeaders: Record<string, string>;

  constructor(options: OpenAIAdapterOptions = {}) {
    this.name = options.providerName ?? 'openai';
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.organization = options.organization;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async *stream(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
    options: ProviderStreamOptions = {},
  ): AsyncIterable<ProviderEvent> {
    const apiKey = this.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey && this.name === 'openai') {
      throw new ProviderError(
        this.name,
        'Missing OpenAI API key. Set OPENAI_API_KEY or configure provider.',
        {
          code: ErrorCode.PROVIDER_AUTH_ERROR,
        },
      );
    }

    const model = options.model ?? 'gpt-4o';

    // Map messages
    const formattedMessages: unknown[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        formattedMessages.push({
          role: 'tool',
          tool_call_id: m.toolCallId ?? 'call_1',
          content: m.content,
        });
      } else if (m.role === 'assistant') {
        const entry: Record<string, unknown> = {
          role: 'assistant',
          content: m.content || null,
        };
        if (m.toolCalls && m.toolCalls.length > 0) {
          entry['tool_calls'] = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        formattedMessages.push(entry);
      } else {
        formattedMessages.push({
          role: m.role,
          content: m.content,
        });
      }
    }

    // Map tools
    const formattedTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const requestBody: Record<string, unknown> = {
      model,
      messages: formattedMessages,
      temperature: options.temperature ?? 0,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (options.maxTokens) {
      requestBody['max_tokens'] = options.maxTokens;
    }
    if (formattedTools.length > 0) {
      requestBody['tools'] = formattedTools;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.defaultHeaders,
    };
    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
    if (this.organization) {
      headers['openai-organization'] = this.organization;
    }

    let response: Response;
    try {
      const endpoint = this.baseUrl.endsWith('/chat/completions')
        ? this.baseUrl
        : `${this.baseUrl}/chat/completions`;

      response = await fetch(endpoint, {
        method: 'POST',
        headers,
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

    const pendingToolCalls = new Map<number, { id: string; name: string; rawArgs: string }>();

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

            // Usage reporting
            if (parsed['usage']) {
              const u = parsed['usage'] as Record<string, unknown>;
              yield {
                type: 'usage',
                inputTokens: Number(u['prompt_tokens'] ?? 0),
                outputTokens: Number(u['completion_tokens'] ?? 0),
                cacheReadTokens: Number(
                  u['prompt_tokens_details']
                    ? (u['prompt_tokens_details'] as Record<string, unknown>)['cached_tokens']
                    : 0,
                ),
              };
            }

            const choices = parsed['choices'] as Array<Record<string, unknown>> | undefined;
            if (!choices || choices.length === 0) continue;

            const choice = choices[0];
            const delta = choice?.['delta'] as Record<string, unknown> | undefined;

            if (delta?.['content']) {
              yield { type: 'text_delta', delta: String(delta['content']) };
            }

            // Streamed tool calls
            const toolCallDeltas = delta?.['tool_calls'] as
              Array<Record<string, unknown>> | undefined;
            if (toolCallDeltas) {
              for (const tcDelta of toolCallDeltas) {
                const index = Number(tcDelta['index'] ?? 0);
                let entry = pendingToolCalls.get(index);
                if (!entry) {
                  entry = {
                    id: String(tcDelta['id'] ?? `call_${Date.now()}_${index}`),
                    name: String(
                      (tcDelta['function'] as Record<string, unknown> | undefined)?.['name'] ?? '',
                    ),
                    rawArgs: '',
                  };
                  pendingToolCalls.set(index, entry);
                }

                const fn = tcDelta['function'] as Record<string, unknown> | undefined;
                if (fn?.['name'] && !entry.name) {
                  entry.name = String(fn['name']);
                }
                if (fn?.['arguments']) {
                  const chunk = String(fn['arguments']);
                  entry.rawArgs += chunk;
                  yield {
                    type: 'tool_call_delta',
                    id: entry.id,
                    name: entry.name,
                    argumentsDelta: chunk,
                  };
                }
              }
            }

            const finishReason = choice?.['finish_reason'] as string | undefined;
            if (finishReason) {
              // Emit all accumulated tool calls
              for (const [_, entry] of pendingToolCalls.entries()) {
                let parsedArgs: Record<string, unknown> = {};
                try {
                  parsedArgs = entry.rawArgs
                    ? (JSON.parse(entry.rawArgs) as Record<string, unknown>)
                    : {};
                } catch {
                  parsedArgs = {};
                }
                yield {
                  type: 'tool_call',
                  id: entry.id,
                  name: entry.name,
                  arguments: parsedArgs,
                };
              }
              pendingToolCalls.clear();

              yield {
                type: 'stop_reason',
                reason:
                  finishReason === 'tool_calls'
                    ? 'tool_use'
                    : finishReason === 'length'
                      ? 'max_tokens'
                      : 'end_turn',
              };
            }
          } catch {
            // Ignore line parsing error
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
