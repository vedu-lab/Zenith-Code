import fs from 'node:fs';
import path from 'node:path';
import { CodeIndex } from './code-index.js';

export interface WorkspaceSymbolMatch {
  readonly relativePath: string;
  readonly symbols: readonly string[];
}

export interface WorkspaceFileRecord {
  readonly path: string;
  readonly size: number;
  readonly symbols: readonly string[];
}

export class WorkspaceIndex {
  private readonly codeIndex: CodeIndex;
  private readonly manualFiles = new Map<string, WorkspaceFileRecord>();

  constructor(public readonly workspaceRoot: string) {
    this.codeIndex = new CodeIndex({ workspaceRoot });
  }

  addFile(filePath: string, size: number, symbols: readonly string[]): void {
    this.manualFiles.set(filePath, { path: filePath, size, symbols });
    const dummyContent = symbols.map((s) => `export function ${s}() {}`).join('\n');
    this.codeIndex.updateFile(filePath, dummyContent);
  }

  findFilesByExtension(ext: string): readonly WorkspaceFileRecord[] {
    const results: WorkspaceFileRecord[] = [];
    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
    for (const file of this.manualFiles.values()) {
      if (file.path.endsWith(normalizedExt)) {
        results.push(file);
      }
    }
    return results;
  }

  searchSymbols(query: string): readonly WorkspaceSymbolMatch[] {
    const results = this.codeIndex.search(query);
    const fromCodeIndex = results.map((r) => ({
      relativePath: r.filePath,
      symbols: r.matches.map((m) => m.symbol.name),
    }));

    const matchedPaths = new Set(fromCodeIndex.map((m) => m.relativePath));
    const lower = query.toLowerCase();
    for (const file of this.manualFiles.values()) {
      if (!matchedPaths.has(file.path)) {
        const matching = file.symbols.filter((s) => s.toLowerCase().includes(lower));
        if (matching.length > 0) {
          fromCodeIndex.push({
            relativePath: file.path,
            symbols: matching,
          });
        }
      }
    }

    return fromCodeIndex;
  }

  async build(): Promise<void> {
    if (!fs.existsSync(this.workspaceRoot)) return;
    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(this.workspaceRoot, full);
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name.startsWith('.forge')
        ) {
          continue;
        }
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            this.codeIndex.updateFile(rel, content);
          } catch {
            // Ignore unreadable
          }
        }
      }
    };
    walk(this.workspaceRoot);
  }
}
