import { Stage } from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { TaggedEvent } from '../event';
import {
  buildGraphicsForTick,
  buildGraphicsStates,
  cloneGraphics,
  createGraphicsEvents,
  GraphicsState,
  GraphicsType,
} from '../graphics';
import {
  createMaidenBloodSplatsEvent,
  createSoteMazePathEvent,
  createVerzikYellowsEvent,
} from './fixtures';
import { coordKey } from '../world';

const CLIENT_A = 1;
const CLIENT_B = 2;

function tag(event: ProtoEvent, source: number): TaggedEvent {
  return { event, source };
}

describe('buildGraphicsForTick', () => {
  it('returns an empty map when there are no events', () => {
    const result = buildGraphicsForTick([], null);
    expect(result.size).toBe(0);
  });

  it('extracts snapshot coords from a blood splats event', () => {
    const event = createMaidenBloodSplatsEvent({
      tick: 0,
      coords: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    const result = buildGraphicsForTick([tag(event, CLIENT_A)], null);

    expect(result.size).toBe(1);
    const splats = result.get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS);
    expect(splats).toBeDefined();
    expect(splats!.size).toBe(2);
    expect(splats!.get(coordKey({ x: 1, y: 2 }))).toBe(CLIENT_A);
    expect(splats!.get(coordKey({ x: 3, y: 4 }))).toBe(CLIENT_A);
  });

  it('extracts snapshot coords from a verzik yellows event', () => {
    const event = createVerzikYellowsEvent({
      tick: 0,
      coords: [{ x: 50, y: 60 }],
    });
    const result = buildGraphicsForTick([tag(event, CLIENT_A)], null);

    const yellows = result.get(GraphicsType.TOB_VERZIK_YELLOWS);
    expect(yellows).toBeDefined();
    expect(yellows!.size).toBe(1);
    expect(yellows!.get(coordKey({ x: 50, y: 60 }))).toBe(CLIENT_A);
  });

  it('extracts overworld tiles from a sote maze path event', () => {
    const event = createSoteMazePathEvent({
      tick: 0,
      overworldTiles: [
        { x: 100, y: 200 },
        { x: 101, y: 200 },
      ],
    });
    const result = buildGraphicsForTick([tag(event, CLIENT_A)], null);

    const tiles = result.get(GraphicsType.TOB_SOTE_OVERWORLD_TILES);
    expect(tiles).toBeDefined();
    expect(tiles!.size).toBe(2);
    expect(tiles!.get(coordKey({ x: 100, y: 200 }))).toBe(CLIENT_A);
    expect(tiles!.get(coordKey({ x: 101, y: 200 }))).toBe(CLIENT_A);
  });

  it("tags every coord with the events' source client", () => {
    const event = createMaidenBloodSplatsEvent({
      tick: 0,
      coords: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    });
    const result = buildGraphicsForTick([tag(event, CLIENT_A)], null);

    const splats = result.get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!;
    expect(splats.get(coordKey({ x: 1, y: 1 }))).toBe(CLIENT_A);
    expect(splats.get(coordKey({ x: 2, y: 2 }))).toBe(CLIENT_A);
  });

  it('deduplicates repeated coords within a single event', () => {
    const event = createMaidenBloodSplatsEvent({
      tick: 0,
      coords: [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    });
    const result = buildGraphicsForTick([tag(event, CLIENT_A)], null);

    const splats = result.get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!;
    expect(splats.size).toBe(2);
  });

  it('records an empty entry when the snapshot event has no coords', () => {
    const event = createMaidenBloodSplatsEvent({ tick: 0, coords: [] });
    const result = buildGraphicsForTick([tag(event, CLIENT_A)], null);

    const splats = result.get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS);
    expect(splats).toBeDefined();
    expect(splats!.size).toBe(0);
  });

  it('does not carry snapshot state forward when no event is present', () => {
    const previous: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 1 }), CLIENT_A]]),
      ],
    ]);

    const result = buildGraphicsForTick([], previous);
    expect(result.size).toBe(0);
  });

  it('replaces snapshot state when a new event is present', () => {
    const previous: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 1 }), CLIENT_A]]),
      ],
    ]);

    const event = createMaidenBloodSplatsEvent({
      tick: 1,
      coords: [
        { x: 9, y: 9 },
        { x: 8, y: 8 },
      ],
    });
    const result = buildGraphicsForTick([tag(event, CLIENT_B)], previous);

    const splats = result.get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!;
    expect(splats.size).toBe(2);
    expect(splats.has(coordKey({ x: 1, y: 1 }))).toBe(false);
    expect(splats.get(coordKey({ x: 9, y: 9 }))).toBe(CLIENT_B);
    expect(splats.get(coordKey({ x: 8, y: 8 }))).toBe(CLIENT_B);
  });

  it('treats different graphics types as independent', () => {
    const splatsEvent = createMaidenBloodSplatsEvent({
      tick: 0,
      coords: [{ x: 1, y: 1 }],
    });
    const yellowsEvent = createVerzikYellowsEvent({
      tick: 0,
      coords: [{ x: 2, y: 2 }],
    });

    const result = buildGraphicsForTick(
      [tag(splatsEvent, CLIENT_A), tag(yellowsEvent, CLIENT_A)],
      null,
    );

    expect(result.get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)?.size).toBe(1);
    expect(result.get(GraphicsType.TOB_VERZIK_YELLOWS)?.size).toBe(1);
  });

  it('ignores events whose type is not in GRAPHICS_CONFIGS', () => {
    const npcEvent = new ProtoEvent();
    npcEvent.setType(ProtoEvent.Type.NPC_UPDATE);

    const result = buildGraphicsForTick([tag(npcEvent, CLIENT_A)], null);
    expect(result.size).toBe(0);
  });

  it('returns an empty overworld-tile entry when the maze has no tiles', () => {
    const event = createSoteMazePathEvent({ tick: 0, overworldTiles: [] });
    const result = buildGraphicsForTick([tag(event, CLIENT_A)], null);

    const tiles = result.get(GraphicsType.TOB_SOTE_OVERWORLD_TILES);
    expect(tiles).toBeDefined();
    expect(tiles!.size).toBe(0);
  });
});

