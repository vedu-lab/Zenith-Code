export interface SandboxEnvironment {
  readonly id: string;
  readonly isolatedPath: string;
  readonly allowedNetworkHosts: readonly string[];
  readonly resourceLimits: {
    readonly maxMemoryMb: number;
    readonly timeoutMs: number;
  };
}

export interface ISandboxAdapter {
  createSandbox(config: Partial<SandboxEnvironment>): Promise<SandboxEnvironment>;
  destroySandbox(id: string): Promise<void>;
  validatePath(sandbox: SandboxEnvironment, targetPath: string): boolean;
}

export class LocalWorkspaceSandbox implements ISandboxAdapter {
  constructor(private readonly workspaceRoot: string) {}

  async createSandbox(config: Partial<SandboxEnvironment>): Promise<SandboxEnvironment> {
    return {
      id: `sandbox-${Date.now()}`,
      isolatedPath: this.workspaceRoot,
      allowedNetworkHosts: config.allowedNetworkHosts ?? [],
      resourceLimits: {
        maxMemoryMb: config.resourceLimits?.maxMemoryMb ?? 512,
        timeoutMs: config.resourceLimits?.timeoutMs ?? 30000,
      },
    };
  }

  async destroySandbox(_id: string): Promise<void> {
    // Local workspace sandbox cleanup if needed
  }

  validatePath(_sandbox: SandboxEnvironment, targetPath: string): boolean {
    return (
      !targetPath.includes('..') &&
      !targetPath.startsWith('/etc') &&
      !targetPath.startsWith('C:\\Windows')
    );
  }
}
