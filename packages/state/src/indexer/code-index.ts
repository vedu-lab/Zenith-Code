import { FileIndexRecord, CodeSearchResult, RepoMap } from './types.js';
import { computeFileHash, extractSymbols } from './parser.js';
import { RepoMapGenerator } from './repo-map.js';

export class CodeIndex {
  private readonly records = new Map<string, FileIndexRecord>();
  private readonly repoMapGen = new RepoMapGenerator();
  readonly workspaceRoot?: string | undefined;

  constructor(options: { workspaceRoot?: string | undefined } = {}) {
    this.workspaceRoot = options.workspaceRoot;
  }

  /**
   * Updates index for a file incrementally.
   * If the file hash matches the previous index record, re-parsing is skipped!
   */
  updateFile(filePath: string, content: string): { updated: boolean; symbolsCount: number } {
    const hash = computeFileHash(content);
    const existing = this.records.get(filePath);

    // Incremental optimization: skip re-parsing if hash hasn't changed
    if (existing && existing.hash === hash) {
      return { updated: false, symbolsCount: existing.symbols.length };
    }

    const symbols = extractSymbols(content, filePath);
    const record: FileIndexRecord = {
      filePath,
      hash,
      symbols,
      lastIndexedMs: Date.now(),
    };

    this.records.set(filePath, record);
    return { updated: true, symbolsCount: symbols.length };
  }

  removeFile(filePath: string): boolean {
    return this.records.delete(filePath);
  }

  getFileRecord(filePath: string): FileIndexRecord | undefined {
    return this.records.get(filePath);
  }

  search(query: string): readonly CodeSearchResult[] {
    const lower = query.toLowerCase();
    const results: CodeSearchResult[] = [];

    for (const record of this.records.values()) {
      const matchingSymbols = record.symbols.filter(
        (sym) =>
          sym.name.toLowerCase().includes(lower) ||
          sym.signature?.toLowerCase().includes(lower) ||
          sym.kind.toLowerCase().includes(lower),
      );

      if (matchingSymbols.length > 0) {
        results.push({
          filePath: record.filePath,
          matches: matchingSymbols.map((symbol) => ({ symbol })),
        });
      }
    }

    return results;
  }

  generateRepoMap(): RepoMap {
    return this.repoMapGen.generate(Array.from(this.records.values()));
  }

  getAllRecords(): readonly FileIndexRecord[] {
    return Array.from(this.records.values());
  }

  clear(): void {
    this.records.clear();
  }
}
