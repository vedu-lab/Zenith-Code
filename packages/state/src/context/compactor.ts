import { countTokens } from './token-counter.js';

export interface AgentTurnMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
}

export class ContextCompactor {
  /**
   * Compacts conversation history when cumulative tokens exceed threshold (default 80%).
   * Retains system prompt, user initial task, and the most recent N turns intact;
   * summarizes intermediate turns into a concise recap turn.
   */
  compactTurns(
    turns: readonly AgentTurnMessage[],
    maxWindowTokens: number,
    thresholdPercent = 80,
    keepRecentTurns = 4,
  ): { compacted: boolean; turns: readonly AgentTurnMessage[]; totalTokens: number } {
    const fullText = turns.map((t) => t.content).join('\n');
    const totalTokens = countTokens(fullText);

    if (
      (totalTokens / maxWindowTokens) * 100 < thresholdPercent ||
      turns.length <= keepRecentTurns + 2
    ) {
      return { compacted: false, turns, totalTokens };
    }

    const firstTurn = turns[0]!;
    const recentTurns = turns.slice(-keepRecentTurns);
    const middleTurns = turns.slice(1, -keepRecentTurns);

    const middleSummary = middleTurns
      .map((t, i) => `[Turn ${i + 1} ${t.role}]: ${t.content.slice(0, 120)}...`)
      .join('\n');

    const summaryTurn: AgentTurnMessage = {
      role: 'assistant',
      content: `[Context Compaction: ${middleTurns.length} earlier turns summarized]\n${middleSummary}`,
    };

    const newTurns = [firstTurn, summaryTurn, ...recentTurns];
    const newTotal = countTokens(newTurns.map((t) => t.content).join('\n'));

    return {
      compacted: true,
      turns: newTurns,
      totalTokens: newTotal,
    };
  }

  /**
   * Truncates oversized tool outputs with a retrieval hint.
   */
  truncateToolOutput(
    output: string,
    maxBytes = 20000,
    retrievalHint = 'Use read_file or grep to inspect detailed output.',
  ): { text: string; truncated: boolean } {
    const byteLength = Buffer.byteLength(output, 'utf8');
    if (byteLength <= maxBytes) {
      return { text: output, truncated: false };
    }

    const half = Math.floor(maxBytes / 2);
    const head = output.slice(0, half);
    const tail = output.slice(-half);
    const omittedBytes = byteLength - maxBytes;

    const marker = `\n\n... [TRUNCATED ${omittedBytes} bytes. ${retrievalHint}] ...\n\n`;
    return {
      text: head + marker + tail,
      truncated: true,
    };
  }
}