describe('buildGraphicsStates', () => {
  it('returns one state map per input tick', () => {
    const ticks: TaggedEvent[][] = [[], [], []];
    const result = buildGraphicsStates(ticks);
    expect(result.length).toBe(3);
    for (const state of result) {
      expect(state.size).toBe(0);
    }
  });

  it('produces independent snapshot state per tick', () => {
    const ticks: TaggedEvent[][] = [
      [
        tag(
          createMaidenBloodSplatsEvent({
            tick: 0,
            coords: [{ x: 1, y: 1 }],
          }),
          CLIENT_A,
        ),
      ],
      [],
      [
        tag(
          createMaidenBloodSplatsEvent({
            tick: 2,
            coords: [{ x: 2, y: 2 }],
          }),
          CLIENT_A,
        ),
      ],
    ];
    const result = buildGraphicsStates(ticks);

    expect(result[0].get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)?.size).toBe(1);
    expect(result[1].has(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)).toBe(false);
    const tick2 = result[2].get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!;
    expect(tick2.size).toBe(1);
    expect(tick2.has(coordKey({ x: 2, y: 2 }))).toBe(true);
  });
});

describe('cloneGraphics', () => {
  it('returns an empty map for an empty input', () => {
    const result = cloneGraphics(new Map());
    expect(result.size).toBe(0);
  });

  it('preserves all entries and sources', () => {
    const original: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([
          [coordKey({ x: 1, y: 1 }), CLIENT_A],
          [coordKey({ x: 2, y: 2 }), CLIENT_B],
        ]),
      ],
      [
        GraphicsType.TOB_VERZIK_YELLOWS,
        new Map([[coordKey({ x: 3, y: 3 }), CLIENT_A]]),
      ],
    ]);

    const copy = cloneGraphics(original);
    expect(copy).toEqual(original);
  });

  it('isolates the outer map from mutations on the copy', () => {
    const original: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 1 }), CLIENT_A]]),
      ],
    ]);

    const copy = cloneGraphics(original);
    copy.set(GraphicsType.TOB_VERZIK_YELLOWS, new Map());
    expect(original.has(GraphicsType.TOB_VERZIK_YELLOWS)).toBe(false);
  });

  it('isolates the inner maps from mutations on the copy', () => {
    const original: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 1 }), CLIENT_A]]),
      ],
    ]);

    const copy = cloneGraphics(original);
    copy
      .get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!
      .set(coordKey({ x: 9, y: 9 }), CLIENT_B);

    const originalSplats = original.get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!;
    expect(originalSplats.size).toBe(1);
    expect(originalSplats.has(coordKey({ x: 9, y: 9 }))).toBe(false);
  });
});

