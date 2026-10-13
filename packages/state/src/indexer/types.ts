export type SymbolKind =
  'function' | 'class' | 'interface' | 'type' | 'method' | 'variable' | 'enum';

export interface SymbolInfo {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly line: number;
  readonly signature?: string | undefined;
}

export interface FileIndexRecord {
  readonly filePath: string;
  readonly hash: string; // SHA-256
  readonly symbols: readonly SymbolInfo[];
  readonly lastIndexedMs: number;
}

export interface SymbolMatch {
  readonly symbol: SymbolInfo;
  readonly lineContent?: string | undefined;
}

export interface CodeSearchResult {
  readonly filePath: string;
  readonly matches: readonly SymbolMatch[];
}

export interface RepoMap {
  readonly compactText: string;
  readonly indexedFilesCount: number;
  readonly symbolsCount: number;
}
