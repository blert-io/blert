import { SplitType } from '@blert/common';
import { NextRequest } from 'next/server';

jest.mock('@/actions/split-distributions', () => ({
  getSplitPercentiles: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { getSplitPercentiles } from '@/actions/split-distributions';
import { GET } from '@/api/v1/splits/percentiles/route';

const mockedGetSplitPercentiles = getSplitPercentiles as jest.MockedFunction<
  typeof getSplitPercentiles
>;

function createRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/splits/percentiles');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

const SAMPLE_RESULT = [
  {
    splitType: SplitType.TOB_REG_MAIDEN,
    count: 5,
    percentiles: { 5: 210, 50: 230, 95: 274 },
  },
];

describe('GET /api/v1/splits/percentiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSplitPercentiles.mockResolvedValue(SAMPLE_RESULT);
  });

  it('requires types and scale', async () => {
    const missingTypes = await GET(createRequest({ scale: '1' }));
    expect(missingTypes.status).toBe(400);

    const missingScale = await GET(createRequest({ types: '152' }));
    expect(missingScale.status).toBe(400);

    const emptyTypes = await GET(createRequest({ types: '', scale: '1' }));
    expect(emptyTypes.status).toBe(400);

    expect(mockedGetSplitPercentiles).not.toHaveBeenCalled();
  });

  it.each(['0', '6', 'abc'])('rejects scale %s', async (scale) => {
    const response = await GET(createRequest({ types: '152', scale }));
    expect(response.status).toBe(400);
    expect(mockedGetSplitPercentiles).not.toHaveBeenCalled();
  });

  it.each(['abc', '101', '-1', '5,,25', '5,', '1,2,3,4,5,6,7,8,9,10,11'])(
    'rejects percentiles %s',
    async (percentiles) => {
      const response = await GET(
        createRequest({ types: '152', scale: '1', percentiles }),
      );
      expect(response.status).toBe(400);
      expect(mockedGetSplitPercentiles).not.toHaveBeenCalled();
    },
  );

  it('applies default percentiles', async () => {
    const response = await GET(createRequest({ types: '152,153', scale: '1' }));

    expect(response.status).toBe(200);
    expect(mockedGetSplitPercentiles).toHaveBeenCalledWith(
      [152, 153],
      1,
      [5, 25, 50, 75, 95],
      undefined,
      undefined,
    );
    expect(await response.json()).toEqual(SAMPLE_RESULT);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
  });

  it('passes through custom fractional percentiles', async () => {
    const response = await GET(
      createRequest({ types: '152', scale: '1', percentiles: '12.5,87.5' }),
    );

    expect(response.status).toBe(200);
    expect(mockedGetSplitPercentiles).toHaveBeenCalledWith(
      [152],
      1,
      [12.5, 87.5],
      undefined,
      undefined,
    );
  });

  it('parses a time window', async () => {
    const response = await GET(
      createRequest({
        types: '152',
        scale: '1',
        after: '2026-01-01',
        before: '2026-07-01',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedGetSplitPercentiles).toHaveBeenCalledWith(
      [152],
      1,
      [5, 25, 50, 75, 95],
      new Date('2026-01-01'),
      new Date('2026-07-01'),
    );
  });

  it.each(['after', 'before'])('rejects an invalid %s date', async (key) => {
    const response = await GET(
      createRequest({ types: '152', scale: '1', [key]: 'not-a-date' }),
    );
    expect(response.status).toBe(400);
    expect(mockedGetSplitPercentiles).not.toHaveBeenCalled();
  });
});