describe('createGraphicsEvents', () => {
  const STAGE = Stage.TOB_MAIDEN;
  const TICK = 7;

  it('returns no events when the graphics state is empty', () => {
    expect(createGraphicsEvents(new Map(), null, STAGE, TICK)).toEqual([]);
  });

  it('emits the full snapshot set as a proto event', () => {
    const state: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([
          [coordKey({ x: 1, y: 2 }), CLIENT_A],
          [coordKey({ x: 3, y: 4 }), CLIENT_A],
        ]),
      ],
    ]);

    const events = createGraphicsEvents(state, null, STAGE, TICK);
    expect(events.length).toBe(1);

    const event = events[0];
    expect(event.getType()).toBe(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS);
    expect(event.getStage()).toBe(STAGE);
    expect(event.getTick()).toBe(TICK);
    const coords = event
      .getMaidenBloodSplatsList()
      .map((c) => ({ x: c.getX(), y: c.getY() }));
    expect(coords).toEqual(
      expect.arrayContaining([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]),
    );
    expect(coords.length).toBe(2);
  });

  it('emits the same full set on every tick the snapshot is present', () => {
    const previous: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 2 }), CLIENT_A]]),
      ],
    ]);
    const current: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 2 }), CLIENT_A]]),
      ],
    ]);

    const events = createGraphicsEvents(current, previous, STAGE, TICK);
    expect(events.length).toBe(1);
    expect(events[0].getMaidenBloodSplatsList().length).toBe(1);
  });

  it('skips graphics types with no current state', () => {
    const previous: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 2 }), CLIENT_A]]),
      ],
    ]);

    const events = createGraphicsEvents(new Map(), previous, STAGE, TICK);
    expect(events).toEqual([]);
  });

  it('emits a separate event per eventType', () => {
    const state: GraphicsState = new Map([
      [
        GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
        new Map([[coordKey({ x: 1, y: 1 }), CLIENT_A]]),
      ],
      [
        GraphicsType.TOB_VERZIK_YELLOWS,
        new Map([[coordKey({ x: 9, y: 9 }), CLIENT_A]]),
      ],
    ]);

    const events = createGraphicsEvents(state, null, STAGE, TICK);
    const types = events.map((e) => e.getType()).sort();
    expect(types).toEqual(
      [
        ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS,
        ProtoEvent.Type.TOB_VERZIK_YELLOWS,
      ].sort(),
    );
  });

  it('writes overworld tiles into the SoteMaze proto wrapper', () => {
    const state: GraphicsState = new Map([
      [
        GraphicsType.TOB_SOTE_OVERWORLD_TILES,
        new Map([
          [coordKey({ x: 100, y: 200 }), CLIENT_A],
          [coordKey({ x: 101, y: 200 }), CLIENT_A],
        ]),
      ],
    ]);

    const events = createGraphicsEvents(state, null, Stage.TOB_SOTETSEG, TICK);
    expect(events.length).toBe(1);

    const event = events[0];
    expect(event.getType()).toBe(ProtoEvent.Type.TOB_SOTE_MAZE_PATH);
    const tiles = event.getSoteMaze()!.getOverworldTilesList();
    expect(tiles.length).toBe(2);
  });

  it('emits an empty snapshot event when the state is an empty map', () => {
    const state: GraphicsState = new Map([
      [GraphicsType.TOB_MAIDEN_BLOOD_SPLATS, new Map()],
    ]);

    const events = createGraphicsEvents(state, null, STAGE, TICK);
    expect(events.length).toBe(1);
    expect(events[0].getMaidenBloodSplatsList().length).toBe(0);
  });
});
