import { numericComparatorParam } from '@/api/query';

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
