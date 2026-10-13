export type MemorySource = 'user' | 'observed' | 'inferred' | 'imported';
export type MemoryScope = 'project' | 'user' | 'global';
export type MemoryStatus = 'active' | 'stale' | 'deleted';

export interface MemoryEntry {
  readonly id: string;
  readonly statement: string;
  readonly source: MemorySource;
  readonly evidence: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly confidence: number;
  readonly scope: MemoryScope;
  readonly status: MemoryStatus;
  readonly expiresAt?: number | undefined;
}

export interface ProposedMemory {
  readonly id: string;
  readonly statement: string;
  readonly source: MemorySource;
  readonly evidence: string;
  readonly confidence: number;
  readonly scope: MemoryScope;
  readonly expiresAt?: number | undefined;
  readonly proposedAt: number;
}

export interface MemorySearchOptions {
  readonly query?: string | undefined;
  readonly scope?: MemoryScope | undefined;
  readonly status?: MemoryStatus | undefined;
  readonly minConfidence?: number | undefined;
  readonly limit?: number | undefined;
}
