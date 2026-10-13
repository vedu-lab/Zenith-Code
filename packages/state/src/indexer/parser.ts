import crypto from 'node:crypto';
import { SymbolInfo, SymbolKind } from './types.js';

export function computeFileHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Extracts top-level and exported code symbols across multiple programming languages.
 */
export function extractSymbols(content: string, filePath: string): readonly SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split('\n');
  const ext = filePath.split('.').pop()?.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // TypeScript / JavaScript
    if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
      const match = line.match(
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z0-9_]+)/,
      );
      if (match) {
        let kind: SymbolKind = 'function';
        if (line.includes('class ')) kind = 'class';
        else if (line.includes('interface ')) kind = 'interface';
        else if (line.includes('type ')) kind = 'type';
        else if (line.includes('enum ')) kind = 'enum';
        else if (line.includes('const ')) kind = 'variable';

        symbols.push({
          name: match[1]!,
          kind,
          line: lineNum,
          signature: line.trim(),
        });
      }
    }
    // Python
    else if (ext === 'py') {
      const classMatch = line.match(/^class\s+([A-Za-z0-9_]+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1]!,
          kind: 'class',
          line: lineNum,
          signature: line.trim(),
        });
      }
      const funcMatch = line.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1]!,
          kind: 'function',
          line: lineNum,
          signature: line.trim(),
        });
      }
    }
    // Go
    else if (ext === 'go') {
      const typeMatch = line.match(/^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1]!,
          kind: 'interface',
          line: lineNum,
          signature: line.trim(),
        });
      }
      const funcMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1]!,
          kind: 'function',
          line: lineNum,
          signature: line.trim(),
        });
      }
    }
    // Rust
    else if (ext === 'rs') {
      const structMatch = line.match(/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z0-9_]+)/);
      if (structMatch) {
        symbols.push({
          name: structMatch[1]!,
          kind: 'class',
          line: lineNum,
          signature: line.trim(),
        });
      }
      const fnMatch = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1]!,
          kind: 'function',
          line: lineNum,
          signature: line.trim(),
        });
      }
    }
  }

  return symbols;
}
