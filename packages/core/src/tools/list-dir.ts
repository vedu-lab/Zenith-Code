import path from 'node:path';
import ignore from 'ignore';
import { z } from 'zod';
import { BaseTool } from './base.js';
import { IFileSystem, PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { ToolExecutionError } from '../errors/index.js';

export const ListDirInputSchema = z.object({
  dirPath: z.string().optional().describe('Directory path to list (defaults to current directory)'),
  recursive: z
    .boolean()
    .optional()
    .describe('Whether to list files recursively (defaults to false)'),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Maximum recursion depth (defaults to 3)'),
});
export type ListDirInput = z.infer<typeof ListDirInputSchema>;

export class ListDirTool extends BaseTool<ListDirInput, string> {
  readonly name = 'list_dir';
  readonly description =
    'List files and directories in a path. Respects .gitignore and .agentignore rules.';
  readonly schema = ListDirInputSchema;
  override readonly isReadOnly = true;

  constructor(
    private readonly fs: IFileSystem,
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
        dirPath: { type: 'string', description: 'Directory to list' },
        recursive: { type: 'boolean', description: 'Whether to list recursively' },
        maxDepth: { type: 'number', description: 'Max depth if recursive' },
      },
    };
  }

  protected createIntent(input: ListDirInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:read',
      target: path.normalize(input.dirPath ?? '.'),
      parameters: { recursive: input.recursive, maxDepth: input.maxDepth },
    };
  }

  private async loadIgnoreFilter(): Promise<ReturnType<typeof ignore>> {
    const ig = ignore();
    ig.add(['.git', 'node_modules', '.DS_Store', 'dist']);

    const gitignorePath = path.join(this.rootDir, '.gitignore');
    if (await this.fs.exists(gitignorePath)) {
      try {
        const content = await this.fs.readFile(gitignorePath);
        ig.add(content);
      } catch {
        // ignore read error
      }
    }

    const agentignorePath = path.join(this.rootDir, '.agentignore');
    if (await this.fs.exists(agentignorePath)) {
      try {
        const content = await this.fs.readFile(agentignorePath);
        ig.add(content);
      } catch {
        // ignore read error
      }
    }

    return ig;
  }

  protected async executeAction(input: ListDirInput): Promise<string> {
    const targetDir = path.resolve(this.rootDir, input.dirPath ?? '.');
    const exists = await this.fs.exists(targetDir);
    if (!exists) {
      throw new ToolExecutionError(this.name, `Directory not found: '${targetDir}'`);
    }

    const stat = await this.fs.stat(targetDir);
    if (!stat.isDirectory) {
      throw new ToolExecutionError(this.name, `'${targetDir}' is a file, not a directory.`);
    }

    const ig = await this.loadIgnoreFilter();
    const isRecursive = input.recursive ?? false;
    const maxDepth = input.maxDepth ?? 3;

    const results: string[] = [];

    const walk = async (currentDir: string, depth: number) => {
      if (depth > maxDepth) return;
      const entries = await this.fs.readDir(currentDir);

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        const relFromRoot = path.relative(this.rootDir, fullPath).replace(/\\/g, '/');

        if (ig.ignores(relFromRoot) || ig.ignores(relFromRoot + '/')) {
          continue;
        }

        try {
          const entryStat = await this.fs.stat(fullPath);
          const relFromTarget = path.relative(targetDir, fullPath).replace(/\\/g, '/');
          const prefix = entryStat.isDirectory ? '[DIR] ' : '[FILE]';
          results.push(
            `${prefix} ${relFromTarget}${entryStat.isDirectory ? '/' : ` (${entryStat.size} bytes)`}`,
          );

          if (isRecursive && entryStat.isDirectory) {
            await walk(fullPath, depth + 1);
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    };

    await walk(targetDir, 1);

    if (results.length === 0) {
      return `Directory '${targetDir}' is empty or all contents are ignored.`;
    }

    return results.join('\n');
  }
}
