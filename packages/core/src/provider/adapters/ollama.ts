import {
  IProvider,
  Message,
  ToolDefinition,
  ProviderStreamOptions,
  ProviderEvent,
} from '../types.js';
import { ProviderError, ErrorCode } from '../../errors/index.js';
import { globalCapabilityRegistry } from '../capabilities.js';
import { injectFallbackProtocol, parseFallbackToolCalls } from '../protocol-fallback.js';

export interface OllamaAdapterOptions {
  readonly baseUrl?: string | undefined;
}

export class OllamaProvider implements IProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;

  constructor(options: OllamaAdapterOptions = {}) {
    const rawUrl =
      options.baseUrl ??
      process.env['OLLAMA_HOST'] ??
      process.env['OLLAMA_BASE_URL'] ??
      'http://127.0.0.1:11434';
    this.baseUrl = rawUrl.replace(/\/$/, '');
  }

  async *stream(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
    options: ProviderStreamOptions = {},
  ): AsyncIterable<ProviderEvent> {
    const model = options.model ?? 'qwen2.5-coder:latest';
    const caps = globalCapabilityRegistry.get(model);

    const useNativeTools = caps.supportsToolCalling;
    const effectiveMessages = useNativeTools ? messages : injectFallbackProtocol(messages, tools);

    // Format messages for Ollama
    const formattedMessages: unknown[] = [];
    for (const m of effectiveMessages) {
      if (m.role === 'tool') {
        formattedMessages.push({
          role: 'tool',
          content: m.content,
        });
      } else if (m.role === 'assistant') {
        const item: Record<string, unknown> = {
          role: 'assistant',
          content: m.content,
        };
        if (m.toolCalls && m.toolCalls.length > 0 && useNativeTools) {
          item['tool_calls'] = m.toolCalls.map((tc) => ({
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }));
        }
        formattedMessages.push(item);
      } else {
        formattedMessages.push({
          role: m.role,
          content: m.content,
        });
      }
    }

    const requestBody: Record<string, unknown> = {
      model,
      messages: formattedMessages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0,
      },
    };

    if (useNativeTools && tools.length > 0) {
      requestBody['tools'] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: options.abortSignal ?? null,
      });
    } catch (err) {
      throw new ProviderError(
        this.name,
        `Failed to connect to Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        {
          code: ErrorCode.PROVIDER_NETWORK_ERROR,
          cause: err,
          isRetryable: true,
        },
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(this.name, `HTTP ${response.status}: ${errorText}`, {
        code: ErrorCode.PROVIDER_ERROR,
        statusCode: response.status,
        isRetryable: response.status >= 500,
      });
    }

    if (!response.body) {
      throw new ProviderError(this.name, 'Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';
    let toolCallsEmitted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            const msg = parsed['message'] as Record<string, unknown> | undefined;

            if (msg?.['content']) {
              const textChunk = String(msg['content']);
              accumulatedText += textChunk;
              yield { type: 'text_delta', delta: textChunk };
            }

            // Native tool calls from Ollama
            if (msg?.['tool_calls']) {
              const nativeCalls = msg['tool_calls'] as Array<Record<string, unknown>>;
              for (const tc of nativeCalls) {
                const fn = tc['function'] as Record<string, unknown> | undefined;
                if (fn?.['name']) {
                  toolCallsEmitted = true;
                  yield {
                    type: 'tool_call',
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: String(fn['name']),
                    arguments: (fn['arguments'] as Record<string, unknown>) ?? {},
                  };
                }
              }
            }

            if (parsed['done']) {
              // If native tool calls were not emitted, parse text for fallback tool calls
              if (
                !toolCallsEmitted &&
                (accumulatedText.includes('<tool_call>') || accumulatedText.includes('```'))
              ) {
                const { toolCalls } = parseFallbackToolCalls(accumulatedText);
                for (const tc of toolCalls) {
                  toolCallsEmitted = true;
                  yield {
                    type: 'tool_call',
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                  };
                }
              }

              const promptTokens = Number(parsed['prompt_eval_count'] ?? 0);
              const outputTokens = Number(parsed['eval_count'] ?? 0);
              if (promptTokens > 0 || outputTokens > 0) {
                yield {
                  type: 'usage',
                  inputTokens: promptTokens,
                  outputTokens,
                };
              }

              yield {
                type: 'stop_reason',
                reason: toolCallsEmitted ? 'tool_use' : 'end_turn',
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
