import { describe, it, expect } from 'vitest';
import { CapabilityRegistry } from '../src/provider/capabilities.js';

describe('Model Capability Registry', () => {
  it('should return exact capabilities for registered models', () => {
    const reg = new CapabilityRegistry();
    const sonnet = reg.get('claude-3-5-sonnet');

    expect(sonnet.providerFamily).toBe('anthropic');
    expect(sonnet.contextWindow).toBe(200_000);
    expect(sonnet.supportsToolCalling).toBe(true);
    expect(sonnet.supportsPromptCaching).toBe(true);
    expect(sonnet.pricing.inputPerMillion).toBe(3.0);
  });

  it('should match prefix versions for dated model releases', () => {
    const reg = new CapabilityRegistry();
    const dated = reg.get('claude-3-5-sonnet-20241022');

    expect(dated.providerFamily).toBe('anthropic');
    expect(dated.supportsToolCalling).toBe(true);
  });

  it('should infer heuristics for local Ollama and unknown models', () => {
    const reg = new CapabilityRegistry();
    const ollamaModel = reg.get('llama3.3:70b');

    expect(ollamaModel.providerFamily).toBe('ollama');
    expect(ollamaModel.supportsToolCalling).toBe(true);
    expect(ollamaModel.pricing.inputPerMillion).toBe(0);
  });

  it('should support dynamic registration of new models', () => {
    const reg = new CapabilityRegistry();
    reg.register({
      id: 'custom-fine-tuned',
      providerFamily: 'openai-compatible',
      contextWindow: 16_000,
      maxOutputTokens: 2048,
      supportsToolCalling: false,
      supportsVision: false,
      supportsFim: true,
      supportsPromptCaching: false,
      pricing: { inputPerMillion: 0.5, outputPerMillion: 1.0 },
    });

    const model = reg.get('custom-fine-tuned');
    expect(model.contextWindow).toBe(16_000);
    expect(model.supportsToolCalling).toBe(false);
  });
});
