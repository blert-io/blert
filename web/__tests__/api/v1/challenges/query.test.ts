import { numericComparatorParam } from '@/api/v1/challenges/query';

describe('comparatorParam', () => {
  const searchParams = new URLSearchParams();
  searchParams.set('single', '200');
  searchParams.set('multiple', '300,600,900');
  searchParams.set('until', '..500');
  searchParams.set('from', '100..');
  searchParams.set('range', '100..500');
  searchParams.set('equal', '==200');
  searchParams.set('equal2', '=200');
  searchParams.set('equal3', 'eq200');
  searchParams.set('notEqual', '!=200');
  searchParams.set('notEqual2', 'ne200');
  searchParams.set('lessThan', '<200');
  searchParams.set('lessThan2', 'lt200');
  searchParams.set('lessThanOrEqual', '<=200');
  searchParams.set('lessThanOrEqual2', 'le200');
  searchParams.set('greaterThan', '>200');
  searchParams.set('greaterThan2', 'gt200');
  searchParams.set('greaterThanOrEqual', '>=200');
  searchParams.set('greaterThanOrEqual2', 'ge200');

  searchParams.set('invalidSingle', '#$*(&');
  searchParams.set('invalidMultiple', '300,600,900,');
  searchParams.set('invalidRange', '..');
  searchParams.set('invalidRange2', '300..600..900');
  searchParams.set('invalidComparator', '>=');
  searchParams.set('invalidComparator2', '43>=38');
  searchParams.set('invalidComparator3', '<32<');
  searchParams.set('invalidComparator4', '32||33');

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
