import { WorkspaceIndex } from '@forge/state';
import { CompletionRequest, CompletionItem, IFimProvider, FimModelFamily } from './types.js';
import { CompletionCache } from './cache.js';
import { CompletionContextExtractor } from './context.js';
import { formatFimPrompt, cleanFimCompletion } from './fim-formatter.js';

export interface AutocompleteServerOptions {
  readonly provider?: IFimProvider | undefined;
  readonly cache?: CompletionCache | undefined;
  readonly extractor?: CompletionContextExtractor | undefined;
  readonly debounceMs?: number | undefined;
}

export interface AutocompleteResult {
  readonly insertText: string;
  readonly cached: boolean;
  readonly latencyMs: number;
  readonly model: string;
  readonly family: FimModelFamily;
}

export class MockFimProvider implements IFimProvider {
  readonly model: string;
  readonly family: FimModelFamily;

  constructor(
    model: string = 'qwen2.5-coder-7b',
    family: FimModelFamily = 'qwen',
    private readonly simulatedDelayMs: number = 25,
    private readonly defaultCompletion: string = '{\n  return true;\n}',
  ) {
    this.model = model;
    this.family = family;
  }

  async complete(
    _prompt: { prompt: string },
    options?: { signal?: AbortSignal },
  ): Promise<{ text: string; latencyMs: number }> {
    const start = Date.now();
    if (this.simulatedDelayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.simulatedDelayMs);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Request cancelled'));
          });
        }
      });
    }
    const latencyMs = Date.now() - start;
    return { text: this.defaultCompletion, latencyMs };
  }
}

export class AutocompleteServer {
  private readonly provider: IFimProvider;
  private readonly cache: CompletionCache;
  private readonly extractor: CompletionContextExtractor;
  private inFlightController: AbortController | null = null;
  private readonly debounceMs: number;

  constructor(
    private readonly index?: WorkspaceIndex | undefined,
    options: AutocompleteServerOptions = {},
  ) {
    this.provider = options.provider ?? new MockFimProvider();
    this.cache = options.cache ?? new CompletionCache();
    this.extractor =
      options.extractor ??
      new CompletionContextExtractor(this.index, {
        workspaceRoot: this.index?.workspaceRoot,
      });
    this.debounceMs = options.debounceMs ?? 0;
  }

  // Legacy method for backwards compatibility with previous tests
  async getCompletions(request: {
    filePath: string;
    prefix: string;
    line: number;
    character: number;
  }): Promise<readonly CompletionItem[]> {
    const trimmed = request.prefix.trim();
    if (!trimmed) {
      return [];
    }

    if (this.index) {
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

      if (results.length > 0) return results;
    }

    // Try FIM completion
    const fimResult = await this.complete({
      filePath: request.filePath,
      fileContent: request.prefix,
      position: { line: request.line, character: request.character },
    });

    if (fimResult && fimResult.insertText) {
      return [
        {
          label: fimResult.insertText.slice(0, 30),
          insertText: fimResult.insertText,
          cached: fimResult.cached,
          latencyMs: fimResult.latencyMs,
          detail: `${fimResult.model} (${fimResult.latencyMs}ms)`,
        },
      ];
    }

    return [];
  }

  // High performance low-latency FIM inline completion method
  async complete(request: CompletionRequest): Promise<AutocompleteResult | null> {
    const startTime = Date.now();

    // 1. Cancel previous in-flight request for debounce / typing responsiveness
    if (this.inFlightController) {
      this.inFlightController.abort();
      this.inFlightController = null;
    }

    const abortController = new AbortController();
    this.inFlightController = abortController;

    // Propagate external signal cancellation if present
    if (request.signal) {
      request.signal.addEventListener('abort', () => abortController.abort());
    }

    // 2. Debounce if configured
    if (this.debounceMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.debounceMs);
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Request cancelled by debounce'));
        });
      });
    }

    // 3. Extract prefix / suffix / imports / context
    const ctx = this.extractor.extractContext(request);
    if (!ctx) {
      return null;
    }

    // 4. Cache check (< 1 ms latency)
    const cachedText = this.cache.get(
      request.filePath,
      ctx.prefix,
      ctx.suffix,
      this.provider.model,
    );
    if (cachedText !== null) {
      return {
        insertText: cachedText,
        cached: true,
        latencyMs: Date.now() - startTime,
        model: this.provider.model,
        family: this.provider.family,
      };
    }

    // 5. Format FIM prompt
    const fimPrompt = formatFimPrompt(ctx.promptPrefix, ctx.suffix, this.provider.family);

    // 6. Invoke provider
    try {
      const response = await this.provider.complete(fimPrompt, {
        signal: abortController.signal,
        maxTokens: 128,
        temperature: 0.1,
      });

      const cleanedText = cleanFimCompletion(response.text);
      if (!cleanedText.trim()) {
        return null;
      }

      // Store in LRU cache
      this.cache.set(request.filePath, ctx.prefix, ctx.suffix, this.provider.model, cleanedText);

      const totalLatency = Date.now() - startTime;
      return {
        insertText: cleanedText,
        cached: false,
        latencyMs: totalLatency,
        model: this.provider.model,
        family: this.provider.family,
      };
    } catch (err) {
      if (abortController.signal.aborted) {
        return null; // Gracefully handle cancellation
      }
      throw err;
    } finally {
      if (this.inFlightController === abortController) {
        this.inFlightController = null;
      }
    }
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
