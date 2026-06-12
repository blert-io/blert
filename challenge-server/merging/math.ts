export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function softMin(values: number[], temperature: number): number {
  if (values.length === 0) {
    return 1;
  }
  const mean =
    values.reduce((sum, v) => sum + Math.exp(-v / temperature), 0) /
    values.length;
  return -temperature * Math.log(mean);
}

export function noisyOr(a: number, b: number): number {
  return 1 - (1 - a) * (1 - b);
}
