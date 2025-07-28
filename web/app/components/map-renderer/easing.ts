export function easeInQuad(x: number): number {
  return x * x;
}

export function easeOutQuad(x: number): number {
  const inv = 1 - x;
  return 1 - inv * inv;
}

export function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export function easeInCubic(x: number): number {
  return x * x * x;
}

export function easeOutCubic(x: number): number {
  const inv = 1 - x;
  return 1 - inv * inv * inv;
}

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeInQuart(x: number): number {
  return x * x * x * x;
}

export function easeOutQuart(x: number): number {
  const inv = 1 - x;
  return 1 - inv * inv * inv * inv;
}

export function easeInOutQuart(x: number): number {
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
}

export function easeInQuint(x: number): number {
  return x * x * x * x * x;
}

export function easeOutQuint(x: number): number {
  const inv = 1 - x;
  return 1 - inv * inv * inv * inv * inv;
}

export function easeInOutQuint(x: number): number {
  return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
}
