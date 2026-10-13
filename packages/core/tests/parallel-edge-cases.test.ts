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
  ParallelGovernor,
  ErrorCode,
  CleanupRegistry,
  WorktreeManager,
  ReconciliationEngine,
  AgentResult,
  ReviewerReport,
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
        return { stdout: 'false\n', stderr: '', exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (command === 'npm' || command === 'pnpm' || command === 'vitest') {
      const exitCode = options?.cwd ? (this.testExitCodes.get(options.cwd) ?? 0) : 0;
      return {
        stdout: exitCode === 0 ? 'All tests passed' : 'Test suite failed',
        stderr: '',
        exitCode,
      };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

class FaultyProvider implements IProvider {
  readonly name = 'faulty-provider';
  shouldCrashAgentId?: string;

  async *stream(
    messages: readonly Message[],
    _tools: readonly ToolDefinition[],
    options?: ProviderStreamOptions,
  ): AsyncIterable<ProviderEvent> {
    if (this.shouldCrashAgentId && options?.model?.includes(this.shouldCrashAgentId)) {
      throw new Error(`Fatal unhandled crash inside agent ${this.shouldCrashAgentId}`);
    }

    yield { type: 'text_delta', delta: 'Candidate completed step.' };
    yield { type: 'usage', inputTokens: 400, outputTokens: 200 };
    yield { type: 'stop_reason', reason: 'end_turn' };
  }
}

describe('Parallel Agents Edge Cases & Failure Recovery', () => {
  let fs: MockFs;
  let runner: MockRunner;
  let eventBus: CoreEventBus;
  let clock: SystemClock;

  beforeEach(() => {
    fs = new MockFs();
    runner = new MockRunner();
    eventBus = new CoreEventBus();
    clock = new SystemClock();
    CleanupRegistry.getInstance().cleanupAll();
  });

  it('detects textual conflicts when multiple agents modify the same file with different content', async () => {
    const workspaceRoot = '/test/workspace';
    const filePath = 'src/service.ts';
    await fs.writeFile(`${workspaceRoot}/${filePath}`, 'original code');

    // Candidate 1 and Candidate 2 worktrees
    const cand1Worktree = `${workspaceRoot}/.forge/worktrees/agent-1`;
    const cand2Worktree = `${workspaceRoot}/.forge/worktrees/agent-2`;
    await fs.writeFile(`${cand1Worktree}/${filePath}`, 'version A from agent-1');
    await fs.writeFile(`${cand2Worktree}/${filePath}`, 'version B from agent-2');

    const candidates: AgentResult[] = [
      {
        agentId: 'agent-1',
        spec: {
          id: 'agent-1',
          name: 'Agent 1',
          model: 'm1',
          strategy: 's1',
          budgetUsd: 0.2,
          prompt: 'p',
        },
        status: 'completed',
        worktreePath: cand1Worktree,
        costUsd: 0.05,
        turns: 1,
        durationMs: 100,
        testStatus: 'passed',
        touchedFiles: [filePath],
        diff: '--- a/src/service.ts\n+++ b/src/service.ts\n+ version A',
      },
      {
        agentId: 'agent-2',
        spec: {
          id: 'agent-2',
          name: 'Agent 2',
          model: 'm2',
          strategy: 's2',
          budgetUsd: 0.2,
          prompt: 'p',
        },
        status: 'completed',
        worktreePath: cand2Worktree,
        costUsd: 0.05,
        turns: 1,
        durationMs: 100,
        testStatus: 'passed',
        touchedFiles: [filePath],
        diff: '--- a/src/service.ts\n+++ b/src/service.ts\n+ version B',
      },
    ];

    const report: ReviewerReport = {
      candidates: [],
      winnerId: 'agent-1',
      recommendedReconciliation: 'merge',
      summary: 'Both completed successfully',
      evidence: [],
    };

    const engine = new ReconciliationEngine({
      fs,
      processRunner: runner,
      workspaceRoot,
      testCommand: 'npm test',
      approvalCallback: async () => true,
    });

    const result = await engine.reconcile(report, candidates, 'merge');

    // Must detect textual conflict
    expect(result.conflicts.length).toBeGreaterThan(0);
    const textConflict = result.conflicts.find((c) => c.type === 'textual');
    expect(textConflict).toBeDefined();
    expect(textConflict?.filePath).toBe(filePath);
  });

  it('detects semantic conflicts when merged code fails test verification in staging', async () => {
    const workspaceRoot = '/test/workspace';
    await fs.writeFile(`${workspaceRoot}/src/a.ts`, 'code a');
    await fs.writeFile(`${workspaceRoot}/src/b.ts`, 'code b');

    const cand1Worktree = `${workspaceRoot}/.forge/worktrees/agent-1`;
    const cand2Worktree = `${workspaceRoot}/.forge/worktrees/agent-2`;
    await fs.writeFile(`${cand1Worktree}/src/a.ts`, 'modified a');
    await fs.writeFile(`${cand2Worktree}/src/b.ts`, 'modified b');

    // Both pass tests individually in their own worktrees
    runner.testExitCodes.set(cand1Worktree, 0);
    runner.testExitCodes.set(cand2Worktree, 0);

    // BUT merged staging tree fails tests! (Semantic break between modified a and modified b)
    const stagingDir = `${workspaceRoot}/.forge/merge-verify-stage`;
    runner.testExitCodes.set(stagingDir, 1); // Exit code 1 -> semantic break!

    const candidates: AgentResult[] = [
      {
        agentId: 'agent-1',
        spec: {
          id: 'agent-1',
          name: 'Agent 1',
          model: 'm1',
          strategy: 's1',
          budgetUsd: 0.2,
          prompt: 'p',
        },
        status: 'completed',
        worktreePath: cand1Worktree,
        costUsd: 0.05,
        turns: 1,
        durationMs: 100,
        testStatus: 'passed',
        touchedFiles: ['src/a.ts'],
        diff: '+ modified a',
      },
      {
        agentId: 'agent-2',
        spec: {
          id: 'agent-2',
          name: 'Agent 2',
          model: 'm2',
          strategy: 's2',
          budgetUsd: 0.2,
          prompt: 'p',
        },
        status: 'completed',
        worktreePath: cand2Worktree,
        costUsd: 0.05,
        turns: 1,
        durationMs: 100,
        testStatus: 'passed',
        touchedFiles: ['src/b.ts'],
        diff: '+ modified b',
      },
    ];

    const report: ReviewerReport = {
      candidates: [],
      winnerId: 'agent-1',
      recommendedReconciliation: 'merge',
      summary: 'Merge candidate evaluation',
      evidence: [],
    };

    const engine = new ReconciliationEngine({
      fs,
      processRunner: runner,
      workspaceRoot,
      testCommand: 'npm test',
      approvalCallback: async () => true,
    });

    const result = await engine.reconcile(report, candidates, 'merge');

    // Must flag semantic conflict and failed re-verification!
    expect(result.reVerificationPassed).toBe(false);
    const semanticConflict = result.conflicts.find((c) => c.type === 'semantic');
    expect(semanticConflict).toBeDefined();
    expect(semanticConflict?.description).toContain('Semantic conflict');
  });

  it('handles a crashed agent gracefully without taking down other agents or leaving worktrees behind', async () => {
    const workspaceRoot = '/test/workspace';
    await fs.writeFile(`${workspaceRoot}/src/app.ts`, 'export const app = 1;');

    const provider = new FaultyProvider();
    provider.shouldCrashAgentId = 'agent-crasher';

    const config: ParallelRunConfig = {
      mode: 'compete',
      workspaceRoot,
      totalCostCapUsd: 1.0,
      maxConcurrency: 2,
      testCommand: 'npm test',
      agents: [
        {
          id: 'agent-stable',
          name: 'Stable Agent',
          model: 'claude-3-5-sonnet',
          strategy: 'standard',
          budgetUsd: 0.3,
          prompt: 'Solve task',
        },
        {
          id: 'agent-crasher',
          name: 'Crashing Agent',
          model: 'claude-agent-crasher',
          strategy: 'experimental',
          budgetUsd: 0.3,
          prompt: 'Crash task',
        },
      ],
    };

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

    // Check individual statuses
    const stable = result.agentResults.find((r) => r.agentId === 'agent-stable');
    const crasher = result.agentResults.find((r) => r.agentId === 'agent-crasher');

    expect(stable).toBeDefined();
    expect(stable?.status).toBe('completed');

    expect(crasher).toBeDefined();
    expect(crasher?.status).toBe('crashed');
    expect(crasher?.error).toContain('Fatal unhandled crash');

    // Reviewer should pick stable agent
    expect(result.reviewerReport.winnerId).toBe('agent-stable');

    // Worktrees must be cleaned up
    const worktreeExists = await fs.exists(`${workspaceRoot}/.forge/worktrees/agent-crasher`);
    expect(worktreeExists).toBe(false);
  });

  it('stops an agent when its individual budget is exhausted while other agents continue', async () => {
    const workspaceRoot = '/test/workspace';
    await fs.writeFile(`${workspaceRoot}/src/index.ts`, 'code');

    const config: ParallelRunConfig = {
      mode: 'compete',
      workspaceRoot,
      totalCostCapUsd: 1.0,
      maxConcurrency: 2,
      agents: [
        {
          id: 'agent-low-budget',
          name: 'Budget Constrained',
          model: 'claude-3-5-haiku',
          strategy: 'minimal',
          budgetUsd: 0.00001, // Near zero budget: guaranteed exhaustion on turn 1
          prompt: 'Task',
        },
        {
          id: 'agent-normal-budget',
          name: 'Healthy Budget',
          model: 'claude-3-5-sonnet',
          strategy: 'full',
          budgetUsd: 0.5,
          prompt: 'Task',
        },
      ],
    };

    class BigCostProvider implements IProvider {
      readonly name = 'big-cost-provider';
      async *stream(): AsyncIterable<ProviderEvent> {
        yield { type: 'text_delta', delta: 'turn' };
        yield { type: 'usage', inputTokens: 100_000, outputTokens: 50_000 }; // ~$0.45 cost
        yield { type: 'stop_reason', reason: 'end_turn' };
      }
    }

    const orchestrator = new ParallelOrchestrator({
      config,
      fs,
      processRunner: runner,
      clock,
      eventBus,
      provider: new BigCostProvider(),
      approvalCallback: async () => true,
    });

    const result = await orchestrator.run();

    const lowBudgetAgent = result.agentResults.find((r) => r.agentId === 'agent-low-budget');
    const normalBudgetAgent = result.agentResults.find((r) => r.agentId === 'agent-normal-budget');

    expect(lowBudgetAgent?.status).toBe('budget_exhausted');
    expect(lowBudgetAgent?.error).toContain('reached allocated budget');
    expect(normalBudgetAgent?.status).toBe('completed');
  });

  it('enforces total cost cap and concurrency cap with preflight warning', () => {
    const governorExceedConcurrency = new ParallelGovernor({
      mode: 'compete',
      workspaceRoot: '/test',
      totalCostCapUsd: 1.0,
      maxConcurrency: 2,
      agents: [
        { id: '1', name: '1', model: 'm', strategy: 's', budgetUsd: 0.1, prompt: 'p' },
        { id: '2', name: '2', model: 'm', strategy: 's', budgetUsd: 0.1, prompt: 'p' },
        { id: '3', name: '3', model: 'm', strategy: 's', budgetUsd: 0.1, prompt: 'p' },
      ],
    });

    expect(() => governorExceedConcurrency.validatePreflight()).toThrowError(
      expect.objectContaining({
        code: ErrorCode.PARALLEL_CONCURRENCY_EXCEEDED,
      }),
    );

    const governorExceedBudget = new ParallelGovernor({
      mode: 'compete',
      workspaceRoot: '/test',
      totalCostCapUsd: 0.5,
      maxConcurrency: 4,
      agents: [
        { id: '1', name: '1', model: 'm', strategy: 's', budgetUsd: 0.4, prompt: 'p' },
        { id: '2', name: '2', model: 'm', strategy: 's', budgetUsd: 0.4, prompt: 'p' },
      ],
    });

    expect(() => governorExceedBudget.validatePreflight()).toThrowError(
      expect.objectContaining({
        code: ErrorCode.PARALLEL_BUDGET_EXCEEDED,
      }),
    );

    const validGovernor = new ParallelGovernor({
      mode: 'compete',
      workspaceRoot: '/test',
      totalCostCapUsd: 1.0,
      maxConcurrency: 2,
      agents: [
        { id: '1', name: '1', model: 'm', strategy: 's', budgetUsd: 0.2, prompt: 'p' },
        { id: '2', name: '2', model: 'm', strategy: 's', budgetUsd: 0.2, prompt: 'p' },
      ],
    });

    const { warning } = validGovernor.validatePreflight();
    expect(warning).toContain(
      'Warning: Running 2 parallel agents costs approximately 2 times as much',
    );
  });

  it('cleans up all worktrees and branches on interrupt / Ctrl+C via CleanupRegistry', async () => {
    const workspaceRoot = '/test/workspace';
    const registry = CleanupRegistry.getInstance();

    const manager = new WorktreeManager({
      workspaceRoot,
      fs,
      processRunner: runner,
      clock,
      cleanupRegistry: registry,
    });

    const wt1 = await manager.createWorktree('agent-interrupt-1');
    const wt2 = await manager.createWorktree('agent-interrupt-2');

    expect(await fs.exists(wt1.path)).toBe(true);
    expect(await fs.exists(wt2.path)).toBe(true);
    expect(registry.getRegisteredIds().length).toBeGreaterThanOrEqual(2);

    // Simulate SIGINT / Ctrl+C
    await registry.cleanupAll();

    expect(registry.getRegisteredIds().length).toBe(0);
    expect(await fs.exists(wt1.path)).toBe(false);
    expect(await fs.exists(wt2.path)).toBe(false);
  });
});
