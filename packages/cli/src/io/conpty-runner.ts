import os from 'node:os';
import { IProcessRunner, ProcessRunOptions, ProcessRunResult } from '@forge/core';
import { ExecaProcessRunner } from './process-runner.js';

export interface IConptyRunner {
  isConptySupported(): boolean;
  runInteractive(
    command: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessRunResult>;
}

export class WindowsConptyRunner implements IConptyRunner {
  constructor(private readonly fallbackRunner: IProcessRunner = new ExecaProcessRunner()) {}

  /**
   * ConPTY is natively supported on Windows 10 build 17763+ (October 2018 Update) and Windows 11.
   */
  isConptySupported(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }
    const release = os.release();
    const parts = release.split('.');
    const buildNumber = parseInt(parts[2] ?? '0', 10);
    return buildNumber >= 17763;
  }

  async runInteractive(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions = {},
  ): Promise<ProcessRunResult> {
    // In environments with native pseudo-terminals or fallbacks, execute with appropriate flags
    const env = {
      ...options.env,
      // Tell child processes that a modern ANSI-capable Windows terminal is present
      ...(process.platform === 'win32'
        ? {
            WT_SESSION: 'forge-conpty',
            COLORTERM: 'truecolor',
            TERM: 'xterm-256color',
          }
        : {}),
    };

    return this.fallbackRunner.run(command, args, {
      ...options,
      env,
    });
  }
}
