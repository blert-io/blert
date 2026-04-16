import { ChallengeMode, ChallengeType } from '@blert/common';

import { queryString } from '@/utils/url';

import {
  SharedFilters,
  applySharedFilterParam,
  buildEntityHref,
  countSharedFilters,
  emptySharedFilters,
  numericList,
  sharedFiltersToUrlParams,
} from '../shared-filters';

function parseParams(filters: SharedFilters): SharedFilters {
  const next = emptySharedFilters();
  const params = sharedFiltersToUrlParams(filters);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    const str = Array.isArray(value) ? value.join(',') : value.toString();
    if (str === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    applySharedFilterParam(next, key, str);
  }
  return next;
}

describe('numericList', () => {
  it('splits comma-separated numeric strings', () => {
    expect(numericList('1,2,3')).toEqual([1, 2, 3]);
  });

  it('drops non-numeric tokens', () => {
    expect(numericList('1,foo,3')).toEqual([1, 3]);
  });

  it('returns an empty array for an empty string', () => {
    expect(numericList('')).toEqual([]);
  });
});

describe('countSharedFilters', () => {
  it('returns 0 when nothing is set', () => {
    expect(countSharedFilters(emptySharedFilters())).toBe(0);
  });

  it('counts party, type/mode, scale, and date each as one', () => {
    const filters: SharedFilters = {
      ...emptySharedFilters(),
      party: ['WWWWWWWWWWQQ'],
      type: [ChallengeType.TOB],
      mode: [ChallengeMode.TOB_REGULAR],
      scale: [1],
      startDate: new Date('2026-01-01'),
    };
    expect(countSharedFilters(filters)).toBe(4);
  });

  it('collapses type+mode into a single count', () => {
    const filters: SharedFilters = {
      ...emptySharedFilters(),
      type: [ChallengeType.TOB],
      mode: [ChallengeMode.TOB_REGULAR],
    };
    expect(countSharedFilters(filters)).toBe(1);
  });

  it('counts a lone endDate as a date filter', () => {
    const filters: SharedFilters = {
      ...emptySharedFilters(),
      endDate: new Date('2026-01-31'),
    };
    expect(countSharedFilters(filters)).toBe(1);
  });
});

describe('shared filter URL round-trip', () => {
  it('preserves each shared field through serialize and parse', () => {
    const filters: SharedFilters = {
      ...emptySharedFilters(),
      party: ['WWWWWWWWWWQQ', 'otter pet'],
      type: [ChallengeType.TOB, ChallengeType.INFERNO],
      mode: [ChallengeMode.TOB_REGULAR, ChallengeMode.NO_MODE],
      scale: [1, 4, 5],
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-01-31T00:00:00Z'),
    };

    const roundTripped = parseParams(filters);
    expect(roundTripped.party).toEqual(['WWWWWWWWWWQQ', 'otter pet']);
    expect(roundTripped.type).toEqual([
      ChallengeType.TOB,
      ChallengeType.INFERNO,
    ]);
    expect(roundTripped.mode).toEqual([
      ChallengeMode.TOB_REGULAR,
      ChallengeMode.NO_MODE,
    ]);
    expect(roundTripped.scale).toEqual([1, 4, 5]);
    expect(roundTripped.startDate?.getTime()).toBe(
      filters.startDate!.getTime(),
    );
    // `endDate` is bumped by one day on serialize so ranges are inclusive of
    // the selected end day, then decoded as that same Jan 31 UTC.
    const expectedEndDate = new Date(filters.endDate!);
    expectedEndDate.setDate(expectedEndDate.getDate() + 1);
    expect(roundTripped.endDate?.getTime()).toBe(expectedEndDate.getTime());
  });

  it('drops empty arrays and null dates from URL params', () => {
    const params = sharedFiltersToUrlParams(emptySharedFilters());
    const serialized = queryString(params);
    expect(serialized).toBe('');
  });

  it('encodes a start-only date range with a >= prefix', () => {
    const filters: SharedFilters = {
      ...emptySharedFilters(),
      startDate: new Date('2026-01-01T00:00:00Z'),
    };
    const params = sharedFiltersToUrlParams(filters);
    expect(params.startTime).toBe(`>=${filters.startDate!.getTime()}`);
  });

  it('encodes an end-only date range with a < prefix bumped by one day', () => {
    const filters: SharedFilters = {
      ...emptySharedFilters(),
      endDate: new Date('2026-01-31T00:00:00Z'),
    };
    const bumped = new Date(filters.endDate!);
    bumped.setDate(bumped.getDate() + 1);
    const params = sharedFiltersToUrlParams(filters);
    expect(params.startTime).toBe(`<${bumped.getTime()}`);
  });
});

