import { WorkspaceIndex } from '@forge/state';
import { AgentIgnoreFilter } from '@forge/safety';
import { CompletionRequest } from './types.js';

export interface ContextExtractorOptions {
  readonly maxPrefixChars?: number | undefined;
  readonly maxSuffixChars?: number | undefined;
  readonly disabledLanguages?: readonly string[] | undefined;
  readonly workspaceRoot?: string | undefined;
}

export interface ExtractedCompletionContext {
  readonly prefix: string;
  readonly suffix: string;
  readonly promptPrefix: string;
  readonly relevantSymbols: readonly string[];
}

export class CompletionContextExtractor {
  private readonly maxPrefixChars: number;
  private readonly maxSuffixChars: number;
  private readonly disabledLanguages: Set<string>;
  private readonly ignoreFilter?: AgentIgnoreFilter | undefined;

  constructor(
    private readonly workspaceIndex?: WorkspaceIndex | undefined,
    options: ContextExtractorOptions = {},
  ) {
    this.maxPrefixChars = options.maxPrefixChars ?? 2500;
    this.maxSuffixChars = options.maxSuffixChars ?? 1000;
    this.disabledLanguages = new Set(
      options.disabledLanguages ?? ['markdown', 'plaintext', 'git-commit', 'env', 'dotenv'],
    );
    if (options.workspaceRoot) {
      this.ignoreFilter = new AgentIgnoreFilter(options.workspaceRoot);
    }
  }

  isLanguageDisabled(languageId?: string): boolean {
    if (!languageId) return false;
    return this.disabledLanguages.has(languageId.toLowerCase());
  }

  isPathIgnored(filePath: string): boolean {
    if (this.ignoreFilter && this.ignoreFilter.isIgnored(filePath)) {
      return true;
    }
    // Default safety checks
    const lower = filePath.toLowerCase();
    if (
      lower.includes('.env') ||
      lower.includes('id_rsa') ||
      lower.includes('node_modules') ||
      lower.includes('.git/') ||
      lower.includes('.forge/')
    ) {
      return true;
    }
    return false;
  }

  extractContext(request: CompletionRequest): ExtractedCompletionContext | null {
    // 1. Language disable check
    if (this.isLanguageDisabled(request.languageId)) {
      return null;
    }

    // 2. Ignore check
    if (this.isPathIgnored(request.filePath)) {
      return null;
    }

    // 3. Slice prefix & suffix around cursor position
    const lines = request.fileContent.split('\n');
    let offset = 0;
    for (let i = 0; i < request.position.line && i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined) {
        offset += line.length + 1; // +1 for \n
      }
    }
    offset += request.position.character;

    const fullContent = request.fileContent;
    const rawPrefix = fullContent.slice(0, offset);
    const rawSuffix = fullContent.slice(offset);

    const prefix = rawPrefix.slice(-this.maxPrefixChars);
    const suffix = rawSuffix.slice(0, this.maxSuffixChars);

    // 4. Extract imported symbols
    const imports = this.extractImports(fullContent);

    // 5. Look up index symbols matching recent word tokens
    const recentWord = this.getRecentIdentifier(rawPrefix);
    const matchedSymbols: string[] = [];

    if (this.workspaceIndex && recentWord && recentWord.length >= 2) {
      const searchMatches = this.workspaceIndex.searchSymbols(recentWord);
      for (const m of searchMatches) {
        for (const sym of m.symbols) {
          if (!matchedSymbols.includes(sym)) {
            matchedSymbols.push(sym);
          }
        }
      }
    }

    // 6. Nearby open files context (sibling files)
    let siblingSummary = '';
    if (request.openFiles && request.openFiles.length > 0) {
      const siblings = request.openFiles
        .filter((f) => f.path !== request.filePath && !this.isPathIgnored(f.path))
        .slice(0, 3);
      if (siblings.length > 0) {
        siblingSummary = siblings
          .map(
            (s) =>
              `// Sibling context from ${s.path}:\n// ${s.content.slice(0, 150).replace(/\n/g, ' ')}`,
          )
          .join('\n');
      }
    }

    // Compose enriched prompt prefix
    let promptPrefix = prefix;
    if (imports.length > 0 && !prefix.includes(imports[0] ?? '')) {
      const importHeader = `// Relevant imports: ${imports.slice(0, 10).join(', ')}\n`;
      promptPrefix = importHeader + promptPrefix;
    }
    if (siblingSummary) {
      promptPrefix = siblingSummary + '\n' + promptPrefix;
    }

    return {
      prefix,
      suffix,
      promptPrefix,
      relevantSymbols: matchedSymbols,
    };
  }

  private extractImports(content: string): readonly string[] {
    const symbols: string[] = [];
    const esImportRegex = /import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from/g;
    let match: RegExpExecArray | null;

    while ((match = esImportRegex.exec(content)) !== null) {
      if (match[1]) {
        const parts = match[1].split(',').map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim(),
        );
        for (const p of parts) {
          if (p && !symbols.includes(p)) symbols.push(p);
        }
      } else if (match[2]) {
        if (!symbols.includes(match[2])) symbols.push(match[2]);
      }
    }

    return symbols;
  }

  private getRecentIdentifier(prefix: string): string | null {
    const match = /([a-zA-Z0-9_$]{2,})$/.exec(prefix.trimEnd());
    return match ? (match[1] ?? null) : null;
  }
}
