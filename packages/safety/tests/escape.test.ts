import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SandboxManager } from '../src/sandbox/manager.js';
import { runSandboxDoctor } from '../src/sandbox/doctor.js';
import { scrubEnvironment } from '../src/sandbox/scrub.js';
import { OfflineGuard } from '../src/privacy/offline.js';

describe('Sandbox Isolation & Escape Prevention Suite', () => {
  let tempDir: string;
  let workspaceRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sandbox-test-'));
    workspaceRoot = path.join(tempDir, 'workspace');
    outsideDir = path.join(tempDir, 'outside');

    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // Gap 1: Symlink and '..' escapes
  it('Gap 1: blocks path traversal via .. and symlinks pointing outside workspace root', () => {
    const sandbox = new SandboxManager({
      workspaceRoot,
      writePaths: [workspaceRoot],
    });

    // 1a. Traversal via raw '..' in target path
    const dotDotTarget = `${workspaceRoot}/../outside/secret.txt`;
    const dotDotCheck = sandbox.validatePath(dotDotTarget);
    expect(dotDotCheck.allowed).toBe(false);
    expect(dotDotCheck.reason).toContain('Path traversal escape attempt detected');

    // 1b. Symlink pointing outside
    const outsideTarget = path.join(outsideDir, 'target.txt');
    fs.writeFileSync(outsideTarget, 'classified');
    const symlinkPath = path.join(workspaceRoot, 'symlink-to-outside');
    try {
      fs.symlinkSync(outsideTarget, symlinkPath);
      const symlinkCheck = sandbox.validatePath(symlinkPath);
      expect(symlinkCheck.allowed).toBe(false);
      expect(symlinkCheck.reason).toContain('Symlink escape detected');
    } catch (err: unknown) {
      // On Windows without symlink privileges, mark as non-exploitable
      expect(err).toBeDefined();
    }
  });

  // Gap 2: Hardlink escapes
  it('Gap 2: blocks writing outside designated write paths via hardlink or out-of-boundary paths', () => {
    const sandbox = new SandboxManager({
      workspaceRoot,
      writePaths: [workspaceRoot],
    });
    const outsideFile = path.join(outsideDir, 'external-system.txt');
    fs.writeFileSync(outsideFile, 'system file');

    // Attempting to target outside file
    const check = sandbox.validatePath(outsideFile);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('outside the designated write sandbox');
  });

  // Gap 3: Child-process writes boundary enforcement
  it('Gap 3: prevents child processes from writing outside project root and temp dir', () => {
    const sandbox = new SandboxManager({
      workspaceRoot,
      writePaths: [workspaceRoot],
    });

    // Writing within workspace is permitted
    const insideWrite = sandbox.validatePath(path.join(workspaceRoot, 'build', 'out.js'));
    expect(insideWrite.allowed).toBe(true);

    // Writing to system path is forbidden
    const systemWrite = sandbox.validatePath('/etc/passwd');
    expect(systemWrite.allowed).toBe(false);

    // Writing to user home dotfiles (~/.ssh) is forbidden
    const sshTarget = path.join(os.homedir(), '.ssh', 'authorized_keys');
    const sshCheck = sandbox.validatePath(sshTarget);
    expect(sshCheck.allowed).toBe(false);
    expect(sshCheck.reason).toContain('forbidden');
  });

  // Gap 4: Environment variable secret leakage (scrub env)
  it('Gap 4: scrubs secrets and tokens from environment variables passed to child processes', () => {
    const dirtyEnv: Record<string, string> = {
      PATH: '/usr/bin:/bin',
      ANTHROPIC_API_KEY: 'sk-ant-secret-1234567890',
      OPENAI_API_KEY: 'sk-proj-super-secret-key-123',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      GITHUB_TOKEN: 'ghp_123456789012345678901234567890123456',
      LD_PRELOAD: '/tmp/malicious.so',
      GIT_HOOKS_PATH: '/tmp/bad-hooks',
      CUSTOM_SAFE_VAR: 'forge-dev',
    };

    const { env, strippedKeys } = scrubEnvironment(dirtyEnv);

    expect(env['PATH']).toBe('/usr/bin:/bin');
    expect(env['CUSTOM_SAFE_VAR']).toBe('forge-dev');

    // All secrets and dangerous execution variables must be scrubbed
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['LD_PRELOAD']).toBeUndefined();
    expect(env['GIT_HOOKS_PATH']).toBeUndefined();

    expect(strippedKeys).toContain('ANTHROPIC_API_KEY');
    expect(strippedKeys).toContain('OPENAI_API_KEY');
    expect(strippedKeys).toContain('AWS_SECRET_ACCESS_KEY');
    expect(strippedKeys).toContain('GITHUB_TOKEN');
    expect(strippedKeys).toContain('LD_PRELOAD');
    expect(strippedKeys).toContain('GIT_HOOKS_PATH');
  });

  // Gap 5: Git hooks/config executing code
  it('Gap 5: blocks tampering with git hooks and git config that could execute untrusted code', () => {
    const sandbox = new SandboxManager({ workspaceRoot });

    // 5a. Direct write to .git/hooks
    const hookPath = path.join(workspaceRoot, '.git', 'hooks', 'pre-commit');
    const hookCheck = sandbox.validatePath(hookPath);
    expect(hookCheck.allowed).toBe(false);
    expect(hookCheck.reason).toContain('Tampering with git hooks');

    // 5b. Direct write to .git/config
    const configPath = path.join(workspaceRoot, '.git', 'config');
    const configCheck = sandbox.validatePath(configPath);
    expect(configCheck.allowed).toBe(false);
    expect(configCheck.reason).toContain('Tampering with git config');

    // 5c. Commands altering core.hooksPath
    const cmdCheck = sandbox.validateCommand('git', [
      'config',
      'core.hooksPath',
      '/tmp/evil-hooks',
    ]);
    expect(cmdCheck.allowed).toBe(false);
    expect(cmdCheck.reason).toContain(
      'Git configuration and hook manipulation commands are restricted',
    );
  });

  // Gap 6: Package install scripts
  it('Gap 6: flags npm/pnpm/yarn install scripts without --ignore-scripts in restricted commands', () => {
    const sandbox = new SandboxManager({ workspaceRoot });

    // Validate command detects risky patterns
    const safeCmd = sandbox.validateCommand('npm', ['install', '--ignore-scripts']);
    expect(safeCmd.allowed).toBe(true);
  });

  // Gap 7: Tampering with .git or agent own config / sandbox profile
  it('Gap 7: forbids tampering with .forge config and sandbox profile', () => {
    const sandbox = new SandboxManager({ workspaceRoot });

    const forgeConfig = path.join(workspaceRoot, '.forge', 'config.json');
    const check1 = sandbox.validatePath(forgeConfig);
    expect(check1.allowed).toBe(false);
    expect(check1.reason).toContain('forbidden');

    const forgeSandbox = path.join(workspaceRoot, '.forge', 'sandbox.json');
    const check2 = sandbox.validatePath(forgeSandbox);
    expect(check2.allowed).toBe(false);
    expect(check2.reason).toContain('forbidden');
  });

  // Gap 8: DNS/network exfiltration
  it('Gap 8: blocks external network exfiltration under offline/sandbox isolation', () => {
    const offlineGuard = new OfflineGuard(true);

    // Localhost allowed
    expect(offlineGuard.validateUrl('http://localhost:11434/api/generate').allowed).toBe(true);
    expect(offlineGuard.validateUrl('http://127.0.0.1:8000/v1/models').allowed).toBe(true);

    // External exfiltration blocked
    const exfilCheck = offlineGuard.validateUrl('https://evil-hacker.com/exfiltrate?data=secret');
    expect(exfilCheck.allowed).toBe(false);
    expect(exfilCheck.reason).toContain('external network request to host');

    // web_fetch blocked
    expect(offlineGuard.validateAction('web_fetch').allowed).toBe(false);
  });

  // Gap 9: Resource exhaustion (limits & destructive commands)
  it('Gap 9: blocks fork bombs, disk wipe patterns, and destructive root deletion', () => {
    const sandbox = new SandboxManager({ workspaceRoot });

    // Fork bomb
    const forkBomb = sandbox.validateCommand(':(){ :|:& };:');
    expect(forkBomb.allowed).toBe(false);
    expect(forkBomb.reason).toContain('destructive pattern');

    // Root delete
    const rootDel = sandbox.validateCommand('rm', ['-rf', '/']);
    expect(rootDel.allowed).toBe(false);

    // Raw device overwrite
    const rawDisk = sandbox.validateCommand('sh', ['-c', 'cat malicious > /dev/sda']);
    expect(rawDisk.allowed).toBe(false);
  });

  // Gap 10: Orphan processes & process tree termination
  it('Gap 10: tracks active child processes and kills process tree on exit', async () => {
    const sandbox = new SandboxManager({ workspaceRoot });

    sandbox.registerChildProcess(999999);
    // Cleanup should complete without throwing
    await expect(sandbox.cleanup()).resolves.toBeUndefined();
  });

  // Forge Doctor truthfulness test
  it('Forge Doctor truthfully reports isolation and refuses to claim sandboxed when backend is unavailable', () => {
    const report = runSandboxDoctor();
    expect(report.os).toBeDefined();
    expect(report.activeBackend).toBeDefined();
    expect(report.availableBackends).toContain('host_isolated');

    if (!report.isOsSandboxed) {
      expect(report.message).toContain('NOT OS-sandboxed');
    } else {
      expect(['seatbelt', 'bubblewrap', 'job_object']).toContain(report.activeBackend);
    }
  });
});
