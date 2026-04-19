import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SplitType,
  Stage,
} from '@blert/common';

import { Comparator } from '@/components/tick-input';
import { NextSearchParams, queryString } from '@/utils/url';

import {
  SearchFilters,
  contextFromUrlParams,
  countActiveFilters,
  defaultSearchFilters,
  emptyMokhaiotlFilters,
  emptyTobFilters,
  filtersToUrlParams,
} from '../context';

function queryToParams(qs: string): NextSearchParams {
  const params: NextSearchParams = {};
  const search = new URLSearchParams(qs);
  for (const key of Array.from(new Set(search.keys()))) {
    const values = search.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  return params;
}

function roundTrip(filters: SearchFilters): SearchFilters {
  const url = queryString(filtersToUrlParams(filters));
  const ctx = contextFromUrlParams(queryToParams(url));
  return ctx.filters;
}

describe('challenges filter URL round-trip', () => {
  it('preserves all shared fields', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      party: ['WWWWWWWWWWQQ'],
      type: [ChallengeType.INFERNO],
      mode: [ChallengeMode.NO_MODE],
      scale: [1],
      startDate: new Date('2026-01-01T00:00:00Z'),
    };
    const result = roundTrip(filters);
    expect(result.party).toEqual(['WWWWWWWWWWQQ']);
    expect(result.type).toEqual([ChallengeType.INFERNO]);
    expect(result.mode).toEqual([ChallengeMode.NO_MODE]);
    expect(result.scale).toEqual([1]);
    expect(result.startDate?.getTime()).toBe(filters.startDate!.getTime());
  });

  it('preserves status', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      status: [ChallengeStatus.COMPLETED, ChallengeStatus.WIPED],
    };
    const result = roundTrip(filters);
    expect(result.status).toEqual([
      ChallengeStatus.COMPLETED,
      ChallengeStatus.WIPED,
    ]);
  });

  it('preserves stage with comparator', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      stage: [Comparator.GREATER_THAN_OR_EQUAL, Stage.TOB_VERZIK],
    };
    const result = roundTrip(filters);
    expect(result.stage).toEqual([
      Comparator.GREATER_THAN_OR_EQUAL,
      Stage.TOB_VERZIK,
    ]);
  });

  it('preserves splits map entries', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      splits: new Map<number, [Comparator, number]>([
        [SplitType.TOB_MAIDEN, [Comparator.LESS_THAN_OR_EQUAL, 110]],
        [SplitType.TOB_BLOAT, [Comparator.EQUAL, 85]],
      ]),
    };
    const result = roundTrip(filters);
    expect(result.splits.get(SplitType.TOB_MAIDEN)).toEqual([
      Comparator.LESS_THAN_OR_EQUAL,
      110,
    ]);
    expect(result.splits.get(SplitType.TOB_BLOAT)).toEqual([
      Comparator.EQUAL,
      85,
    ]);
  });

  it('preserves TOB sub-filters', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      tob: {
        bloatDowns: new Map<number, [Comparator, number]>([
          [1, [Comparator.EQUAL, 30]],
          [2, [Comparator.LESS_THAN_OR_EQUAL, 40]],
        ]),
        bloatDownCount: [Comparator.GREATER_THAN_OR_EQUAL, 3],
        nylocasPreCapStalls: [Comparator.EQUAL, 2],
        nylocasPostCapStalls: null,
        xarpusHealing: [Comparator.GREATER_THAN, 100],
        verzikRedsCount: [Comparator.LESS_THAN, 5],
      },
    };
    const result = roundTrip(filters);
    expect(result.tob.bloatDowns.get(1)).toEqual([Comparator.EQUAL, 30]);
    expect(result.tob.bloatDowns.get(2)).toEqual([
      Comparator.LESS_THAN_OR_EQUAL,
      40,
    ]);
    expect(result.tob.bloatDownCount).toEqual([
      Comparator.GREATER_THAN_OR_EQUAL,
      3,
    ]);
    expect(result.tob.nylocasPreCapStalls).toEqual([Comparator.EQUAL, 2]);
    expect(result.tob.nylocasPostCapStalls).toBeNull();
    expect(result.tob.xarpusHealing).toEqual([Comparator.GREATER_THAN, 100]);
    expect(result.tob.verzikRedsCount).toEqual([Comparator.LESS_THAN, 5]);
  });

  it('preserves Mokhaiotl sub-filters', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      mokhaiotl: {
        maxCompletedDelve: [Comparator.GREATER_THAN_OR_EQUAL, 40],
      },
    };
    const result = roundTrip(filters);
    expect(result.mokhaiotl.maxCompletedDelve).toEqual([
      Comparator.GREATER_THAN_OR_EQUAL,
      40,
    ]);
  });

  it('omits Mokhaiotl sub-filter params when null', () => {
    const filters = defaultSearchFilters();
    const params = filtersToUrlParams(filters);
    expect(params['mok.maxCompletedDelve']).toBeUndefined();
  });

  it('preserves options', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      accurateSplits: false,
      fullRecordings: true,
    };
    const result = roundTrip(filters);
    expect(result.accurateSplits).toBe(false);
    expect(result.fullRecordings).toBe(true);
  });

  it('defaults accurateSplits to true when omitted', () => {
    const result = contextFromUrlParams({});
    expect(result.filters.accurateSplits).toBe(true);
    expect(result.filters.fullRecordings).toBe(false);
  });
});

describe('countActiveFilters', () => {
  it('counts accurateSplits=true by default', () => {
    const filters = defaultSearchFilters();
    expect(countActiveFilters(filters)).toBe(1);
  });

  it('drops to 0 when accurateSplits is disabled and nothing else is set', () => {
    const filters = defaultSearchFilters();
    filters.accurateSplits = false;
    expect(countActiveFilters(filters)).toBe(0);
  });

  it('counts fullRecordings when enabled', () => {
    const filters = defaultSearchFilters();
    expect(countActiveFilters(filters)).toBe(1);
    filters.fullRecordings = true;
    expect(countActiveFilters(filters)).toBe(2);
  });

  it('counts status, stage, and date each as one', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      status: [ChallengeStatus.COMPLETED],
      stage: [Comparator.EQUAL, Stage.TOB_VERZIK],
      startDate: new Date('2026-01-01T00:00:00Z'),
    };
    expect(countActiveFilters(filters)).toBe(4);
  });

  it('counts each custom split separately', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      splits: new Map<number, [Comparator, number]>([
        [SplitType.TOB_MAIDEN, [Comparator.EQUAL, 100]],
        [SplitType.TOB_BLOAT, [Comparator.EQUAL, 80]],
      ]),
    };
    expect(countActiveFilters(filters)).toBe(3);
  });

  it('counts TOB sub-filters individually', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      tob: {
        ...emptyTobFilters(),
        bloatDowns: new Map([[1, [Comparator.EQUAL, 30]]]),
        bloatDownCount: [Comparator.EQUAL, 3],
        verzikRedsCount: [Comparator.LESS_THAN, 5],
      },
    };
    expect(countActiveFilters(filters)).toBe(4);
  });

  it('counts Mokhaiotl sub-filters individually', () => {
    const filters: SearchFilters = {
      ...defaultSearchFilters(),
      mokhaiotl: {
        ...emptyMokhaiotlFilters(),
        maxCompletedDelve: [Comparator.GREATER_THAN_OR_EQUAL, 40],
      },
    };
    expect(countActiveFilters(filters)).toBe(2);
  });
});
