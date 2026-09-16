jest.mock('@/actions/challenge', () => ({
  loadSessionWithStats: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { loadSessionWithStats } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedLoadSessionWithStats = loadSessionWithStats as jest.MockedFunction<
  typeof loadSessionWithStats
>;

const UUID = '66666666-6666-6666-6666-666666666667';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/sessions/[uuid]', () => {
  it('returns 404 for an unknown session', async () => {
    mockedLoadSessionWithStats.mockResolvedValue(null);
    const response = await GET(apiRequest(`/api/v1/sessions/${UUID}`), {
      params: Promise.resolve({ uuid: UUID }),
    });
    expect(response.status).toBe(404);
  });

  it('returns the session', async () => {
    const session = { uuid: UUID };
    mockedLoadSessionWithStats.mockResolvedValue(
      session as unknown as Awaited<ReturnType<typeof loadSessionWithStats>>,
    );
    const response = await GET(apiRequest(`/api/v1/sessions/${UUID}`), {
      params: Promise.resolve({ uuid: UUID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(session);
  });
});
