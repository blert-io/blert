import { EventJson, jsonToProtoEvent, Stage } from '@blert/common';
import { Coords, Event } from '@blert/common/generated/event_pb';

import { EventType, TaggedEvent } from './event';
import { CoordsLike } from './world';

export type CoordKey = `${number},${number}`;

export function coordKey({ x, y }: CoordsLike): CoordKey {
  return `${x},${y}`;
}

export function fromCoordKey(key: CoordKey): CoordsLike {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

function protoCoords({ x, y }: CoordsLike): Coords {
  const c = new Coords();
  c.setX(x);
  c.setY(y);
  return c;
}

function coordsFromProto(c: Coords): CoordsLike {
  return { x: c.getX(), y: c.getY() };
}

/**
 * Fine-grained graphics types. A single event type can store multiple graphics.
 */
export const enum GraphicsType {
  TOB_MAIDEN_BLOOD_SPLATS = 'TOB_MAIDEN_BLOOD_SPLATS',
  TOB_VERZIK_YELLOWS = 'TOB_VERZIK_YELLOWS',
  TOB_SOTE_OVERWORLD_TILES = 'TOB_SOTE_OVERWORLD_TILES',
}

/**
 * Snapshot graphics: each event's payload is the full visible set on the tick.
 */
type SnapshotConfig = {
  style: 'snapshot';
  eventType: EventType;
  extract: (event: Event) => CoordsLike[];
  write: (event: Event, coords: CoordsLike[]) => void;
};

/**
 * Delta graphics: each event's payload describes additions and removals
 * since the previous tick.
 */
type DeltaConfig = {
  style: 'delta';
  eventType: EventType;
  extract: (event: Event) => { added: CoordsLike[]; removed: CoordsLike[] };
  write: (event: Event, added: CoordsLike[], removed: CoordsLike[]) => void;
};

export type GraphicsConfig = SnapshotConfig | DeltaConfig;

/**
 * Per-tick graphics state: the visible coords for each active
 * {@link GraphicsType}, mapped to the client that originally observed each
 * coord. Types with no graphics on a tick are absent from the outer map.
 */
export type GraphicsState = Map<GraphicsType, Map<CoordKey, number>>;

export const GRAPHICS_CONFIGS: Record<GraphicsType, GraphicsConfig> = {
  [GraphicsType.TOB_MAIDEN_BLOOD_SPLATS]: {
    style: 'snapshot',
    eventType: Event.Type.TOB_MAIDEN_BLOOD_SPLATS,
    extract: (event) => event.getMaidenBloodSplatsList().map(coordsFromProto),
    write: (event, coords) =>
      event.setMaidenBloodSplatsList(coords.map(protoCoords)),
  },
  [GraphicsType.TOB_VERZIK_YELLOWS]: {
    style: 'snapshot',
    eventType: Event.Type.TOB_VERZIK_YELLOWS,
    extract: (event) => event.getVerzikYellowsList().map(coordsFromProto),
    write: (event, coords) =>
      event.setVerzikYellowsList(coords.map(protoCoords)),
  },
  [GraphicsType.TOB_SOTE_OVERWORLD_TILES]: {
    style: 'snapshot',
    eventType: Event.Type.TOB_SOTE_MAZE_PATH,
    extract: (event) =>
      event.getSoteMaze()?.getOverworldTilesList().map(coordsFromProto) ?? [],
    write: (event, coords) => {
      const maze = event.getSoteMaze() ?? new Event.SoteMaze();
      maze.setOverworldTilesList(coords.map(protoCoords));
      event.setSoteMaze(maze);
    },
  },
};

/**
 * Deep-copies a graphics state map.
 */
export function cloneGraphics(
  graphics: Readonly<GraphicsState>,
): GraphicsState {
  const copy: GraphicsState = new Map();
  for (const [type, coords] of graphics) {
    copy.set(type, new Map(coords));
  }
  return copy;
}

/**
 * Builds the graphics state map for a single tick from a single client's
 * events, dispatching per-type via {@link GRAPHICS_CONFIGS}. Snapshot-style
 * configs replace the entries with the event's full coordinate list.
 * Delta-style configs seed from the previous tick's entries, then apply
 * additions and removals.
 *
 * Each coord is tagged with the source client's ID.
 *
 * @param events Events for this tick.
 * @param previous Graphics state from the immediately preceding tick, or
 *   `null` if this is the first tick.
 * @returns The graphics state map for this tick.
 */
export function buildGraphicsForTick(
  events: TaggedEvent[],
  previous: Readonly<GraphicsState> | null,
): GraphicsState {
  const result: GraphicsState = new Map();

  for (const graphicsType of Object.keys(GRAPHICS_CONFIGS) as GraphicsType[]) {
    const config = GRAPHICS_CONFIGS[graphicsType];
    const matching = events.filter(
      (t) => t.event.getType() === config.eventType,
    );

    if (config.style === 'snapshot') {
      // Snapshots are absent when no event is present on this tick.
      if (matching.length === 0) {
        continue;
      }
      const coords = new Map<CoordKey, number>();
      for (const tagged of matching) {
        for (const coord of config.extract(tagged.event)) {
          const key = coordKey(coord);
          if (!coords.has(key)) {
            coords.set(key, tagged.source);
          }
        }
      }
      result.set(graphicsType, coords);
    } else {
      // Deltas carry forward from the previous tick.
      const prev = previous?.get(graphicsType);
      if (matching.length === 0 && prev === undefined) {
        continue;
      }
      const coords = new Map<CoordKey, number>(prev);
      for (const tagged of matching) {
        const { added, removed } = config.extract(tagged.event);
        for (const coord of removed) {
          coords.delete(coordKey(coord));
        }
        for (const coord of added) {
          const key = coordKey(coord);
          if (!coords.has(key)) {
            coords.set(key, tagged.source);
          }
        }
      }
      result.set(graphicsType, coords);
    }
  }

  return result;
}

/**
 * Builds graphics state maps for an entire client's tick range, threading
 * carried-forward state across ticks. Returns a parallel array indexed by
 * tick.
 */
export function buildGraphicsStates(
  eventsByTick: TaggedEvent[][],
): GraphicsState[] {
  const result: GraphicsState[] = [];
  for (const events of eventsByTick) {
    result.push(buildGraphicsForTick(events, result.at(-1) ?? null));
  }
  return result;
}

/**
 * Synthesizes proto graphics events from the merged graphics state of a
 * tick. {@link GraphicsType}s that share an `eventType` are emitted as a
 * single event with each member's payload written into it.
 *
 * @param current Graphics state for this tick.
 * @param previous Graphics state from the immediately preceding tick, or
 *   `null` if this is the first tick.
 * @param stage The stage in which the events occur.
 * @param tick The tick at which the events occur.
 * @returns Synthesized events.
 */
export function createGraphicsEvents(
  current: Readonly<GraphicsState>,
  previous: Readonly<GraphicsState> | null,
  stage: Stage,
  tick: number,
): Event[] {
  const groups = new Map<EventType, GraphicsType[]>();
  for (const graphicsType of Object.keys(GRAPHICS_CONFIGS) as GraphicsType[]) {
    const { eventType } = GRAPHICS_CONFIGS[graphicsType];
    const types = groups.get(eventType);
    if (types === undefined) {
      groups.set(eventType, [graphicsType]);
    } else {
      types.push(graphicsType);
    }
  }

  const events: Event[] = [];

  for (const [eventType, types] of groups) {
    let event: Event | null = null;

    for (const graphicsType of types) {
      const config = GRAPHICS_CONFIGS[graphicsType];
      const currentCoords = current.get(graphicsType);

      if (config.style === 'snapshot') {
        if (currentCoords === undefined) {
          continue;
        }
        event ??= emptyGraphicsEvent(eventType, stage, tick);
        config.write(event, [...currentCoords.keys()].map(fromCoordKey));
      } else {
        const previousCoords = previous?.get(graphicsType);
        const added: CoordsLike[] = [];
        const removed: CoordsLike[] = [];

        if (currentCoords !== undefined) {
          for (const key of currentCoords.keys()) {
            if (!previousCoords?.has(key)) {
              added.push(fromCoordKey(key));
            }
          }
        }
        if (previousCoords !== undefined) {
          for (const key of previousCoords.keys()) {
            if (!currentCoords?.has(key)) {
              removed.push(fromCoordKey(key));
            }
          }
        }

        if (added.length === 0 && removed.length === 0) {
          continue;
        }
        event ??= emptyGraphicsEvent(eventType, stage, tick);
        config.write(event, added, removed);
      }
    }

    if (event !== null) {
      events.push(event);
    }
  }

  return events;
}

function emptyGraphicsEvent(
  eventType: EventType,
  stage: Stage,
  tick: number,
): Event {
  const json: EventJson = {
    type: eventType,
    stage,
    tick,
    xCoord: 0,
    yCoord: 0,
  };
  return jsonToProtoEvent(json);
}
