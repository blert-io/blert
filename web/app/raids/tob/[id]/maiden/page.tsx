'use client';

import Image from 'next/image';
import {
  Event,
  EventType,
  NpcUpdateEvent,
  PlayerUpdateEvent,
  Room,
} from '@blert/common';
import { useContext, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { loadEventsForRoom } from '../../../../actions/raid';

import styles from './style.module.scss';
import { BossPageAttackTimeline } from '../../../../components/boss-page-attack-timeline/boss-page-attack-timeline';
import { BossPageControls } from '../../../../components/boss-page-controls/boss-page-controls';
import { BossPageReplay } from '../../../../components/boss-page-replay/boss-page-replay';
import { BossPageDPSTimeline } from '../../../../components/boss-page-dps-timeine/boss-page-dps-timeline';
import { createContext } from 'vm';
import { RaidContext } from '../../context';
import { TICK_MS } from '../../../../utils/tick';
import { clamp } from '../../../../utils/math';
import { PlayerEvent } from '@blert/common/dist/event';

export const maidenControlsContext = createContext({
  requestedTick: 1,
});

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

  if (raidData === null || events === null) {
    return <>Loading...</>;
  }

  // #region todo
  const maidenNPCIds = [8360, 8361, 8362, 8363, 8364, 8365];
  const justMaidenNPCEvents = events
    .filter((event) => {
      if (event.type !== EventType.NPC_UPDATE) return;

      const eventAsNpcEvent = event as NpcUpdateEvent;

      return (
        event.type === EventType.NPC_UPDATE &&
        maidenNPCIds.includes(eventAsNpcEvent.npc.id)
      );
    })
    .sort((a, b) => a.tick - b.tick);

  console.log('Just maiden npc events:', justMaidenNPCEvents);

  // for (const partyMember of raidData!.party) {

  const partyMember = 'NACHOCUPOFT';

  let justNachosEventsNormalized = [];

  for (let i = 0; i < totalTicks; i++) {
    const tick = i + 1;
    const eventsForThisTick = events.filter((event: Event) => {
      if (
        [
          EventType.PLAYER_ATTACK,
          EventType.PLAYER_DEATH,
          EventType.PLAYER_UPDATE,
        ].includes(event.type) === false
      )
        return;

      const eventTyped = event as PlayerEvent;

      // And only for this tick
      if (eventTyped.tick !== tick) return;

      // And only for this party member
      if (eventTyped.player.name !== partyMember) return;

      return eventTyped;
    });

    if (eventsForThisTick.length > 1) {
      for (const event of eventsForThisTick) {
        if (event.type === EventType.PLAYER_ATTACK) {
          justNachosEventsNormalized.push(event);
        }
      }
    } else {
      justNachosEventsNormalized.push(eventsForThisTick[0]);
    }
  }

  const arrayOfStrings = [];

  for (let i = 0; i < justNachosEventsNormalized.length; i++) {
    if (justNachosEventsNormalized[i] !== undefined) {
      console.log(justNachosEventsNormalized[i]);
      arrayOfStrings.push(
        `NACHOCUPOFT Tick: ${justNachosEventsNormalized[i].tick}, ACTION: ${justNachosEventsNormalized[i].type}`,
      );
    }
  }

  console.log('Just nachos events:', arrayOfStrings);
  // }

  // const maidensHealthOverTime = justMaidenNPCEvents
  //   .map((event) => {
  //     const npc = (event as NpcUpdateEvent).npc;
  //     return {
  //       tick: event.tick,
  //       health: npc.hitpoints?.current,
  //     };
  //   })
  //   .sort((a, b) => a.tick - b.tick)
  //   .map((event) => event.health);

  // console.log("Maiden's health over time:", maidensHealthOverTime);

  // console.log('\n');
  // #endregion

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
          roomEvents={events}
        />

        <BossPageReplay />

        <BossPageDPSTimeline />
      </div>
    </div>
  );
}
