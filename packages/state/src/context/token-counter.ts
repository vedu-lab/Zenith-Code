/**
 * Fast, accurate token estimator for code and natural language text.
 * Averages ~3.6 characters per token across code, markdown, and JSON.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  // Word/code segment boundary regex
  const segments = text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+|\s+/gu);
  if (!segments) {
    return Math.ceil(text.length / 3.6);
  }

  let tokens = 0;
  for (const seg of segments) {
    if (/^\s+$/.test(seg)) {
      tokens += Math.ceil(seg.length / 4);
    } else if (seg.length <= 4) {
      tokens += 1;
    } else {
      tokens += Math.ceil(seg.length / 3.5);
    }
  }

  return Math.max(1, tokens);
}

export function isOverThreshold(
  tokenCount: number,
  maxWindowTokens: number,
  thresholdPercent = 60,
): boolean {
  return (tokenCount / maxWindowTokens) * 100 >= thresholdPercent;
}
