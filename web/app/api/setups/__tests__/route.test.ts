import { ChallengeType } from '@blert/common';

jest.mock('@/actions/setup', () => ({
  getSetups: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { getSetups, SetupCursor, SetupSort } from '@/actions/setup';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedGetSetups = getSetups as jest.MockedFunction<typeof getSetups>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetSetups.mockResolvedValue({
    setups: [],
    nextCursor: null,
    prevCursor: null,
    total: 0,
    remaining: 0,
  });
});

describe('GET /api/setups', () => {
  it('defaults limit and sort', async () => {
    const response = await GET(apiRequest('/api/setups'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      setups: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      remaining: 0,
    });
    expect(mockedGetSetups).toHaveBeenCalledWith(
      {
        orderBy: 'latest',
        challenge: undefined,
        scale: undefined,
        author: undefined,
      },
      null,
      10,
    );
  });

  it('forwards provided filters', async () => {
    const response = await GET(
      apiRequest('/api/setups', {
        limit: '20',
        sort: 'views',
        state: 'published',
        challenge: `${ChallengeType.TOB}`,
        scale: '5',
        author: '7',
        search: '  maiden  ',
      }),
    );
    expect(response.status).toBe(200);
    expect(mockedGetSetups).toHaveBeenCalledWith(
      {
        orderBy: 'views',
        state: 'published',
        challenge: ChallengeType.TOB,
        scale: 5,
        author: 7,
        search: 'maiden',
      },
      null,
      20,
    );
  });

  it.each<[Record<string, string>, SetupSort, SetupCursor]>([
    [
      { after: '1789478160173,aaaaaaaaaaa' },
      'latest',
      {
        createdAt: new Date(1789478160173),
        publicId: 'aaaaaaaaaaa',
        direction: 'forward',
        score: 0,
        views: 0,
      },
    ],
    [
      { sort: 'score', before: '-3,1789478160173,aaaaaaaaaaa' },
      'score',
      {
        score: -3,
        createdAt: new Date(1789478160173),
        publicId: 'aaaaaaaaaaa',
        direction: 'backward',
        views: 0,
      },
    ],
    [
      { sort: 'views', after: '12,1789478160173,aaaaaaaaaaa' },
      'views',
      {
        views: 12,
        createdAt: new Date(1789478160173),
        publicId: 'aaaaaaaaaaa',
        direction: 'forward',
        score: 0,
      },
    ],
  ])('parses cursor %j', async (params, sort, cursor) => {
    const response = await GET(apiRequest('/api/setups', params));
    expect(response.status).toBe(200);
    expect(mockedGetSetups).toHaveBeenCalledWith(
      {
        orderBy: sort,
        challenge: undefined,
        scale: undefined,
        author: undefined,
      },
      cursor,
      10,
    );
  });

  it.each<[Record<string, string>, string]>([
    [{ limit: 'abc' }, 'limit'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '51' }, 'limit'],
    [{ sort: 'bogus' }, 'sort'],
    [{ state: 'bogus' }, 'state'],
    [{ challenge: 'abc' }, 'challenge'],
    [{ challenge: '99' }, 'challenge'],
    [{ scale: '9' }, 'scale'],
    [{ author: 'abc' }, 'author'],
    [{ author: '0' }, 'author'],
    [{ author: '99999999999' }, 'author'],
    [{ after: 'abc,aaaaaaaaaaa' }, 'after'],
    [{ after: '1789478160173' }, 'after'],
    [{ before: '8640000000000001,aaaaaaaaaaa' }, 'before'],
    [{ sort: 'score', after: '1.5,1789478160173,aaaaaaaaaaa' }, 'after'],
    [{ sort: 'views', before: '-1,1789478160173,aaaaaaaaaaa' }, 'before'],
    [{ after: '1,aaaaaaaaaaa', before: '1,aaaaaaaaaaa' }, 'before and after'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(apiRequest('/api/setups', params));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedGetSetups).not.toHaveBeenCalled();
  });
});
