import { coordsEqual, inRect } from '../coords';

describe('coordsEqual', () => {
  it('returns true for identical coordinates', () => {
    expect(coordsEqual({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
  });

  it('returns false for different x', () => {
    expect(coordsEqual({ x: 1, y: 2 }, { x: 2, y: 2 })).toBe(false);
  });

  it('returns false for different y', () => {
    expect(coordsEqual({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
  });

  it('returns false for both x and y different', () => {
    expect(coordsEqual({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(false);
  });
});

describe('inRect', () => {
  const rect = { x: 0, y: 0, width: 10, height: 5 };

  it('returns true for a point inside the rectangle', () => {
    expect(inRect({ x: 5, y: 2 }, rect)).toBe(true);
  });

  it('returns true for a point at the top-left corner', () => {
    expect(inRect({ x: 0, y: 0 }, rect)).toBe(true);
  });

  it('returns false for a point outside to the left', () => {
    expect(inRect({ x: -1, y: 2 }, rect)).toBe(false);
  });

  it('returns false for a point outside above', () => {
    expect(inRect({ x: 5, y: -1 }, rect)).toBe(false);
  });

  it('returns false for a point outside to the right (boundary exclusive)', () => {
    expect(inRect({ x: 10, y: 2 }, rect)).toBe(false);
  });

  it('returns false for a point outside below (boundary exclusive)', () => {
    expect(inRect({ x: 5, y: 5 }, rect)).toBe(false);
  });

  it('returns true for a point just inside the right and bottom edges', () => {
    expect(inRect({ x: 9, y: 4 }, rect)).toBe(true);
  });
});
