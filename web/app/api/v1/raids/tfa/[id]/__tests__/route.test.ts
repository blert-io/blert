import { ChallengeType } from '@blert/common';

jest.mock('@/actions/challenge', () => ({
  loadChallenge: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { loadChallenge } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedLoadChallenge = loadChallenge as jest.MockedFunction<
  typeof loadChallenge
>;

type Raid = Awaited<ReturnType<typeof loadChallenge>>;

const UUID = '25252525-2525-9999-2525-252525252525';
const PATH = `/api/v1/raids/tfa/${UUID}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/raids/tfa/[id]', () => {
  it('returns the requested raid', async () => {
    const raid = { uuid: UUID, type: ChallengeType.TFA };
    mockedLoadChallenge.mockResolvedValue(raid as unknown as Raid);
    const response = await GET(apiRequest(PATH), {
      params: Promise.resolve({ id: UUID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(raid);
    expect(mockedLoadChallenge).toHaveBeenCalledWith(ChallengeType.TFA, UUID);
  });

  it('returns 404 for an unknown raid', async () => {
    mockedLoadChallenge.mockResolvedValue(null);
    const response = await GET(apiRequest(PATH), {
      params: Promise.resolve({ id: UUID }),
    });
    expect(response.status).toBe(404);
    expect(mockedLoadChallenge).toHaveBeenCalledWith(ChallengeType.TFA, UUID);
  });
});
