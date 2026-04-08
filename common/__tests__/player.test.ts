import { normalizeRsn } from '../player';

describe('normalizeRsn', () => {
  it('should lowercase the name', () => {
    expect(normalizeRsn('Zezima')).toBe('zezima');
    expect(normalizeRsn('ZEZIMA')).toBe('zezima');
  });

  it('should replace spaces with underscores', () => {
    expect(normalizeRsn('Gucci Clogs')).toBe('gucci_clogs');
  });

  it('should replace hyphens with underscores', () => {
    expect(normalizeRsn('Gucci-Clogs')).toBe('gucci_clogs');
  });

  it('should preserve existing underscores', () => {
    expect(normalizeRsn('Gucci_Clogs')).toBe('gucci_clogs');
  });

  it('should treat all separator variants as equivalent', () => {
    const expected = 'gucci_clogs';
    expect(normalizeRsn('Gucci Clogs')).toBe(expected);
    expect(normalizeRsn('Gucci-Clogs')).toBe(expected);
    expect(normalizeRsn('Gucci_Clogs')).toBe(expected);
    expect(normalizeRsn('gucci clogs')).toBe(expected);
    expect(normalizeRsn('gucci-clogs')).toBe(expected);
    expect(normalizeRsn('gucci_clogs')).toBe(expected);
  });

  it('should handle names with multiple separators', () => {
    expect(normalizeRsn('A B-C')).toBe('a_b_c');
  });

  it('should handle names with no separators', () => {
    expect(normalizeRsn('Zezima')).toBe('zezima');
  });

  it('should handle single character names', () => {
    expect(normalizeRsn('A')).toBe('a');
  });

  it('should handle names with numbers', () => {
    expect(normalizeRsn('Player 123')).toBe('player_123');
  });
});
