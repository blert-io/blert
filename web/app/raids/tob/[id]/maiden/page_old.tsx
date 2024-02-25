'use client';

import {
  Event,
  EventType,
  MaidenBloodSplatsEvent,
  MaidenCrab,
  MaidenCrabSpawn,
  NpcSpawnEvent,
  NpcUpdateEvent,
  PlayerUpdateEvent,
  Room,
  RoomNpcType,
} from '@blert/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

import { loadEventsForRoom } from '../../../../actions/raid';
import Map, {
  Entity,
  MarkerEntity,
  NpcEntity,
  PlayerEntity,
} from '../../../../components/map';
import ProgressBar from '../../../../components/progress-bar';

import { CrabSpawn, spawnString } from './crab-spawn';
import styles from './style.module.css';
import maidenBaseTiles from './maiden.json';
import { TICK_MS, ticksToFormattedSeconds } from '../../../../utils/tick';

const MAIDEN_X = 3160;
const MAIDEN_Y = 4435;
const MAIDEN_WIDTH = 28;
const MAIDEN_HEIGHT = 24;

const BLOOD_SPLAT_COLOR = '#b93e3e';

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
  const crabSpawns = (
    (eventsByType[EventType.NPC_SPAWN] || []) as NpcSpawnEvent[]
  ).filter((evt) => evt.npc.type === RoomNpcType.MAIDEN_CRAB);

  const seventies = crabSpawns.filter(
    (evt) => evt.npc.maidenCrab?.spawn === MaidenCrabSpawn.SEVENTIES,
  );
  const fifties = crabSpawns.filter(
    (evt) => evt.npc.maidenCrab?.spawn === MaidenCrabSpawn.FIFTIES,
  );
  const thirties = crabSpawns.filter(
    (evt) => evt.npc.maidenCrab?.spawn === MaidenCrabSpawn.THIRTIES,
  );

  const shouldShowSpawn = (spawn: NpcSpawnEvent[]) =>
    spawn.length > 0 &&
    (playback === Playback.STOPPED || spawn[0].tick <= tick);

  const showSeventies = shouldShowSpawn(seventies);
  const showFifties = showSeventies && shouldShowSpawn(fifties);
  const showThirties = showFifties && shouldShowSpawn(thirties);

  return (
    <div className={`${styles.info} ${styles.events}`}>
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

export default function Maiden({ params: { id } }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const requestedTick = Number.parseInt(searchParams.get('tick') || '1', 10);

  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    const getEvents = async () => {
      const evts = await loadEventsForRoom(id, Room.MAIDEN);
      setEvents(evts);
    };

    getEvents();
  }, []);

  const [tick, setTick] = useState(requestedTick || 1);
  const [playback, setPlayback] = useState(Playback.STOPPED);
  const [hoveredPlayer, setHoveredPlayer] = useState('');
  const [selectedEntity, setSelectedEntity] = useState('');

  const [eventsByTick, eventsByType] = useMemo(
    () => buildEventMaps(events),
    [events],
  );

  const eventsForTick = eventsByTick[tick] || [];

  const lastTick = events[events.length - 1]?.tick ?? 0;
  const isLastTick = tick >= lastTick;

  const onTickSelected = useCallback(
    (tick: number) => {
      // @ts-ignore
      clearTimeout();
      setTick(tick);
      if (playback === Playback.STOPPED) {
        setPlayback(Playback.PAUSED);
      }
    },
    [playback],
  );

  const [entities, players] = useMemo(() => {
    const entities: Entity[] = [];
    const players: PlayerEntity[] = [];
    for (const evt of eventsForTick) {
      switch (evt.type) {
        case EventType.PLAYER_UPDATE: {
          const e = evt as PlayerUpdateEvent;
          const player = new PlayerEntity(
            e.xCoord,
            e.yCoord,
            e.player.name,
            e.player.hitpoints,
          );
          player.setHighlight(
            player.getUniqueId() === selectedEntity ||
              player.getUniqueId() === hoveredPlayer,
          );
          entities.push(player);
          players.push(player);
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
        case EventType.MAIDEN_BLOOD_SPLATS:
          const e = evt as MaidenBloodSplatsEvent;
          for (const coord of e.maidenBloodSplats ?? []) {
            entities.push(
              new MarkerEntity(coord.x, coord.y, BLOOD_SPLAT_COLOR),
            );
          }
      }
    }
    return [entities, players];
  }, [tick, selectedEntity, hoveredPlayer]);

  const onEntitySelected = (selected: Entity) => {
    const entity = entities.find(
      (e) => e.getUniqueId() === selected.getUniqueId(),
    );
    if (entity) {
      setSelectedEntity(entity.getUniqueId());
    }
  };

  const spawns = (
    (eventsByType[EventType.NPC_SPAWN] as NpcSpawnEvent[]) || []
  ).filter((evt) => evt.npc.type === RoomNpcType.MAIDEN_CRAB);

  const spawnTicks = spawns.reduce((accum, evt) => {
    const spawn = evt.npc.maidenCrab!.spawn;
    return {
      ...accum,
      [spawn]: {
        label: spawnString(spawn),
        tick: evt.tick,
      },
    };
  }, {});

  const MAP_TILE_SIZE = 35;
  const PROGRESS_BAR_WIDTH = MAIDEN_WIDTH * MAP_TILE_SIZE;

  return (
    <div className={styles.maiden}>
      <div className={styles.map}>
        <ProgressBar
          milestones={Object.values(spawnTicks)}
          onTickSelected={onTickSelected}
          tick={tick}
          totalTicks={lastTick}
          height={35}
          width={PROGRESS_BAR_WIDTH}
        />
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
          tileSize={MAP_TILE_SIZE}
          entities={entities}
          onEntityClicked={onEntitySelected}
        />
      </div>
      <div className={styles.container}>
        <RoomInfo eventsByType={eventsByType} playback={playback} tick={tick} />
        <div className={`${styles.info} ${styles.players}`}>
          <h2>Party</h2>
          {players.map((p) => (
            <button
              key={p.getUniqueId()}
              className={`${styles.player} ${
                p.getUniqueId() === selectedEntity ? styles.selected : ''
              }`}
              onClick={() =>
                setSelectedEntity(
                  p.getUniqueId() === selectedEntity ? '' : p.getUniqueId(),
                )
              }
              onMouseEnter={() => setHoveredPlayer(p.getUniqueId())}
              onMouseLeave={() => setHoveredPlayer('')}
            >
              <div className={styles.name}>{p.name}</div>
              <div className={styles.stats}>
                {p.hitpoints && (
                  <div className={styles.stat}>
                    <Image
                      alt="hitpoints"
                      src="/skills/hitpoints.png"
                      height={16}
                      width={16}
                    />
                    <span>{p.hitpoints.current}</span>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
