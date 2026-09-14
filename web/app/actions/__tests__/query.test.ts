import { InvalidQueryError } from '../errors';
import { Comparator, comparatorMatches } from '../query';

describe('comparatorMatches', () => {
  it.each<[Comparator<number>, number, boolean]>([
    [['==', 3], 3, true],
    [['==', 3], 4, false],
    [['!=', 3], 4, true],
    [['!=', 3], 3, false],
    [['is', 3], 3, true],
    [['is', 3], 4, false],
    [['isnot', 3], 4, true],
    [['isnot', 3], 3, false],
    [['<', 3], 2, true],
    [['<', 3], 3, false],
    [['<=', 3], 2, true],
    [['<=', 3], 3, true],
    [['<=', 3], 4, false],
    [['>', 3], 4, true],
    [['>', 3], 3, false],
    [['>=', 3], 4, true],
    [['>=', 3], 3, true],
    [['>=', 3], 2, false],
    [['in', [1, 3]], 3, true],
    [['in', [1, 3]], 2, false],
    [['nin', [1, 3]], 2, true],
    [['nin', [1, 3]], 3, false],
    [['range', [1, 3]], 0, false],
    [['range', [1, 3]], 1, true],
    [['range', [1, 3]], 2, true],
    [['range', [1, 3]], 3, false],
  ])('%j against %d is %s', (comparator, value, expected) => {
    expect(comparatorMatches(comparator, value)).toBe(expected);
  });

  it('rejects logical operators', () => {
    expect(() => comparatorMatches(['&&', 1], 1)).toThrow(InvalidQueryError);
    expect(() => comparatorMatches(['||', 1], 1)).toThrow(InvalidQueryError);
  });
});
