import path from 'node:path';
import { z } from 'zod';
import { BaseTool } from './base.js';
import { IFileSystem, PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { FileReadTracker } from './tracker.js';
import { ToolExecutionError, ErrorCode } from '../errors/index.js';

export const WriteFileInputSchema = z.object({
  filePath: z.string().describe('The path of the file to write'),
  content: z.string().describe('The full content to write to the file'),
});
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

export class WriteFileTool extends BaseTool<WriteFileInput, string> {
  readonly name = 'write_file';
  readonly description =
    'Write content to a file. If the file already exists, it MUST have been read first using read_file.';
  readonly schema = WriteFileInputSchema;
  override readonly isReadOnly = false;

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
        filePath: { type: 'string', description: 'Path to file to write' },
        content: { type: 'string', description: 'File contents' },
      },
      required: ['filePath', 'content'],
    };
  }

  protected createIntent(input: WriteFileInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:write',
      target: path.normalize(input.filePath.replace(/\\/g, path.sep)),
      parameters: { bytes: Buffer.byteLength(input.content, 'utf8') },
    };
  }

  protected async executeAction(input: WriteFileInput): Promise<string> {
    const normalizedPath = path.normalize(input.filePath.replace(/\\/g, path.sep));
    const exists = await this.fs.exists(normalizedPath);

    if (exists && !this.tracker.hasBeenRead(normalizedPath)) {
      throw new ToolExecutionError(
        this.name,
        `Cannot write to existing file '${normalizedPath}' without reading it first. Call read_file on '${normalizedPath}' before modifying it.`,
        undefined,
        { code: ErrorCode.FILE_NOT_READ_BEFORE_WRITE, filePath: normalizedPath },
      );
    }

    let finalContent = input.content;
    if (exists) {
      const existing = await this.fs.readFile(normalizedPath);
      finalContent = this.fs.preserveLineEndings(existing, input.content);
    }

    await this.fs.writeFile(normalizedPath, finalContent);
    this.tracker.markRead(normalizedPath);

    const byteCount = Buffer.byteLength(finalContent, 'utf8');

    if (this.eventBus) {
      await this.eventBus.publish({
        id: `evt-fwrite-${Date.now()}`,
        type: 'file.written',
        timestamp: Date.now(),
        actor: 'tool',
        payload: {
          filePath: normalizedPath,
          byteCount,
          isNew: !exists,
        },
      });
    }

    return `Successfully wrote ${byteCount} bytes to '${normalizedPath}'.`;
  }
}
