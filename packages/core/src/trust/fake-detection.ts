import { FakeVerificationFinding } from './types.js';

export interface FileChangeRecord {
  readonly path: string;
  readonly beforeContent?: string | undefined;
  readonly afterContent: string;
}

export interface TestExecutionRecord {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

export class FakeVerificationDetector {
  static isTestFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
      lower.includes('.test.') ||
      lower.includes('.spec.') ||
      lower.startsWith('test_') ||
      lower.endsWith('_test.go') ||
      lower.endsWith('_test.py') ||
      lower.includes('/tests/') ||
      lower.includes('/test/') ||
      lower.includes('__tests__')
    );
  }

  static detectNoTestsRun(
    hasCodeChanges: boolean,
    testExecutions: readonly TestExecutionRecord[],
  ): FakeVerificationFinding | null {
    if (hasCodeChanges && testExecutions.length === 0) {
      return {
        reason: 'no_tests_run',
        details: 'Code was modified during this session, but no test command was executed.',
      };
    }
    return null;
  }

  static detectZeroTestsCollected(
    testExecutions: readonly TestExecutionRecord[],
  ): FakeVerificationFinding | null {
    const zeroTestPatterns = [
      /0\s+(?:tests?\s+)?passed/i,
      /0\s+tests?\s+run/i,
      /no\s+test\s+files\s+found/i,
      /no\s+tests\s+found/i,
      /collected\s+0\s+items/i,
      /ran\s+0\s+tests/i,
      /total\s+0/i,
    ];

    for (const exec of testExecutions) {
      // If exit code is 0 but 0 tests were actually run
      if (exec.exitCode === 0) {
        for (const pattern of zeroTestPatterns) {
          if (pattern.test(exec.output)) {
            return {
              reason: 'zero_tests_collected',
              details: `Test runner exited with 0, but output indicated 0 tests were collected/run: "${exec.command}"`,
            };
          }
        }
      }
    }
    return null;
  }

  static detectWeakenedOrSkippedTests(
    fileChanges: readonly FileChangeRecord[],
  ): FakeVerificationFinding | null {
    const skipPatterns = [
      /\.skip\s*\(/,
      /\bxit\s*\(/,
      /\bxdescribe\s*\(/,
      /@pytest\.mark\.skip/,
      /#\[ignore\]/,
      /\/\/.*(?:test|it)\s*\(/,
      /\/\*[\s\S]*?(?:test|it)\s*\([\s\S]*?\*\//,
    ];

    for (const change of fileChanges) {
      if (!this.isTestFile(change.path)) continue;

      const after = change.afterContent;
      const before = change.beforeContent ?? '';

      // Check if skip was introduced
      for (const pattern of skipPatterns) {
        if (pattern.test(after) && !pattern.test(before)) {
          return {
            reason: 'tests_weakened_or_skipped',
            details: `Test skipping or weakening introduced in '${change.path}' matching pattern ${pattern}`,
          };
        }
      }

      // Check if test assertions were significantly deleted
      const expectCountBefore = (before.match(/\bexpect\s*\(/g) || []).length;
      const expectCountAfter = (after.match(/\bexpect\s*\(/g) || []).length;
      if (expectCountBefore > 0 && expectCountAfter === 0) {
        return {
          reason: 'tests_weakened_or_skipped',
          details: `All assertions were removed from test file '${change.path}'`,
        };
      }
    }

    return null;
  }

  static detectSourceAndTestsEditedTogether(
    fileChanges: readonly FileChangeRecord[],
  ): FakeVerificationFinding | null {
    let sourceModified = false;
    let testModified = false;

    for (const change of fileChanges) {
      if (this.isTestFile(change.path)) {
        testModified = true;
      } else {
        sourceModified = true;
      }
    }

    if (sourceModified && testModified) {
      return {
        reason: 'source_and_tests_edited_together',
        details:
          'Source code and tests were modified in the same batch; requires review to ensure tests were not altered to match regressions.',
      };
    }

    return null;
  }

  static audit(
    fileChanges: readonly FileChangeRecord[],
    testExecutions: readonly TestExecutionRecord[],
    isBugFix: boolean = false,
  ): readonly FakeVerificationFinding[] {
    const findings: FakeVerificationFinding[] = [];

    const noTests = this.detectNoTestsRun(fileChanges.length > 0, testExecutions);
    if (noTests) findings.push(noTests);

    const zeroTests = this.detectZeroTestsCollected(testExecutions);
    if (zeroTests) findings.push(zeroTests);

    const weakened = this.detectWeakenedOrSkippedTests(fileChanges);
    if (weakened) findings.push(weakened);

    if (isBugFix) {
      const coEdited = this.detectSourceAndTestsEditedTogether(fileChanges);
      if (coEdited) findings.push(coEdited);
    }

    return findings;
  }
}
