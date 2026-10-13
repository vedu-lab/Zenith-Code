import path from 'node:path';
import { IFileSystem, IProcessRunner } from '../interfaces/index.js';
import {
  AgentResult,
  CandidateEvaluation,
  ReviewerReport,
  ReviewScore,
  ParallelMode,
} from './types.js';

export interface ReviewerAgentOptions {
  readonly fs: IFileSystem;
  readonly processRunner?: IProcessRunner | undefined;
  readonly testCommand?: string | undefined;
  readonly lintCommand?: string | undefined;
  readonly typecheckCommand?: string | undefined;
}

export class ReviewerAgent {
  private readonly fs: IFileSystem;
  private readonly processRunner?: IProcessRunner | undefined;
  private readonly testCommand?: string | undefined;
  private readonly lintCommand?: string | undefined;
  private readonly typecheckCommand?: string | undefined;

  constructor(options: ReviewerAgentOptions) {
    this.fs = options.fs;
    this.processRunner = options.processRunner;
    this.testCommand = options.testCommand;
    this.lintCommand = options.lintCommand;
    this.typecheckCommand = options.typecheckCommand;
  }

  /**
   * Reviews all completed candidate branches in separate read-only contexts,
   * runs test verification, scores each across 4 dimensions, and ranks them.
   */
  async review(candidates: readonly AgentResult[], mode: ParallelMode): Promise<ReviewerReport> {
    const evaluations: CandidateEvaluation[] = [];

    for (const candidate of candidates) {
      if (candidate.status !== 'completed') {
        evaluations.push({
          agentId: candidate.agentId,
          rank: candidates.length,
          score: { correctness: 0, scope: 0, style: 0, security: 0, total: 0 },
          testPassed: false,
          testOutput: candidate.error ?? `Agent ended with status: ${candidate.status}`,
          scopeViolations: [],
          pros: [],
          cons: [`Agent failed or was aborted: ${candidate.status}`],
        });
        continue;
      }

      const evalResult = await this.evaluateCandidate(candidate, mode);
      evaluations.push(evalResult);
    }

    // Rank descending by total score, then by test pass status
    evaluations.sort((a, b) => {
      if (a.testPassed && !b.testPassed) return -1;
      if (!a.testPassed && b.testPassed) return 1;
      return b.score.total - a.score.total;
    });

    // Assign rank numbers 1..N
    const ranked: CandidateEvaluation[] = evaluations.map((e, idx) => ({
      ...e,
      rank: idx + 1,
    }));

    const passingCandidates = ranked.filter((c) => c.testPassed);
    const winner = passingCandidates[0];

    // Determine reconciliation recommendation
    let recommendation: 'pick' | 'cherry_pick' | 'merge' = 'pick';
    if (mode === 'collaborate') {
      recommendation = 'merge';
    } else if (passingCandidates.length > 1) {
      // Compete mode: Check if changes can be cherry-picked or if a single winner should be picked
      const topScore = passingCandidates[0]?.score.total ?? 0;
      const runnerUpScore = passingCandidates[1]?.score.total ?? 0;
      if (Math.abs(topScore - runnerUpScore) < 5) {
        recommendation = 'cherry_pick';
      } else {
        recommendation = 'pick';
      }
    }

    const summary = this.buildSummary(ranked, winner?.agentId, recommendation, mode);
    const evidence = ranked.map(
      (c) =>
        `Agent '${c.agentId}' (Rank ${c.rank}): Total ${c.score.total}/100 [Correctness: ${c.score.correctness}, Scope: ${c.score.scope}, Style: ${c.score.style}, Security: ${c.score.security}] - Tests: ${c.testPassed ? 'PASSED' : 'FAILED'}`,
    );

    return {
      candidates: ranked,
      winnerId: winner?.agentId,
      recommendedReconciliation: recommendation,
      summary,
      evidence,
    };
  }

