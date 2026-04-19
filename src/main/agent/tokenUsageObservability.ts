const TOKENS_PER_CHAR = 4;

export function estimateTokenCountFromText(text: string): number {
  if (!text) return 0;
  return Math.max(0, Math.ceil(text.length / TOKENS_PER_CHAR));
}

export function serializeForTokenEstimate(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function estimateTokenCountFromValue(value: unknown): number {
  return estimateTokenCountFromText(serializeForTokenEstimate(value));
}

