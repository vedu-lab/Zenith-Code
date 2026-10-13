import { describe, it, expect, vi } from 'vitest';
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  MultiEditTool,
  ListDirTool,
  GrepTool,
  BashTool,
  TodoWriteTool,
  FileReadTracker,
  IFileSystem,
  IProcessRunner,
  PolicyViolationError,
} from '@forge/core';
import { CapabilityManager } from '../src/capabilities/manager.js';
import { PolicyEngine } from '../src/policy/engine.js';

describe('Tool Policy Gate Enforcement & Bypass Prevention', () => {
  const createMockFs = (): IFileSystem => ({
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readDir: vi.fn().mockResolvedValue(['file1.ts']),
    stat: vi.fn().mockResolvedValue({ size: 100, isDirectory: false, mtimeMs: 12345 }),
    preserveLineEndings: vi.fn().mockReturnValue('content'),
  });

  const createMockRunner = (): IProcessRunner => ({
    run: vi.fn().mockResolvedValue({ stdout: 'output', stderr: '', exitCode: 0 }),
  });

  it('fails if ReadFileTool bypasses policy gate', async () => {
    const fs = createMockFs();
    const tracker = new FileReadTracker();
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new ReadFileTool(fs, tracker, policy);

    // Without capability, policy returns 'ask' -> tool must fail with PolicyViolationError
    await expect(tool.execute({ filePath: 'src/secret.txt' })).rejects.toThrow(
      PolicyViolationError,
    );
    expect(checkSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'read_file',
        actionType: 'fs:read',
        target: 'src/secret.txt',
      }),
    );
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('fails if WriteFileTool bypasses policy gate', async () => {
    const fs = createMockFs();
    const tracker = new FileReadTracker();
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new WriteFileTool(fs, tracker, policy);

    await expect(
      tool.execute({ filePath: 'src/out.ts', content: 'console.log(1)' }),
    ).rejects.toThrow(PolicyViolationError);
    expect(checkSpy).toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('fails if EditFileTool bypasses policy gate', async () => {
    const fs = createMockFs();
    const tracker = new FileReadTracker();
    tracker.markRead('src/app.ts');
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new EditFileTool(fs, tracker, policy);

    await expect(
      tool.execute({
        filePath: 'src/app.ts',
        oldContent: 'const a = 1;',
        newContent: 'const a = 2;',
      }),
    ).rejects.toThrow(PolicyViolationError);
    expect(checkSpy).toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('fails if MultiEditTool bypasses policy gate', async () => {
    const fs = createMockFs();
    const tracker = new FileReadTracker();
    tracker.markRead('src/app.ts');
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new MultiEditTool(fs, tracker, policy);

    await expect(
      tool.execute({
        edits: [
          {
            filePath: 'src/app.ts',
            oldContent: 'const a = 1;',
            newContent: 'const a = 10;',
          },
        ],
      }),
    ).rejects.toThrow(PolicyViolationError);
    expect(checkSpy).toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('fails if ListDirTool bypasses policy gate', async () => {
    const fs = createMockFs();
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new ListDirTool(fs, process.cwd(), policy);

    await expect(tool.execute({ path: 'forbidden/dir' })).rejects.toThrow(PolicyViolationError);
    expect(checkSpy).toHaveBeenCalled();
    expect(fs.readDir).not.toHaveBeenCalled();
  });

  it('fails if GrepTool bypasses policy gate', async () => {
    const fs = createMockFs();
    const runner = createMockRunner();
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new GrepTool(fs, runner, process.cwd(), policy);

    await expect(tool.execute({ query: 'password', dirPath: 'sensitive/' })).rejects.toThrow(
      PolicyViolationError,
    );
    expect(checkSpy).toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('fails if BashTool bypasses policy gate', async () => {
    const fs = createMockFs();
    const runner = createMockRunner();
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new BashTool(runner, fs, process.cwd(), 10000, policy);

    await expect(tool.execute({ command: 'cat /etc/shadow' })).rejects.toThrow(
      PolicyViolationError,
    );
    expect(checkSpy).toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('fails if TodoWriteTool bypasses policy gate', async () => {
    const policy = new PolicyEngine(new CapabilityManager());
    const checkSpy = vi.spyOn(policy, 'check');

    const tool = new TodoWriteTool(policy);

    await expect(
      tool.execute({
        tasks: [{ title: 'Test todo', status: 'pending' }],
      }),
    ).rejects.toThrow(PolicyViolationError);
    expect(checkSpy).toHaveBeenCalled();
  });

  it('allows execution when policy engine grants explicit capability handle', async () => {
    const fs = createMockFs();
    const tracker = new FileReadTracker();
    const caps = new CapabilityManager();
    caps.grant('fs:read', 'src/allowed.ts');
    const policy = new PolicyEngine(caps);

    const tool = new ReadFileTool(fs, tracker, policy);
    const result = await tool.execute({ filePath: 'src/allowed.ts' });

    expect(result).toBeDefined();
    expect(fs.readFile).toHaveBeenCalled();
  });
});
