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
const PATH = `/api/v1/challenges/mokhaiotl/${UUID}/events`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/challenges/mokhaiotl/[id]/events', () => {
  it('queries delves by stage', async () => {
    const events = [
      {
        type: EventType.NPC_SPAWN,
        stage: Stage.MOKHAIOTL_DELVE_1,
        tick: 0,
        xCoord: 1309,
        yCoord: 9571,
        npc: { id: 14707, roomId: 63813, hitpoints: 34406925, prayers: 0 },
      },
    ];
    mockedLoadEventsForStage.mockResolvedValue(events as unknown as Events);
    const response = await GET(
      apiRequest(PATH, { stage: `${Stage.MOKHAIOTL_DELVE_1}` }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(events);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.MOKHAIOTL_DELVE_1,
      undefined,
      undefined,
    );
  });

  it('queries delves by number', async () => {
    const events = [
      {
        type: EventType.NPC_SPAWN,
        stage: Stage.MOKHAIOTL_DELVE_1,
        tick: 0,
        xCoord: 1309,
        yCoord: 9571,
        npc: { id: 14707, roomId: 63813, hitpoints: 34406925, prayers: 0 },
      },
    ];
    mockedLoadEventsForStage.mockResolvedValue(events as unknown as Events);
    const response = await GET(apiRequest(PATH, { delve: '1' }), {
      params: Promise.resolve({ id: UUID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(events);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.MOKHAIOTL_DELVE_1,
      undefined,
      undefined,
    );
  });

  it('translates delves 8+ to an attempt of stage DELVE_8PLUS', async () => {
    const events = [
      {
        type: EventType.NPC_SPAWN,
        stage: Stage.MOKHAIOTL_DELVE_8PLUS,
        tick: 0,
        xCoord: 3549,
        yCoord: 6435,
        npc: { id: 14707, roomId: 40170, hitpoints: 44237475, prayers: 0 },
      },
    ];
    mockedLoadEventsForStage.mockResolvedValue(events as unknown as Events);
    const response = await GET(apiRequest(PATH, { delve: '9' }), {
      params: Promise.resolve({ id: UUID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(events);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.MOKHAIOTL_DELVE_8PLUS,
      undefined,
      1,
    );
  });

  it('queries directly provided attempts for DELVE_8PLUS', async () => {
    const events = [
      {
        type: EventType.NPC_SPAWN,
        stage: Stage.MOKHAIOTL_DELVE_8PLUS,
        tick: 0,
        xCoord: 3549,
        yCoord: 6435,
        npc: { id: 14707, roomId: 41727, hitpoints: 44237475, prayers: 0 },
      },
    ];
    mockedLoadEventsForStage.mockResolvedValue(events as unknown as Events);
    const response = await GET(
      apiRequest(PATH, {
        stage: `${Stage.MOKHAIOTL_DELVE_8PLUS}`,
        attempt: '3',
      }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(events);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.MOKHAIOTL_DELVE_8PLUS,
      undefined,
      3,
    );
  });

  it('filters by a specified event type', async () => {
    const events = [
      {
        type: EventType.NPC_SPAWN,
        stage: Stage.MOKHAIOTL_DELVE_1,
        tick: 0,
        xCoord: 1309,
        yCoord: 9571,
        npc: { id: 14707, roomId: 63813, hitpoints: 34406925, prayers: 0 },
      },
    ];
    mockedLoadEventsForStage.mockResolvedValue(events as unknown as Events);
    const response = await GET(
      apiRequest(PATH, {
        stage: `${Stage.MOKHAIOTL_DELVE_1}`,
        type: `${EventType.NPC_SPAWN}`,
      }),
      { params: Promise.resolve({ id: UUID }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(events);
    expect(mockedLoadEventsForStage).toHaveBeenCalledWith(
      UUID,
      Stage.MOKHAIOTL_DELVE_1,
      EventType.NPC_SPAWN,
      undefined,
    );
  });

  it.each<[Record<string, string>, string]>([
    [{}, 'stage'],
    [{ stage: '49' }, 'stage'],
    [{ stage: '59' }, 'stage'],
    [{ stage: 'abc' }, 'stage'],
    [{ stage: '99999999999' }, 'stage'],
    [{ stage: '50', attempt: '0' }, 'attempt'],
    [{ stage: '50', attempt: 'abc' }, 'attempt'],
    [{ delve: '0' }, 'delve'],
    [{ delve: 'abc' }, 'delve'],
  ])('rejects %j', async (params, name) => {
    const response = await GET(apiRequest(PATH, params), {
      params: Promise.resolve({ id: UUID }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(name);
    expect(mockedLoadEventsForStage).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown challenge or stage', async () => {
    mockedLoadEventsForStage.mockResolvedValue(null);
    const response = await GET(apiRequest(PATH, { delve: '12' }), {
      params: Promise.resolve({ id: UUID }),
    });
    expect(response.status).toBe(404);
  });
});