  private async evaluateCandidate(
    candidate: AgentResult,
    mode: ParallelMode,
  ): Promise<CandidateEvaluation> {
    const pros: string[] = [];
    const cons: string[] = [];
    const scopeViolations: string[] = [];

    // 1. Correctness: Run test command in candidate's worktree
    let testPassed = true;
    let testOutput = 'Tests passed or no test command configured';
    let correctnessScore = 100;

    if (this.testCommand && this.processRunner) {
      try {
        const parts = this.testCommand.split(' ');
        const bin = parts[0] ?? 'npm';
        const args = parts.slice(1);
        const res = await this.processRunner.run(bin, args, { cwd: candidate.worktreePath });
        testOutput = res.stdout || res.stderr;
        if (res.exitCode !== 0) {
          testPassed = false;
          correctnessScore = 0;
          cons.push(`Test command '${this.testCommand}' failed with exit code ${res.exitCode}`);
        } else {
          pros.push(`Test command '${this.testCommand}' passed cleanly`);
        }
      } catch (err) {
        testPassed = false;
        correctnessScore = 0;
        testOutput = err instanceof Error ? err.message : String(err);
        cons.push(`Failed to run test command: ${testOutput}`);
      }
    } else if (candidate.testStatus === 'failed') {
      testPassed = false;
      correctnessScore = 0;
      cons.push('Candidate test status was marked failed');
    }

    // Check touched files on disk
    for (const f of candidate.touchedFiles) {
      const full = path.join(candidate.worktreePath, f);
      try {
        const exists = await this.fs.exists(full);
        if (!exists) {
          cons.push(`Reported touched file '${f}' not found on disk.`);
        }
      } catch {
        // Skip
      }
    }

    // 1b. Typecheck command if configured
    if (this.typecheckCommand && this.processRunner) {
      try {
        const parts = this.typecheckCommand.split(' ');
        const bin = parts[0] ?? 'npm';
        const args = parts.slice(1);
        const res = await this.processRunner.run(bin, args, { cwd: candidate.worktreePath });
        if (res.exitCode !== 0) {
          correctnessScore = Math.min(correctnessScore, 40);
          cons.push(`Typecheck command '${this.typecheckCommand}' failed`);
        }
      } catch {
        // Skip
      }
    }

    // 2. Scope Creep: Check touched files against declared ownership or reasonable scope
    let scopeScore = 100;
    if (mode === 'collaborate' && candidate.spec.declaredOwnership) {
      for (const file of candidate.touchedFiles) {
        const matchesOwnership = candidate.spec.declaredOwnership.some((p) =>
          file.includes(p.replace(/\*+/g, '')),
        );
        if (!matchesOwnership) {
          scopeViolations.push(file);
          scopeScore = Math.max(0, scopeScore - 30);
          cons.push(`Scope creep: Modified unowned file '${file}'`);
        }
      }
    } else {
      // In compete mode, penalize touching excessive files
      if (candidate.touchedFiles.length > 5) {
        scopeScore = Math.max(40, scopeScore - (candidate.touchedFiles.length - 5) * 10);
        cons.push(`Broad touch count: Modified ${candidate.touchedFiles.length} files`);
      } else {
        pros.push(`Focused diff: Touched ${candidate.touchedFiles.length} files`);
      }
    }

    // 3. Style / Cleanliness: Check diff patterns and optional lint command
    let styleScore = 100;
    if (this.lintCommand && this.processRunner) {
      try {
        const parts = this.lintCommand.split(' ');
        const bin = parts[0] ?? 'npm';
        const args = parts.slice(1);
        const res = await this.processRunner.run(bin, args, { cwd: candidate.worktreePath });
        if (res.exitCode !== 0) {
          styleScore -= 20;
          cons.push(`Lint command '${this.lintCommand}' reported style/lint issues`);
        }
      } catch {
        // Skip
      }
    }
    if (
      candidate.diff.includes('console.log(') &&
      !candidate.diff.includes('console.log(// allowed')
    ) {
      styleScore -= 15;
      cons.push('Diff introduces console.log statements');
    }
    if (candidate.diff.includes('debugger;')) {
      styleScore -= 30;
      cons.push('Diff contains debugger statement');
    }
    if (styleScore >= 90) {
      pros.push('Clean code style without residual debug logs');
    }

    // 4. Security Check: Search for secrets, eval, risky execution
    let securityScore = 100;
    const dangerousPatterns = [
      /eval\(/,
      /new Function\(/,
      /child_process\.exec\(/,
      /BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY/,
      /(sk_live|ghp_|glpat-|xoxb-)[a-zA-Z0-9_-]{10,}/,
    ];

    for (const pat of dangerousPatterns) {
      if (pat.test(candidate.diff)) {
        securityScore = 20;
        cons.push(`Security warning: Diff matches suspicious pattern: ${pat.source}`);
        break;
      }
    }
    if (securityScore === 100) {
      pros.push('No obvious security risks or leaked secrets detected in diff');
    }

    // Weighted composite: Correctness (45%), Scope (25%), Style (15%), Security (15%)
    const total = Math.round(
      correctnessScore * 0.45 + scopeScore * 0.25 + styleScore * 0.15 + securityScore * 0.15,
    );

    const score: ReviewScore = {
      correctness: correctnessScore,
      scope: scopeScore,
      style: styleScore,
      security: securityScore,
      total,
    };

    return {
      agentId: candidate.agentId,
      rank: 0, // Assigned after sorting
      score,
      testPassed,
      testOutput,
      scopeViolations,
      pros,
      cons,
    };
  }

  private buildSummary(
    ranked: readonly CandidateEvaluation[],
    winnerId: string | undefined,
    recommendation: 'pick' | 'cherry_pick' | 'merge',
    mode: ParallelMode,
  ): string {
    const lines: string[] = [
      `### Reviewer Agent Report (${mode.toUpperCase()} Mode)`,
      winnerId
        ? `Winner Selected: Agent '${winnerId}' (Rank 1)`
        : 'No passing candidate passed all verifications.',
      `Recommended Reconciliation Strategy: ${recommendation.toUpperCase()}`,
      '',
      'Ranked Candidates:',
    ];

    for (const c of ranked) {
      lines.push(
        `  ${c.rank}. [Agent: ${c.agentId}] Score: ${c.score.total}/100 | Tests: ${c.testPassed ? 'PASS' : 'FAIL'} | Scope Violations: ${c.scopeViolations.length}`,
      );
      for (const p of c.pros) {
        lines.push(`     + ${p}`);
      }
      for (const con of c.cons) {
        lines.push(`     - ${con}`);
      }
    }

    return lines.join('\n');
  }
}
