import { IProcessRunner, IFileSystem, IClock } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import {
  VerificationStage,
  VerificationResult,
  EvidenceRecord,
  FakeVerificationFinding,
} from './types.js';
import { EvidenceCollector } from './evidence.js';
import {
  FakeVerificationDetector,
  FileChangeRecord,
  TestExecutionRecord,
} from './fake-detection.js';
import { VerifierAgent } from './verifier-agent.js';

export interface DoneGateOptions {
  readonly maxAttempts?: number | undefined; // default 3
  readonly typecheckCommand?: string | undefined;
  readonly lintCommand?: string | undefined;
  readonly testCommand?: string | undefined;
  readonly smokeCommand?: string | undefined;
  readonly isBugFix?: boolean | undefined;
  readonly tddBaselineFailed?: boolean | undefined;
  readonly verifierAgent?: VerifierAgent | undefined;
}

export class DoneGate {
  private currentAttempt: number = 0;
  private readonly maxAttempts: number;

  constructor(
    private readonly runner: IProcessRunner,
    private readonly fs: IFileSystem,
    private readonly clock: IClock,
    private readonly eventBus: IEventBus,
    private readonly evidenceCollector: EvidenceCollector,
    private readonly options: DoneGateOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async verify(
    changedFiles: readonly FileChangeRecord[],
    testHistory: readonly TestExecutionRecord[],
  ): Promise<VerificationResult> {
    this.currentAttempt++;

    const changedPaths = changedFiles.map((c) => c.path);

    await this.eventBus.publish({
      id: `verif-start-${this.clock.nowMs()}`,
      type: 'verification.started',
      timestamp: this.clock.nowMs(),
      actor: 'system',
      payload: {
        attempt: this.currentAttempt,
        maxAttempts: this.maxAttempts,
        stage: 're_read',
        changedFiles: changedPaths,
      },
    });

    // 1. STAGE 1 (Cheapest): Re-read changes & basic filesystem check
    const reReadResult = await this.verifyReReadStage(changedFiles);
    if (!reReadResult.passed) {
      return this.handleStageFailure(
        're_read',
        reReadResult.error ?? 'Re-read verification failed',
      );
    }

    // 2. STAGE 2: Typecheck & Lint
    if (this.options.typecheckCommand || this.options.lintCommand) {
      const typecheckResult = await this.verifyTypecheckStage();
      if (!typecheckResult.passed) {
        return this.handleStageFailure(
          'typecheck_lint',
          typecheckResult.error ?? 'Typecheck/lint failed',
        );
      }
    }

    // 3. STAGE 3: Relevant Tests & Fake Verification Detection
    const testStageResult = await this.verifyTestStage(changedFiles, testHistory);
    if (!testStageResult.passed) {
      return this.handleStageFailure(
        'existing_tests',
        testStageResult.error ?? 'Test verification failed',
        testStageResult.fakeFindings,
      );
    }

    // 4. STAGE 4: TDD Regression Loop (for bug fixes)
    if (this.options.isBugFix) {
      const tddResult = this.verifyTddStage();
      if (!tddResult.passed) {
        return this.handleStageFailure(
          'tdd_regression',
          tddResult.error ?? 'Bug fix TDD regression loop not satisfied',
        );
      }
    }

    // 5. STAGE 5: Smoke command for behavioral claims
    if (this.options.smokeCommand) {
      const smokeResult = await this.verifySmokeStage();
      if (!smokeResult.passed) {
        return this.handleStageFailure('smoke_command', smokeResult.error ?? 'Smoke test failed');
      }
    }

    // 6. Optional Verifier Agent (read-only context trying to break the diff)
    if (this.options.verifierAgent) {
      const verifierResult = await this.options.verifierAgent.verifyDiff(changedFiles);
      if (!verifierResult.approved) {
        return this.handleStageFailure(
          'existing_tests',
          `Verifier agent rejected changes: ${verifierResult.critique}`,
        );
      }
    }

    // All verification stages passed!
    await this.eventBus.publish({
      id: `verif-comp-${this.clock.nowMs()}`,
      type: 'verification.completed',
      timestamp: this.clock.nowMs(),
      actor: 'system',
      payload: {
        attempt: this.currentAttempt,
        success: true,
        stage: 'smoke_command',
        evidence: { totalRecords: this.evidenceCollector.getRecords().length },
      },
    });

    return {
      passed: true,
      stage: 'smoke_command',
      attempt: this.currentAttempt,
      evidence: this.evidenceCollector.getRecords(),
      fakeFindings: [],
    };
  }

  private async verifyReReadStage(
    changedFiles: readonly FileChangeRecord[],
  ): Promise<{ passed: boolean; error?: string }> {
    const start = this.clock.nowMs();
    for (const file of changedFiles) {
      const exists = await this.fs.exists(file.path);
      if (!exists) {
        return {
          passed: false,
          error: `Modified file '${file.path}' does not exist on disk after changes.`,
        };
      }
      try {
        const diskContent = await this.fs.readFile(file.path);
        if (diskContent.length === 0 && file.afterContent.length > 0) {
          return {
            passed: false,
            error: `Modified file '${file.path}' was read as empty on disk.`,
          };
        }
      } catch (err) {
        return {
          passed: false,
          error: `Failed to read file '${file.path}': ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const durationMs = this.clock.nowMs() - start;
    const evidence: EvidenceRecord = {
      stage: 're_read',
      exitCode: 0,
      outputExcerpt: `Successfully re-read and validated ${changedFiles.length} changed files.`,
      durationMs,
      timestamp: this.clock.nowMs(),
    };
    this.evidenceCollector.recordEvidence(evidence);
    this.evidenceCollector.addClaim(
      `Re-read and verified syntax of ${changedFiles.length} modified files`,
      'Verified',
      evidence,
    );

    return { passed: true };
  }

  private async verifyTypecheckStage(): Promise<{ passed: boolean; error?: string }> {
    const cmdToRun = this.options.typecheckCommand ?? this.options.lintCommand;
    if (!cmdToRun) return { passed: true };

    const parts = cmdToRun.split(' ');
    const command = parts[0] ?? 'pnpm';
    const args = parts.slice(1);

    const start = this.clock.nowMs();
    try {
      const res = await this.runner.run(command, args);
      const durationMs = this.clock.nowMs() - start;
      const evidence: EvidenceRecord = {
        stage: 'typecheck_lint',
        command: cmdToRun,
        exitCode: res.exitCode,
        outputExcerpt: (res.stdout + '\n' + res.stderr).slice(0, 300),
        durationMs,
        timestamp: this.clock.nowMs(),
      };
      this.evidenceCollector.recordEvidence(evidence);

      if (res.exitCode !== 0) {
        return {
          passed: false,
          error: `Typecheck/lint failed with exit code ${res.exitCode}:\n${res.stdout}\n${res.stderr}`,
        };
      }

      this.evidenceCollector.addClaim(
        `Typecheck and lint passed clean with zero errors (\`${cmdToRun}\`)`,
        'Verified',
        evidence,
      );
      return { passed: true };
    } catch (err) {
      return {
        passed: false,
        error: `Failed to execute typecheck command '${cmdToRun}': ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async verifyTestStage(
    changedFiles: readonly FileChangeRecord[],
    testHistory: readonly TestExecutionRecord[],
  ): Promise<{
    passed: boolean;
    error?: string;
    fakeFindings: readonly FakeVerificationFinding[];
  }> {
    const currentExecutions = [...testHistory];

    // If testCommand is configured and hasn't been run yet, run it
    if (this.options.testCommand && currentExecutions.length === 0) {
      const parts = this.options.testCommand.split(' ');
      const command = parts[0] ?? 'pnpm';
      const args = parts.slice(1);

      const start = this.clock.nowMs();
      try {
        const res = await this.runner.run(command, args);
        const durationMs = this.clock.nowMs() - start;
        const testExec: TestExecutionRecord = {
          command: this.options.testCommand,
          exitCode: res.exitCode,
          output: res.stdout + '\n' + res.stderr,
        };
        currentExecutions.push(testExec);

        const evidence: EvidenceRecord = {
          stage: 'existing_tests',
          command: this.options.testCommand,
          exitCode: res.exitCode,
          outputExcerpt: testExec.output.slice(0, 300),
          durationMs,
          timestamp: this.clock.nowMs(),
        };
        this.evidenceCollector.recordEvidence(evidence);

        if (res.exitCode !== 0) {
          return {
            passed: false,
            error: `Tests failed with exit code ${res.exitCode}:\n${testExec.output}`,
            fakeFindings: [],
          };
        }
      } catch (err) {
        return {
          passed: false,
          error: `Failed to run test command: ${err instanceof Error ? err.message : String(err)}`,
          fakeFindings: [],
        };
      }
    }

    // Audit for fake verification!
    const fakeFindings = FakeVerificationDetector.audit(
      changedFiles,
      currentExecutions,
      Boolean(this.options.isBugFix),
    );

    if (fakeFindings.length > 0) {
      for (const finding of fakeFindings) {
        await this.eventBus.publish({
          id: `fake-verif-${this.clock.nowMs()}`,
          type: 'verification.fake_detected',
          timestamp: this.clock.nowMs(),
          actor: 'system',
          payload: {
            reason: finding.reason,
            details: finding.details,
          },
        });
      }

      // Serious fake findings fail verification immediately
      const fatalFake = fakeFindings.find(
        (f) =>
          f.reason === 'no_tests_run' ||
          f.reason === 'tests_weakened_or_skipped' ||
          f.reason === 'zero_tests_collected',
      );
      if (fatalFake) {
        return {
          passed: false,
          error: `Fake verification detected: [${fatalFake.reason}] ${fatalFake.details}`,
          fakeFindings,
        };
      }
    }

    this.evidenceCollector.addClaim(
      `Test suite verified with active tests running`,
      'Verified',
      this.evidenceCollector.findEvidenceForStage('existing_tests'),
    );

    return { passed: true, fakeFindings };
  }

  private verifyTddStage(): { passed: boolean; error?: string } {
    // For bug fixes, require that the baseline test failed before the fix was applied
    if (this.options.tddBaselineFailed === false) {
      return {
        passed: false,
        error:
          'TDD Regression loop violation: for bug fixes, a test must fail on the baseline code first before verifying the fix.',
      };
    }

    const testEvidence = this.evidenceCollector.findEvidenceForStage('existing_tests');
    if (!testEvidence) {
      return {
        passed: false,
        error: 'Bug fix has not been verified against an passing test run.',
      };
    }

    this.evidenceCollector.addClaim(
      'Bug fix verified via TDD: test failed on baseline, now passes clean on fix',
      'Verified',
      testEvidence,
    );

    return { passed: true };
  }

  private async verifySmokeStage(): Promise<{ passed: boolean; error?: string }> {
    if (!this.options.smokeCommand) return { passed: true };

    const parts = this.options.smokeCommand.split(' ');
    const command = parts[0] ?? 'node';
    const args = parts.slice(1);

    const start = this.clock.nowMs();
    try {
      const res = await this.runner.run(command, args);
      const durationMs = this.clock.nowMs() - start;

      const evidence: EvidenceRecord = {
        stage: 'smoke_command',
        command: this.options.smokeCommand,
        exitCode: res.exitCode,
        outputExcerpt: (res.stdout + '\n' + res.stderr).slice(0, 300),
        durationMs,
        timestamp: this.clock.nowMs(),
      };
      this.evidenceCollector.recordEvidence(evidence);

      if (res.exitCode !== 0) {
        return {
          passed: false,
          error: `Smoke command failed with exit code ${res.exitCode}:\n${res.stdout}\n${res.stderr}`,
        };
      }

      this.evidenceCollector.addClaim(
        `Smoke verification passed clean (\`${this.options.smokeCommand}\`)`,
        'Verified',
        evidence,
      );
      return { passed: true };
    } catch (err) {
      return {
        passed: false,
        error: `Smoke command execution failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async handleStageFailure(
    stage: VerificationStage,
    error: string,
    fakeFindings: readonly FakeVerificationFinding[] = [],
  ): Promise<VerificationResult> {
    await this.eventBus.publish({
      id: `verif-fail-${this.clock.nowMs()}`,
      type: 'verification.completed',
      timestamp: this.clock.nowMs(),
      actor: 'system',
      payload: {
        attempt: this.currentAttempt,
        success: false,
        stage,
        error,
      },
    });

    const isExhausted = this.currentAttempt >= this.maxAttempts;
    const remediation = isExhausted
      ? `Verification attempts (${this.maxAttempts}) exhausted. Escalating to human handoff.`
      : `Attempt ${this.currentAttempt}/${this.maxAttempts} failed. Repair code or tests and retry verification.`;

    return {
      passed: false,
      stage,
      attempt: this.currentAttempt,
      evidence: this.evidenceCollector.getRecords(),
      fakeFindings,
      error,
      remediation,
    };
  }

  getAttempts(): number {
    return this.currentAttempt;
  }

  isAttemptsExhausted(): boolean {
    return this.currentAttempt >= this.maxAttempts;
  }

  getVerificationCommands(): readonly string[] {
    const cmds: string[] = [];
    if (this.options.typecheckCommand) cmds.push(this.options.typecheckCommand);
    if (this.options.lintCommand) cmds.push(this.options.lintCommand);
    if (this.options.testCommand) cmds.push(this.options.testCommand);
    if (this.options.smokeCommand) cmds.push(this.options.smokeCommand);
    return cmds;
  }
}
