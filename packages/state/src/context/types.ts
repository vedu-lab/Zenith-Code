export type ChunkType = 'code' | 'doc' | 'log' | 'generic';

export interface ChunkMetadata {
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
  readonly symbolOrHeading?: string | undefined;
  readonly language?: string | undefined;
}

export interface SemanticChunk {
  readonly id: string;
  readonly type: ChunkType;
  readonly content: string;
  readonly tokenCount: number;
  readonly metadata: ChunkMetadata;
}

export interface MapReduceResult {
  readonly brief: string;
  readonly chunks: readonly SemanticChunk[];
  readonly totalOriginalTokens: number;
  readonly briefTokens: number;
  readonly reductionRatio: number;
}

export interface ContextWindowConfig {
  readonly maxTokens: number;
  readonly mapThresholdPercent: number; // default 60%
  readonly compactThresholdPercent: number; // default 80%
}
