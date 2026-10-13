import path from 'node:path';
import { z } from 'zod';
import { BaseTool } from './base.js';
import { IFileSystem, PolicyGate, ToolActionIntent } from '../interfaces/index.js';
import { IEventBus } from '../events/index.js';
import { FileReadTracker } from './tracker.js';
import { ToolExecutionError, ErrorCode } from '../errors/index.js';

export const EditFileInputSchema = z.object({
  filePath: z.string().describe('The path of the file to edit'),
  oldContent: z.string().describe('The exact string to find and replace'),
  newContent: z.string().describe('The replacement string'),
});
export type EditFileInput = z.infer<typeof EditFileInputSchema>;

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

export function tryFuzzyMatch(
  fileContent: string,
  target: string,
): { matched: boolean; matchedString?: string } {
  // 1. Normalize line endings (\r\n -> \n)
  const normFile = fileContent.replace(/\r\n/g, '\n');
  const normTarget = target.replace(/\r\n/g, '\n');

  if (countOccurrences(normFile, normTarget) === 1) {
    return { matched: true, matchedString: normTarget };
  }

  // 2. Line-by-line whitespace trim
  const targetLines = normTarget.split('\n').map((l) => l.trimEnd());
  const fileLines = normFile.split('\n');

  if (targetLines.length > 0 && targetLines.length <= fileLines.length) {
    const candidateMatches: string[] = [];
    for (let i = 0; i <= fileLines.length - targetLines.length; i++) {
      let isMatch = true;
      for (let j = 0; j < targetLines.length; j++) {
        const fileLineTrimmed = fileLines[i + j]?.trimEnd();
        if (fileLineTrimmed !== targetLines[j]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        candidateMatches.push(fileLines.slice(i, i + targetLines.length).join('\n'));
      }
    }

    if (candidateMatches.length === 1 && candidateMatches[0]) {
      return { matched: true, matchedString: candidateMatches[0] };
    }
  }

  return { matched: false };
}

export class EditFileTool extends BaseTool<EditFileInput, string> {
  readonly name = 'edit_file';
  readonly description =
    'Edit an existing file by replacing oldContent with newContent. Requires an exact unique match. Falls back to fuzzy matching if needed.';
  readonly schema = EditFileInputSchema;
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
        filePath: { type: 'string', description: 'Path of the file to edit' },
        oldContent: { type: 'string', description: 'Exact string to find and replace' },
        newContent: { type: 'string', description: 'Replacement string' },
      },
      required: ['filePath', 'oldContent', 'newContent'],
    };
  }

  protected createIntent(input: EditFileInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:write',
      target: path.normalize(input.filePath),
      parameters: {
        oldContentLength: input.oldContent.length,
        newContentLength: input.newContent.length,
      },
    };
  }

  protected async executeAction(input: EditFileInput): Promise<string> {
    const normalizedPath = path.normalize(input.filePath);
    const exists = await this.fs.exists(normalizedPath);
    if (!exists) {
      throw new ToolExecutionError(this.name, `File not found: '${normalizedPath}'`);
    }

    if (!this.tracker.hasBeenRead(normalizedPath)) {
      throw new ToolExecutionError(
        this.name,
        `Cannot edit file '${normalizedPath}' without reading it first. Call read_file on '${normalizedPath}' before editing.`,
        undefined,
        { code: ErrorCode.FILE_NOT_READ_BEFORE_WRITE, filePath: normalizedPath },
      );
    }

    const currentContent = await this.fs.readFile(normalizedPath);
    const exactCount = countOccurrences(currentContent, input.oldContent);

    let stringToReplace = input.oldContent;

    if (exactCount === 0) {
      // Fuzzy fallback
      const fuzzy = tryFuzzyMatch(currentContent, input.oldContent);
      if (fuzzy.matched && fuzzy.matchedString) {
        stringToReplace = fuzzy.matchedString;
      } else {
        const firstLine = input.oldContent.split(/\r?\n/)[0]?.slice(0, 60) ?? '';
        throw new ToolExecutionError(
          this.name,
          `Could not find 'oldContent' in '${normalizedPath}'. First line of target was: "${firstLine}". Please check line numbers and exact formatting.`,
          undefined,
          { code: ErrorCode.EDIT_NO_MATCH, filePath: normalizedPath },
        );
      }
    } else if (exactCount > 1) {
      throw new ToolExecutionError(
        this.name,
        `Found ${exactCount} occurrences of 'oldContent' in '${normalizedPath}'. Please include more surrounding context lines to make the replacement unique.`,
        undefined,
        { code: ErrorCode.EDIT_MULTIPLE_MATCHES, count: exactCount, filePath: normalizedPath },
      );
    }

    const updatedContent = currentContent.replace(stringToReplace, input.newContent);
    const finalContent = this.fs.preserveLineEndings(currentContent, updatedContent);

    await this.fs.writeFile(normalizedPath, finalContent);
    this.tracker.markRead(normalizedPath);

    if (this.eventBus) {
      await this.eventBus.publish({
        id: `evt-fedit-${Date.now()}`,
        type: 'file.written',
        timestamp: Date.now(),
        actor: 'tool',
        payload: {
          filePath: normalizedPath,
          byteCount: Buffer.byteLength(finalContent, 'utf8'),
          isNew: false,
        },
      });
    }

    return `Successfully updated '${normalizedPath}'.`;
  }
}
