import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCli } from '../src/index.js';

describe('CLI Subcommands & Estimation Integration', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cli-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    vi.restoreAllMocks();
  });

  it('runs forge run with --estimate and prints cost range without executing agent loop', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['run', 'Refactor auth controller into domain services', '--estimate']);

    expect(process.exitCode).toBe(0);
    const logged = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('Cost Estimate for:');
    expect(logged).toContain('Cost Range:');
    expect(logged).toContain('Estimated Tokens:');
    expect(logged).toContain('Assumptions:');
  });

  it('runs forge init and syncs instruction files with headers', async () => {
    const _consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['init']);

    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'GEMINI.md'))).toBe(true);

    const claudeContent = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    expect(claudeContent).toContain('Generated from AGENTS.md');
  });

  it('runs forge usage and returns summary statistics', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['usage', '--since', '7d', '--json']);

    expect(process.exitCode).toBe(0);
    const logged = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('"totalTokens"');
    expect(logged).toContain('"totalCostUsd"');
  });
});
