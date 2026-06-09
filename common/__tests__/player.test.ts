import { isValidRsn, normalizeRsn } from '../player';

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

describe('isValidRsn', () => {
  it('accepts legacy single-character names', () => {
    expect(isValidRsn('a')).toBe(true);
    expect(isValidRsn('1')).toBe(true);
  });

  it('accepts interior spaces, hyphens, and underscores', () => {
    expect(isValidRsn('a b')).toBe(true);
    expect(isValidRsn('x_y-z')).toBe(true);
    expect(isValidRsn('a b c')).toBe(true);
    expect(isValidRsn('u  W  u')).toBe(true);
  });

  it('accepts consecutive interior separators', () => {
    expect(isValidRsn('a  b')).toBe(true);
    expect(isValidRsn('a _-b')).toBe(true);
  });

  it('accepts legacy leading and trailing separators', () => {
    expect(isValidRsn('-Spooky')).toBe(true);
    expect(isValidRsn('Spooky-')).toBe(true);
    expect(isValidRsn('_x')).toBe(true);
  });

  it('rejects leading or trailing spaces', () => {
    expect(isValidRsn(' a')).toBe(false);
    expect(isValidRsn('a ')).toBe(false);
  });

  it('accepts names up to 12 characters', () => {
    const hex = '0123456789abcdef';
    for (let i = 1; i < hex.length; i++) {
      const name = hex.slice(0, i);
      const allowed = i <= 12;
      expect(isValidRsn(name)).toBe(allowed);
    }
  });

  it('rejects an empty name', () => {
    expect(isValidRsn('')).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(isValidRsn('a@b')).toBe(false);
  });
});
