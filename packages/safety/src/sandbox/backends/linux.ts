import fs from 'node:fs';
import { ISandboxBackend, SandboxProfile, SandboxBackendType } from '../types.js';
import { HostIsolationBackend } from './host.js';
import { scrubEnvironment } from '../scrub.js';

export class LinuxBubblewrapBackend implements ISandboxBackend {
  readonly name: SandboxBackendType = 'bubblewrap';
  readonly isAvailable: boolean;
  private readonly fallback = new HostIsolationBackend();

  constructor() {
    this.isAvailable =
      process.platform === 'linux' &&
      (fs.existsSync('/usr/bin/bwrap') || fs.existsSync('/bin/bwrap'));
  }

  validateTarget(
    targetPath: string,
    profile: SandboxProfile,
  ): { allowed: boolean; reason?: string } {
    return this.fallback.validateTarget(targetPath, profile);
  }

  wrapCommand(
    command: string,
    args: readonly string[],
    profile: SandboxProfile,
  ): { command: string; args: readonly string[]; env: Record<string, string> } {
    const { env } = scrubEnvironment(process.env);
    if (!this.isAvailable) {
      return { command, args, env };
    }

    const bwrapArgs = [
      '--ro-bind',
      '/usr',
      '/usr',
      '--ro-bind',
      '/bin',
      '/bin',
      '--ro-bind',
      '/lib',
      '/lib',
      '--bind',
      profile.workspaceRoot,
      profile.workspaceRoot,
      '--bind',
      profile.tempDir,
      profile.tempDir,
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--unshare-pid',
      '--die-with-parent',
      '--',
      command,
      ...args,
    ];

    return {
      command: 'bwrap',
      args: bwrapArgs,
      env,
    };
  }
}
