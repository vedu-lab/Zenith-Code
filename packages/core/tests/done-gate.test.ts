import { describe, it, expect, beforeEach } from 'vitest';
import {
  DoneGate,
  EvidenceCollector,
  FakeVerificationDetector,
  VerifierAgent,
  CoreEventBus,
  SystemClock,
  IProcessRunner,
  IFileSystem,
  ProcessRunResult,
  FileStatResult,
} from '../src/index.js';

class MockProcessRunner implements IProcessRunner {
  private responses = new Map<string, ProcessRunResult>();

  setResponse(command: string, result: ProcessRunResult): void {
    this.responses.set(command, result);
  }

  async run(command: string, args: readonly string[]): Promise<ProcessRunResult> {
    const fullCmd = [command, ...args].join(' ');
    if (this.responses.has(fullCmd)) {
      return this.responses.get(fullCmd)!;
    }
    if (this.responses.has(command)) {
      return this.responses.get(command)!;
    }
    return { stdout: 'Mock stdout', stderr: '', exitCode: 0 };
  }
}

class MockFileSystem implements IFileSystem {
  private files = new Map<string, string>();

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) throw new Error(`File not found: ${filePath}`);
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async mkdir(): Promise<void> {}

  async readDir(): Promise<readonly string[]> {
    return Array.from(this.files.keys());
  }

  async stat(filePath: string): Promise<FileStatResult> {
    return {
      size: (this.files.get(filePath) || '').length,
      isDirectory: false,
      mtimeMs: Date.now(),
    };
  }

  preserveLineEndings(_orig: string, newContent: string): string {
    return newContent;
  }
}

