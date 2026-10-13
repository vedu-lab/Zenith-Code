import { ModelPricing } from './types.js';

export const PRICING_TABLE_VERSION = '2026-Q1';

export const PRICING_TABLE: readonly ModelPricing[] = [
  // Anthropic Claude
  {
    model: 'claude-3-5-sonnet',
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
    isLocal: false,
  },
  {
    model: 'claude-3-5-haiku',
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1.0,
    isLocal: false,
  },
  {
    model: 'claude-3-opus',
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
    isLocal: false,
  },
  // OpenAI
  {
    model: 'gpt-4o',
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cacheReadPerMillion: 1.25,
    isLocal: false,
  },
  {
    model: 'gpt-4o-mini',
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cacheReadPerMillion: 0.075,
    isLocal: false,
  },
  {
    model: 'o1',
    inputPerMillion: 15.0,
    outputPerMillion: 60.0,
    cacheReadPerMillion: 7.5,
    isLocal: false,
  },
  {
    model: 'o3-mini',
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cacheReadPerMillion: 0.55,
    isLocal: false,
  },
  // Google Gemini
  {
    model: 'gemini-1.5-pro',
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cacheReadPerMillion: 0.3125,
    isLocal: false,
  },
  {
    model: 'gemini-1.5-flash',
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
    cacheReadPerMillion: 0.01875,
    isLocal: false,
  },
  {
    model: 'gemini-2.0-flash',
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    isLocal: false,
  },
];

export function getPricingForModel(modelName?: string): ModelPricing {
  const name = modelName ?? 'claude-3-5-sonnet';
  const normalized = name.toLowerCase();

  // Local models (Ollama, llama.cpp, vLLM, LM Studio) are always $0.00
  if (
    normalized.startsWith('ollama') ||
    normalized.includes('llama') ||
    normalized.includes('qwen') ||
    normalized.includes('mistral-local') ||
    normalized.includes('deepseek-r1-local') ||
    normalized.includes('local')
  ) {
    return {
      model: name,
      inputPerMillion: 0,
      outputPerMillion: 0,
      cacheReadPerMillion: 0,
      cacheWritePerMillion: 0,
      isLocal: true,
    };
  }

  // Find exact or partial match
  const match = PRICING_TABLE.find(
    (p) => p.model.toLowerCase() === normalized || normalized.includes(p.model.toLowerCase()),
  );

  if (match) {
    return match;
  }

  // Default fallback to sonnet pricing
  return {
    model: name,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
    isLocal: false,
  };
}

export function calculateCost(
  modelName: string | undefined,
  usage: {
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
): number {
  const pricing = getPricingForModel(modelName);
  if (pricing.isLocal) {
    return 0;
  }

  const promptCost = (usage.promptTokens / 1_000_000) * pricing.inputPerMillion;
  const completionCost = (usage.completionTokens / 1_000_000) * pricing.outputPerMillion;

  let cacheCost = 0;
  if (usage.cacheReadTokens && pricing.cacheReadPerMillion) {
    cacheCost += (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  }
  if (usage.cacheWriteTokens && pricing.cacheWritePerMillion) {
    cacheCost += (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;
  }

  return promptCost + completionCost + cacheCost;
}
