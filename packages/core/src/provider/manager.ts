import { IProvider } from './types.js';
import { ForgeConfig, ModelRole } from '../config/schema.js';
import { globalCapabilityRegistry } from './capabilities.js';
import { AnthropicProvider } from './adapters/anthropic.js';
import { OpenAIProvider } from './adapters/openai.js';
import { GeminiProvider } from './adapters/gemini.js';
import { OpenAICompatibleProvider } from './adapters/openai-compatible.js';
import { OllamaProvider } from './adapters/ollama.js';
import { FailoverProvider } from './failover.js';

export interface ResolvedRoleProvider {
  readonly provider: IProvider;
  readonly model: string;
}

export class ProviderManager {
  private readonly providerCache = new Map<string, IProvider>();

  constructor(private readonly config: ForgeConfig) {}

  getProviderForRole(role: ModelRole = 'main'): ResolvedRoleProvider {
    const model = this.config.models[role];
    const provider = this.getProviderForModel(model);
    return { provider, model };
  }

  getProviderForModel(modelName: string): IProvider {
    const caps = globalCapabilityRegistry.get(modelName);
    const family = caps.providerFamily;

    const cacheKey = `${family}:${modelName}`;
    const cached = this.providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let provider: IProvider;
    switch (family) {
      case 'anthropic':
        provider = new AnthropicProvider({
          apiKey: this.config.providers.anthropic.apiKey,
          baseUrl: this.config.providers.anthropic.baseUrl,
        });
        break;

      case 'gemini':
        provider = new GeminiProvider({
          apiKey: this.config.providers.gemini.apiKey,
          baseUrl: this.config.providers.gemini.baseUrl,
        });
        break;

      case 'ollama':
        provider = new OllamaProvider({
          baseUrl: this.config.providers.ollama.baseUrl,
        });
        break;

      case 'openai-compatible': {
        const ep = Object.values(this.config.providers.openaiCompatible)[0];
        if (ep) {
          provider = new OpenAICompatibleProvider({
            name: 'openai-compatible',
            baseUrl: ep.baseUrl,
            apiKey: ep.apiKey,
            defaultHeaders: ep.headers,
          });
        } else {
          provider = new OpenAIProvider({
            apiKey: this.config.providers.openai.apiKey,
            baseUrl: this.config.providers.openai.baseUrl,
          });
        }
        break;
      }

      case 'openai':
      default:
        provider = new OpenAIProvider({
          apiKey: this.config.providers.openai.apiKey,
          baseUrl: this.config.providers.openai.baseUrl,
        });
        break;
    }

    this.providerCache.set(cacheKey, provider);
    return provider;
  }

  createFailoverChain(providers: readonly IProvider[]): FailoverProvider {
    return new FailoverProvider(providers);
  }
}
