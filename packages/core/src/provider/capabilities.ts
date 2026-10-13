export interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion?: number | undefined;
  readonly cacheWritePerMillion?: number | undefined;
}

export interface ModelCapabilities {
  readonly id: string;
  readonly providerFamily: 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openai-compatible';
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly supportsToolCalling: boolean;
  readonly supportsVision: boolean;
  readonly supportsFim: boolean;
  readonly supportsPromptCaching: boolean;
  readonly pricing: ModelPricing;
}

const DEFAULT_MODELS: Record<string, ModelCapabilities> = {
  // Anthropic
  'claude-3-5-sonnet': {
    id: 'claude-3-5-sonnet',
    providerFamily: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    supportsToolCalling: true,
    supportsVision: true,
    supportsFim: false,
    supportsPromptCaching: true,
    pricing: {
      inputPerMillion: 3.0,
      outputPerMillion: 15.0,
      cacheReadPerMillion: 0.3,
      cacheWritePerMillion: 3.75,
    },
  },
  'claude-3-5-haiku': {
    id: 'claude-3-5-haiku',
    providerFamily: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    supportsToolCalling: true,
    supportsVision: true,
    supportsFim: false,
    supportsPromptCaching: true,
    pricing: {
      inputPerMillion: 1.0,
      outputPerMillion: 5.0,
      cacheReadPerMillion: 0.1,
      cacheWritePerMillion: 1.25,
    },
  },

  // OpenAI
  'gpt-4o': {
    id: 'gpt-4o',
    providerFamily: 'openai',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    supportsToolCalling: true,
    supportsVision: true,
    supportsFim: false,
    supportsPromptCaching: true,
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0, cacheReadPerMillion: 1.25 },
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    providerFamily: 'openai',
    contextWindow: 128_000,
    maxOutputTokens: 16384,
    supportsToolCalling: true,
    supportsVision: true,
    supportsFim: false,
    supportsPromptCaching: true,
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheReadPerMillion: 0.075 },
  },

  // Gemini
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    providerFamily: 'gemini',
    contextWindow: 1_048_576,
    maxOutputTokens: 8192,
    supportsToolCalling: true,
    supportsVision: true,
    supportsFim: false,
    supportsPromptCaching: true,
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  },
  'gemini-1.5-pro': {
    id: 'gemini-1.5-pro',
    providerFamily: 'gemini',
    contextWindow: 2_097_152,
    maxOutputTokens: 8192,
    supportsToolCalling: true,
    supportsVision: true,
    supportsFim: false,
    supportsPromptCaching: true,
    pricing: { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  },

  // DeepSeek
  'deepseek-chat': {
    id: 'deepseek-chat',
    providerFamily: 'openai-compatible',
    contextWindow: 64_000,
    maxOutputTokens: 8192,
    supportsToolCalling: true,
    supportsVision: false,
    supportsFim: false,
    supportsPromptCaching: true,
    pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014 },
  },
  'deepseek-coder': {
    id: 'deepseek-coder',
    providerFamily: 'openai-compatible',
    contextWindow: 64_000,
    maxOutputTokens: 8192,
    supportsToolCalling: true,
    supportsVision: false,
    supportsFim: true,
    supportsPromptCaching: true,
    pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheReadPerMillion: 0.014 },
  },

  // Ollama local coding models
  'qwen2.5-coder': {
    id: 'qwen2.5-coder',
    providerFamily: 'ollama',
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    supportsToolCalling: true,
    supportsVision: false,
    supportsFim: true,
    supportsPromptCaching: false,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  },
  'qwen2.5-coder:0.5b': {
    id: 'qwen2.5-coder:0.5b',
    providerFamily: 'ollama',
    contextWindow: 32_768,
    maxOutputTokens: 2048,
    supportsToolCalling: true,
    supportsVision: false,
    supportsFim: true,
    supportsPromptCaching: false,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  },
  'qwen2.5-coder:latest': {
    id: 'qwen2.5-coder:latest',
    providerFamily: 'ollama',
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    supportsToolCalling: true,
    supportsVision: false,
    supportsFim: true,
    supportsPromptCaching: false,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  },
};

export class CapabilityRegistry {
  private readonly registry = new Map<string, ModelCapabilities>();

  constructor() {
    for (const [key, cap] of Object.entries(DEFAULT_MODELS)) {
      this.registry.set(key.toLowerCase(), cap);
    }
  }

  register(capabilities: ModelCapabilities): void {
    this.registry.set(capabilities.id.toLowerCase(), capabilities);
  }

  get(modelId: string): ModelCapabilities {
    const normalized = modelId.toLowerCase();
    const exact = this.registry.get(normalized);
    if (exact) {
      return exact;
    }

    // Prefix match (e.g. claude-3-5-sonnet-20241022 matches claude-3-5-sonnet)
    for (const [key, cap] of this.registry.entries()) {
      if (normalized.startsWith(key) || key.startsWith(normalized)) {
        return { ...cap, id: modelId };
      }
    }

    // Heuristic inference for unknown models
    const isOllama =
      normalized.includes(':') ||
      normalized.includes('llama') ||
      normalized.includes('qwen') ||
      normalized.includes('mistral');
    const isAnthropic = normalized.includes('claude');
    const isGemini = normalized.includes('gemini');
    const isDeepSeek = normalized.includes('deepseek');

    return {
      id: modelId,
      providerFamily: isAnthropic
        ? 'anthropic'
        : isGemini
          ? 'gemini'
          : isOllama
            ? 'ollama'
            : isDeepSeek
              ? 'openai-compatible'
              : 'openai',
      contextWindow: 32_768,
      maxOutputTokens: 4096,
      supportsToolCalling: !normalized.includes('base') && !normalized.includes('instruct-small'),
      supportsVision: normalized.includes('vision') || normalized.includes('vl') || isAnthropic,
      supportsFim: normalized.includes('coder') || normalized.includes('fim'),
      supportsPromptCaching: isAnthropic || isDeepSeek,
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    };
  }

  list(): readonly ModelCapabilities[] {
    return Array.from(this.registry.values());
  }
}

export const globalCapabilityRegistry = new CapabilityRegistry();
