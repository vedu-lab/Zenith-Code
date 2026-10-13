import { describe, it, expect, beforeEach } from 'vitest';
import {
  CoreEventBus,
  SystemClock,
  IFileSystem,
  IProcessRunner,
  FileStatResult,
  ProcessRunOptions,
  ProcessRunResult,
  IProvider,
  Message,
  ToolDefinition,
  ProviderStreamOptions,
  ProviderEvent,
  ParallelOrchestrator,
  ParallelRunConfig,
  AttenuatedPolicyGate,
  CleanupRegistry,
} from '../src/index.js';

class MockFs implements IFileSystem {
  readonly files = new Map<string, string>();

  async readFile(filePath: string): Promise<string> {
    const val = this.files.get(filePath);
    if (val === undefined) {
      throw new Error(`File not found: ${filePath}`);
    }
    return val;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    if (this.files.has(filePath)) return true;
    for (const k of this.files.keys()) {
      if (k.startsWith(filePath)) return true;
    }
    return false;
  }

  async mkdir(): Promise<void> {}

  async readDir(dirPath: string): Promise<readonly string[]> {
    const results: string[] = [];
    for (const k of this.files.keys()) {
      if (k.startsWith(dirPath)) {
        const sub = k.slice(dirPath.length).replace(/^[/\\]/, '');
        const seg = sub.split(/[/\\]/)[0];
        if (seg && !results.includes(seg)) {
          results.push(seg);
        }
      }
    }
    return results;
  }

  async stat(_filePath: string): Promise<FileStatResult> {
    return { size: 100, isDirectory: false, mtimeMs: 1000 };
  }

  preserveLineEndings(_orig: string, newContent: string): string {
    return newContent;
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }

  async rmdir(dirPath: string): Promise<void> {
    for (const k of Array.from(this.files.keys())) {
      if (k.startsWith(dirPath)) {
        this.files.delete(k);
      }
    }
  }

  async copyFile(src: string, dst: string): Promise<void> {
    const c = this.files.get(src);
    if (c !== undefined) {
      this.files.set(dst, c);
    }
  }
}

class MockRunner implements IProcessRunner {
  commandsRun: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
  testExitCodes: Map<string, number> = new Map();