describe('DoneGate & Verification Loops', () => {
  let runner: MockProcessRunner;
  let fs: MockFileSystem;
  let eventBus: CoreEventBus;
  let clock: SystemClock;
  let collector: EvidenceCollector;

  beforeEach(() => {
    runner = new MockProcessRunner();
    fs = new MockFileSystem();
    eventBus = new CoreEventBus();
    clock = new SystemClock();
    collector = new EvidenceCollector();
  });

  it('passes verification through all stages with valid evidence', async () => {
    fs.setFile('src/app.ts', 'export const port = 3000;');
    runner.setResponse('pnpm typecheck', { stdout: 'tsc success', stderr: '', exitCode: 0 });
    runner.setResponse('pnpm test', { stdout: '✓ 12 tests passed', stderr: '', exitCode: 0 });
    runner.setResponse('node dist/index.js --version', {
      stdout: 'v1.0.0',
      stderr: '',
      exitCode: 0,
    });

    const gate = new DoneGate(runner, fs, clock, eventBus, collector, {
      maxAttempts: 3,
      typecheckCommand: 'pnpm typecheck',
      testCommand: 'pnpm test',
      smokeCommand: 'node dist/index.js --version',
    });

    const result = await gate.verify(
      [{ path: 'src/app.ts', afterContent: 'export const port = 3000;' }],
      [{ command: 'pnpm test', exitCode: 0, output: '✓ 12 tests passed' }],
    );

    expect(result.passed).toBe(true);
    expect(result.stage).toBe('smoke_command');
    expect(result.fakeFindings).toHaveLength(0);
    expect(collector.getRecords().length).toBeGreaterThanOrEqual(3);
  });

  it('fails verification at re-read stage if a file was deleted or left empty', async () => {
    const gate = new DoneGate(runner, fs, clock, eventBus, collector, { maxAttempts: 2 });
    const result = await gate.verify([{ path: 'src/missing.ts', afterContent: 'content' }], []);

    expect(result.passed).toBe(false);
    expect(result.stage).toBe('re_read');
    expect(result.error).toContain('does not exist on disk');
  });

  it('fails verification at typecheck stage if compiler errors out', async () => {
    fs.setFile('src/app.ts', 'const a: number = "string";');
    runner.setResponse('pnpm typecheck', {
      stdout: '',
      stderr: 'Type "string" is not assignable to type "number"',
      exitCode: 1,
    });

    const gate = new DoneGate(runner, fs, clock, eventBus, collector, {
      maxAttempts: 2,
      typecheckCommand: 'pnpm typecheck',
    });

    const result = await gate.verify(
      [{ path: 'src/app.ts', afterContent: 'const a: number = "string";' }],
      [],
    );

    expect(result.passed).toBe(false);
    expect(result.stage).toBe('typecheck_lint');
    expect(result.error).toContain('Typecheck/lint failed');
  });

  describe('Fake Verification Detection', () => {
    it('detects no_tests_run when code is modified but zero tests are executed', () => {
      const findings = FakeVerificationDetector.audit(
        [{ path: 'src/auth.ts', afterContent: 'export function login() {}' }],
        [],
      );
      expect(findings.some((f) => f.reason === 'no_tests_run')).toBe(true);
    });

    it('detects zero_tests_collected when test runner exits 0 but executed 0 tests', () => {
      const findings = FakeVerificationDetector.audit(
        [{ path: 'src/auth.ts', afterContent: 'export function login() {}' }],
        [{ command: 'vitest run', exitCode: 0, output: 'No test files found, 0 tests run' }],
      );
      expect(findings.some((f) => f.reason === 'zero_tests_collected')).toBe(true);
    });

    it('detects tests_weakened_or_skipped when tests are skipped or assertions deleted', () => {
      const findings = FakeVerificationDetector.audit(
        [
          {
            path: 'tests/auth.test.ts',
            beforeContent: 'it("logs in", () => { expect(1).toBe(1); });',
            afterContent: 'it.skip("logs in", () => { expect(1).toBe(1); });',
          },
        ],
        [{ command: 'vitest run', exitCode: 0, output: '1 passed' }],
      );
      expect(findings.some((f) => f.reason === 'tests_weakened_or_skipped')).toBe(true);
    });

    it('detects source_and_tests_edited_together for bug fixes', () => {
      const findings = FakeVerificationDetector.audit(
        [
          { path: 'src/auth.ts', afterContent: 'export function auth() {}' },
          { path: 'tests/auth.test.ts', afterContent: 'it("tests auth", () => {});' },
        ],
        [{ command: 'vitest run', exitCode: 0, output: '1 passed' }],
        true, // isBugFix
      );
      expect(findings.some((f) => f.reason === 'source_and_tests_edited_together')).toBe(true);
    });
  });

  describe('TDD Regression Loop & Bounded Retries', () => {
    it('enforces that bug fix must have failed on baseline first', async () => {
      fs.setFile('src/bug.ts', 'fix');
      const gate = new DoneGate(runner, fs, clock, eventBus, collector, {
        isBugFix: true,
        tddBaselineFailed: false, // Baseline did not fail!
      });

      const result = await gate.verify(
        [{ path: 'src/bug.ts', afterContent: 'fix' }],
        [{ command: 'vitest', exitCode: 0, output: '1 passed' }],
      );

      expect(result.passed).toBe(false);
      expect(result.stage).toBe('tdd_regression');
      expect(result.error).toContain('TDD Regression loop violation');
    });

    it('exhausts bounded retries and signals handoff escalation', async () => {
      fs.setFile('src/broken.ts', 'bad');
      runner.setResponse('pnpm typecheck', { stdout: '', stderr: 'error', exitCode: 1 });

      const gate = new DoneGate(runner, fs, clock, eventBus, collector, {
        maxAttempts: 2,
        typecheckCommand: 'pnpm typecheck',
      });

      // Attempt 1
      const res1 = await gate.verify([{ path: 'src/broken.ts', afterContent: 'bad' }], []);
      expect(res1.passed).toBe(false);
      expect(gate.isAttemptsExhausted()).toBe(false);

      // Attempt 2
      const res2 = await gate.verify([{ path: 'src/broken.ts', afterContent: 'bad' }], []);
      expect(res2.passed).toBe(false);
      expect(gate.isAttemptsExhausted()).toBe(true);
      expect(res2.remediation).toContain('Escalating to human handoff');
    });
  });

  describe('Verifier Agent (Read-only Adversarial Check)', () => {
    it('catches breaking keywords and type escapes in diff', async () => {
      const verifier = new VerifierAgent();
      const res = await verifier.verifyDiff([
        { path: 'src/app.ts', afterContent: 'const bad = val as any;' },
      ]);
      expect(res.approved).toBe(false);
      expect(res.critique).toContain("Found type bypass 'as any'");
    });

    it('approves clean diffs without regressions', async () => {
      const verifier = new VerifierAgent();
      const res = await verifier.verifyDiff([
        { path: 'src/clean.ts', afterContent: 'export const value: number = 42;' },
      ]);
      expect(res.approved).toBe(true);
    });
  });
});
