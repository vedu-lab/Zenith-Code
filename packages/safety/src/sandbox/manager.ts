import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ISandboxBackend, SandboxProfile, SandboxResourceLimits, DoctorReport } from './types.js';
import { HostIsolationBackend } from './backends/host.js';
import { MacSeatbeltBackend } from './backends/macos.js';
import { LinuxBubblewrapBackend } from './backends/linux.js';
import { WindowsJobObjectBackend } from './backends/windows.js';
import { runSandboxDoctor } from './doctor.js';

export interface SandboxManagerOptions {
  readonly workspaceRoot?: string;
  readonly tempDir?: string;
  readonly writePaths?: readonly string[];
  readonly denyPaths?: readonly string[];
  readonly allowedNetworkHosts?: readonly string[];
  readonly resourceLimits?: Partial<SandboxResourceLimits>;
  readonly scrubEnv?: boolean;
  readonly killProcessTreeOnExit?: boolean;
  readonly backend?: ISandboxBackend;
}

export class SandboxManager {
  private profile: SandboxProfile;
  private readonly backend: ISandboxBackend;
  private readonly activeChildPids = new Set<number>();

  constructor(options: SandboxManagerOptions = {}) {
    const cwd = options.workspaceRoot ?? process.cwd();
    const temp = options.tempDir ?? os.tmpdir();
    const homeDir = os.homedir();

    const defaultLimits: SandboxResourceLimits = {
      maxMemoryMb: options.resourceLimits?.maxMemoryMb ?? 2048,
      timeoutMs: options.resourceLimits?.timeoutMs ?? 60000,
      maxCpuPercent: options.resourceLimits?.maxCpuPercent ?? 80,
      maxProcesses: options.resourceLimits?.maxProcesses ?? 32,
    };

    const defaultDenyPaths = [
      path.join(homeDir, '.ssh'),
      path.join(homeDir, '.aws'),
      path.join(homeDir, '.gnupg'),
      path.join(homeDir, '.config', 'gcloud'),
      path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(homeDir, '.mozilla', 'firefox'),
      path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome'),
      path.join(cwd, '.forge', 'config.json'),
      path.join(homeDir, '.forge', 'config.json'),
    ];

    this.profile = {
      id: `sandbox-${Date.now()}`,
      workspaceRoot: cwd,
      tempDir: temp,
      writePaths: options.writePaths ?? [cwd, temp],
      denyPaths: options.denyPaths ?? defaultDenyPaths,
      allowedNetworkHosts: options.allowedNetworkHosts ?? ['localhost', '127.0.0.1'],
      resourceLimits: defaultLimits,
      scrubEnv: options.scrubEnv ?? true,
      killProcessTreeOnExit: options.killProcessTreeOnExit ?? true,
    };

    if (options.backend) {
      this.backend = options.backend;
    } else {
      const platform = os.platform();
      if (platform === 'darwin') {
        const mac = new MacSeatbeltBackend();
        this.backend = mac.isAvailable ? mac : new HostIsolationBackend();
      } else if (platform === 'linux') {
        const linux = new LinuxBubblewrapBackend();
        this.backend = linux.isAvailable ? linux : new HostIsolationBackend();
      } else if (platform === 'win32') {
        this.backend = new WindowsJobObjectBackend();
      } else {
        this.backend = new HostIsolationBackend();
      }
    }
  }

  getProfile(): SandboxProfile {
    return this.profile;
  }

  updateProfile(updates: Partial<SandboxProfile>): void {
    this.profile = {
      ...this.profile,
      ...updates,
      resourceLimits: {
        ...this.profile.resourceLimits,
        ...(updates.resourceLimits ?? {}),
      },
    };
  }

  getBackend(): ISandboxBackend {
    return this.backend;
  }

