import { ISandboxBackend, SandboxProfile, SandboxBackendType } from '../types.js';
import { HostIsolationBackend } from './host.js';
import { scrubEnvironment } from '../scrub.js';

export class WindowsJobObjectBackend implements ISandboxBackend {
  readonly name: SandboxBackendType = 'job_object';
  readonly isAvailable: boolean;
  private readonly fallback = new HostIsolationBackend();

  constructor() {
    this.isAvailable = process.platform === 'win32';
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
    _profile: SandboxProfile,
  ): { command: string; args: readonly string[]; env: Record<string, string> } {
    const { env } = scrubEnvironment(process.env);
    return { command, args, env };
  }
}
