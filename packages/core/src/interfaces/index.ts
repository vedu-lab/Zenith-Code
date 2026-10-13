export interface IClock {
  now(): Date;
  nowMs(): number;
}

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
  nowMs(): number {
    return Date.now();
  }
}

export interface IFileSystem {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
  preserveLineEndings(originalContent: string, newContent: string): string;
}

export interface ProcessRunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ProcessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface IProcessRunner {
  run(
    command: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessRunResult>;
}

export interface AgentChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: readonly ToolCallProposal[];
  readonly toolCallId?: string;
}

export interface ToolCallProposal {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface LlmChatResponse {
  readonly message: AgentChatMessage;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface ILlmProvider {
  readonly name: string;
  chat(messages: readonly AgentChatMessage[]): Promise<LlmChatResponse>;
}

export interface ToolActionIntent {
  readonly toolName: string;
  readonly actionType: 'fs:read' | 'fs:write' | 'exec:command' | 'net:request' | 'state:modify';
  readonly target: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export type PolicyDecisionResult = 'allow' | 'deny' | 'ask';

export interface PolicyDecision {
  readonly result: PolicyDecisionResult;
  readonly reason: string;
  readonly requiredCapabilities?: readonly string[];
}

export interface IPolicyEngine {
  evaluate(intent: ToolActionIntent): Promise<PolicyDecision>;
}
