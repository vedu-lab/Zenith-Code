import path from 'node:path';
import { z } from 'zod';
import { BaseTool } from './base.js';
import { IFileSystem, PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { FileReadTracker } from './tracker.js';
import { ToolExecutionError, ErrorCode } from '../errors/index.js';
import { countOccurrences, tryFuzzyMatch } from './edit-file.js';

export const SingleEditSchema = z.object({
  filePath: z.string().describe('File path to edit'),
  oldContent: z.string().describe('Exact string to replace'),
  newContent: z.string().describe('Replacement string'),
});

export const MultiEditInputSchema = z.object({
  edits: z.array(SingleEditSchema).min(1).describe('Array of file edits to apply atomically'),
});
export type MultiEditInput = z.infer<typeof MultiEditInputSchema>;

export class MultiEditTool extends BaseTool<MultiEditInput, string> {
  readonly name = 'multi_edit';
  readonly description =
    'Apply multiple file edits atomically. If any single edit fails validation, no changes are made to disk.';
  readonly schema = MultiEditInputSchema;
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
        edits: {
          type: 'array',
          description: 'Array of edits to apply atomically',
          items: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              oldContent: { type: 'string' },
              newContent: { type: 'string' },
            },
            required: ['filePath', 'oldContent', 'newContent'],
          },
        },
      },
      required: ['edits'],
    };
  }

  protected createIntent(input: MultiEditInput): ToolActionIntent {
    const targets = input.edits
      .map((e) => path.normalize(e.filePath.replace(/\\/g, path.sep)))
      .join(', ');
    return {
      toolName: this.name,
      actionType: 'fs:write',
      target: targets,
      parameters: { editCount: input.edits.length },
    };
  }

  protected async executeAction(input: MultiEditInput): Promise<string> {
    // 1. Group edits by file
    const fileContents = new Map<string, string>();
    const plannedChanges = new Map<string, Array<{ old: string; newStr: string }>>();

    // Phase 1: In-memory validation
    for (let idx = 0; idx < input.edits.length; idx++) {
      const edit = input.edits[idx]!;
      const normalizedPath = path.normalize(edit.filePath.replace(/\\/g, path.sep));

      let content = fileContents.get(normalizedPath);
      if (content === undefined) {
        const exists = await this.fs.exists(normalizedPath);
        if (!exists) {
          throw new ToolExecutionError(
            this.name,
            `Atomic multi_edit failed at edit #${idx + 1}: File not found: '${normalizedPath}'. No files were modified.`,
          );
        }
        if (!this.tracker.hasBeenRead(normalizedPath)) {
          throw new ToolExecutionError(
            this.name,
            `Atomic multi_edit failed at edit #${idx + 1}: File '${normalizedPath}' has not been read yet. Call read_file first. No files were modified.`,
            undefined,
            { code: ErrorCode.FILE_NOT_READ_BEFORE_WRITE, filePath: normalizedPath },
          );
        }
        content = await this.fs.readFile(normalizedPath);
        fileContents.set(normalizedPath, content);
        plannedChanges.set(normalizedPath, []);
      }

      let stringToReplace = edit.oldContent;
      const count = countOccurrences(content, stringToReplace);

      if (count === 0) {
        const fuzzy = tryFuzzyMatch(content, stringToReplace);
        if (fuzzy.matched && fuzzy.matchedString) {
          stringToReplace = fuzzy.matchedString;
        } else {
          throw new ToolExecutionError(
            this.name,
            `Atomic multi_edit failed at edit #${idx + 1} for '${normalizedPath}': oldContent not found. No files were modified.`,
            undefined,
            { code: ErrorCode.EDIT_NO_MATCH, filePath: normalizedPath },
          );
        }
      } else if (count > 1) {
        throw new ToolExecutionError(
          this.name,
          `Atomic multi_edit failed at edit #${idx + 1} for '${normalizedPath}': oldContent matches ${count} times. Provide more context. No files were modified.`,
          undefined,
          { code: ErrorCode.EDIT_MULTIPLE_MATCHES, filePath: normalizedPath },
        );
      }

      // Apply replacement in memory
      const updated = content.replace(stringToReplace, edit.newContent);
      fileContents.set(normalizedPath, updated);
      plannedChanges.get(normalizedPath)?.push({ old: stringToReplace, newStr: edit.newContent });
    }

    // Phase 2: Commit all changes to disk
    const modifiedFiles: string[] = [];
    for (const [filePath, updatedContent] of fileContents.entries()) {
      const existing = await this.fs.readFile(filePath);
      const finalContent = this.fs.preserveLineEndings(existing, updatedContent);

      await this.fs.writeFile(filePath, finalContent);
      this.tracker.markRead(filePath);
      modifiedFiles.push(filePath);

      if (this.eventBus) {
        await this.eventBus.publish({
          id: `evt-fmulti-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'file.written',
          timestamp: Date.now(),
          actor: 'tool',
          payload: {
            filePath,
            byteCount: Buffer.byteLength(finalContent, 'utf8'),
            isNew: false,
          },
        });
      }
    }

    return `Atomic multi_edit succeeded. Applied ${input.edits.length} edits across ${modifiedFiles.length} files: ${modifiedFiles.join(', ')}.`;
  }
}
