'use client';

import Image from 'next/image';
import {
  Event,
  EventType,
  PlayerAttackEvent,
  PlayerEvent,
  Room,
  isPlayerEvent,
} from '@blert/common';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { loadEventsForRoom } from '../../../../actions/raid';

import styles from './style.module.scss';
import { BossPageAttackTimeline } from '../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import { BossPageControls } from '../../../../components/boss-page-controls/boss-page-controls';
import { BossPageReplay } from '../../../../components/boss-page-replay/boss-page-replay';
import { BossPageDPSTimeline } from '../../../../components/boss-page-dps-timeine/boss-page-dps-timeline';
import { RaidContext } from '../../context';
import { TICK_MS } from '../../../../utils/tick';
import { clamp } from '../../../../utils/math';

type EventTickMap = { [key: number]: Event[] };
type EventTypeMap = { [key: string]: Event[] };

const maidenNPCIds = [8360, 8361, 8362, 8363, 8364, 8365];

const eventBelongsToPlayer = (event: Event, playerName: string): boolean => {
  if (!isPlayerEvent(event)) return false;

  const eventAsPlayerEvent = event as PlayerEvent;

  return eventAsPlayerEvent.player.name === playerName;
};

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

function buildAttackTimelines(
  party: string[],
  totalTicks: number,
  eventsByTick: EventTickMap,
) {
  let attackTimelines: Map<string, any[]> = new Map();

  for (const partyMember of party) {
    attackTimelines.set(partyMember, new Array(totalTicks));

    let isDead = false;

    for (let i = 0; i < totalTicks; i++) {
      const eventsForThisTick = eventsByTick[i];
      if (eventsForThisTick === undefined) {
        continue;
      }

      const combinedEventsForThisTick = eventsForThisTick
        .filter((event) => eventBelongsToPlayer(event, partyMember))
        .reduce((acc, event) => {
          if (event.type === EventType.PLAYER_DEATH) {
            if (isDead === false) {
              isDead = true;
            }

            return { ...acc, diedThisTick: isDead };
          }

          if (event.type === EventType.PLAYER_UPDATE) {
            const { type, room, raidId, ...rest } = event;
            return { ...acc, ...rest, isDead };
          }

          if (event.type === EventType.PLAYER_ATTACK) {
            return { ...acc, attack: (event as PlayerAttackEvent).attack };
          }

          return acc;
        }, {});

      attackTimelines.get(partyMember)![i] = combinedEventsForThisTick;
    }
  }

  if (
    Array.from(attackTimelines.values()).every(
      (value) => value.length === totalTicks,
    )
  ) {
    // console.log(`All timelines are ${totalTicks} ticks long (good!)`);
  } else {
    console.error('Not all timelines are the same length, this is bad.');
    window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  }

  return attackTimelines;
}

export default function Maiden({ params: { id } }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const raidData = useContext(RaidContext);

  const [currentTick, updateTickOnPage] = useState(1);

  const totalTicks = raidData?.rooms[Room.MAIDEN]!.roomTicks!;

  const tickParam = searchParams.get('tick');
  let parsedTickParam = 0;
  if (tickParam === null) {
    parsedTickParam = 1;
  } else {
    parsedTickParam = Number.parseInt(tickParam, 10);
    if (Number.isNaN(parsedTickParam)) {
      console.log('Unable to parse param as valid int, defaulting to 1');
      parsedTickParam = 1;
    }
  }
  const finalParsedTickParam = clamp(Math.abs(parsedTickParam), 1, totalTicks);

  useEffect(() => {
    updateTickOnPage(finalParsedTickParam);
  }, [finalParsedTickParam]);

  const [playing, setPlaying] = useState(false);
  const [slowMode, setSlowMode] = useState(false);

  const [events, setEvents] = useState<Event[]>([]);

  let tickTimeout = useRef<number | undefined>(undefined);

  const clearTimeout = () => {
    window.clearTimeout(tickTimeout.current);
    tickTimeout.current = undefined;
  };

  const lastTick = events[events.length - 1]?.tick ?? 0;

  useEffect(() => {
    if (playing === true) {
      if (currentTick < lastTick) {
        tickTimeout.current = window.setTimeout(() => {
          updateTickOnPage(currentTick + 1);
        }, TICK_MS);
      } else {
        setPlaying(false);
        clearTimeout();
        updateTickOnPage(1);
      }
    } else {
      clearTimeout();
    }
  }, [currentTick, lastTick, playing]);

  useEffect(() => {
    const getEvents = async () => {
      const evts = await loadEventsForRoom(id, Room.MAIDEN);
      setEvents(evts);
    };

    getEvents();
  }, [id]);

  const [eventsByTick, eventsByType] = useMemo(
    () => buildEventMaps(events),
    [events],
  );

  const attackTimelines = useMemo(() => {
    if (raidData !== null && events.length !== 0) {
      return buildAttackTimelines(raidData.party, totalTicks, eventsByTick);
    }
    return new Map();
  }, [raidData, events]);

  if (raidData === null || events.length === 0) {
    return <>Loading...</>;
  }

  console.log(raidData);

  return (
    <div className={styles.bossPage}>
      <div className={styles.bossPage__Inner}>
        <div className={styles.bossPage__Overview}>
          <div className={styles.bossPage__BossPic}>
            <Image
              src="/maiden.webp"
              alt="Maiden of Sugadinti"
              fill
              style={{ objectFit: 'contain' }}
            />
          </div>
          <div className={styles.bossPage__KeyDetails}>
            <h2>The Maiden of Sugondeez</h2>
          </div>
        </div>

        <BossPageControls
          currentlyPlaying={playing}
          totalTicks={totalTicks}
          currentTick={currentTick}
          updateTick={updateTickOnPage}
          updatePlayingState={setPlaying}
          updateSlowMoState={setSlowMode}
        />

        <BossPageAttackTimeline
          currentTick={currentTick}
          playing={playing}
          attackTimelines={attackTimelines}
        />

        <BossPageReplay />

        <BossPageDPSTimeline />
      </div>
    </div>
  );
}
