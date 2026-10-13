import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  ForgeError,
  PolicyViolationError,
  ToolExecutionError,
  isForgeError,
} from '../src/errors/index.js';

describe('Structured Errors', () => {
  it('should initialize ForgeError with correct code and context', () => {
    const error = new ForgeError({
      code: ErrorCode.IO_ERROR,
      message: 'Failed to access file',
      context: { path: '/tmp/test' },
      remediation: 'Check file permissions',
    });

    expect(error.code).toBe(ErrorCode.IO_ERROR);
    expect(error.message).toBe('Failed to access file');
    expect(error.context).toEqual({ path: '/tmp/test' });
    expect(error.remediation).toBe('Check file permissions');
    expect(isForgeError(error)).toBe(true);
  });

  it('should format PolicyViolationError with proper code and remediation', () => {
    const error = new PolicyViolationError('exec_command', 'Untrusted bash invocation');

    expect(error.code).toBe(ErrorCode.POLICY_VIOLATION);
    expect(error.message).toContain('exec_command');
    expect(error.remediation).toBeDefined();
    expect(isForgeError(error)).toBe(true);
  });

  it('should wrap inner causes in ToolExecutionError', () => {
    const inner = new Error('Disk full');
    const error = new ToolExecutionError('write_file', 'Cannot write', inner, { target: '/foo' });

    expect(error.code).toBe(ErrorCode.TOOL_EXECUTION_FAILED);
    expect(error.cause).toBe(inner);
    expect(error.context['toolName']).toBe('write_file');
    expect(error.context['target']).toBe('/foo');
  });
});
