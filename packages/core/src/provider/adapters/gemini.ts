import {
  IProvider,
  Message,
  ToolDefinition,
  ProviderStreamOptions,
  ProviderEvent,
} from '../types.js';
import { ProviderError, ErrorCode } from '../../errors/index.js';

export interface GeminiAdapterOptions {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
}

export class GeminiProvider implements IProvider {
  readonly name = 'gemini';
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(options: GeminiAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async *stream(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
    options: ProviderStreamOptions = {},
  ): AsyncIterable<ProviderEvent> {
    const apiKey = this.apiKey ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
    if (!apiKey) {
      throw new ProviderError(
        this.name,
        'Missing Gemini API key. Set GEMINI_API_KEY or configure provider.',
        {
          code: ErrorCode.PROVIDER_AUTH_ERROR,
        },
      );
    }

    const model = options.model ?? 'gemini-2.0-flash';

    // Separate system messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    let systemInstruction: unknown = undefined;
    if (systemMessages.length > 0) {
      systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }],
      };
    }

    const contents: unknown[] = [];
    for (const msg of conversationMessages) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts: unknown[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.name ?? 'tool_result',
                response: { output: msg.content },
              },
            },
          ],
        });
      }
    }

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0,
        maxOutputTokens: options.maxTokens ?? 8192,
      },
    };
    if (systemInstruction) {
      requestBody['systemInstruction'] = systemInstruction;
    }
    if (tools.length > 0) {
      requestBody['tools'] = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    let response: Response;
    try {
      const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>;
            const candidates = parsed['candidates'] as Array<Record<string, unknown>> | undefined;
            if (!candidates || candidates.length === 0) continue;

            const candidate = candidates[0];
            const content = candidate?.['content'] as Record<string, unknown> | undefined;
            const parts = content?.['parts'] as Array<Record<string, unknown>> | undefined;

            if (parts) {
              for (const part of parts) {
                if (part['text']) {
                  yield { type: 'text_delta', delta: String(part['text']) };
                }
                if (part['functionCall']) {
                  const fc = part['functionCall'] as Record<string, unknown>;
                  yield {
                    type: 'tool_call',
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: String(fc['name'] ?? ''),
                    arguments: (fc['args'] as Record<string, unknown>) ?? {},
                  };
                }
              }
            }

            const usage = parsed['usageMetadata'] as Record<string, unknown> | undefined;
            if (usage) {
              yield {
                type: 'usage',
                inputTokens: Number(usage['promptTokenCount'] ?? 0),
                outputTokens: Number(usage['candidatesTokenCount'] ?? 0),
              };
            }

            const finishReason = candidate?.['finishReason'] as string | undefined;
            if (finishReason) {
              yield {
                type: 'stop_reason',
                reason:
                  finishReason === 'STOP'
                    ? 'end_turn'
                    : finishReason === 'MAX_TOKENS'
                      ? 'max_tokens'
                      : 'end_turn',
              };
            }
          } catch {
            // Ignore line parsing errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
