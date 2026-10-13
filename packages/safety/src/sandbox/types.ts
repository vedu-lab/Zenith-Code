export type SandboxBackendType =
  | 'seatbelt' // macOS Seatbelt (sandbox-exec)
  | 'bubblewrap' // Linux bubblewrap (bwrap)
  | 'landlock' // Linux Landlock + seccomp
  | 'job_object' // Windows Restricted Token + Job Object
  | 'host_isolated'; // Strict in-process fallback

export interface SandboxResourceLimits {
  readonly maxMemoryMb: number;
  readonly timeoutMs: number;
  readonly maxCpuPercent?: number | undefined;
  readonly maxProcesses?: number | undefined;
}

export interface SandboxProfile {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly tempDir: string;
  readonly writePaths: readonly string[];
  readonly denyPaths: readonly string[];
  readonly allowedNetworkHosts: readonly string[];
  readonly resourceLimits: SandboxResourceLimits;
  readonly scrubEnv: boolean;
  readonly killProcessTreeOnExit: boolean;
}

export interface SandboxExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly killed?: boolean | undefined;
  readonly violation?: string | undefined;
}

export interface ISandboxBackend {
  readonly name: SandboxBackendType;
  readonly isAvailable: boolean;
  validateTarget(
    targetPath: string,
    profile: SandboxProfile,
  ): { allowed: boolean; reason?: string };
  wrapCommand(
    command: string,
    args: readonly string[],
    profile: SandboxProfile,
  ): { command: string; args: readonly string[]; env: Record<string, string> };
}

export interface DoctorReport {
  readonly os: string;
  readonly activeBackend: SandboxBackendType;
  readonly isOsSandboxed: boolean;
  readonly message: string;
  readonly availableBackends: readonly SandboxBackendType[];
}
