jest.mock('@/actions/challenge', () => ({
  getSessionStatuses: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { getSessionStatuses } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedGetSessionStatuses = getSessionStatuses as jest.MockedFunction<
  typeof getSessionStatuses
>;

const UUID = '66666666-6666-6666-6666-666666666667';

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetSessionStatuses.mockResolvedValue([]);
});

describe('GET /api/v1/sessions/status', () => {
  it('does not query for an empty UUID list', async () => {
    const response = await GET(apiRequest('/api/v1/sessions/status'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedGetSessionStatuses).not.toHaveBeenCalled();
  });

  it('looks up every provided UUID', async () => {
    const response = await GET(
      apiRequest('/api/v1/sessions/status', { uuids: `${UUID},${UUID}` }),
    );
    expect(response.status).toBe(200);
    expect(mockedGetSessionStatuses).toHaveBeenCalledWith([UUID, UUID]);
  });

  it.each(['abc', `${UUID},1`, '1'])('rejects uuids %s', async (uuids) => {
    const response = await GET(
      apiRequest('/api/v1/sessions/status', { uuids }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('uuids');
    expect(mockedGetSessionStatuses).not.toHaveBeenCalled();
  });
});
