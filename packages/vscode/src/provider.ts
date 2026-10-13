import {
  InlineCompletionList,
  InlineCompletionContext,
  CancellationToken,
  CompletionPosition,
} from './types.js';
import { AutocompleteServer } from './server.js';

export interface MinimalTextDocument {
  readonly uri: { readonly fsPath: string };
  readonly getText: () => string;
  readonly languageId: string;
}

export class ForgeInlineCompletionProvider {
  private activeCompletion: string | null = null;

  constructor(private readonly server: AutocompleteServer) {}

  async provideInlineCompletionItems(
    document: MinimalTextDocument,
    position: CompletionPosition,
    _context: InlineCompletionContext,
    token?: CancellationToken,
  ): Promise<InlineCompletionList | null> {
    if (token?.isCancellationRequested) {
      return null;
    }

    const abortController = new AbortController();
    if (token) {
      token.onCancellationRequested(() => {
        abortController.abort();
      });
    }

    const result = await this.server.complete({
      filePath: document.uri.fsPath,
      fileContent: document.getText(),
      position,
      languageId: document.languageId,
      signal: abortController.signal,
    });

    if (!result || !result.insertText) {
      this.activeCompletion = null;
      return null;
    }

    this.activeCompletion = result.insertText;

    return {
      items: [
        {
          insertText: result.insertText,
        },
      ],
    };
  }

  // Helper for accepting the entire completion (Tab)
  acceptFull(): string | null {
    const text = this.activeCompletion;
    this.activeCompletion = null;
    return text;
  }

  // Helper for dismissing completion (Esc)
  dismiss(): void {
    this.activeCompletion = null;
  }

  // Helper for partial acceptance by word
  acceptNextWord(completionText?: string): { accepted: string; remainder: string } {
    const text = completionText ?? this.activeCompletion ?? '';
    if (!text) {
      return { accepted: '', remainder: '' };
    }

    // Match leading whitespace + first word or punctuation cluster
    const match = /^(\s*[a-zA-Z0-9_$]+|\s*[^a-zA-Z0-9_\s]+)/.exec(text);
    if (!match || !match[1]) {
      return { accepted: text, remainder: '' };
    }

    const accepted = match[1];
    const remainder = text.slice(accepted.length);
    this.activeCompletion = remainder;
    return { accepted, remainder };
  }

  // Helper for partial acceptance by line
  acceptNextLine(completionText?: string): { accepted: string; remainder: string } {
    const text = completionText ?? this.activeCompletion ?? '';
    if (!text) {
      return { accepted: '', remainder: '' };
    }

    const newlineIdx = text.indexOf('\n');
    if (newlineIdx === -1) {
      this.activeCompletion = null;
      return { accepted: text, remainder: '' };
    }

    const accepted = text.slice(0, newlineIdx + 1);
    const remainder = text.slice(newlineIdx + 1);
    this.activeCompletion = remainder;
    return { accepted, remainder };
  }

  getActiveCompletion(): string | null {
    return this.activeCompletion;
  }
}
