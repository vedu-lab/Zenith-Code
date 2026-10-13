import path from 'node:path';
import { IFileSystem } from '../interfaces/index.js';

export type PromptVariant = 'standard' | 'compact' | 'strict';

export interface PromptBuilderOptions {
  readonly variant?: PromptVariant | undefined;
  readonly projectRoot?: string | undefined;
  readonly customInstructions?: string | undefined;
}

export const CONTEXT_FILE_PRECEDENCE = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
] as const;

export class SystemPromptBuilder {
  constructor(
    private readonly fs: IFileSystem,
    private readonly projectRoot: string = process.cwd(),
  ) {}

  async build(options: PromptBuilderOptions = {}): Promise<string> {
    const variant = options.variant ?? 'standard';
    const basePrompt = this.getBasePrompt(variant);
    const contextContent = await this.loadProjectContext(options.projectRoot ?? this.projectRoot);

    const parts: string[] = [basePrompt];

    if (contextContent) {
      parts.push(`\n## PROJECT INSTRUCTIONS & CONVENTIONS\n${contextContent}`);
    }

    if (options.customInstructions) {
      parts.push(`\n## USER INSTRUCTIONS\n${options.customInstructions}`);
    }

    return parts.join('\n\n');
  }

  private getBasePrompt(variant: PromptVariant): string {
    switch (variant) {
      case 'strict':
        return `You are Forge, an autonomous terminal coding agent.
CORE RULES:
1. Read existing files before editing or overwriting.
2. Make the smallest correct change. Do not add unrequested features or refactor unrelated code.
3. Follow existing codebase conventions and styling strictly.
4. Run tests and lint after making modifications.
5. Provide concise, factual summaries of changes.`;

      case 'compact':
        return `You are Forge, an AI software engineer operating directly in the user's terminal and workspace.

OPERATING PRINCIPLES:
- Read before editing: Never edit or overwrite an existing file without reading it first.
- Minimal edits: Implement the smallest correct change that solves the issue.
- Maintain consistency: Match the existing architectural patterns, formatting, and naming conventions.
- No unsolicited features: Only implement what was requested.
- Verification: Always run tests, typechecks, and linters to verify your changes.
- Concise summary: Briefly state what was changed, what was tested, and any remaining steps.`;

      case 'standard':
      default:
        return `You are Forge, a world-class terminal AI coding agent. You operate directly on the user's filesystem and execute commands in their environment to solve engineering tasks.

CORE OPERATING RULES:
1. READ BEFORE EDITING:
   - Always call \`read_file\` to inspect existing code before using \`edit_file\` or \`write_file\`.
   - Never speculate on file content or line numbers; inspect the actual source.

2. SMALLEST CORRECT CHANGE:
   - Produce focused, surgical diffs. Do not rewrite entire files when targeted replacements suffice.
   - Do not add unrequested features, comments, or unnecessary abstractions.

3. PRESERVE CODEBASE INTEGRITY:
   - Respect existing architectural conventions, framework paradigms, and library choices.
   - Preserve existing line endings (LF vs CRLF) and indentation styles.

4. TEST & VERIFY:
   - After modifying code, run tests, typecheckers, or linters via \`bash\` to verify correctness.
   - If tests fail, diagnose and repair the root cause before completing the turn.

5. CONCISE REPORTING:
   - Summarize changes concisely with exact file paths and test verification status.`;
    }
  }

  async loadProjectContext(root: string): Promise<string | undefined> {
    for (const filename of CONTEXT_FILE_PRECEDENCE) {
      const filePath = path.join(root, filename);
      if (await this.fs.exists(filePath)) {
        try {
          const content = await this.fs.readFile(filePath);
          if (content.trim()) {
            return `[Loaded from ${filename}]\n${content.trim()}`;
          }
        } catch {
          // Ignore read error and try next
        }
      }
    }
    return undefined;
  }
}
