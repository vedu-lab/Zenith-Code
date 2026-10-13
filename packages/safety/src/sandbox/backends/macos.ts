import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ISandboxBackend, SandboxProfile, SandboxBackendType } from '../types.js';
import { HostIsolationBackend } from './host.js';
import { scrubEnvironment } from '../scrub.js';

export class MacSeatbeltBackend implements ISandboxBackend {
  readonly name: SandboxBackendType = 'seatbelt';
  readonly isAvailable: boolean;
  private readonly fallback = new HostIsolationBackend();

  constructor() {
    this.isAvailable = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
  }

  validateTarget(
    targetPath: string,
    profile: SandboxProfile,
  ): { allowed: boolean; reason?: string } {
    return this.fallback.validateTarget(targetPath, profile);
  }

  generateSbplProfile(profile: SandboxProfile): string {
    const home = os.homedir();
    return `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow sysctl-read)
(allow file-read*
  (subpath "/System")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/Library")
  (subpath "${profile.workspaceRoot}")
  (subpath "${profile.tempDir}"))
(allow file-write*
  (subpath "${profile.workspaceRoot}")
  (subpath "${profile.tempDir}"))
(deny file-read* file-write*
  (subpath "${path.join(home, '.ssh')}")
  (subpath "${path.join(home, '.aws')}")
  (subpath "${path.join(home, '.gnupg')}"))
(allow network* (local ip "localhost:*"))
`;
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

    const sbpl = this.generateSbplProfile(profile);
    return {
      command: '/usr/bin/sandbox-exec',
      args: ['-p', sbpl, command, ...args],
      env,
    };
  }
}
