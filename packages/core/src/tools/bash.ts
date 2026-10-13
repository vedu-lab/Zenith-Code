import path from 'node:path';
import { z } from 'zod';
import { BaseTool } from './base.js';
import { IFileSystem, IProcessRunner, PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { ToolExecutionError } from '../errors/index.js';

export const BashInputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  cwd: z
    .string()
    .optional()
    .describe('Directory to execute command in (defaults to agent current working directory)'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Timeout in milliseconds (defaults to 30000)'),
  isBackground: z.boolean().optional().describe('Whether to run as a background task'),
});
export type BashInput = z.infer<typeof BashInputSchema>;

export interface BackgroundJob {
  readonly id: string;
  readonly command: string;
  readonly startTime: number;
  status: 'running' | 'completed' | 'failed' | 'killed';
}

export class BashTool extends BaseTool<BashInput, string> {
  readonly name = 'bash';
  readonly description =
    'Execute shell commands with timeout, cwd tracking, output truncation, and background job support.';
  readonly schema = BashInputSchema;
  override readonly isReadOnly = false;

  private currentCwd: string;
  private readonly backgroundJobs = new Map<string, BackgroundJob>();
  private readonly maxOutputBytes: number;

  constructor(
    private readonly processRunner: IProcessRunner,
    private readonly fs: IFileSystem,
    initialCwd: string = process.cwd(),
    maxOutputBytes = 100_000,
    policyGate: PolicyGate,
    eventBus?: IEventBus,
  ) {
    super(policyGate, eventBus);
    this.currentCwd = initialCwd;
    this.maxOutputBytes = maxOutputBytes;
  }

  getCurrentCwd(): string {
    return this.currentCwd;
  }

  override getParametersSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        cwd: { type: 'string', description: 'Optional directory' },
        timeoutMs: { type: 'number', description: 'Timeout in ms' },
        isBackground: { type: 'boolean', description: 'Run in background' },
      },
      required: ['command'],
    };
  }

  protected createIntent(input: BashInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'exec:command',
      target: input.command,
      parameters: { cwd: input.cwd ?? this.currentCwd, isBackground: input.isBackground },
    };
  }

  private detectShell(): { shell: string; flag: string } {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      if (process.env['PSModulePath']) {
        return { shell: 'powershell.exe', flag: '-Command' };
      }
      return { shell: 'cmd.exe', flag: '/c' };
    }
    return { shell: 'bash', flag: '-c' };
  }

  protected async executeAction(input: BashInput): Promise<string> {
    const trimmed = input.command.trim();

    // 1. Handle CWD tracking if command is 'cd <path>'
    if (trimmed.startsWith('cd ') || trimmed === 'cd') {
      const targetDir = trimmed === 'cd' ? process.cwd() : trimmed.slice(3).trim();
      const resolved = path.resolve(this.currentCwd, targetDir);
      const exists = await this.fs.exists(resolved);
      if (!exists) {
        throw new ToolExecutionError(this.name, `Directory does not exist: '${resolved}'`);
      }
      const stat = await this.fs.stat(resolved);
      if (!stat.isDirectory) {
        throw new ToolExecutionError(this.name, `'${resolved}' is not a directory.`);
      }
      this.currentCwd = resolved;
      return `Changed directory to: ${resolved}`;
    }

    // 2. Handle background jobs query or termination
    if (trimmed === 'jobs') {
      const jobs = Array.from(this.backgroundJobs.values());
      if (jobs.length === 0) return 'No background jobs currently running.';
      return jobs.map((j) => `[${j.id}] ${j.status} - ${j.command}`).join('\n');
    }

    if (trimmed.startsWith('kill ') && trimmed.split(' ').length === 2) {
      const jobId = trimmed.split(' ')[1]!;
      const job = this.backgroundJobs.get(jobId);
      if (job) {
        job.status = 'killed';
        return `Killed background job ${jobId}`;
      }
    }

    const effectiveCwd = input.cwd ? path.resolve(this.currentCwd, input.cwd) : this.currentCwd;
    const { shell, flag } = this.detectShell();
    const timeoutMs = input.timeoutMs ?? 30000;

    // 3. Background execution
    if (input.isBackground) {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const job: BackgroundJob = {
        id: jobId,
        command: input.command,
        startTime: Date.now(),
        status: 'running',
      };
      this.backgroundJobs.set(jobId, job);

      // Launch process in background
      void this.processRunner
        .run(shell, [flag, input.command], { cwd: effectiveCwd, timeoutMs })
        .then((res) => {
          job.status = res.exitCode === 0 ? 'completed' : 'failed';
        })
        .catch(() => {
          job.status = 'failed';
        });

      return `Background job started with ID: ${jobId}. Use 'jobs' to list or 'kill ${jobId}' to terminate.`;
    }

    // 4. Synchronous execution
    const result = await this.processRunner.run(shell, [flag, input.command], {
      cwd: effectiveCwd,
      timeoutMs,
    });

    let combined = '';
    if (result.stdout && result.stderr) {
      combined = `${result.stdout}\n[stderr]\n${result.stderr}`;
    } else if (result.stdout) {
      combined = result.stdout;
    } else if (result.stderr) {
      combined = result.stderr;
    } else {
      combined = '(No output)';
    }

    // Truncate output if exceeding maxOutputBytes
    if (Buffer.byteLength(combined, 'utf8') > this.maxOutputBytes) {
      const truncated = combined.slice(0, this.maxOutputBytes);
      combined = `${truncated}\n\n[Output truncated: exceeded ${this.maxOutputBytes} bytes]`;
    }

    if (result.exitCode !== 0) {
      return `Command failed with exit code ${result.exitCode}:\n${combined}`;
    }

    return combined;
  }
}