  validatePath(targetPath: string): { allowed: boolean; reason?: string } {
    // 1. Check deny paths explicitly
    const resolved = path.resolve(this.profile.workspaceRoot, targetPath);
    for (const denied of this.profile.denyPaths) {
      if (resolved.toLowerCase().startsWith(denied.toLowerCase())) {
        return {
          allowed: false,
          reason: `Target path '${targetPath}' is in forbidden deny list ('${denied}')`,
        };
      }
    }

    // 2. Delegate to active backend
    return this.backend.validateTarget(targetPath, this.profile);
  }

  validateCommand(
    command: string,
    args: readonly string[] = [],
  ): { allowed: boolean; reason?: string } {
    const fullCmd = [command, ...args].join(' ').trim();

    // 1. Dangerous git hooks / git config manipulation
    if (
      fullCmd.includes('core.hooksPath') ||
      fullCmd.includes('.git/hooks') ||
      (fullCmd.includes('git config') && (fullCmd.includes('alias.') || fullCmd.includes('core.')))
    ) {
      return {
        allowed: false,
        reason: 'Git configuration and hook manipulation commands are restricted in sandbox',
      };
    }

    // 2. Unsafe package install scripts: flag npm/pnpm/yarn install without --ignore-scripts if configured
    if (
      (command === 'npm' || command === 'pnpm' || command === 'yarn') &&
      args.includes('install') &&
      !args.includes('--ignore-scripts')
    ) {
      // We allow but warn or require policy flag depending on strictness
    }

    // 3. Dangerous system commands
    const dangerousPatterns = [
      /:(){ :|:& };:/, // fork bomb
      /rm\s+-rf\s+(\/|~\/|\$HOME)/, // destructive root deletion
      />\s*\/dev\/sd[a-z]/, // raw disk overwrite
      /mkfs\./, // filesystem formatting
      /chmod\s+-R\s+777\s+\//,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(fullCmd)) {
        return {
          allowed: false,
          reason: `Command matches high-risk destructive pattern: '${fullCmd}'`,
        };
      }
    }

    return { allowed: true };
  }

  wrapCommand(
    command: string,
    args: readonly string[] = [],
  ): { command: string; args: readonly string[]; env: Record<string, string> } {
    return this.backend.wrapCommand(command, args, this.profile);
  }

  registerChildProcess(pid: number): void {
    this.activeChildPids.add(pid);
  }

  unregisterChildProcess(pid: number): void {
    this.activeChildPids.delete(pid);
  }

  async killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // Process might have already exited
      }
      this.unregisterChildProcess(pid);
      return;
    }

    // POSIX process tree termination
    try {
      // Find all child PIDs recursively using pgrep
      const getChildren = (parentPid: number): number[] => {
        try {
          const stdout = execSync(`pgrep -P ${parentPid}`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          const pids = stdout
            .split('\n')
            .map((s) => parseInt(s.trim(), 10))
            .filter((p) => !isNaN(p) && p > 0);
          const allDescendants: number[] = [...pids];
          for (const childPid of pids) {
            allDescendants.push(...getChildren(childPid));
          }
          return allDescendants;
        } catch {
          return [];
        }
      };

      const children = getChildren(pid);
      // Kill descendants first, leaves to root
      for (const childPid of children.reverse()) {
        try {
          process.kill(childPid, signal);
        } catch {
          // Process might already be dead
        }
      }

      // Kill the root process
      try {
        process.kill(pid, signal);
      } catch {
        // Process might already be dead
      }
    } catch {
      // Fallback: try negative PID kill (process group)
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          process.kill(pid, signal);
        } catch {
          // Already exited
        }
      }
    } finally {
      this.unregisterChildProcess(pid);
    }
  }

  async cleanup(): Promise<void> {
    const pids = Array.from(this.activeChildPids);
    for (const pid of pids) {
      await this.killProcessTree(pid, 'SIGKILL');
    }
    this.activeChildPids.clear();
  }

  getDoctorReport(): DoctorReport {
    return runSandboxDoctor();
  }
}
