import path from 'node:path';
import { IFileSystem, IProcessRunner, IClock } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { IProvider } from '../provider/types.js';
import { ToolRegistry } from '../tools/registry.js';
import {
  ParallelMode,
  AgentSpec,
  ParallelRunConfig,
  AgentResult,
  AgentRunStatus,
  ReviewerReport,
  ReconciliationResult,
} from './types.js';
import { ParallelGovernor } from './governor.js';
import { WorktreeManager } from './worktree-manager.js';
import { AttenuatedPolicyGate } from './attenuation.js';
import { ReviewerAgent } from './reviewer-agent.js';
import { ReconciliationEngine } from './reconciliation.js';

export interface ParallelOrchestratorOptions {
  readonly config: ParallelRunConfig;
  readonly fs: IFileSystem;
  readonly processRunner?: IProcessRunner | undefined;
  readonly clock: IClock;
  readonly eventBus: IEventBus;
  readonly provider: IProvider;
  readonly tools?: ToolRegistry | undefined;
  readonly approvalCallback?: ((diff: string, reasoning: string) => Promise<boolean>) | undefined;
}

export interface ParallelRunResult {
  readonly runId: string;
  readonly mode: ParallelMode;
  readonly agentResults: readonly AgentResult[];
  readonly reviewerReport: ReviewerReport;
  readonly reconciliation: ReconciliationResult;
  readonly totalCostUsd: number;
  readonly warning: string;
}

export class ParallelOrchestrator {
  private readonly config: ParallelRunConfig;
  private readonly fs: IFileSystem;
  private readonly processRunner?: IProcessRunner | undefined;
  private readonly clock: IClock;
  private readonly eventBus: IEventBus;
  private readonly provider: IProvider;
  private readonly tools: ToolRegistry;
  private readonly approvalCallback?:
    ((diff: string, reasoning: string) => Promise<boolean>) | undefined;

  private readonly governor: ParallelGovernor;
  private readonly worktreeManager: WorktreeManager;
  private readonly reviewerAgent: ReviewerAgent;
  private readonly reconciliationEngine: ReconciliationEngine;
  private readonly agentPolicyGates = new Map<string, AttenuatedPolicyGate>();

  constructor(options: ParallelOrchestratorOptions) {
    this.config = options.config;
    this.fs = options.fs;
    this.processRunner = options.processRunner;
    this.clock = options.clock;
    this.eventBus = options.eventBus;
    this.provider = options.provider;
    this.tools = options.tools ?? new ToolRegistry();
    this.approvalCallback = options.approvalCallback;

    this.governor = new ParallelGovernor(this.config);
    this.worktreeManager = new WorktreeManager({
      workspaceRoot: this.config.workspaceRoot,
      fs: this.fs,
      processRunner: this.processRunner,
      clock: this.clock,
    });
    this.reviewerAgent = new ReviewerAgent({
      fs: this.fs,
      processRunner: this.processRunner,
      testCommand: this.config.testCommand,
      lintCommand: this.config.lintCommand,
      typecheckCommand: this.config.typecheckCommand,
    });
    this.reconciliationEngine = new ReconciliationEngine({
      fs: this.fs,
      processRunner: this.processRunner,
      workspaceRoot: this.config.workspaceRoot,
      testCommand: this.config.testCommand,
      approvalCallback: this.approvalCallback,
    });
  }

