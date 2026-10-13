import {
  IProvider,
  Message,
  ToolDefinition,
  ProviderStreamOptions,
  ProviderEvent,
} from './types.js';
import { ProviderError } from '../errors/index.js';

export class FailoverProvider implements IProvider {
  readonly name: string;
  private readonly providers: readonly IProvider[];

  constructor(providers: readonly IProvider[], customName?: string) {
    if (providers.length === 0) {
      throw new Error('FailoverProvider requires at least one provider');
    }
    this.providers = providers;
    this.name = customName ?? `failover(${providers.map((p) => p.name).join('->')})`;
  }

  async *stream(
    messages: readonly Message[],
    tools: readonly ToolDefinition[],
    options: ProviderStreamOptions = {},
  ): AsyncIterable<ProviderEvent> {
    let lastError: unknown = null;

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]!;
      let yieldedAny = false;

      try {
        for await (const event of provider.stream(messages, tools, options)) {
          yieldedAny = true;
          yield event;
        }
        // If completed successfully, finish
        return;
      } catch (err) {
        lastError = err;
        // If we already started yielding tokens to the caller, we cannot cleanly switch providers mid-stream
        if (yieldedAny) {
          throw err;
        }
        // If not the last provider, log or continue to next in failover chain
        if (i < this.providers.length - 1) {
          console.warn(
            `[FailoverProvider] ${provider.name} failed, falling over to ${this.providers[i + 1]?.name}`,
          );
          continue;
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new ProviderError(this.name, 'All providers in failover chain failed', {
      cause: lastError,
    });
  }
}
