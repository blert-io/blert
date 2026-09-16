import { ChallengeType } from '@blert/common';

import { InvalidQueryError } from '../../actions/errors';
import {
  assertValidUuid,
  dateComparatorParam,
  dateParam,
  normalizeSortAggregation,
  integerComparatorParam,
  parseAggregateParams,
  restoreAggregateAliases,
  spawnQueryValue,
} from '../query';

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

  it('returns undefined if the param is not present', () => {
    expect(integerComparatorParam(searchParams, 'missing')).toBeUndefined();
  });

  it('parses a scalar value as equality', () => {
    expect(integerComparatorParam(searchParams, 'single')).toEqual(['==', 200]);
  });

  it('parses a list of values as membership', () => {
    expect(integerComparatorParam(searchParams, 'multiple')).toEqual([
      'in',
      [300, 600, 900],
    ]);
  });

  it('parses a range operator', () => {
    expect(integerComparatorParam(searchParams, 'until')).toEqual(['<', 500]);
    expect(integerComparatorParam(searchParams, 'from')).toEqual(['>=', 100]);
    expect(integerComparatorParam(searchParams, 'range')).toEqual([
      'range',
      [100, 500],
    ]);
  });

  it('parses a single value with a comparator', () => {
    expect(integerComparatorParam(searchParams, 'equal')).toEqual(['==', 200]);
    expect(integerComparatorParam(searchParams, 'equal2')).toEqual(['==', 200]);
    expect(integerComparatorParam(searchParams, 'equal3')).toEqual(['==', 200]);
    expect(integerComparatorParam(searchParams, 'notEqual')).toEqual([
      '!=',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'notEqual2')).toEqual([
      '!=',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'lessThan')).toEqual([
      '<',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'lessThan2')).toEqual([
      '<',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'lessThanOrEqual')).toEqual([
      '<=',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'lessThanOrEqual2')).toEqual([
      '<=',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'greaterThan')).toEqual([
      '>',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'greaterThan2')).toEqual([
      '>',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'greaterThanOrEqual')).toEqual([
      '>=',
      200,
    ]);
    expect(integerComparatorParam(searchParams, 'greaterThanOrEqual2')).toEqual(
      ['>=', 200],
    );
  });

  it('throws an error on invalid values', () => {
    expect(() =>
      integerComparatorParam(searchParams, 'invalidSingle'),
    ).toThrow();
    expect(() =>
      integerComparatorParam(searchParams, 'invalidMultiple'),
    ).toThrow();
    expect(() =>
      integerComparatorParam(searchParams, 'invalidRange'),
    ).toThrow();
    expect(() =>
      integerComparatorParam(searchParams, 'invalidRange2'),
    ).toThrow();
    expect(() =>
      integerComparatorParam(searchParams, 'invalidComparator'),
    ).toThrow();
    expect(() =>
      integerComparatorParam(searchParams, 'invalidComparator2'),
    ).toThrow();
    expect(() =>
      integerComparatorParam(searchParams, 'invalidComparator3'),
    ).toThrow();
    expect(() =>
      integerComparatorParam(searchParams, 'invalidComparator4'),
    ).toThrow();
  });
});

describe('dateComparatorParam', () => {
  it('parses a millisecond timestamp comparator', () => {
    expect(
      dateComparatorParam({ startTime: '>=1789427566258' }, 'startTime'),
    ).toEqual(['>=', new Date(1789427566258)]);
    expect(
      dateComparatorParam(
        { startTime: '1789427000000..1789427566258' },
        'startTime',
      ),
    ).toEqual(['range', [new Date(1789427000000), new Date(1789427566258)]]);
  });

  it.each(['abc', '1,abc', '-1', '8640000000000001', '2026-09-14'])(
    'rejects %s',
    (value) => {
      expect(() =>
        dateComparatorParam({ startTime: value }, 'startTime'),
      ).toThrow(InvalidQueryError);
    },
  );
});

