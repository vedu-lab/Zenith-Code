export enum ErrorCode {
  UNKNOWN = 'CORE_UNKNOWN',
  INVALID_ARGUMENT = 'CORE_INVALID_ARGUMENT',
  CONFIG_ERROR = 'CORE_CONFIG_ERROR',
  POLICY_VIOLATION = 'SAFETY_POLICY_VIOLATION',
  CAPABILITY_MISSING = 'SAFETY_CAPABILITY_MISSING',

  // Provider error codes
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  PROVIDER_AUTH_ERROR = 'PROVIDER_AUTH_ERROR',
  PROVIDER_RATE_LIMIT = 'PROVIDER_RATE_LIMIT',
  PROVIDER_CONTEXT_OVERFLOW = 'PROVIDER_CONTEXT_OVERFLOW',
  PROVIDER_NETWORK_ERROR = 'PROVIDER_NETWORK_ERROR',
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',

  // Tool error codes
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
  TOOL_VALIDATION_ERROR = 'TOOL_VALIDATION_ERROR',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  FILE_NOT_READ_BEFORE_WRITE = 'FILE_NOT_READ_BEFORE_WRITE',
  BINARY_FILE_REFUSED = 'BINARY_FILE_REFUSED',
  EDIT_NO_MATCH = 'EDIT_NO_MATCH',
  EDIT_MULTIPLE_MATCHES = 'EDIT_MULTIPLE_MATCHES',

  // Agent loop error codes
  AGENT_MAX_TURNS_EXCEEDED = 'AGENT_MAX_TURNS_EXCEEDED',
  AGENT_INTERRUPTED = 'AGENT_INTERRUPTED',

  // State error codes
  CHECKPOINT_ERROR = 'STATE_CHECKPOINT_ERROR',
  SESSION_ERROR = 'STATE_SESSION_ERROR',
  IO_ERROR = 'IO_ERROR',
}

export interface ForgeErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
  readonly remediation?: string | undefined;
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
  readonly isRetryable: boolean;

  constructor(
    providerName: string,
    message: string,
    options: {
      code?: ErrorCode;
      cause?: unknown;
      isRetryable?: boolean;
      statusCode?: number;
      context?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super({
      code: options.code ?? ErrorCode.PROVIDER_ERROR,
      message: `LLM Provider '${providerName}' error: ${message}`,
      cause: options.cause,
      context: { providerName, statusCode: options.statusCode, ...options.context },
      remediation: options.isRetryable
        ? 'Request can be retried with exponential backoff.'
        : 'Check your API key, endpoint URL, or account quotas.',
    });
    this.name = 'ProviderError';
    this.isRetryable = options.isRetryable ?? false;
  }
}

export class ConfigError extends ForgeError {
  constructor(message: string, context?: Readonly<Record<string, unknown>>) {
    super({
      code: ErrorCode.CONFIG_ERROR,
      message: `Configuration error: ${message}`,
      context,
      remediation: 'Verify config file format or environment variable settings.',
    });
    this.name = 'ConfigError';
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
