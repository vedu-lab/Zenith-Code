import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ListDirTool, GrepTool, AllowAllPolicyGate } from '../src/tools/index.js';
import { IFileSystem, IProcessRunner, FileStatResult } from '../src/interfaces/index.js';

class RealDiskFileSystem implements IFileSystem {
  async readFile(p: string): Promise<string> {
    return fs.readFile(path.resolve(p), 'utf-8');
  }
  async writeFile(p: string, content: string): Promise<void> {
    const res = path.resolve(p);
    await fs.mkdir(path.dirname(res), { recursive: true });
    await fs.writeFile(res, content, 'utf-8');
  }
  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(path.resolve(p));
      return true;
    } catch {
      return false;
    }
  }
  async mkdir(p: string): Promise<void> {
    await fs.mkdir(path.resolve(p), { recursive: true });
  }
  async readDir(p: string): Promise<readonly string[]> {
    return fs.readdir(path.resolve(p));
  }
  async stat(p: string): Promise<FileStatResult> {
    const s = await fs.stat(path.resolve(p));
    return { size: s.size, isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs };
  }
  preserveLineEndings(_orig: string, updated: string): string {
    return updated;
  }
}

describe('Search & Directory Tools with .gitignore and .agentignore', () => {
  let tempDir: string;
  let diskFs: IFileSystem;
  const policyGate = new AllowAllPolicyGate();

  const mockRunner: IProcessRunner = {
    run: async () => ({ stdout: '', stderr: 'rg not installed', exitCode: 127 }),
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-search-test-'));
    diskFs = new RealDiskFileSystem();

    // Setup files
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'secrets'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'build'), { recursive: true });

    await fs.writeFile(
      path.join(tempDir, 'src', 'app.ts'),
      'export function run() { return "find_me"; }\n',
    );
    await fs.writeFile(path.join(tempDir, 'secrets', 'key.pem'), 'secret data with find_me\n');
    await fs.writeFile(path.join(tempDir, 'build', 'bundle.js'), 'bundle find_me\n');

    // Add .gitignore and .agentignore
    await fs.writeFile(path.join(tempDir, '.gitignore'), 'build/\n');
    await fs.writeFile(path.join(tempDir, '.agentignore'), 'secrets/\n');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('list_dir: should respect .gitignore and .agentignore', async () => {
    const listTool = new ListDirTool(diskFs, tempDir, policyGate);
    const result = await listTool.execute({ recursive: true, maxDepth: 2 });

    expect(result).toContain('app.ts');
    expect(result).not.toContain('key.pem');
    expect(result).not.toContain('bundle.js');
  });

  it('grep: should find matches while respecting ignored directories', async () => {
    const grepTool = new GrepTool(diskFs, mockRunner, tempDir, policyGate);
    const result = await grepTool.execute({ query: 'find_me' });

    expect(result).toContain('app.ts:1:export function run');
    expect(result).not.toContain('key.pem');
    expect(result).not.toContain('bundle.js');
  });
});
