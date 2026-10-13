import path from 'node:path';

export interface IndexedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly extension: string;
  readonly sizeBytes: number;
  readonly symbols: readonly string[];
}

export class WorkspaceIndex {
  private readonly files = new Map<string, IndexedFile>();

  constructor(private readonly rootDir: string) {}

  addFile(relativePath: string, sizeBytes: number, symbols: readonly string[] = []): IndexedFile {
    const normalized = path.normalize(relativePath);
    const absolutePath = path.resolve(this.rootDir, normalized);
    const extension = path.extname(normalized);

    const record: IndexedFile = {
      relativePath: normalized,
      absolutePath,
      extension,
      sizeBytes,
      symbols,
    };

    this.files.set(normalized, record);
    return record;
  }

  getFile(relativePath: string): IndexedFile | undefined {
    return this.files.get(path.normalize(relativePath));
  }

  findFilesByExtension(ext: string): readonly IndexedFile[] {
    const formattedExt = ext.startsWith('.') ? ext : `.${ext}`;
    return Array.from(this.files.values()).filter((f) => f.extension === formattedExt);
  }

  searchSymbols(query: string): readonly IndexedFile[] {
    const lower = query.toLowerCase();
    return Array.from(this.files.values()).filter((f) =>
      f.symbols.some((sym) => sym.toLowerCase().includes(lower)),
    );
  }

  listAll(): readonly IndexedFile[] {
    return Array.from(this.files.values());
  }
}
