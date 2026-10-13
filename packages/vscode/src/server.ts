import { WorkspaceIndex } from '@forge/state';

export interface CompletionRequest {
  readonly filePath: string;
  readonly prefix: string;
  readonly line: number;
  readonly character: number;
}

export interface CompletionItem {
  readonly label: string;
  readonly insertText: string;
  readonly detail?: string;
}

export class AutocompleteServer {
  constructor(private readonly index: WorkspaceIndex) {}

  async getCompletions(request: CompletionRequest): Promise<readonly CompletionItem[]> {
    const trimmed = request.prefix.trim();
    if (!trimmed) {
      return [];
    }

    const matchingFiles = this.index.searchSymbols(trimmed);
    const results: CompletionItem[] = [];

    for (const file of matchingFiles) {
      for (const symbol of file.symbols) {
        if (symbol.toLowerCase().includes(trimmed.toLowerCase())) {
          results.push({
            label: symbol,
            insertText: symbol,
            detail: `from ${file.relativePath}`,
          });
        }
      }
    }

    return results;
  }
}
