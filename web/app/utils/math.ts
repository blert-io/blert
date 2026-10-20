export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

/** Returns a pseudo-random number in [0, 1) that is always the same for `n`. */
export function hash(n: number): number {
  return (((Math.sin(n) * 43758.5453123) % 1) + 1) % 1;
}
