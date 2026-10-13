export enum ErrorCode {
  UNKNOWN = 'CORE_UNKNOWN',
  INVALID_ARGUMENT = 'CORE_INVALID_ARGUMENT',
  POLICY_VIOLATION = 'SAFETY_POLICY_VIOLATION',
  CAPABILITY_MISSING = 'SAFETY_CAPABILITY_MISSING',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  CHECKPOINT_ERROR = 'STATE_CHECKPOINT_ERROR',
  SESSION_ERROR = 'STATE_SESSION_ERROR',
  IO_ERROR = 'IO_ERROR',
}

export interface ForgeErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly remediation?: string;
}

export class ForgeError extends Error {
  readonly code: ErrorCode;
  readonly context: Readonly<Record<string, unknown>>;
  readonly remediation: string | undefined;

  constructor(options: ForgeErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'ForgeError';
    this.code = options.code;
    this.context = options.context ?? {};
    this.remediation = options.remediation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PolicyViolationError extends ForgeError {
  constructor(actionName: string, reason: string, context?: Readonly<Record<string, unknown>>) {
    super({
      code: ErrorCode.POLICY_VIOLATION,
      message: `Action '${actionName}' was denied by safety policy: ${reason}`,
      context: { actionName, reason, ...context },
      remediation: 'Obtain explicit user approval or update the active capability policy grant.',
    });
    this.name = 'PolicyViolationError';
  }
}

export class ToolExecutionError extends ForgeError {
  constructor(
    toolName: string,
    message: string,
    cause?: unknown,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super({
      code: ErrorCode.TOOL_EXECUTION_FAILED,
      message: `Tool '${toolName}' execution failed: ${message}`,
      cause,
      context: { toolName, ...context },
    });
    this.name = 'ToolExecutionError';
  }
}

export class ProviderError extends ForgeError {
  constructor(providerName: string, message: string, cause?: unknown) {
    super({
      code: ErrorCode.PROVIDER_ERROR,
      message: `LLM Provider '${providerName}' error: ${message}`,
      cause,
      context: { providerName },
    });
    this.name = 'ProviderError';
  }
}

export class InvalidArgumentError extends ForgeError {
  constructor(argumentName: string, message: string) {
    super({
      code: ErrorCode.INVALID_ARGUMENT,
      message: `Invalid argument '${argumentName}': ${message}`,
      context: { argumentName },
    });
    this.name = 'InvalidArgumentError';
  }
}

export function isForgeError(error: unknown): error is ForgeError {
  return error instanceof ForgeError;
}
