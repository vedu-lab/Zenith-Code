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

export interface FileStatResult {
  readonly size: number;
  readonly isDirectory: boolean;
  readonly mtimeMs: number;
}

export interface IFileSystem {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
  readDir(dirPath: string): Promise<readonly string[]>;
  stat(filePath: string): Promise<FileStatResult>;
  preserveLineEndings(originalContent: string, newContent: string): string;
  unlink?(filePath: string): Promise<void>;
  rmdir?(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  copyFile?(sourcePath: string, destinationPath: string): Promise<void>;
}

export interface ProcessRunOptions {
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
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

export type PolicyDecisionResult = 'allow' | 'deny' | 'ask';

export interface PolicyDecision {
  readonly result: PolicyDecisionResult;
  readonly reason: string;
  readonly requiredCapabilities?: readonly string[] | undefined;
}

export interface ToolActionIntent {
  readonly toolName: string;
  readonly actionType:
    'fs:read' | 'fs:write' | 'exec:command' | 'net:request' | 'state:modify' | 'mcp:call';
  readonly target: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface PolicyGate {
  check(intent: ToolActionIntent): Promise<PolicyDecision>;
}

export class AllowAllPolicyGate implements PolicyGate {
  async check(_intent: ToolActionIntent): Promise<PolicyDecision> {
    return {
      result: 'allow',
      reason: 'Allow-all default policy gate',
    };
  }
}

// Backward-compatible alias for prompt 1 safety stub
export interface IPolicyEngine extends PolicyGate {
  evaluate(intent: ToolActionIntent): Promise<PolicyDecision>;
}

export class PolicyEngineAdapter implements IPolicyEngine {
  constructor(private readonly gate: PolicyGate) {}

  async check(intent: ToolActionIntent): Promise<PolicyDecision> {
    return this.gate.check(intent);
  }

  async evaluate(intent: ToolActionIntent): Promise<PolicyDecision> {
    return this.gate.check(intent);
  }
}

// Legacy messages for backwards compatibility
export interface AgentChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCalls?: readonly ToolCallProposal[] | undefined;
  readonly toolCallId?: string | undefined;
}

export interface ToolCallProposal {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface LlmChatResponse {
  readonly message: AgentChatMessage;
  readonly usage?:
    | {
        readonly promptTokens: number;
        readonly completionTokens: number;
        readonly totalTokens: number;
      }
    | undefined;
}

export interface ILlmProvider {
  readonly name: string;
  chat(messages: readonly AgentChatMessage[]): Promise<LlmChatResponse>;
}
