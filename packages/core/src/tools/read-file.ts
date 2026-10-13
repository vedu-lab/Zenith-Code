import path from 'node:path';
import { z } from 'zod';
import { BaseTool } from './base.js';
import { IFileSystem, PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { FileReadTracker } from './tracker.js';
import { ToolExecutionError, ErrorCode } from '../errors/index.js';

export const ReadFileInputSchema = z.object({
  filePath: z.string().describe('The path of the file to read'),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('1-indexed line number to start reading from'),
  limit: z.number().int().positive().optional().describe('Maximum number of lines to read'),
});
export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.exe',
  '.bin',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.node',
  '.pyc',
  '.class',
]);

export function isBinaryFile(filePath: string, content: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return true;
  }
  // Check for null byte in the first 8000 characters
  return content.slice(0, 8000).includes('\0');
}

export class ReadFileTool extends BaseTool<ReadFileInput, string> {
  readonly name = 'read_file';
  readonly description =
    'Read the contents of a file with line numbers. Refuses binary files. Can read subsets via offset and limit.';
  readonly schema = ReadFileInputSchema;
  override readonly isReadOnly = true;

  constructor(
    private readonly fs: IFileSystem,
    private readonly tracker: FileReadTracker,
    policyGate: PolicyGate,
    eventBus?: IEventBus,
  ) {
    super(policyGate, eventBus);
  }

  override getParametersSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file to read' },
        offset: { type: 'number', description: '1-indexed line number to start reading from' },
        limit: { type: 'number', description: 'Number of lines to return' },
      },
      required: ['filePath'],
    };
  }

  protected createIntent(input: ReadFileInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:read',
      target: path.normalize(input.filePath.replace(/\\/g, path.sep)),
      parameters: { offset: input.offset, limit: input.limit },
    };
  }

  protected async executeAction(input: ReadFileInput): Promise<string> {
    const normalizedPath = path.normalize(input.filePath.replace(/\\/g, path.sep));
    const exists = await this.fs.exists(normalizedPath);
    if (!exists) {
      throw new ToolExecutionError(this.name, `File not found: '${normalizedPath}'`);
    }

    const rawContent = await this.fs.readFile(normalizedPath);
    if (isBinaryFile(normalizedPath, rawContent)) {
      throw new ToolExecutionError(
        this.name,
        `Cannot read binary file '${normalizedPath}'. Only text files are supported.`,
        undefined,
        { code: ErrorCode.BINARY_FILE_REFUSED },
      );
    }

    this.tracker.markRead(normalizedPath);

    const lines = rawContent.split(/\r?\n/);
    const totalLines = lines.length;
    const startLine = input.offset ?? 1;
    const maxLines = input.limit ?? totalLines;

    const startIndex = Math.max(0, startLine - 1);
    const endIndex = Math.min(totalLines, startIndex + maxLines);

    const selectedLines = lines.slice(startIndex, endIndex);
    const numberedLines = selectedLines.map((line, idx) => {
      const lineNum = startIndex + idx + 1;
      return `${String(lineNum).padStart(6, ' ')} | ${line}`;
    });

    if (this.eventBus) {
      await this.eventBus.publish({
        id: `evt-fread-${Date.now()}`,
        type: 'file.read',
        timestamp: Date.now(),
        actor: 'tool',
        payload: {
          filePath: normalizedPath,
          lineCount: selectedLines.length,
          byteCount: Buffer.byteLength(selectedLines.join('\n'), 'utf8'),
        },
      });
    }

    return numberedLines.join('\n');
  }
}
