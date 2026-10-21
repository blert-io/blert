import { EventType, Stage } from '@blert/common';

jest.mock('@/actions/challenge', () => ({
  loadEventsForStage: jest.fn(),
}));
jest.mock('@/utils/metrics', () => ({
  observeHttpRequest: jest.fn(),
}));

import { loadEventsForStage } from '@/actions/challenge';
import { apiRequest } from '@/api/__tests__/request';

import { GET } from '../route';

const mockedLoadEventsForStage = loadEventsForStage as jest.MockedFunction<
  typeof loadEventsForStage
>;

type Events = Awaited<ReturnType<typeof loadEventsForStage>>;

const UUID = '25252525-2525-2525-2525-252525252525';
const PATH = `/api/v1/raids/tfa/${UUID}/events`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/raids/tfa/[id]/events', () => {
  it('queries events by stage', async () => {
    const events = [
      { type: EventType.NPC_SPAWN, stage: Stage.TFA_GUARDIAN, tick: 0 },
    ];
    mockedLoadEventsForStage.mockResolvedValue(events as unknown as Events);
    const response = await GET(
      apiRequest(PATH, { stage: `${Stage.TFA_GUARDIAN}` }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(events);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.TFA_GUARDIAN,
      undefined,
    );
  });

  it('filters by a specified event type', async () => {
    const events = [
      { type: EventType.NPC_SPAWN, stage: Stage.TFA_OCELLUS, tick: 0 },
    ];
    mockedLoadEventsForStage.mockResolvedValue(events as unknown as Events);
    const response = await GET(
      apiRequest(PATH, {
        stage: `${Stage.TFA_OCELLUS}`,
        type: `${EventType.NPC_SPAWN}`,
      }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(events);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.TFA_OCELLUS,
      EventType.NPC_SPAWN,
    );
  });

  it.each<[Record<string, string>, string]>([
    [{}, 'stage'],
    [{ stage: `${Stage.MOKHAIOTL_DELVE_8PLUS}` }, 'stage'],
    [{ stage: `${Stage.COLOSSEUM_WAVE_1}` }, 'stage'],
    [{ stage: '68' }, 'stage'],
    [{ stage: 'abc' }, 'stage'],
    [{ stage: `${Stage.TFA_GUARDIAN}`, type: '99999' }, 'type'],
    [{ stage: `${Stage.TFA_GUARDIAN}`, type: 'abc' }, 'type'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(apiRequest(PATH, params), {
      params: Promise.resolve({ id: UUID }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedLoadEventsForStage).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown raid or stage', async () => {
    mockedLoadEventsForStage.mockResolvedValue(null);
    const response = await GET(
      apiRequest(PATH, { stage: `${Stage.TFA_XARTH}` }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(response.status).toBe(404);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.TFA_XARTH,
      undefined,
    );
  });
});
