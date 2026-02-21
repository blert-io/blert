export function hash(n: number): number {
  return (((Math.sin(n) * 43758.5453123) % 1) + 1) % 1;
}
