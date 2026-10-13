import { describe, it, expect } from 'vitest';
import { BashTool, TodoWriteTool, AllowAllPolicyGate } from '../src/tools/index.js';
import { IFileSystem, IProcessRunner } from '../src/interfaces/index.js';

describe('BashTool & TodoWriteTool', () => {
  const policyGate = new AllowAllPolicyGate();

  const mockFs: IFileSystem = {
    readFile: async () => '',
    writeFile: async () => {},
    exists: async (p) => p.includes('valid_dir'),
    mkdir: async () => {},
    readDir: async () => [],
    stat: async () => ({ size: 0, isDirectory: true, mtimeMs: 0 }),
    preserveLineEndings: (_o, n) => n,
  };

  it('bash: should track cwd changes when running cd commands', async () => {
    const mockRunner: IProcessRunner = {
      run: async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
    };

    const bash = new BashTool(mockRunner, mockFs, '/initial/path', 1000, policyGate);
    expect(bash.getCurrentCwd()).toBe('/initial/path');

    const res = await bash.execute({ command: 'cd valid_dir' });
    expect(res).toContain('Changed directory to:');
    expect(bash.getCurrentCwd()).toContain('valid_dir');
  });

  it('bash: should truncate output exceeding maxOutputBytes', async () => {
    const hugeOutput = 'x'.repeat(500);
    const mockRunner: IProcessRunner = {
      run: async () => ({ stdout: hugeOutput, stderr: '', exitCode: 0 }),
    };

    const bash = new BashTool(mockRunner, mockFs, '/root', 200, policyGate);
    const res = await bash.execute({ command: 'cat bigfile' });

    expect(res).toContain('[Output truncated: exceeded 200 bytes]');
  });

  it('bash: should support background job execution and listing', async () => {
    const mockRunner: IProcessRunner = {
      run: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { stdout: 'done', stderr: '', exitCode: 0 };
      },
    };

    const bash = new BashTool(mockRunner, mockFs, '/root', 1000, policyGate);
    const startRes = await bash.execute({ command: 'sleep 5', isBackground: true });
    expect(startRes).toContain('Background job started with ID:');

    const jobsRes = await bash.execute({ command: 'jobs' });
    expect(jobsRes).toContain('sleep 5');
  });

  it('todo_write: should manage task checklist and status symbols', async () => {
    const todo = new TodoWriteTool(policyGate);
    const res = await todo.execute({
      tasks: [
        { id: '1', title: 'Setup database', status: 'completed' },
        { id: '2', title: 'Write tests', status: 'in_progress' },
        { id: '3', title: 'Deploy service', status: 'pending' },
      ],
    });

    expect(res).toContain('[x] 1: Setup database (completed)');
    expect(res).toContain('[/] 2: Write tests (in_progress)');
    expect(res).toContain('[ ] 3: Deploy service (pending)');
    expect(todo.getCurrentTasks()).toHaveLength(3);
  });
});
