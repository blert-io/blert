'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import Map, {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../components/map';
import {
  Event,
  EventType,
  MaidenCrabSpawn,
  MaidenCrabSpawnEvent,
  NpcUpdateEvent,
  PlayerUpdateEvent,
} from '../../stats';
import { TICK_MS, ticksToFormattedSeconds } from '../../tick';

import { CrabSpawn } from './crab-spawn';
import styles from './style.module.css';

import maidenBaseTiles from './maiden.json';
import testEventData from '../../../../testdata/maiden/50s_misclick_wipe.json';
const maidenEvents = testEventData as Event[];

const MAIDEN_X = 3160;
const MAIDEN_Y = 4435;
const MAIDEN_WIDTH = 28;
const MAIDEN_HEIGHT = 24;

// TODO(frolv): Added for test purposes only, remove when no longer needed.
const DEBUG_TILES_TO_MARK: [number, number][] = [
  [3174, 4457],
  [3178, 4457],
  [3182, 4457],
  [3186, 4457],
  [3186, 4455],
  [3174, 4436],
  [3178, 4436],
  [3182, 4436],
  [3186, 4436],
  [3186, 4438],
];

type EventTickMap = { [key: number]: Event[] };
type EventTypeMap = { [key: string]: Event[] };

function buildEventMaps(events: Event[]): [EventTickMap, EventTypeMap] {
  let byTick: EventTickMap = {};
  let byType: EventTypeMap = {};

  for (const event of events) {
    if (byTick[event.tick] === undefined) {
      byTick[event.tick] = [];
    }
    byTick[event.tick].push(event);

    if (byType[event.type] === undefined) {
      byType[event.type] = [];
    }
    byType[event.type].push(event);
  }

  return [byTick, byType];
}

const enum Playback {
  STOPPED,
  PLAYING,
  PAUSED,
}

type RoomInfoProps = {
  eventsByType: EventTypeMap;
  tick: number;
  playback: Playback;
};

function RoomInfo({ eventsByType, tick, playback }: RoomInfoProps) {
  const crabSpawns = eventsByType[
    EventType.MAIDEN_CRAB_SPAWN
  ] as MaidenCrabSpawnEvent[];

  const seventies = crabSpawns.filter(
    (evt) => evt.maidenEntity.crab?.spawn === MaidenCrabSpawn.SEVENTIES,
  );
  const fifties = crabSpawns.filter(
    (evt) => evt.maidenEntity.crab?.spawn === MaidenCrabSpawn.FIFTIES,
  );
  const thirties = crabSpawns.filter(
    (evt) => evt.maidenEntity.crab?.spawn === MaidenCrabSpawn.THIRTIES,
  );

  const shouldShowSpawn = (spawn: MaidenCrabSpawnEvent[]) =>
    spawn.length > 0 &&
    (playback === Playback.STOPPED || spawn[0].tick <= tick);

  const showSeventies = shouldShowSpawn(seventies);
  const showFifties = showSeventies && shouldShowSpawn(fifties);
  const showThirties = showFifties && shouldShowSpawn(thirties);

  return (
    <div className={styles.info}>
      <h2>Room events</h2>
      {showSeventies && <CrabSpawn crabs={seventies} />}
      {showFifties && (
        <CrabSpawn
          crabs={fifties}
          tickDiff={fifties[0].tick - seventies[0].tick}
        />
      )}
      {showThirties && (
        <CrabSpawn
          crabs={thirties}
          tickDiff={thirties[0].tick - fifties[0].tick}
        />
      )}
    </div>
  );
}

export default function Maiden() {
  const searchParams = useSearchParams();
  const requestedTick = Number.parseInt(searchParams.get('tick') || '1', 10);

  const [tick, setTick] = useState(requestedTick || 1);
  const [playback, setPlayback] = useState(Playback.STOPPED);

  const events = maidenEvents;

  let tickTimeout = useRef<number | undefined>(undefined);
  const clearTimeout = () => {
    window.clearTimeout(tickTimeout.current);
    tickTimeout.current = undefined;
  };

  const [eventsByTick, eventsByType] = useMemo(
    () => buildEventMaps(events),
    [events],
  );

  const eventsForTick = eventsByTick[tick] || [];

  const lastTick = events[events.length - 1].tick;
  const isLastTick = tick >= lastTick;

  useEffect(() => {
    if (playback === Playback.PLAYING) {
      if (tick < lastTick) {
        tickTimeout.current = window.setTimeout(
          () => setTick(tick + 1),
          TICK_MS,
        );
      } else {
        clearTimeout();
        setPlayback(Playback.STOPPED);
      }
    }
  }, [tick, lastTick, playback]);

  // onclick handler for the play/pause button.
  const onPlayPauseClick = useCallback(() => {
    switch (playback) {
      case Playback.PLAYING:
        clearTimeout();
        setPlayback(Playback.PAUSED);
        break;
      case Playback.STOPPED:
        if (isLastTick) {
          setTick(1);
        }
      // fallthrough
      case Playback.PAUSED:
        setPlayback(Playback.PLAYING);
        break;
    }
  }, [playback, isLastTick]);

  let entities: Entity[] = [];
  for (const evt of eventsForTick) {
    switch (evt.type) {
      case EventType.PLAYER_UPDATE: {
        const e = evt as PlayerUpdateEvent;
        entities.push(
          new PlayerEntity(
            e.xCoord,
            e.yCoord,
            e.player.name,
            e.player.hitpoints,
          ),
        );
        break;
      }
      case EventType.NPC_UPDATE: {
        const e = evt as NpcUpdateEvent;
        entities.push(
          new NpcEntity(
            e.xCoord,
            e.yCoord,
            e.npc.id,
            e.npc.roomId,
            e.npc.hitpoints,
          ),
        );
        break;
      }
    }
  }

  const debugTiles = DEBUG_TILES_TO_MARK.map(
    ([x, y]: [number, number]) => new MarkerEntity(x, y),
  );

  return (
    <div className={styles.maiden}>
      <div className={styles.map}>
        <div className={styles.playback}>
          <button
            className="rounded-l disabled:opacity-50"
            disabled={playback === Playback.STOPPED}
            style={{ border: '1px solid grey', borderRight: 'none' }}
            onClick={() => {
              clearTimeout();
              setPlayback(Playback.STOPPED);
              setTick(1);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-8 h-8"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
              />
            </svg>
          </button>

          <button
            className="rounded-r disabled:opacity-50"
            style={{ border: '1px solid grey' }}
            onClick={onPlayPauseClick}
          >
            {playback === Playback.PLAYING ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-8 h-8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 5.25v13.5m-7.5-13.5v13.5"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="w-8 h-8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
                />
              </svg>
            )}
          </button>
        </div>
        <div className={styles.timer}>
          Tick {tick} ({ticksToFormattedSeconds(tick)})
        </div>
        <Map
          x={MAIDEN_X}
          y={MAIDEN_Y}
          width={MAIDEN_WIDTH}
          height={MAIDEN_HEIGHT}
          baseTiles={maidenBaseTiles}
          tileSize={36}
          entities={entities.concat(debugTiles)}
        />
      </div>
      <RoomInfo eventsByType={eventsByType} playback={playback} tick={tick} />
    </div>
  );
}
