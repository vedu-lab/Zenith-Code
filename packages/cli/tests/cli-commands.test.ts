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

  it('runs forge doctor and returns diagnostic report', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['doctor']);

    expect(process.exitCode).toBe(0);
    const logged = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('=== Forge Doctor: System & Environment Diagnostics ===');
    expect(logged).toContain('[Runtime] Node.js Version:');
    expect(logged).toContain('[Operating System] OS & Active Shell:');
    expect(logged).toContain('[Safety & Sandbox] Isolation Engine:');
  });

  it('runs forge replay on a session file and verifies turns', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create a mock session file
    const sessionDir = path.join(tmpDir, '.forge', 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, 'test-replay-sess.json');
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({
        id: 'test-replay-sess',
        title: 'Replay Test',
        turns: [
          {
            turnIndex: 1,
            userMessage: 'Test prompt',
            modelOutput: 'I will run command.',
            toolCalls: [],
          },
        ],
      }),
    );

    await runCli(['replay', 'test-replay-sess']);

    expect(process.exitCode).toBe(0);
    const logged = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('Replaying Session: test-replay-sess');
    expect(logged).toContain('Replay completed successfully. All 1 turns verified.');
  });
});
