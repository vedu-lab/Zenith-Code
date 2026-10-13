import { SemanticChunk, MapReduceResult } from './types.js';
import { countTokens } from './token-counter.js';

export interface SummarizeFn {
  (chunk: SemanticChunk): Promise<string>;
}

export class MapReduceSummarizer {
  constructor(private readonly summarizeFn?: SummarizeFn | undefined) {}

  /**
   * Summarizes a collection of semantic chunks in parallel (Map step),
   * then synthesizes a structured brief with chunk IDs for retrieval (Reduce step).
   */
  async summarize(chunks: readonly SemanticChunk[]): Promise<MapReduceResult> {
    if (chunks.length === 0) {
      return {
        brief: '',
        chunks: [],
        totalOriginalTokens: 0,
        briefTokens: 0,
        reductionRatio: 0,
      };
    }

    const totalOriginalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

    // Map step: parallel summarization per chunk
    const mapPromises = chunks.map(async (chunk) => {
      if (this.summarizeFn) {
        const summary = await this.summarizeFn(chunk);
        return { chunkId: chunk.id, summary, chunk };
      }

      // Default deterministic extractive summary
      const lines = chunk.content.trim().split('\n');
      const firstLines = lines.slice(0, 3).join(' ');
      const symbolInfo = chunk.metadata.symbolOrHeading
        ? `[${chunk.metadata.symbolOrHeading}] `
        : '';
      const summary = `${symbolInfo}${firstLines.slice(0, 160)}... (${chunk.tokenCount} tokens)`;
      return { chunkId: chunk.id, summary, chunk };
    });

    const mapped = await Promise.all(mapPromises);

    // Reduce step: combine into structured brief with chunk IDs
    const sections: string[] = [
      `# Structured Summary Brief (${chunks.length} chunks, ${totalOriginalTokens} tokens reduced)`,
      '',
    ];

    for (const item of mapped) {
      sections.push(
        `## Chunk [${item.chunkId}] (Type: ${item.chunk.type}${item.chunk.metadata.symbolOrHeading ? `, Symbol: ${item.chunk.metadata.symbolOrHeading}` : ''})`,
        item.summary,
        '',
      );
    }

    const brief = sections.join('\n');
    const briefTokens = countTokens(brief);
    const reductionRatio =
      totalOriginalTokens > 0 ? Number((1 - briefTokens / totalOriginalTokens).toFixed(2)) : 0;

    return {
      brief,
      chunks,
      totalOriginalTokens,
      briefTokens,
      reductionRatio,
    };
  }
}