  /**
   * Executes the full multi-agent parallel run.
   */
  async run(): Promise<ParallelRunResult> {
    const runId = `run-${this.clock.nowMs()}`;

    // 1. Preflight validation & warning
    const { warning } = this.governor.validatePreflight();

    await this.eventBus.publish({
      id: `parallel-start-${runId}`,
      type: 'parallel.started',
      timestamp: this.clock.nowMs(),
      actor: 'orchestrator',
      payload: {
        runId,
        mode: this.config.mode,
        agentCount: this.config.agents.length,
        maxConcurrency: this.config.maxConcurrency,
        totalCostCapUsd: this.config.totalCostCapUsd,
        costWarning: warning,
      },
    });

    const agentResults: AgentResult[] = [];

    try {
      // 2. Concurrency execution pool
      const poolQueue = [...this.config.agents];
      const executeNext = async (): Promise<void> => {
        while (poolQueue.length > 0) {
          const nextAgent = poolQueue.shift();
          if (!nextAgent) break;
          const finished = await this.executeAgent(runId, nextAgent);
          agentResults.push(finished);
        }
      };

      const workerCount = Math.min(this.config.maxConcurrency, this.config.agents.length);
      const workers = Array.from({ length: workerCount }, () => executeNext());
      await Promise.all(workers);

      // 3. Reviewer Agent (separate read-only context on all candidate worktrees)
      await this.eventBus.publish({
        id: `parallel-review-start-${runId}`,
        type: 'parallel.review_started',
        timestamp: this.clock.nowMs(),
        actor: 'orchestrator',
        payload: {
          runId,
          candidateIds: agentResults.map((r) => r.agentId),
          mode: this.config.mode,
        },
      });

      const reviewerReport = await this.reviewerAgent.review(agentResults, this.config.mode);

      await this.eventBus.publish({
        id: `parallel-review-comp-${runId}`,
        type: 'parallel.review_completed',
        timestamp: this.clock.nowMs(),
        actor: 'orchestrator',
        payload: {
          runId,
          winnerId: reviewerReport.winnerId,
          recommendedReconciliation: reviewerReport.recommendedReconciliation,
          rankingsSummary: reviewerReport.summary,
        },
      });

      // 4. Reconciliation & Merging
      await this.eventBus.publish({
        id: `parallel-reconcile-start-${runId}`,
        type: 'parallel.reconciliation_started',
        timestamp: this.clock.nowMs(),
        actor: 'orchestrator',
        payload: {
          runId,
          strategy:
            this.config.reconciliationPreference ?? reviewerReport.recommendedReconciliation,
          candidateIds: agentResults.map((r) => r.agentId),
        },
      });

      const reconciliation = await this.reconciliationEngine.reconcile(
        reviewerReport,
        agentResults,
        this.config.reconciliationPreference,
      );

      await this.eventBus.publish({
        id: `parallel-reconcile-comp-${runId}`,
        type: 'parallel.reconciliation_completed',
        timestamp: this.clock.nowMs(),
        actor: 'orchestrator',
        payload: {
          runId,
          success: reconciliation.conflicts.length === 0,
          reVerificationPassed: reconciliation.reVerificationPassed,
          conflictCount: reconciliation.conflicts.length,
          approved: reconciliation.approved,
        },
      });

      return {
        runId,
        mode: this.config.mode,
        agentResults,
        reviewerReport,
        reconciliation,
        totalCostUsd: this.governor.getTotalCost(),
        warning,
      };
    } finally {
      // 5. Clean up all worktrees and branches
      await this.worktreeManager.cleanupAll();

      for (const res of agentResults) {
        await this.eventBus.publish({
          id: `parallel-cleaned-${runId}-${res.agentId}`,
          type: 'parallel.worktree_cleaned',
          timestamp: this.clock.nowMs(),
          actor: 'orchestrator',
          payload: {
            runId,
            agentId: res.agentId,
            worktreePath: res.worktreePath,
          },
        });
      }
    }
  }

  /**
   * Executes a single agent in its isolated worktree.
   */
  private async executeAgent(runId: string, spec: AgentSpec): Promise<AgentResult> {
    const startTimeMs = this.clock.nowMs();
    let status: AgentRunStatus = 'running';
    let errorMessage: string | undefined;
    let turnCount = 0;
    const touchedFiles: string[] = [];

    // Create isolated worktree
    const worktree = await this.worktreeManager.createWorktree(spec.id);

    // Setup attenuated policy gate
    const policyGate = new AttenuatedPolicyGate({
      agentId: spec.id,
      worktreePath: worktree.path,
      declaredOwnership: spec.declaredOwnership,
    });
    this.agentPolicyGates.set(spec.id, policyGate);

    await this.eventBus.publish({
      id: `agent-start-${runId}-${spec.id}`,
      type: 'parallel.agent_started',
      timestamp: this.clock.nowMs(),
      actor: 'orchestrator',
      payload: {
        runId,
        agentId: spec.id,
        name: spec.name,
        model: spec.model,
        strategy: spec.strategy,
        worktreePath: worktree.path,
        budgetUsd: spec.budgetUsd,
        declaredOwnership: spec.declaredOwnership,
      },
    });

    try {
      // Simulate/run turns with provider
      turnCount++;
      const stream = this.provider.stream(
        [{ role: 'user', content: spec.prompt }],
        this.tools.getDefinitions(),
        { model: spec.model, maxTokens: 1024 },
      );

      let turnCost = 0.02; // Base estimated turn cost
      let _responseText = '';

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          _responseText += chunk.delta;
        } else if (chunk.type === 'usage') {
          const totalTokens = chunk.inputTokens + chunk.outputTokens;
          turnCost = (totalTokens / 1_000_000) * 3.0;
        }
      }

