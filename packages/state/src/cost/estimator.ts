import { CostEstimate } from './types.js';
import { calculateCost, getPricingForModel } from './pricing.js';

export class CostEstimator {
  estimate(task: string, model = 'claude-3-5-sonnet'): CostEstimate {
    const pricing = getPricingForModel(model);
    const words = task.trim().split(/\s+/).length;

    // Estimate complexity
    const isComplex =
      words > 25 ||
      task.toLowerCase().includes('refactor') ||
      task.toLowerCase().includes('implement') ||
      task.toLowerCase().includes('test');

    const lowInput = 1500;
    const lowOutput = 250;
    const expInput = isComplex ? 6000 : 3500;
    const expOutput = isComplex ? 1200 : 600;
    const highInput = isComplex ? 25000 : 12000;
    const highOutput = isComplex ? 4000 : 2000;

    const lowCost = calculateCost(model, { promptTokens: lowInput, completionTokens: lowOutput });
    const expCost = calculateCost(model, { promptTokens: expInput, completionTokens: expOutput });
    const highCost = calculateCost(model, {
      promptTokens: highInput,
      completionTokens: highOutput,
    });

    const assumptions: string[] = [
      `Model: ${model} (${pricing.isLocal ? 'Local model, zero monetary cost' : `$${pricing.inputPerMillion}/M in, $${pricing.outputPerMillion}/M out`})`,
      `Low: 1-2 turns, straightforward query or single-file change (~${lowInput + lowOutput} tokens)`,
      `Expected: ${isComplex ? '4-6' : '2-4'} turns with tool iterations and validation (~${expInput + expOutput} tokens)`,
      `High: ${isComplex ? '8-12' : '5-8'} turns with error retries, tool feedback, and multi-file updates (~${highInput + highOutput} tokens)`,
    ];

    return {
      low: Number(lowCost.toFixed(5)),
      expected: Number(expCost.toFixed(5)),
      high: Number(highCost.toFixed(5)),
      currency: 'USD',
      assumptions,
      tokensEstimated: {
        input: expInput,
        output: expOutput,
      },
    };
  }
}
