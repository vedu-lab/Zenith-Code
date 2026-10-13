import { SemanticChunk, ChunkType } from './types.js';
import { countTokens } from './token-counter.js';

export interface ChunkerOptions {
  readonly targetChunkTokens?: number | undefined; // default 1500
  readonly maxChunkTokens?: number | undefined; // default 3000
}

export class SemanticChunker {
  private readonly targetChunkTokens: number;
  private readonly maxChunkTokens: number;

  constructor(options: ChunkerOptions = {}) {
    this.targetChunkTokens = options.targetChunkTokens ?? 1500;
    this.maxChunkTokens = options.maxChunkTokens ?? 3000;
  }

  chunk(content: string, type: ChunkType = 'generic', language?: string): readonly SemanticChunk[] {
    if (!content.trim()) return [];

    switch (type) {
      case 'doc':
        return this.chunkDocument(content);
      case 'code':
        return this.chunkCode(content, language);
      case 'log':
        return this.chunkLogs(content);
      default:
        return this.chunkGeneric(content);
    }
  }

  /**
   * Split documentation by Markdown headings (#, ##, ###).
   */
  private chunkDocument(content: string): readonly SemanticChunk[] {
    const lines = content.split('\n');
    const chunks: SemanticChunk[] = [];
    let currentLines: string[] = [];
    let currentHeading = 'Introduction';
    let startLine = 1;

    const flush = (endLine: number): void => {
      if (currentLines.length === 0) return;
      const text = currentLines.join('\n');
      const tokens = countTokens(text);
      chunks.push({
        id: `chunk-doc-${chunks.length + 1}`,
        type: 'doc',
        content: text,
        tokenCount: tokens,
        metadata: {
          startLine,
          endLine,
          symbolOrHeading: currentHeading,
        },
      });
      currentLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const headingMatch = line.match(/^#{1,4}\s+(.+)$/);

      if (headingMatch && currentLines.length > 0) {
        const estTokens = countTokens(currentLines.join('\n'));
        if (estTokens >= this.targetChunkTokens) {
          flush(i);
          startLine = i + 1;
          currentHeading = headingMatch[1]!;
        }
      }

      currentLines.push(line);
    }

    flush(lines.length);
    return chunks;
  }

  /**
   * Split code along top-level boundaries (classes, functions, interfaces).
   */
  private chunkCode(content: string, language?: string): readonly SemanticChunk[] {
    const lines = content.split('\n');
    const chunks: SemanticChunk[] = [];
    let currentLines: string[] = [];
    let currentSymbol = 'Top-level code';
    let startLine = 1;

    const flush = (endLine: number): void => {
      if (currentLines.length === 0) return;
      const text = currentLines.join('\n');
      const tokens = countTokens(text);
      chunks.push({
        id: `chunk-code-${chunks.length + 1}`,
        type: 'code',
        content: text,
        tokenCount: tokens,
        metadata: {
          startLine,
          endLine,
          symbolOrHeading: currentSymbol,
          language,
        },
      });
      currentLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Top-level function, class, interface, type declaration
      const symbolMatch = line.match(
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z0-9_]+)/,
      );

      if (symbolMatch && currentLines.length > 0) {
        const estTokens = countTokens(currentLines.join('\n'));
        if (estTokens >= this.targetChunkTokens) {
          flush(i);
          startLine = i + 1;
          currentSymbol = symbolMatch[1]!;
        }
      }

      currentLines.push(line);
    }

    flush(lines.length);
    return chunks;
  }

  /**
   * Split logs into sliding overlapping line groups.
   */
  private chunkLogs(content: string): readonly SemanticChunk[] {
    const lines = content.split('\n');
    const chunks: SemanticChunk[] = [];
    const windowLines = 100;
    const overlapLines = 20;

    let idx = 0;
    while (idx < lines.length) {
      const slice = lines.slice(idx, idx + windowLines);
      const text = slice.join('\n');
      const tokens = countTokens(text);

      chunks.push({
        id: `chunk-log-${chunks.length + 1}`,
        type: 'log',
        content: text,
        tokenCount: tokens,
        metadata: {
          startLine: idx + 1,
          endLine: Math.min(idx + windowLines, lines.length),
        },
      });

      idx += windowLines - overlapLines;
      if (idx >= lines.length && slice.length < windowLines) {
        break;
      }
    }

    return chunks;
  }

  /**
   * Split generic text by paragraphs.
   */
  private chunkGeneric(content: string): readonly SemanticChunk[] {
    const paragraphs = content.split(/\n\s*\n/);
    const chunks: SemanticChunk[] = [];
    let currentParas: string[] = [];
    let currentTokens = 0;

    for (const para of paragraphs) {
      const tokens = countTokens(para);
      if (currentTokens + tokens > this.maxChunkTokens && currentParas.length > 0) {
        const text = currentParas.join('\n\n');
        chunks.push({
          id: `chunk-gen-${chunks.length + 1}`,
          type: 'generic',
          content: text,
          tokenCount: currentTokens,
          metadata: {},
        });
        currentParas = [];
        currentTokens = 0;
      }
      currentParas.push(para);
      currentTokens += tokens;
    }

    if (currentParas.length > 0) {
      const text = currentParas.join('\n\n');
      chunks.push({
        id: `chunk-gen-${chunks.length + 1}`,
        type: 'generic',
        content: text,
        tokenCount: currentTokens,
        metadata: {},
      });
    }

    return chunks;
  }
}
