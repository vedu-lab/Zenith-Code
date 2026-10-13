export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface Message {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[] | undefined;
  readonly toolCallId?: string | undefined;
  readonly name?: string | undefined;
  readonly isError?: boolean | undefined;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export type StopReason =
  'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'cancelled' | 'error';

export interface TextDeltaEvent {
  readonly type: 'text_delta';
  readonly delta: string;
}

export interface ToolCallDeltaEvent {
  readonly type: 'tool_call_delta';
  readonly id: string;
  readonly name?: string | undefined;
  readonly argumentsDelta: string;
}

export interface ToolCallEvent {
  readonly type: 'tool_call';
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface UsageEvent {
  readonly type: 'usage';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number | undefined;
  readonly cacheWriteTokens?: number | undefined;
}

export interface StopReasonEvent {
  readonly type: 'stop_reason';
  readonly reason: StopReason;
}

export interface ErrorEvent {
  readonly type: 'error';
  readonly error: Error;
}

export type ProviderEvent =
  TextDeltaEvent | ToolCallDeltaEvent | ToolCallEvent | UsageEvent | StopReasonEvent | ErrorEvent;

export interface ProviderStreamOptions {
  readonly model?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly enablePromptCaching?: boolean | undefined;
}

export interface IProvider {
  readonly name: string;
  stream(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
    options?: ProviderStreamOptions,
  ): AsyncIterable<ProviderEvent>;
}