  async run(
    command: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessRunResult> {
    this.commandsRun.push({ command, args, cwd: options?.cwd });

    if (command === 'git') {
      if (args[0] === 'rev-parse') {
        return { stdout: 'false\n', stderr: '', exitCode: 1 }; // Fall back to sandbox copy
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (command === 'npm' || command === 'pnpm' || command === 'vitest') {
      // Check if cwd has specific test exit code
      const exitCode = options?.cwd ? (this.testExitCodes.get(options.cwd) ?? 0) : 0;
      return {
        stdout: exitCode === 0 ? 'All tests passed' : '1 test failed',
        stderr: '',
        exitCode,
      };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

class MockProvider implements IProvider {
  readonly name = 'mock-provider';

  async *stream(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
    _options?: ProviderStreamOptions,
  ): AsyncIterable<ProviderEvent> {
    yield { type: 'text_delta', delta: 'Agent completed code changes.' };
    yield { type: 'usage', inputTokens: 500, outputTokens: 200 };
    yield { type: 'stop_reason', reason: 'end_turn' };
  }
}

describe('Parallel Agents Orchestrator', () => {
  let fs: MockFs;
  let runner: MockRunner;
  let eventBus: CoreEventBus;
  let clock: SystemClock;
  let provider: MockProvider;

  beforeEach(() => {
    fs = new MockFs();
    runner = new MockRunner();
    eventBus = new CoreEventBus();
    clock = new SystemClock();
    provider = new MockProvider();
    CleanupRegistry.getInstance().cleanupAll();
  });

  it('runs two agents in isolation in compete mode, reviewer picks winner, re-verifies, and leaves user tree clean until approval', async () => {
    const workspaceRoot = '/test/workspace';
    const originalFile = `${workspaceRoot}/src/calculator.ts`;
    const originalContent = 'export function add(a: number, b: number) { return a - b; } // Buggy';
    await fs.writeFile(originalFile, originalContent);

    // Setup candidate worktree paths
    const agent1Worktree = `${workspaceRoot}/.forge/worktrees/agent-1`;
    const agent2Worktree = `${workspaceRoot}/.forge/worktrees/agent-2`;

    // Configure test outcomes: agent-1 passes tests, agent-2 fails tests
    runner.testExitCodes.set(agent1Worktree, 0); // Pass
    runner.testExitCodes.set(agent2Worktree, 1); // Fail

    const config: ParallelRunConfig = {
      mode: 'compete',
      workspaceRoot,
      totalCostCapUsd: 1.0,
      maxConcurrency: 2,
      testCommand: 'npm test',
      agents: [
        {
          id: 'agent-1',
          name: 'Fast Fixer',
          model: 'claude-3-5-haiku',
          strategy: 'minimal_patch',
          budgetUsd: 0.2,
          prompt: 'Fix add function in calculator.ts',
        },
        {
          id: 'agent-2',
          name: 'Deep Refactorer',
          model: 'claude-3-5-sonnet',
          strategy: 'refactor',
          budgetUsd: 0.3,
          prompt: 'Refactor calculator.ts',
        },
      ],
    };

    let userApproved = false;
    let presentedDiff = '';

    const orchestrator = new ParallelOrchestrator({
      config,
      fs,
      processRunner: runner,
      clock,
      eventBus,
      provider,
      approvalCallback: async (diff) => {
        presentedDiff = diff;
        // User rejects on first attempt
        return userApproved;
      },
    });

    // 1. Initial run with user rejection: Working tree must stay completely clean!
    const resultRejected = await orchestrator.run();

    expect(resultRejected.mode).toBe('compete');
    expect(resultRejected.agentResults.length).toBe(2);
    expect(resultRejected.reviewerReport.winnerId).toBe('agent-1'); // Picked passing agent
    expect(resultRejected.reviewerReport.recommendedReconciliation).toBe('pick');
    expect(resultRejected.reconciliation.approved).toBe(false);
    expect(presentedDiff).toBeDefined();

    // User working tree must NOT have been modified!
    const fileAfterReject = await fs.readFile(originalFile);
    expect(fileAfterReject).toBe(originalContent);

    // 2. Second run where user approves: Changes are safely applied to user working tree!
    userApproved = true;
    const orchestratorApproved = new ParallelOrchestrator({
      config,
      fs,
      processRunner: runner,
      clock,
      eventBus,
      provider,
      approvalCallback: async () => true,
    });

    // Simulate agent-1 writing correct solution into its worktree during run
    const resultApproved = await orchestratorApproved.run();

    expect(resultApproved.reviewerReport.winnerId).toBe('agent-1');
    expect(resultApproved.reconciliation.approved).toBe(true);
    expect(resultApproved.reconciliation.reVerificationPassed).toBe(true);
  });

  it('runs two agents in collaborate mode with declared disjoint file ownership and merges results', async () => {
    const workspaceRoot = '/test/workspace';
    const authFile = `${workspaceRoot}/src/auth/login.ts`;
    const billingFile = `${workspaceRoot}/src/billing/invoice.ts`;
    await fs.writeFile(authFile, 'export function login() {}');
    await fs.writeFile(billingFile, 'export function invoice() {}');

    const config: ParallelRunConfig = {
      mode: 'collaborate',
      workspaceRoot,
      totalCostCapUsd: 1.0,
      maxConcurrency: 2,
      testCommand: 'npm test',
      agents: [
        {
          id: 'agent-auth',
          name: 'Auth Specialist',
          model: 'claude-3-5-sonnet',
          strategy: 'security_first',
          budgetUsd: 0.25,
          prompt: 'Add 2FA to auth/login.ts',
          declaredOwnership: ['src/auth/**'],
        },
        {
          id: 'agent-billing',
          name: 'Billing Specialist',
          model: 'claude-3-5-haiku',
          strategy: 'fast_patch',
          budgetUsd: 0.25,
          prompt: 'Add tax calculation to billing/invoice.ts',
          declaredOwnership: ['src/billing/**'],
        },
      ],
    };

    // Both pass tests
    const authWorktree = `${workspaceRoot}/.forge/worktrees/agent-auth`;
    const billingWorktree = `${workspaceRoot}/.forge/worktrees/agent-billing`;
    runner.testExitCodes.set(authWorktree, 0);
    runner.testExitCodes.set(billingWorktree, 0);

    const orchestrator = new ParallelOrchestrator({
      config,
      fs,
      processRunner: runner,
      clock,
      eventBus,
      provider,
      approvalCallback: async () => true,
    });

    const result = await orchestrator.run();

    expect(result.mode).toBe('collaborate');
    expect(result.reviewerReport.recommendedReconciliation).toBe('merge');
    expect(result.reconciliation.strategyUsed).toBe('merge');
    expect(result.reconciliation.approved).toBe(true);
    expect(result.reconciliation.conflicts.length).toBe(0);
  });

  it('attenuated policy gate enforces collaborate mode declared ownership and worktree containment', async () => {
    const worktreePath = '/test/workspace/.forge/worktrees/agent-1';

    const gate = new AttenuatedPolicyGate({
      agentId: 'agent-1',
      worktreePath,
      declaredOwnership: ['src/auth/**'],
    });

    // 1. Authorized file write inside declared ownership
    const allowDecision = await gate.check({
      toolName: 'write_file',
      action: 'fs:write',
      target: 'src/auth/token.ts',
      parameters: { path: `${worktreePath}/src/auth/token.ts`, content: 'export const token = 1;' },
    });
    expect(allowDecision.result).toBe('allow');

    // 2. Denied write: File outside declared ownership
    const denyOwnership = await gate.check({
      toolName: 'write_file',
      action: 'fs:write',
      target: 'src/billing/payment.ts',
      parameters: {
        path: `${worktreePath}/src/billing/payment.ts`,
        content: 'export const pay = 2;',
      },
    });
    expect(denyOwnership.result).toBe('deny');
    expect(denyOwnership.reason).toContain('does not own file');

    // 3. Denied write: Path traversal escape outside worktree
    const denyEscape = await gate.check({
      toolName: 'write_file',
      action: 'fs:write',
      target: '../../secrets.json',
      parameters: { path: `${worktreePath}/../../secrets.json`, content: '{}' },
    });
    expect(denyEscape.result).toBe('deny');
    expect(denyEscape.reason).toContain('escapes agent worktree root');

    // 4. Denied shell: Directory change outside worktree
    const denyShell = await gate.check({
      toolName: 'bash',
      action: 'exec:command',
      target: 'bash',
      parameters: { command: 'cd .. && rm -rf *' },
    });
    expect(denyShell.result).toBe('deny');
    expect(denyShell.reason).toContain('attempts to change directory outside worktree');
  });
});
