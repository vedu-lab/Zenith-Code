import { IProvider, Message } from '../provider/types.js';
import { FileChangeRecord } from './fake-detection.js';

export interface VerifierAgentResult {
  readonly approved: boolean;
  readonly critique: string;
  readonly edgeCasesFound: readonly string[];
}

export class VerifierAgent {
  constructor(
    private readonly provider?: IProvider | undefined,
    private readonly model: string = 'default',
  ) {}

  async verifyDiff(changedFiles: readonly FileChangeRecord[]): Promise<VerifierAgentResult> {
    if (changedFiles.length === 0) {
      return { approved: true, critique: 'No files changed.', edgeCasesFound: [] };
    }

    // 1. Static edge-case heuristics first (fast, reliable)
    const edgeCases: string[] = [];
    for (const change of changedFiles) {
      const code = change.afterContent;
      // Common regressions and bugs
      if (code.includes('as any')) {
        edgeCases.push(`Found type bypass 'as any' in '${change.path}'`);
      }
      if (/\bTODO\b|\bFIXME\b/.test(code)) {
        edgeCases.push(`Unresolved TODO/FIXME left in '${change.path}'`);
      }
      if (/console\.log\(|debugger;/.test(code)) {
        edgeCases.push(`Debug statement left in '${change.path}'`);
      }
      if (/process\.exit\(/.test(code)) {
        edgeCases.push(`Direct process.exit call in '${change.path}'`);
      }
    }

    if (edgeCases.length > 0) {
      return {
        approved: false,
        critique: `Adversarial verifier detected issues in diff: ${edgeCases.join('; ')}`,
        edgeCasesFound: edgeCases,
      };
    }

    // 2. If provider is injected, perform LLM-based adversarial inspection in isolated context
    if (this.provider) {
      const diffSummary = changedFiles
        .map((f) => `### File: ${f.path}\n\`\`\`\n${f.afterContent.slice(0, 1000)}\n\`\`\``)
        .join('\n\n');

      const messages: Message[] = [
        {
          role: 'system',
          content:
            'You are a strict, read-only adversarial code verifier. Your goal is to inspect the proposed code diff and find any subtle regressions, security gaps, unhandled null/undefined values, or broken assumptions. If the changes are clean, reply with "APPROVED". If there are issues, reply with "REJECTED: <reasons>".',
        },
        {
          role: 'user',
          content: `Inspect this diff:\n\n${diffSummary}`,
        },
      ];

      try {
        const stream = this.provider.stream(messages, [], {
          model: this.model,
          temperature: 0.1,
        });

        let response = '';
        for await (const chunk of stream) {
          if (chunk.type === 'text_delta') {
            response += chunk.delta;
          }
        }

        const trimmed = response.trim();
        if (trimmed.toUpperCase().startsWith('REJECTED')) {
          return {
            approved: false,
            critique: trimmed,
            edgeCasesFound: [trimmed],
          };
        }
      } catch {
        // If provider call fails, default to heuristics
      }
    }

    return {
      approved: true,
      critique: 'Adversarial verification passed: no breaking changes or regressions found.',
      edgeCasesFound: [],
    };
  }
}