describe('dateParam', () => {
  it('parses a millisecond timestamp or a date string', () => {
    expect(dateParam({ from: '1789478160173' }, 'from')).toEqual(
      new Date(1789478160173),
    );
    expect(dateParam({ from: '2026-09-15' }, 'from')).toEqual(
      new Date('2026-09-15'),
    );
    expect(dateParam({ from: '' }, 'from')).toBeUndefined();
    expect(dateParam({}, 'from')).toBeUndefined();
  });

  it.each(['blt', '8640000000000001', '1789478160173,1'])(
    'rejects %s',
    (value) => {
      expect(() => dateParam({ from: value }, 'from')).toThrow(
        InvalidQueryError,
      );
    },
  );
});

describe('assertValidUuid', () => {
  const UUID = '4c22f46d-09f7-473c-9199-ab268bf2b386';

  it('accepts a uuid or a list of them', () => {
    expect(() => assertValidUuid(UUID)).not.toThrow();
    expect(() => assertValidUuid([UUID, UUID.toUpperCase()])).not.toThrow();
    expect(() => assertValidUuid([])).not.toThrow();
  });

  it('names every value which is not a uuid', () => {
    expect(() => assertValidUuid([UUID, 'abc', '1'], 'uuids')).toThrow(
      'uuids: Invalid uuid abc,1',
    );
    expect(() => assertValidUuid(`${UUID}x`)).toThrow(InvalidQueryError);
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

  it('does not modify a result without aliases', () => {
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

  it('does not touch non-alias aggregations and plain fields', () => {
    expect(normalizeSortAggregation('-duration:max')).toBe('-duration:max');
    expect(normalizeSortAggregation('+challengeTicks')).toBe('+challengeTicks');
  });
});

describe('spawnQueryValue', () => {
  it('parses a spawn', () => {
    expect(
      spawnQueryValue(
        'stage:104,105;npc:12811@1821.3103;npc:javelin@28.14;npc:manticore@1827.3103;tile:13.20;player:7.13',
        ChallengeType.COLOSSEUM,
      ),
    ).toEqual([
      {
        stage: ['in', [104, 105]],
        values: [436, 1934, 2676],
        tiles: [[436, 1460, 2484, 3508]],
        player: 3335,
        match: 'contains',
      },
      ChallengeType.COLOSSEUM,
    ]);
  });

  it('parses an exact spawn on a stage', () => {
    expect(
      spawnQueryValue(
        'stage:104;value:436;tile:1821.3103;player:1815.3110;match:exact',
        null,
      ),
    ).toEqual([
      {
        stage: ['==', 104],
        values: [436],
        tiles: [[436, 1460, 2484, 3508]],
        player: 3335,
        match: 'exact',
      },
      ChallengeType.COLOSSEUM,
    ]);
  });

  it('infers a challenge type from its clauses', () => {
    expect(
      spawnQueryValue(
        'npc:bat@2258.5330;tile:2262.5335;player:2267.5347',
        null,
      ),
    ).toEqual([
      {
        stage: null,
        values: [60],
        tiles: [[183, 1207, 2231, 3255, 4279]],
        player: 2826,
        match: 'contains',
      },
      ChallengeType.INFERNO,
    ]);
  });

  it('rejects a clause outside the search type', () => {
    expect(() =>
      spawnQueryValue('npc:bat@1.28', ChallengeType.COLOSSEUM),
    ).toThrow(InvalidQueryError);
  });

  it.each([
    '436',
    'wave:104',
    'npc:jaguar@1821.3103',
    'npc:shaman',
    'value:abc',
    'value:32768',
    'player:70000',
    'stage:99999',
    'match:some',
    'value:436;match:exact',
    'stage:104,105;value:436;match:exact',
    'stage:>=104;value:436;match:exact',
    'tile:13.20',
    'npc:shaman@10.11;npc:bat@1.28',
    'stage:104;npc:bat@1.28',
    'player:1818.3112;npc:bat@1.28',
    'npc:shaman@2258.5330',
  ])('rejects %s', (value) => {
    expect(() => spawnQueryValue(value, null)).toThrow(InvalidQueryError);
  });
});
