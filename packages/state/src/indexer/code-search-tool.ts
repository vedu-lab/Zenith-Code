import { z } from 'zod';
import { BaseTool, IEventBus, PolicyGate, ToolActionIntent, AllowAllPolicyGate } from '@forge/core';
import { CodeIndex } from './code-index.js';

export const CodeSearchInputSchema = z.object({
  query: z.string().describe('Search query for symbol names, classes, functions, or signatures'),
});

export type CodeSearchInput = z.infer<typeof CodeSearchInputSchema>;

export class CodeSearchTool extends BaseTool<CodeSearchInput, string> {
  readonly name = 'code_search';
  readonly description =
    'Search across indexed codebase symbols (functions, classes, interfaces, types) by name or signature.';
  readonly schema = CodeSearchInputSchema;
  override readonly isReadOnly = true;

  constructor(
    private readonly index: CodeIndex,
    policyGate?: PolicyGate,
    eventBus?: IEventBus,
  ) {
    super(policyGate ?? new AllowAllPolicyGate(), eventBus);
  }

  override getParametersSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for symbol names, classes, functions, or signatures',
        },
      },
      required: ['query'],
    };
  }

  protected createIntent(input: CodeSearchInput): ToolActionIntent {
    return {
      toolName: this.name,
      actionType: 'fs:read',
      target: input.query,
      parameters: { query: input.query },
    };
  }

  protected async executeAction(input: CodeSearchInput): Promise<string> {
    const results = this.index.search(input.query);
    if (results.length === 0) {
      return `No symbols found matching "${input.query}".`;
    }

    const lines: string[] = [`Found matches across ${results.length} files:`];
    for (const r of results) {
      lines.push(`\n${r.filePath}:`);
      for (const m of r.matches) {
        const sig = m.symbol.signature ? ` (${m.symbol.signature})` : '';
        lines.push(`  - [${m.symbol.kind}] ${m.symbol.name} at line ${m.symbol.line}${sig}`);
      }
    }

    return lines.join('\n');
  }
}
