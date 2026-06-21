import {
  normalizeSortAggregation,
  numericComparatorParam,
  parseAggregateParams,
  restoreAggregateAliases,
} from '@/api/query';

describe('comparatorParam', () => {
  const params = new URLSearchParams();
  params.set('single', '200');
  params.set('multiple', '300,600,900');
  params.set('until', '..500');
  params.set('from', '100..');
  params.set('range', '100..500');
  params.set('equal', '==200');
  params.set('equal2', '=200');
  params.set('equal3', 'eq200');
  params.set('notEqual', '!=200');
  params.set('notEqual2', 'ne200');
  params.set('lessThan', '<200');
  params.set('lessThan2', 'lt200');
  params.set('lessThanOrEqual', '<=200');
  params.set('lessThanOrEqual2', 'le200');
  params.set('greaterThan', '>200');
  params.set('greaterThan2', 'gt200');
  params.set('greaterThanOrEqual', '>=200');
  params.set('greaterThanOrEqual2', 'ge200');

  params.set('invalidSingle', '#$*(&');
  params.set('invalidMultiple', '300,600,900,');
  params.set('invalidRange', '..');
  params.set('invalidRange2', '300..600..900');
  params.set('invalidComparator', '>=');
  params.set('invalidComparator2', '43>=38');
  params.set('invalidComparator3', '<32<');
  params.set('invalidComparator4', '32||33');

  const searchParams = Object.fromEntries(params.entries());

  it('should return undefined if the param is not present', () => {
    expect(numericComparatorParam(searchParams, 'missing')).toBeUndefined();
  });

  it('should parse a scalar value if there is no comparator', () => {
    expect(numericComparatorParam(searchParams, 'single')).toEqual(['==', 200]);
  });

  it('should parse a list of values if there is no comparator', () => {
    expect(numericComparatorParam(searchParams, 'multiple')).toEqual([
      'in',
      [300, 600, 900],
    ]);
  });

  it('should parse a list a spread operator', () => {
    expect(numericComparatorParam(searchParams, 'until')).toEqual(['<', 500]);
    expect(numericComparatorParam(searchParams, 'from')).toEqual(['>=', 100]);
    expect(numericComparatorParam(searchParams, 'range')).toEqual([
      'range',
      [100, 500],
    ]);
  });

  it('should parse a single value with a comparator', () => {
    expect(numericComparatorParam(searchParams, 'equal')).toEqual(['==', 200]);
    expect(numericComparatorParam(searchParams, 'equal2')).toEqual(['==', 200]);
    expect(numericComparatorParam(searchParams, 'equal3')).toEqual(['==', 200]);
    expect(numericComparatorParam(searchParams, 'notEqual')).toEqual([
      '!=',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'notEqual2')).toEqual([
      '!=',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'lessThan')).toEqual([
      '<',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'lessThan2')).toEqual([
      '<',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'lessThanOrEqual')).toEqual([
      '<=',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'lessThanOrEqual2')).toEqual([
      '<=',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'greaterThan')).toEqual([
      '>',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'greaterThan2')).toEqual([
      '>',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'greaterThanOrEqual')).toEqual([
      '>=',
      200,
    ]);
    expect(numericComparatorParam(searchParams, 'greaterThanOrEqual2')).toEqual(
      ['>=', 200],
    );
  });

  it('should throw an error on invalid values', () => {
    expect(() =>
      numericComparatorParam(searchParams, 'invalidSingle'),
    ).toThrow();
    expect(() =>
      numericComparatorParam(searchParams, 'invalidMultiple'),
    ).toThrow();
    expect(() =>
      numericComparatorParam(searchParams, 'invalidRange'),
    ).toThrow();
    expect(() =>
      numericComparatorParam(searchParams, 'invalidRange2'),
    ).toThrow();
    expect(() =>
      numericComparatorParam(searchParams, 'invalidComparator'),
    ).toThrow();
    expect(() =>
      numericComparatorParam(searchParams, 'invalidComparator2'),
    ).toThrow();
    expect(() =>
      numericComparatorParam(searchParams, 'invalidComparator3'),
    ).toThrow();
    expect(() =>
      numericComparatorParam(searchParams, 'invalidComparator4'),
    ).toThrow();
  });
});

describe('parseAggregateParams', () => {
  it('parses tokens into aggregations with an implicit count', () => {
    expect(parseAggregateParams(['challengeTicks:avg,p90'])).toEqual({
      aggregations: {
        '*': { type: 'count' },
        challengeTicks: [{ type: 'avg' }, { type: 'percentile', value: 90 }],
      },
      aliases: {},
    });
  });

  it('aliases p50 as median', () => {
    expect(parseAggregateParams(['challengeTicks:median'])).toEqual({
      aggregations: {
        '*': { type: 'count' },
        challengeTicks: [{ type: 'percentile', value: 50 }],
      },
      aliases: { challengeTicks: { p50: 'median' } },
    });
  });

  it('parses field from ops on the last colon', () => {
    expect(parseAggregateParams(['splits:1234:median'])).toEqual({
      aggregations: {
        '*': { type: 'count' },
        'splits:1234': [{ type: 'percentile', value: 50 }],
      },
      aliases: { 'splits:1234': { p50: 'median' } },
    });
  });

  it('returns null for an invalid token', () => {
    expect(parseAggregateParams(['challengeTicks:p150'])).toBeNull();
    expect(parseAggregateParams(['challengeTicks:nonsense'])).toBeNull();
  });
});

describe('restoreAggregateAliases', () => {
  it('renames result keys back to the requested token', () => {
    const result = {
      '*': { count: 5 },
      challengeTicks: { avg: 760, p50: 500 },
    };
    restoreAggregateAliases(result, 0, { challengeTicks: { p50: 'median' } });
    expect(result).toEqual({
      '*': { count: 5 },
      challengeTicks: { avg: 760, median: 500 },
    });
  });

  it('renames within each group of a grouped result', () => {
    const result = {
      '2': { challengeTicks: { p50: 500 } },
      '3': { challengeTicks: { p50: 700 } },
    };
    restoreAggregateAliases(result, 1, { challengeTicks: { p50: 'median' } });
    expect(result).toEqual({
      '2': { challengeTicks: { median: 500 } },
      '3': { challengeTicks: { median: 700 } },
    });
  });

  it('leaves the result untouched when there are no aliases', () => {
    const result = { challengeTicks: { p50: 500 } };
    restoreAggregateAliases(result, 0, {});
    expect(result).toEqual({ challengeTicks: { p50: 500 } });
  });
});

describe('normalizeSortAggregation', () => {
  it('rewrites a median sort suffix to p50', () => {
    expect(normalizeSortAggregation('-duration:median')).toBe('-duration:p50');
  });

  it('rewrites a bare median sort to p50', () => {
    expect(normalizeSortAggregation('-median')).toBe('-p50');
  });

  it('preserves the sort direction and options', () => {
    expect(normalizeSortAggregation('+duration:median#nl')).toBe(
      '+duration:p50#nl',
    );
  });

  it('leaves non-alias aggregations and plain fields untouched', () => {
    expect(normalizeSortAggregation('-duration:max')).toBe('-duration:max');
    expect(normalizeSortAggregation('+challengeTicks')).toBe('+challengeTicks');
  });
});
