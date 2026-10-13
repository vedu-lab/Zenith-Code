import { execa } from 'execa';
import { IProcessRunner, ProcessRunOptions, ProcessRunResult } from '@forge/core';

export class ExecaProcessRunner implements IProcessRunner {
  async run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions = {},
  ): Promise<ProcessRunResult> {
    const mutableArgs = [...args];
    try {
      const execaOptions: Record<string, unknown> = { reject: false };
      if (options.cwd !== undefined) {
        execaOptions.cwd = options.cwd;
      }
      if (options.env !== undefined) {
        execaOptions.env = { ...options.env };
      }
      if (options.timeoutMs !== undefined) {
        execaOptions.timeout = options.timeoutMs;
      }

      const result = await execa(command, mutableArgs, execaOptions);

      return {
        stdout: String(result.stdout),
        stderr: String(result.stderr),
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  }
}
