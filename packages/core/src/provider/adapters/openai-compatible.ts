import { OpenAIProvider, OpenAIAdapterOptions } from './openai.js';

export interface OpenAICompatibleOptions extends OpenAIAdapterOptions {
  readonly name?: string | undefined;
}

export class OpenAICompatibleProvider extends OpenAIProvider {
  constructor(options: OpenAICompatibleOptions) {
    super({
      ...options,
      providerName: options.name ?? 'openai-compatible',
    });
  }
}
