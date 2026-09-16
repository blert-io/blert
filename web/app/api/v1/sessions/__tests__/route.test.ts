jest.mock('@/actions/challenge', () => ({
  loadSessionsPage: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { loadSessionsPage } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedLoadSessionsPage = loadSessionsPage as jest.MockedFunction<
  typeof loadSessionsPage
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedLoadSessionsPage.mockResolvedValue({
    sessions: [],
    total: 0,
    remaining: 0,
  });
});

describe('GET /api/v1/sessions', () => {
  it('defaults limit to 10', async () => {
    const response = await GET(apiRequest('/api/v1/sessions'));
    expect(response.status).toBe(200);
    expect(mockedLoadSessionsPage).toHaveBeenCalledWith(10, expect.anything());
  });

  it('forwards a limit within range', async () => {
    const response = await GET(
      apiRequest('/api/v1/sessions', { limit: '100' }),
    );
    expect(response.status).toBe(200);
    expect(mockedLoadSessionsPage).toHaveBeenCalledWith(100, expect.anything());
  });

  it.each(['abc', '', '0', '101', '-1', '1.03', '1e6', '4+2i'])(
    'rejects limit %s',
    async (limit) => {
      const response = await GET(apiRequest('/api/v1/sessions', { limit }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('limit');
      expect(mockedLoadSessionsPage).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid filters', async () => {
    const response = await GET(apiRequest('/api/v1/sessions', { status: '9' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('status');
    expect(mockedLoadSessionsPage).not.toHaveBeenCalled();
  });
});