describe('applySharedFilterParam', () => {
  it('reports false for unknown keys', () => {
    const filters = emptySharedFilters();
    expect(applySharedFilterParam(filters, 'unknown', 'value')).toBe(false);
  });

  it('reports true for every known shared key', () => {
    const filters = emptySharedFilters();
    expect(applySharedFilterParam(filters, 'party', 'WWWWWWWWWWQQ')).toBe(true);
    expect(applySharedFilterParam(filters, 'mode', '0')).toBe(true);
    expect(applySharedFilterParam(filters, 'scale', '1')).toBe(true);
    expect(applySharedFilterParam(filters, 'type', '0')).toBe(true);
    expect(
      applySharedFilterParam(filters, 'startTime', '>=1700000000000'),
    ).toBe(true);
  });

  it('trims whitespace around party names', () => {
    const filters = emptySharedFilters();
    applySharedFilterParam(filters, 'party', ' WWWWWWWWWWQQ , otter pet ');
    expect(filters.party).toEqual(['WWWWWWWWWWQQ', 'otter pet']);
  });
});

describe('buildEntityHref', () => {
  it('returns the target path unchanged when no params are given', () => {
    expect(buildEntityHref('/search/sessions', null)).toBe('/search/sessions');
  });

  it('preserves every shared filter param', () => {
    const params = new URLSearchParams();
    params.set('party', 'WWWWWWWWWWQQ,otter pet');
    params.set('mode', '0,1');
    params.set('scale', '1');
    params.set('type', '0');
    params.set('startTime', '>=1700000000000');
    const href = buildEntityHref('/search/sessions', params);
    const parsed = new URL(href, 'https://blert.io');
    expect(parsed.pathname).toBe('/search/sessions');
    expect(parsed.searchParams.get('party')).toBe('WWWWWWWWWWQQ,otter pet');
    expect(parsed.searchParams.get('mode')).toBe('0,1');
    expect(parsed.searchParams.get('scale')).toBe('1');
    expect(parsed.searchParams.get('type')).toBe('0');
    expect(parsed.searchParams.get('startTime')).toBe('>=1700000000000');
  });

  it('drops entity-specific params (e.g. splits, status, challengeCount)', () => {
    const params = new URLSearchParams();
    params.set('party', 'WWWWWWWWWWQQ');
    params.set('status', '2');
    params.set('split:1', 'ge1200');
    params.set('challengeCount', 'ge5');
    const href = buildEntityHref('/search/sessions', params);
    const parsed = new URL(href, 'https://blert.io');
    expect(parsed.searchParams.get('party')).toBe('WWWWWWWWWWQQ');
    expect(parsed.searchParams.get('status')).toBeNull();
    expect(parsed.searchParams.get('split:1')).toBeNull();
    expect(parsed.searchParams.get('challengeCount')).toBeNull();
  });

  it('returns the target path with no query string when no shared params are present', () => {
    const params = new URLSearchParams();
    params.set('status', '2');
    params.set('split:1', 'ge1200');
    const href = buildEntityHref('/search/challenges', params);
    expect(href).toBe('/search/challenges');
  });
});
