import { FileIndexRecord, RepoMap } from './types.js';

export class RepoMapGenerator {
  generate(records: readonly FileIndexRecord[]): RepoMap {
    let symbolsCount = 0;
    const lines: string[] = ['# Repository Symbol Map', ''];

    for (const rec of records) {
      if (rec.symbols.length === 0) continue;
      lines.push(`${rec.filePath}:`);
      for (const sym of rec.symbols) {
        symbolsCount++;
        const sig = sym.signature ? ` — ${sym.signature}` : '';
        lines.push(`  - [${sym.kind}] ${sym.name} (L${sym.line})${sig}`);
      }
      lines.push('');
    }

    return {
      compactText: lines.join('\n').trim(),
      indexedFilesCount: records.length,
      symbolsCount,
    };
  }
}
