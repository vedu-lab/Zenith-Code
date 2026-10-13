import path from 'node:path';
import ignore from 'ignore';
import { z } from 'zod';
import { BaseTool } from './base.js';
import { IFileSystem, IProcessRunner, PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { isBinaryFile } from './read-file.js';

export const GrepInputSchema = z.object({
  query: z.string().describe('Search query string or regex pattern'),
  dirPath: z
    .string()
    .optional()
    .describe('Directory path to search in (defaults to current directory)'),
  caseSensitive: z
    .boolean()
    .optional()
    .describe('Whether match is case-sensitive (defaults to false)'),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of matching lines to return (defaults to 100)'),
});
export type GrepInput = z.infer<typeof GrepInputSchema>;

export class GrepTool extends BaseTool<GrepInput, string> {
  readonly name = 'grep';
  readonly description =
    'Search for regex pattern or string in files using ripgrep or pure search. Respects .gitignore and .agentignore.';
  readonly schema = GrepInputSchema;
  override readonly isReadOnly = true;

  constructor(
    private readonly fs: IFileSystem,
    private readonly processRunner: IProcessRunner,
    private readonly rootDir: string = process.cwd(),
    policyGate: PolicyGate,
    eventBus?: IEventBus,
  ) {
    super(policyGate, eventBus);
  }

  override getParametersSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or regex' },
        dirPath: { type: 'string', description: 'Directory to search in' },
        caseSensitive: { type: 'boolean', description: 'Case sensitive match' },
        maxResults: { type: 'number', description: 'Max matching results' },
      },
      required: ['query'],
    };
  }

  protected createIntent(input: GrepInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:read',
      target: path.normalize(input.dirPath ?? '.'),
      parameters: { query: input.query, caseSensitive: input.caseSensitive },
    };
  }

  protected async executeAction(input: GrepInput): Promise<string> {
    const searchDir = path.resolve(this.rootDir, input.dirPath ?? '.');
    const maxResults = input.maxResults ?? 100;

    // 1. Try running ripgrep via processRunner
    const rgArgs = ['--line-number', '--no-heading', '--color=never'];
    if (!input.caseSensitive) {
      rgArgs.push('-i');
    }
    rgArgs.push('-m', String(maxResults));
    rgArgs.push(input.query, searchDir);

    try {
      const rgResult = await this.processRunner.run('rg', rgArgs, { cwd: this.rootDir });
      if (rgResult.exitCode === 0 && rgResult.stdout.trim()) {
        const lines = rgResult.stdout.trim().split('\n').slice(0, maxResults);
        return lines.join('\n');
      }
      if (rgResult.exitCode === 1 && !rgResult.stderr) {
        return `No matches found for query: "${input.query}"`;
      }
    } catch {
      // Ripgrep not installed, fall back to pure JS search
    }

    // 2. Pure JS fallback search
    return this.fallbackSearch(input.query, searchDir, input.caseSensitive ?? false, maxResults);
  }

  private async fallbackSearch(
    query: string,
    dir: string,
    caseSensitive: boolean,
    maxResults: number,
  ): Promise<string> {
    const ig = ignore();
    ig.add(['.git', 'node_modules', '.DS_Store', 'dist']);

    const gitignorePath = path.join(this.rootDir, '.gitignore');
    if (await this.fs.exists(gitignorePath)) {
      try {
        ig.add(await this.fs.readFile(gitignorePath));
      } catch {
        // ignore
      }
    }

    const agentignorePath = path.join(this.rootDir, '.agentignore');
    if (await this.fs.exists(agentignorePath)) {
      try {
        ig.add(await this.fs.readFile(agentignorePath));
      } catch {
        // ignore
      }
    }

    const regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
    const matches: string[] = [];

    const walk = async (current: string) => {
      if (matches.length >= maxResults) return;
      const entries = await this.fs.readDir(current);

      for (const entry of entries) {
        if (matches.length >= maxResults) return;
        const full = path.join(current, entry);
        const rel = path.relative(this.rootDir, full).replace(/\\/g, '/');

        if (ig.ignores(rel) || ig.ignores(rel + '/')) continue;

        try {
          const stat = await this.fs.stat(full);
          if (stat.isDirectory) {
            await walk(full);
          } else {
            const content = await this.fs.readFile(full);
            if (isBinaryFile(full, content)) continue;

            const lines = content.split(/\r?\n/);
            lines.forEach((line, idx) => {
              if (matches.length >= maxResults) return;
              if (regex.test(line)) {
                regex.lastIndex = 0;
                matches.push(`${path.relative(this.rootDir, full)}:${idx + 1}:${line}`);
              }
            });
          }
        } catch {
          // ignore read error
        }
      }
    };

    await walk(dir);

    if (matches.length === 0) {
      return `No matches found for query: "${query}"`;
    }

    return matches.join('\n');
  }
}