      // Check budget
      const budgetCheck = this.governor.recordAgentCost(spec.id, turnCost);
      if (!budgetCheck.canProceed) {
        status = 'budget_exhausted';
        errorMessage = budgetCheck.reason;
      }

      await this.eventBus.publish({
        id: `agent-prog-${runId}-${spec.id}-${turnCount}`,
        type: 'parallel.agent_progress',
        timestamp: this.clock.nowMs(),
        actor: 'orchestrator',
        payload: {
          runId,
          agentId: spec.id,
          turnIndex: turnCount,
          costUsd: this.governor.getAgentCost(spec.id),
          status,
          elapsedMs: this.clock.nowMs() - startTimeMs,
          testStatus: 'pending',
        },
      });

      if (status !== 'budget_exhausted') {
        status = 'completed';
      }
    } catch (err) {
      status = 'crashed';
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Inspect touched files and diff from worktree
    const diff = await this.computeWorktreeDiff(worktree.path, touchedFiles);

    // Run test verification in agent worktree
    let testStatus: 'passed' | 'failed' | 'untested' = 'untested';
    if (this.config.testCommand && this.processRunner && status === 'completed') {
      try {
        const parts = this.config.testCommand.split(' ');
        const bin = parts[0] ?? 'npm';
        const args = parts.slice(1);
        const testRes = await this.processRunner.run(bin, args, { cwd: worktree.path });
        testStatus = testRes.exitCode === 0 ? 'passed' : 'failed';
      } catch {
        testStatus = 'failed';
      }
    }

    const durationMs = this.clock.nowMs() - startTimeMs;
    const finalCost = this.governor.getAgentCost(spec.id);

    await this.eventBus.publish({
      id: `agent-comp-${runId}-${spec.id}`,
      type: 'parallel.agent_completed',
      timestamp: this.clock.nowMs(),
      actor: 'orchestrator',
      payload: {
        runId,
        agentId: spec.id,
        status,
        costUsd: finalCost,
        turns: turnCount,
        durationMs,
        testStatus,
        touchedFiles,
        error: errorMessage,
      },
    });

    return {
      agentId: spec.id,
      spec,
      status,
      worktreePath: worktree.path,
      costUsd: finalCost,
      turns: turnCount,
      durationMs,
      testStatus,
      touchedFiles,
      diff,
      error: errorMessage,
    };
  }

  /**
   * Scans for files that differ between the worktree and the user's workspaceRoot.
   */
  private async computeWorktreeDiff(
    worktreePath: string,
    outTouchedFiles: string[],
  ): Promise<string> {
    const diffLines: string[] = [];

    const scan = async (relativeDir = ''): Promise<void> => {
      const dirInWorktree = path.join(worktreePath, relativeDir);
      let entries: readonly string[];
      try {
        entries = await this.fs.readDir(dirInWorktree);
      } catch {
        return;
      }

      const ignored = new Set(['.git', '.forge', 'node_modules', 'dist']);

      for (const entry of entries) {
        if (ignored.has(entry)) continue;
        const relPath = relativeDir ? path.join(relativeDir, entry) : entry;
        const worktreeFile = path.join(worktreePath, relPath);
        const rootFile = path.join(this.config.workspaceRoot, relPath);

        try {
          const s = await this.fs.stat(worktreeFile);
          if (s.isDirectory) {
            await scan(relPath);
          } else {
            const rootExists = await this.fs.exists(rootFile);
            const worktreeContent = await this.fs.readFile(worktreeFile);
            if (!rootExists) {
              outTouchedFiles.push(relPath);
              diffLines.push(`+++ ${relPath} (new file)`);
            } else {
              const rootContent = await this.fs.readFile(rootFile);
              if (worktreeContent !== rootContent) {
                outTouchedFiles.push(relPath);
                diffLines.push(`--- a/${relPath}\n+++ b/${relPath}`);
              }
            }
          }
        } catch {
          // Skip
        }
      }
    };

    await scan();
    return diffLines.join('\n');
  }
}
